# Sales Onboarding & Training Module

Implements *"Bytes Platform Sales Onboarding and Training Module — Specification and Curriculum"* inside the existing salary system (`frontend/`, Next.js API routes + Supabase Postgres).

**Two decisions override the spec:**
- Onboarding is **3 days** (spec: 10). Day 1 = Track 1 → `PRODUCT_CERT`, Day 2–3 = Track 2 → `LIVE_CALL_CERT` on Day 3. The quota ramp after certification is unchanged (50% → 75% → 100%).
- **Part F (compliance) is out of scope**: no compliance lessons/quiz/gate, no DNC suppression or recording-consent controls. Scorecard criterion 9 is "Accuracy" (no false promises). The 7 compliance exam questions were redistributed (exam = 17 product + 10 classification + 13 sales).

## Install (production)

Nothing changes for anyone until the migration is applied.

```bash
cd frontend
# 1. Dry run: executes everything in a transaction, prints row counts, ROLLBACK.
node scripts/apply-training-migration.js --dry-run
# 2. Apply for real (idempotent; safe to re-run)
node scripts/apply-training-migration.js
```

The script reads `DB_HOST / DB_PORT / DB_USER / DB_PASSWORD` from the environment or `frontend/.env.local`.

- `database/migrations/create_training_module.sql` — schema + config. **Additive only** (`training_*`, `ai_*`, `v_rep_ramp_status`); existing tables are only read. It grandfathers every existing agent as certified with ramp phase `FULL`, so **current pay does not change**.
- `database/migrations/seed_training_content.sql` — the curriculum (3 tracks, 15 courses, 64 lessons, 151 questions, 63 flashcards, 17 objections, 19 classification rows, 11 roleplay scripts). Fill-only: re-running never overwrites trainer edits.

Then deploy the frontend as usual (Render: "Deploy latest commit").

### Environment

| Variable | Needed | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | optional | AI features. Without it everything runs in **standard mode** (scripted roleplays, keyword pitch, rule-based site scan, trainer grading). |
| `TRAINING_SERVICE_TOKEN` | optional | Bearer token for the salary-system integration endpoints (`CRON_SECRET` also works). |
| `OPENAI_BASE_URL` | optional | Proxy / test double for OpenAI (default `https://api.openai.com/v1`). |
| `DB_SSL=false`, `DB_POOL_MAX` | local only | For a local test Postgres. Production keeps SSL. |

## What changes for pay and the dialer

| Rep | Ramp phase | Payroll / agent dashboard | My Leads |
|---|---|---|---|
| Existing agents (at install) | `FULL` (grandfathered) | unchanged | unchanged |
| New agent, before `LIVE_CALL_CERT` | `TRAINING` | **penalty-free**: day scored as 100% performance | blocked (setting `block_dialer_until_certified`) |
| Days 1–30 after cert | `RAMP_50` | penalty-free | open |
| Days 31–60 | `RAMP_75` | targets × 0.75 | open |
| Day 61+ | `FULL` | normal | open |
| Trainer sets `SUPERVISED` | `SUPERVISED` | penalty-free (base pay unaffected) | open |

- Phases are kept as a per-day history (`training_ramp_history`), so payroll applies the phase in effect on each day (`lib/training/ramp.ts → loadRampLookup`, `lib/salary-utils.ts → calculateRampedPerformanceScore`).
- Days and multipliers, penalty-free phases and the dialer gate are all settings (`/hr/training/settings`).
- Roleplay minutes never count as call time.

**Salary-system hooks (B.9):**
- Events go to `training_events_outbox` and are delivered to registered webhooks with `X-Training-Signature: sha256=HMAC(body)`. The event types are `training.track_completed`, `training.certified`, `training.ramp_phase_changed` and `training.supervised_flag`.
- External systems can read the `v_rep_ramp_status` view or call `GET /api/training/integration/ramp-status/{employee_id|all}`.

## Screens

**Rep (agent):**
- `/agent/training`: My Path, certifications, assignments, notifications
- `/agent/training/lesson/[id]`: the lesson player (reading, checklist, flashcard deck, quiz, timed exam, classification and objection drills)
- `/agent/training/today`: the 5-minute daily drill
- `/agent/training/flashcards`: SM-2 review
- `/agent/training/roleplay` and `…/roleplay/[id]`: text roleplay, plus voice when enabled
- `/agent/training/calls`: call grading
- `/agent/training/scoreboard`
- `/agent/training/assist`: Live Assist. It's also a drawer inside My Leads.

