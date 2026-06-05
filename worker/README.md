# Transcription Worker

Polls `call_transcripts` for `status='discovered'`, downloads each recording from
3CX, diarizes (pyannote) + transcribes (faster-whisper), writes the transcript +
`talk_ratio` back, flips to `status='transcribed'`, and deletes the local audio.

It is the engine behind the AI Call QA module. The Vercel "discover" cron inserts
rows; this worker drains them; the daily-eval cron grades the `transcribed` rows.

## Setup

```bash
cd worker
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# system dependency:
#   macOS:  brew install ffmpeg
#   Ubuntu: sudo apt-get install -y ffmpeg

cp .env.example .env       # then fill in HUGGINGFACE_TOKEN
# accept the model license: https://hf.co/pyannote/speaker-diarization-3.1
```

## Run

```bash
set -a; source .env; set +a
python transcription_worker.py
```

Run **multiple instances** for throughput — the `FOR UPDATE SKIP LOCKED` claim
guarantees no two workers grab the same call:

```bash
python transcription_worker.py &   # worker 1
python transcription_worker.py &   # worker 2
```

For production, supervise it (systemd, pm2, supervisord) so it restarts on crash.
A dead worker's in-flight rows are auto-reclaimed after 30 min (`reset_stale_locks`).

## State machine

```
discovered → downloading → transcribing → transcribed   (success; audio deleted)
                                         → failed         (retries w/ backoff, gives up at MAX_ATTEMPTS)
stuck downloading/transcribing > 30m → reset to discovered (crash recovery)
```

## Speaker labels

pyannote emits anonymous `SPEAKER_00/01`. The worker maps them to `agent`/`customer`
by who dominates the first ~20s (agent opens outbound / answers inbound), and sets
`transcript_json.speaker_mapping_suspect = true` when confidence is low (≠2 speakers,
or near-equal early airtime). The daily-eval prompt is told to score conservatively
when that flag is set.

## Notes

- **Apple Silicon**: runs on CPU (`WHISPER_DEVICE=cpu`, `int8`). pyannote MPS support
  is flaky; CPU is the safe default. ~10–13× realtime for `small.en`.
- **GPU box**: set `WHISPER_DEVICE=cuda`, `WHISPER_COMPUTE=float16`.
- The 3CX API key is read from `system_settings.recording_access_token` (same source
  as the Next.js routes), not from env.
