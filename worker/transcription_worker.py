#!/usr/bin/env python3
"""
Live Transcription + Diarization Worker for the AI Call QA module.

Pipeline per call:
  claim (FOR UPDATE SKIP LOCKED) -> download from 3CX -> ffmpeg 16k mono
  -> pyannote diarization -> faster-whisper ASR -> align words to speakers
  -> compute talk_ratio -> write transcript/transcript_json -> status='transcribed'
  -> delete local audio.

On any failure: status='failed', error recorded, exponential-ish backoff via next_retry_at.

Run multiple instances safely: the claim uses FOR UPDATE SKIP LOCKED so no two
workers ever grab the same call.

Env (see .env.example):
  DATABASE_URL, THREECX_BASE_URL, THREECX_CLIENT_ID, HUGGINGFACE_TOKEN,
  WHISPER_MODEL, WORKER_POLL_INTERVAL, WORKER_MAX_ATTEMPTS, WHISPER_DEVICE
"""

import os
import gc
import sys
import json
import time
import socket
import signal
import tempfile
import traceback
import subprocess
from datetime import datetime

import requests
import psycopg2
import psycopg2.extras
from psycopg2.extras import Json, RealDictCursor

# Heavy ML imports are done lazily in load_models() so --help / config errors are fast.

# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
DATABASE_URL        = os.environ["DATABASE_URL"]
THREECX_BASE_URL    = os.environ.get("THREECX_BASE_URL", "https://bytesplatform.tx.3cx.us")
THREECX_CLIENT_ID   = os.environ.get("THREECX_CLIENT_ID", "sales")
HF_TOKEN            = os.environ.get("HUGGINGFACE_TOKEN")  # required for pyannote
# faster-whisper / huggingface_hub also read HF_TOKEN; mirror it so both are authenticated.
if HF_TOKEN:
    os.environ.setdefault("HF_TOKEN", HF_TOKEN)
WHISPER_MODEL       = os.environ.get("WHISPER_MODEL", "small.en")
WHISPER_DEVICE      = os.environ.get("WHISPER_DEVICE", "cpu")     # 'cpu' | 'cuda'
WHISPER_COMPUTE     = os.environ.get("WHISPER_COMPUTE", "int8")   # int8 (cpu) | float16 (cuda)
DIARIZATION_MODEL   = "pyannote/speaker-diarization-3.1"
POLL_INTERVAL       = float(os.environ.get("WORKER_POLL_INTERVAL", "5"))
MAX_ATTEMPTS        = int(os.environ.get("WORKER_MAX_ATTEMPTS", "4"))
EARLY_WINDOW_SEC    = 20.0   # window used for the agent/customer speaker heuristic
STALE_LOCK_MIN      = 30     # reclaim rows stuck 'downloading'/'transcribing' this long
MAX_AUDIO_SEC       = int(os.environ.get("MAX_AUDIO_SEC", "180"))  # cap processed audio (mem+time)

WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"

_shutdown = False
def _handle_signal(signum, frame):
    global _shutdown
    print(f"\n[{WORKER_ID}] Signal {signum} received — finishing current call then exiting.")
    _shutdown = True
signal.signal(signal.SIGINT, _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)


def log(msg: str):
    print(f"[{datetime.utcnow().isoformat()}Z] [{WORKER_ID}] {msg}", flush=True)


# ----------------------------------------------------------------------------
# Database
# ----------------------------------------------------------------------------
def connect():
    # autocommit off: the claim runs in its own short transaction.
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    return conn