**Trainer (hr):**
- `/hr/training`: cohort dashboard
- `/hr/training/rep/[id]`
- `/hr/training/reviews`: the review queue, sorted by lowest score or AI-vs-trainer disagreement
- `/hr/training/content`: lessons with a Markdown editor and versioned publish, the quiz builder, flashcards with CSV import, roleplay personas and scripts, objections, classification rows, the rubric, gates, prompt templates and badges
- `/hr/training/assign`
- `/hr/training/digest`
- `/hr/training/ai`: usage, budgets and models
- `/hr/training/settings`: settings and integration/webhooks

## AI (B.11 / Part E)

- **Gateway:** all AI goes through one server-side gateway, `lib/training/ai.ts`. The browser never sees the key.
- **Models:** set per feature in `training_settings.ai_models`, never hard-coded. The default is `gpt-6-luna`. Transcription uses `gpt-4o-mini-transcribe` and switches to `gpt-transcribe` automatically after 2027-02-26. Voice uses `gpt-realtime-2.1-mini` and is off by default.
- **Prompts:** stored in `ai_prompts`, versioned, and editable by the trainer. The code defaults are version 0. Every call logs its prompt version.
- **Budgets:** per rep per month ($5, or $10 with voice) plus an org-wide cap. A warning goes out at 80%, and calls hard-stop at 100% until the trainer raises the cap. Every call is logged to `ai_sessions` with tokens, cached tokens, cost and latency.
- **Structured outputs:** strict JSON schemas, with an evidence quote required for every score.
- **Caching and cost:** pitch points are cached by a hash of the narrative, and site scans for 7 days per domain. A nightly Batch API job (50% off) pre-computes pitch points for assigned leads.
- **Privacy:** contact names, emails and phone numbers are stripped before prospect data is sent to the AI. Uploaded audio is deleted after 30 days; transcripts and scores are kept.
- **Fallback:** every AI screen shows "AI unavailable — using standard mode" and stays usable.

## Background jobs

These run inside the existing in-app scheduler (`instrumentation.ts`, every 60 s):
- every minute: outbox delivery
- every 10 minutes: batch polling
- daily after 06:00 PKT: ramp advancement, badges, audio purge, the pitch batch, and low-scorecard ("supervised") suggestions
- Mondays: the coach digest

A backup trigger is available at `GET /api/cron/training?job=tick|ramp|outbox|digest` (Bearer `CRON_SECRET`).

## Where things live

| Spec | Code |
|---|---|
| B.3 data model | `database/migrations/create_training_module.sql` |
| C, D, G, H curriculum | `database/migrations/seed_training_content.sql` |
| B.5 gates & certs | `lib/training/progress.ts` (rules in `training_gates`) |
| B.6 exam, quizzes, drills | `lib/training/quiz.ts`, `attempts.ts` |
| E.6 SM-2 | `lib/training/srs.ts`, `daily.ts` |
| E.3 roleplay (AI + scripted fallback) | `lib/training/roleplay.ts` |
| D.19 scorecard, E.5 grading | `lib/training/scorecard.ts`, `call-reviews.ts` |
| C3.2 rubric, E.7 pitch, E.8 site scan | `lib/training/classify.ts`, `assist.ts`, `site-scan.ts` |
| B.9 ramp/outbox | `lib/training/ramp.ts`, `events.ts` |
| B.10 analytics, E.9 scoreboard, E.10 digest | `lib/training/analytics.ts`, `badges.ts`, `digest.ts` |
| B.7 API | `app/api/training/**` (each route documents itself) |

## Things for the trainer to confirm

- **C3.2 scoring table:** the PDF lost its column alignment. Two rows were reconstructed as "No capability statement: Website +1, Revamp +2, Contract-mgmt +1" and "Pure-federal: Website +1, Revamp +1, SEO −3, SMM −2, Contract-mgmt +2". Check `lib/training/classify.ts` and the classification drill rows.
- **Placeholders:** `[PRICE]`, `[TIMELINE]`, `[TOKEN_FEE]` and `[CLOSER/SALES LEAD]` are still in the lessons. Fill them in from Content → Curriculum.
- **Track 3:** "How the Company Works" (Day 1, after Track 1) is written from how the system actually works: tools and a shift, attendance and the salary formula with a worked example, training-period pay, commission (5% when a deal is fully collected), the pipeline handover and logging sales. Fill in `[PAYDAY]` and `[COMMISSION PAYOUT]`: payroll doesn't include commission, so confirm how it is paid.
- **Voice roleplay and the Batch API:** implemented, but only tested against a mock OpenAI server. Try them with the real key before relying on them.
