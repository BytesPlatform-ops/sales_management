# AI Call QA & Coaching — Session Handoff Context

Repo: `BytesPlatform-ops/sales_management` · App: `frontend/` (Next.js) · Worker: `worker/` (Python)
Frontend URL: `https://sales-management-frontend-d9gp.onrender.com`
DB: Supabase Postgres (transaction pooler `:6543`). CRON_SECRET: `Bytes_sales_analysis_cron_2026`

---

## Pipeline (runs nightly, autopilot)
```
3CX recordings
  → cron discover-calls (05:00 PKT)  → call_transcripts [discovered]
  → Python worker (whisper-only, 2GB) → [transcribed]   (audio deleted)
  → cron daily-eval (06:00 PKT)       → call_evaluations + daily_scores
  → HR /hr/qa-daily (review, flag)
  → cron weekly-coach (Mon 07:00)     → weekly_reports [draft]
  → HR /hr/qa-weekly (publish)        → agent /agent/coaching
  → cron monthly-rollup (1st 07:00)   → monthly_reports → /hr/qa-monthly
```
Shift = overnight 9PM–5AM PKT. `shift_date` pivots on 21:00 (`lib/shift-date.ts`).

## DB tables
- `call_transcripts` — status machine: discovered→downloading→transcribing→transcribed→evaluated (or failed/skipped). Has `scorecard` source transcript, `duration_sec`, `shift_date`.
- `call_evaluations` — one per call. Cols: overall_score, meeting_scheduled, not_evaluable(+reason), **scorecard JSONB**, disposition, attribution_confidence, model_version, prompt_version. UNIQUE(transcript_id).
- `daily_scores` — per agent/shift: calls_total, calls_evaluated, meetings_scheduled, daily_score, **metrics JSONB**. UNIQUE(agent_id, shift_date).
- `weekly_reports` — strengths, weaknesses, custom_scripts, improvement, improvement_rate, narrative, status(draft/published/low_data), prev_report_id. UNIQUE(agent_id, week_start).
- `monthly_reports` — trajectory(improving/flat/declining/low_data), score_trend, persistent_weaknesses, narrative. UNIQUE(agent_id, month).
- `weakness_taxonomy` — 22 controlled weakness IDs (immutable, add-only).
- `qa_calibration_flags` — HR "flag AI error" feedback.

## Models & rubrics
- **daily-eval = gpt-4o** (temp 0, seed 7). **rubric_v3 = DUAL RUBRIC** (routes by `duration_sec`):
  - `< 180s` → **COLD_CALL**: up_front_contract, rapport_tone, objection_validation(null-safe) + explicit_ask, firm_future_commit (booleans).
  - `>= 180s` → **DISCOVERY**: up_front_contract, pain_identification, cost_of_inaction*, budget_qualification*, timeline_urgency*, feature_to_value, objection_validation* + decision_maker_discovery, firm_future_commit. (*=null-safe)
  - Both: un-diarized guardrails → first classify `disposition` + `reconstructed_turns` (agent/prospect attribution), then score. Only `connected_conversation` scored.
  - `overall_score` = mean of non-null numeric dims, **computed in code** (not LLM). Scorecard tagged `rubric: 'cold'|'discovery'`.
- **weekly-coach = gpt-4o** (reads daily_scores + prev week's weaknesses; anti-flattery guardrail).
- **monthly-rollup = gpt-4o-mini**.
- **Transcription = faster-whisper base.en**, diarization OFF (`DIARIZATION_ENABLED=false`) to fit 2GB. Re-enable + 4GB RAM to restore speaker-split/talk_ratio.

## Cron endpoints (all GET+POST, Bearer CRON_SECRET; ?date=YYYY-MM-DD & ?limit=N supported)
`/api/cron/discover-calls`, `/api/cron/daily-eval`, `/api/cron/weekly-coach`, `/api/cron/monthly-rollup`.
daily-eval is batched (limit 40) + drained by `frontend/scripts/drain-eval.sh`.

## Operating commands
```bash
URL="https://sales-management-frontend-d9gp.onrender.com"; SEC="Bytes_sales_analysis_cron_2026"
UA="Mozilla/5.0 (compatible; BytesQA-Cron/1.0)"
# trigger any cron (manual / backfill a date):
curl -fsS -A "$UA" -X POST "$URL/api/cron/daily-eval?date=2026-06-10&limit=40" -H "Authorization: Bearer $SEC"
# re-grade a shift with current rubric: DELETE evals + reset transcripts, then drain:
#   DELETE FROM call_evaluations WHERE shift_date='YYYY-MM-DD';
#   UPDATE call_transcripts SET status='transcribed' WHERE shift_date='YYYY-MM-DD' AND status='evaluated';
```
DB access from repo: `node -e` with `pg` from `/Users/bytes/Desktop/3cx/node_modules/pg`, host/creds in `worker/.env` (gitignored).

## Deployment gotchas (IMPORTANT)
1. **Frontend auto-deploy is OFF** → after any push, manually "Deploy latest commit" on `sales_management-frontend`.
2. **Cloudflare fronts Render** → bare curl gets 429. Fixed with browser UA + `--retry 5 --retry-delay 20`. **Cron SERVICES need a Blueprint re-sync** to pick up the UA fix (else scheduled runs 429).
3. Worker = `type: worker`, Docker, Standard 2GB, 1 instance. pyannote disabled. Gated HF models already accepted.
4. One failed cron run ≠ disabled (fires next schedule). Idempotent; data never lost (stays `transcribed`). Failed night = re-trigger with `?date=`.

## Current data state
- **2026-06-05**: re-graded with **v3** (dual). Scores ~3.1–3.4. ✅
- **2026-06-10**: graded with OLD **v2** (single rubric) — short cold calls unfairly scored on discovery metrics. **NEEDS v3 re-grade.**
- Demo/seed data already purged.

## Open follow-ups (next session)
1. **Re-grade 06-10 (and any v2 shifts) with v3** — reset evals + drain `daily-eval?date=2026-06-10`.
2. **Blueprint-sync cron services** so scheduled runs use the UA fix.
3. **Dashboard `/hr/qa-daily`**: title is hardcoded "rubric v2" (fix), and it renders the fixed v2 field set — should branch on `scorecard.rubric` to cleanly show cold vs discovery cards (cold cards currently show discovery chips as "—").
4. **Calibration**: raise `too_short` cutoff 30s → ~45–60s (so 35s instant-rejections aren't scored). In `daily-eval` `MIN_DURATION_SEC`.
5. Optional: 07:00 safety-net daily-eval cron + look-back auto-catch-up (so a failed night self-heals).
6. Optional: re-enable diarization on a 4GB worker for talk_ratio + speaker-attributed scoring.

## Assessment of current scores (honest)
Low scores (~2–3/10) are **substantively accurate** — agents use vague scripted openers, don't acknowledge objections, rarely ask for a meeting. Dual rubric makes them **fair** (doesn't penalize cold calls for missing deep discovery) but doesn't inflate genuinely weak calls. 06-10 looks extra-low only because it's still on the old single rubric.