def reset_stale_locks(conn):
    """Reclaim calls a dead worker left mid-flight."""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            UPDATE call_transcripts
            SET status = 'discovered', locked_by = NULL, locked_at = NULL
            WHERE status IN ('downloading', 'transcribing')
              AND locked_at < now() - interval '{STALE_LOCK_MIN} minutes'
            """
        )
        if cur.rowcount:
            log(f"Reset {cur.rowcount} stale locked row(s).")
    conn.commit()


def claim_next(conn):
    """
    Atomically claim ONE eligible call. FOR UPDATE SKIP LOCKED means concurrent
    workers never collide. Returns the row dict, or None if the queue is empty.
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            UPDATE call_transcripts
            SET status = 'downloading', locked_by = %s, locked_at = now(),
                attempts = attempts + 1
            WHERE id = (
              SELECT id FROM call_transcripts
              WHERE status IN ('discovered', 'failed')
                AND attempts < %s
                AND (next_retry_at IS NULL OR next_retry_at <= now())
              ORDER BY created_at
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            )
            RETURNING *;
            """,
            (WORKER_ID, MAX_ATTEMPTS),
        )
        row = cur.fetchone()
    conn.commit()
    return row


def set_status(conn, row_id, status):
    with conn.cursor() as cur:
        cur.execute("UPDATE call_transcripts SET status = %s WHERE id = %s", (status, row_id))
    conn.commit()


def mark_transcribed(conn, row_id, transcript, transcript_json, talk_ratio, word_count,
                     language, asr_model):
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE call_transcripts
            SET status = 'transcribed',
                transcript = %s,
                transcript_json = %s,
                talk_ratio = %s,
                word_count = %s,
                language = %s,
                asr_model = %s,
                diarization_model = %s,
                error = NULL,
                locked_by = NULL,
                locked_at = NULL
            WHERE id = %s
            """,
            (transcript, Json(transcript_json), talk_ratio, word_count,
             language, asr_model, DIARIZATION_MODEL, row_id),
        )
    conn.commit()


def mark_failed(conn, row_id, attempts, error):
    """Record failure + backoff. Stays eligible for retry until attempts >= MAX."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE call_transcripts
            SET status = 'failed',
                error = %s,
                locked_by = NULL,
                locked_at = NULL,
                next_retry_at = now() + (%s * interval '5 minutes')
            WHERE id = %s
            """,
            (str(error)[:1000], max(attempts, 1), row_id),
        )
    conn.commit()


