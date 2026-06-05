# Deploying the AI Call QA Module to Render

You already run two Render services from this repo (`BytesPlatform-ops/sales_management`):

| Existing service | Role |
|---|---|
| `sales_management-frontend` | The Next.js app — **already hosts the `/api/cron/*` endpoints** once you push the QA code |
| `sales_management` | Backend (unchanged) |

So we **reuse** `sales_management-frontend` and only **add** the new pieces via the trimmed
`render.yaml` Blueprint:

| New service | Type | Purpose |
|---|---|---|
| `transcription-worker` | Background Worker | Always-on Python loop (faster-whisper + pyannote) |
| `cron-discover-calls` | Cron Job | curls discover — 05:00 PKT daily |
| `cron-daily-eval` | Cron Job | curls daily-eval — 06:00 PKT daily |
| `cron-weekly-coach` | Cron Job | curls weekly-coach — 07:00 PKT Mondays |
| `cron-monthly-rollup` | Cron Job | curls monthly-rollup — 07:00 PKT on the 1st |

> Render Cron Jobs run a **shell command** (`curl`), not an HTTP ping. Schedules are **UTC**.
> Cron Jobs + Workers are **not** free tier.

---

## Step 1 — Commit & push the QA code

Pushing to `main` makes `sales_management-frontend` auto-deploy the new routes/pages.

```bash
cd /Users/bytes/Desktop/3cx
git add render.yaml RENDER_DEPLOY.md \
        worker/ \
        frontend/app/api/cron frontend/app/api/hr/qa-daily frontend/app/api/hr/qa-weekly \
        frontend/app/api/hr/qa-monthly frontend/app/api/agent/coaching \
        frontend/app/\(dashboard\)/hr/qa-daily frontend/app/\(dashboard\)/hr/qa-weekly \
        frontend/app/\(dashboard\)/hr/qa-monthly frontend/app/\(dashboard\)/agent/coaching \
        frontend/lib/shift-date.ts frontend/components/layout/sidebar.tsx frontend/vercel.json \
        .gitignore
git status   # confirm worker/.env is NOT staged (gitignored)
git commit -m "Add AI Call QA module: cron routes, dashboards, worker, Render blueprint"
git push
```

Watch `sales_management-frontend` redeploy in the Render dashboard. The new sidebar links
(Call QA, Weekly Review, Monthly Trends, My Coaching) appear once it's live.

---

## Step 2 — Apply the trimmed Blueprint (creates worker + 4 crons)

1. Render Dashboard → **New** → **Blueprint**.
2. Select the `sales_management` repo. Render reads `render.yaml`.
3. It proposes **5 new services** + the `qa-shared` env group (it will NOT touch your two
   existing services — different names). Click **Apply**.
4. Enter the prompted `sync: false` secrets:

   **`qa-shared` group**
   | Key | Value |
   |---|---|
   | `CRON_SECRET` | a long random string — `openssl rand -hex 32` |
   | `APP_URL` | public URL of `sales_management-frontend` (e.g. `https://sales-management-frontend.onrender.com`) |

   **`transcription-worker`**
   | Key | Value |
   |---|---|
   | `DATABASE_URL` | `postgresql://postgres.wcwaslfuvuboexuldtzy:<PWD>@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres?sslmode=require` |
   | `HUGGINGFACE_TOKEN` | your HF token (pyannote license accepted) |

---

## Step 3 — Add 2 env vars to the EXISTING frontend service

`sales_management-frontend` already has its DB/JWT/Supabase vars. The QA crons need two more:

1. Open `sales_management-frontend` → **Environment**.
2. **Link the `qa-shared` env group** (so `CRON_SECRET` matches what the crons send).
3. Add **`OPENAI_API_KEY`** = your OpenAI key (used by daily-eval, weekly-coach, monthly-rollup).
4. Save → it redeploys.

> Why: the cron routes authenticate the incoming `curl` by comparing its bearer to
> `CRON_SECRET`, and call OpenAI with `OPENAI_API_KEY`. Both must live on the frontend service.

---

## Step 4 — Verify

**Endpoint auth** (replace host + secret):
```bash
curl -X POST "https://sales-management-frontend.onrender.com/api/cron/discover-calls" \
     -H "Authorization: Bearer YOUR_CRON_SECRET"
# Expect: {"status":"success","shiftDate":"...","inserted":N}
```

**Cron jobs:** each has a **"Trigger Run"** button → check the run log + exit code.

**Worker:** `transcription-worker` → **Logs** → expect:
```
Loading faster-whisper 'small.en' ...
Models ready.
Queue empty — polling.
```

**Full smoke test (in order):** Trigger `cron-discover-calls` → watch worker transcribe →
Trigger `cron-daily-eval` → open `/hr/qa-daily` in the app.

---

## Schedule reference

| Cron | UTC | PKT |
|---|---|---|
| discover-calls | `0 0 * * *` | 05:00 daily |
| daily-eval | `0 1 * * *` | 06:00 daily |
| weekly-coach | `0 2 * * 1` | 07:00 Mondays |
| monthly-rollup | `0 2 1 * *` | 07:00 on the 1st |

---

## Gotchas

1. **Worker plan ≥ Standard** — pyannote+torch need ~2–4 GB RAM; tiny plans OOM. `numInstances: 2`
   doubles throughput (SKIP-LOCKED safe) and cost. ~227 calls/night ÷ ~20s ≈ 75 min on one worker,
   so 2–3 instances finish before the 06:00 daily-eval.
2. **`CRON_SECRET` must match** on the frontend service and the crons — that's why Step 3 links
   the `qa-shared` group instead of typing it twice.
3. **First worker build is slow** (torch + pyannote are large Docker layers) — 5–15 min.
4. **Rotate the HuggingFace token** you pasted earlier; the real one lives only in `worker/.env` (gitignored).
5. **No Vercel-style timeout** on Render, so weekly-coach's multiple LLM calls run fine.

---

## Clean up the demo/seed data (when ready for real-only)

```sql
DELETE FROM call_transcripts WHERE threecx_rec_id >= 990000000;  -- cascades to call_evaluations
DELETE FROM daily_scores  WHERE shift_date IN ('2026-06-04','2026-06-05');
DELETE FROM weekly_reports;
DELETE FROM monthly_reports;
DELETE FROM qa_calibration_flags;
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Cron exits non-zero | `curl -f` got 4xx/5xx. 403 = `CRON_SECRET` mismatch; 404 = wrong `APP_URL`. |
| Worker OOM-crashes on boot | Increase plan; or `HUGGINGFACE_TOKEN` missing / license not accepted. |
| Worker idles, nothing transcribes | No `discovered` rows — run `cron-discover-calls`; check `system_settings.recording_access_token`. |
| daily-eval 500 | `OPENAI_API_KEY` not set on the frontend service. |
| Dates look off by a day in logs | node-pg renders `DATE` as UTC — trust `date::text`, not a real bug. |