def get_3cx_secret(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT value FROM system_settings WHERE key = 'recording_access_token' LIMIT 1")
        row = cur.fetchone()
    return row[0] if row else None


# ----------------------------------------------------------------------------
# 3CX audio download
# ----------------------------------------------------------------------------
def get_3cx_token(client_secret: str) -> str:
    resp = requests.post(
        f"{THREECX_BASE_URL}/connect/token",
        data={
            "grant_type": "client_credentials",
            "client_id": THREECX_CLIENT_ID,
            "client_secret": client_secret,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def download_recording(rec_id: int, client_secret: str, dest_path: str):
    """Fresh token per download (3CX JWTs expire in ~60s)."""
    token = get_3cx_token(client_secret)
    url = (
        f"{THREECX_BASE_URL}/xapi/v1/Recordings/"
        f"Pbx.DownloadRecording(recId={rec_id})?access_token={token}"
    )
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(dest_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 16):
                f.write(chunk)
    if os.path.getsize(dest_path) == 0:
        raise RuntimeError("Downloaded recording is empty")


def to_wav16k(src_path: str, dst_path: str):
    """Convert to 16kHz mono PCM, capped at MAX_AUDIO_SEC to bound memory + time."""
    subprocess.run(
        ["ffmpeg", "-y", "-i", src_path, "-ar", "16000", "-ac", "1",
         "-c:a", "pcm_s16le", "-t", str(MAX_AUDIO_SEC), dst_path],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


# ----------------------------------------------------------------------------
# Models (loaded once, reused for every call)
# ----------------------------------------------------------------------------
_whisper = None
_diarizer = None

def load_models():
    global _whisper, _diarizer
    from faster_whisper import WhisperModel
    from pyannote.audio import Pipeline
    import torch

    # Keep memory + CPU overhead low (Render plan has 1 CPU; avoids thread-pool bloat).
    torch.set_num_threads(1)

    log(f"Loading faster-whisper '{WHISPER_MODEL}' on {WHISPER_DEVICE}/{WHISPER_COMPUTE} ...")
    _whisper = WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE)

    if not HF_TOKEN:
        raise RuntimeError("HUGGINGFACE_TOKEN is required for pyannote diarization. "
                           "Accept the model license at hf.co/pyannote/speaker-diarization-3.1")
    log(f"Loading pyannote '{DIARIZATION_MODEL}' ...")
    # pyannote.audio 3.1+ renamed `use_auth_token` -> `token`; support both.
    try:
        _diarizer = Pipeline.from_pretrained(DIARIZATION_MODEL, token=HF_TOKEN)
    except TypeError:
        _diarizer = Pipeline.from_pretrained(DIARIZATION_MODEL, use_auth_token=HF_TOKEN)
    # Apple Silicon: MPS support in pyannote is flaky; CPU is the safe default.
    if WHISPER_DEVICE == "cuda" and torch.cuda.is_available():
        _diarizer.to(torch.device("cuda"))
    log("Models ready.")


# ----------------------------------------------------------------------------
# Diarization + ASR alignment
# ----------------------------------------------------------------------------
def diarize(wav_path: str):
    """Return list of (start, end, speaker_label) sorted by start."""
    result = _diarizer(wav_path)
    # pyannote.audio 4.x returns a DiarizeOutput (use .speaker_diarization);
    # 3.x returns a pyannote.core.Annotation directly. Handle both.
    annotation = getattr(result, "speaker_diarization", result)
    turns = [(seg.start, seg.end, spk)
             for seg, _, spk in annotation.itertracks(yield_label=True)
             if seg.start is not None and seg.end is not None]
    turns.sort(key=lambda t: t[0])
    return turns


def resolve_speaker_roles(turns, call_type: str):
    """
    Map raw pyannote labels (SPEAKER_00/01/...) to 'agent'/'customer'.

    Heuristic: the speaker who dominates the FIRST ~20s is the agent — on an
    outbound call the agent opens; on inbound the agent answers. Returns
    (role_map, suspect) where suspect flags low-confidence mappings for review.
    """
    if not turns:
        return {}, True

    # speaking time per label, overall and within the early window
    early, total = {}, {}
    for start, end, spk in turns:
        if start is None or end is None:
            continue
        dur = max(0.0, end - start)
        total[spk] = total.get(spk, 0.0) + dur
        if start < EARLY_WINDOW_SEC:
            early[spk] = early.get(spk, 0.0) + min(end, EARLY_WINDOW_SEC) - start

    speakers = sorted(total, key=total.get, reverse=True)
    suspect = False

    # >2 speakers (conference/IVR/noise) or only 1 → low confidence
    if len(speakers) != 2:
        suspect = True

    # Pick the early-window leader as agent; fall back to overall leader.
    ranking = early if early else total
    agent_label = max(ranking, key=ranking.get)

    # If the top-2 early speakers are within 20% of each other, mapping is shaky.
    early_sorted = sorted(ranking.values(), reverse=True)
    if len(early_sorted) >= 2 and early_sorted[1] > 0 and early_sorted[0] / early_sorted[1] < 1.2:
        suspect = True

    role_map = {}
    for spk in speakers:
        role_map[spk] = "agent" if spk == agent_label else "customer"
    return role_map, suspect


def speaker_at(turns, t: float):
    """Which diarization label is speaking at time t (point lookup)."""
    for start, end, spk in turns:
        if start <= t <= end:
            return spk
    # nearest turn fallback
    best, best_d = None, 1e9
    for start, end, spk in turns:
        d = min(abs(t - start), abs(t - end))
        if d < best_d:
            best, best_d = spk, d
    return best


def transcribe_and_align(wav_path: str, turns, role_map):
    """
    Run faster-whisper with word timestamps, assign each word to a speaker via
    diarization, group consecutive same-speaker words into turns.
    Returns (full_text, transcript_json, word_count, language).
    """
    segments, info = _whisper.transcribe(
        wav_path, language="en", word_timestamps=True, vad_filter=True
    )

    grouped = []   # [{speaker, start, end, text}]
    word_count = 0

    def role_for(t):
        spk = speaker_at(turns, t) if turns else None
        return role_map.get(spk, "agent") if spk is not None else "agent"

    for seg in segments:
        words = seg.words or []
        if not words:
            # no word timestamps (rare) — attribute the whole segment by its midpoint
            if seg.start is None or seg.end is None:
                continue
            role = role_for((seg.start + seg.end) / 2)
            txt = (seg.text or "").strip()
            if txt:
                _append(grouped, role, seg.start, seg.end, txt)
                word_count += len(txt.split())
            continue
        for w in words:
            # faster-whisper can emit words with None start/end — skip those.
            if w.start is None or w.end is None:
                continue
            mid = (w.start + w.end) / 2
            role = role_for(mid)
            _append(grouped, role, w.start, w.end, (w.word or "").strip())
            word_count += 1

    full_text = "\n".join(f"[{g['speaker']}] {g['text'].strip()}" for g in grouped if g["text"].strip())
    return full_text, grouped, word_count, info.language


def _append(grouped, role, start, end, text):
    if grouped and grouped[-1]["speaker"] == role:
        grouped[-1]["text"] += (" " + text)
        grouped[-1]["end"] = end
    else:
        grouped.append({"speaker": role, "start": round(start, 2), "end": round(end, 2), "text": text})


def compute_talk_ratio(turns, role_map):
    """Agent speaking seconds / total speaking seconds (from diarization)."""
    agent = sum((e - s) for s, e, spk in turns if role_map.get(spk) == "agent")
    total = sum((e - s) for s, e, _ in turns)
    if total <= 0:
        return None
    return round(agent / total, 3)


# ----------------------------------------------------------------------------
# Per-call processing
# ----------------------------------------------------------------------------
def process_call(conn, row, client_secret):
    rec_id = row["threecx_rec_id"]
    row_id = row["id"]
    call_type = row.get("call_type") or "OutboundExternal"
    log(f"Processing id={row_id} rec={rec_id} ext={row.get('extension')} type={call_type}")

    tmpdir = tempfile.mkdtemp(prefix="qa_audio_")
    raw_path = os.path.join(tmpdir, f"{rec_id}.audio")
    wav_path = os.path.join(tmpdir, f"{rec_id}_16k.wav")
    try:
        # 1) download
        download_recording(rec_id, client_secret, raw_path)
        to_wav16k(raw_path, wav_path)

        # 2) diarize + label speakers
        set_status(conn, row_id, "transcribing")
        turns = diarize(wav_path)
        role_map, suspect = resolve_speaker_roles(turns, call_type)

        # 3) transcribe + align
        full_text, tjson, word_count, language = transcribe_and_align(wav_path, turns, role_map)
        talk_ratio = compute_talk_ratio(turns, role_map)

        payload = {
            "speakers": role_map,
            "speaker_mapping_suspect": suspect,
            "turns": tjson,
        }

        # 4) persist + flip to 'transcribed' (audio deleted in finally)
        mark_transcribed(
            conn, row_id,
            transcript=full_text,
            transcript_json=payload,
            talk_ratio=talk_ratio,
            word_count=word_count,
            language=language,
            asr_model=f"faster-whisper:{WHISPER_MODEL}",
        )
        log(f"  ok: {word_count} words, talk_ratio={talk_ratio}, suspect={suspect}")

    except Exception as e:
        tb = traceback.format_exc()
        log(f"  FAILED id={row_id}: {e}\n{tb}")
        try:
            # store the full traceback (truncated) so the exact failing line is visible
            mark_failed(conn, row_id, row.get("attempts", 1), f"{e}\n{tb}")
        except Exception as e2:
            log(f"  (could not mark failed: {e2})")
            conn.rollback()
    finally:
        # 5) always delete local audio
        for p in (raw_path, wav_path):
            try:
                if os.path.exists(p):
                    os.remove(p)
            except OSError:
                pass
        try:
            os.rmdir(tmpdir)
        except OSError:
            pass
        # Release memory between calls so peak RSS stays low on the small plan.
        gc.collect()


# ----------------------------------------------------------------------------
# Main loop
# ----------------------------------------------------------------------------
def main():
    log("Starting transcription worker.")
    load_models()
    conn = connect()

    client_secret = get_3cx_secret(conn)
    if not client_secret:
        log("WARNING: no 3CX 'recording_access_token' in system_settings — downloads will fail.")

    reset_stale_locks(conn)
    idle_logged = False

    while not _shutdown:
        try:
            row = claim_next(conn)
        except psycopg2.Error as e:
            log(f"DB error on claim, reconnecting: {e}")
            try:
                conn.close()
            except Exception:
                pass
            time.sleep(POLL_INTERVAL)
            conn = connect()
            continue

        if row is None:
            if not idle_logged:
                log("Queue empty — polling.")
                idle_logged = True
            reset_stale_locks(conn)
            time.sleep(POLL_INTERVAL)
            continue

        idle_logged = False
        # refresh the 3CX secret occasionally in case HR rotated it
        client_secret = get_3cx_secret(conn) or client_secret
        process_call(conn, row, client_secret)

    log("Shutdown complete.")
    try:
        conn.close()
    except Exception:
        pass


if __name__ == "__main__":
    main()
