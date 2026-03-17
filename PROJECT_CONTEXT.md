# Sales Management Platform - Project Context

## Overview
A sales team management platform built with **Next.js 14 (frontend + API routes)** and **PostgreSQL (Supabase)**. Used by a B2B digital agency that sells websites, SEO, Google Business, social media marketing. Agents work night shifts (PKT timezone) calling US businesses. Deployed on **Render**.

## Tech Stack
- **Frontend**: Next.js 14 (App Router), TailwindCSS, lucide-react icons
- **Backend**: Next.js API routes (NOT Express — Express backend exists but most features use Next.js API routes)
- **Database**: PostgreSQL via Supabase (Transaction Pooler), `pg` library
- **Auth**: JWT (jose library in Next.js, jsonwebtoken in Express)
- **AI**: OpenAI GPT-4o-mini for lead enrichment
- **Scheduler**: In-app via `instrumentation.ts` (setInterval, checks every 60s)
- **DB Config**: `frontend/lib/db.ts` (query, queryOne helpers)
- **API Client**: `frontend/lib/api-client.ts` (class-based, token in localStorage)
- **Auth Pattern**: Every API route manually checks `Authorization: Bearer <token>`, verifies with jose, checks role

## Database (PRODUCTION - DO NOT DROP/ALTER DESTRUCTIVELY)
### Existing Tables (DO NOT TOUCH)
- `users` — agents + HR (role: 'hr' | 'agent'), has extension_number, base_salary, shift times
- `leads` — old leads system (still in use by old Power Dialer)
- `attendance`, `daily_stats`, `sales` — existing system tables

### New Tables (Dialer Leads System)
- `lead_upload_batches` — tracks each CSV upload (file_name, total_leads, uploaded_by, leads_per_agent)
- `dialer_leads` — main leads table with:
  - Core: firm_name, contact_person, phone_number
  - Flexible: `raw_data JSONB` (all CSV columns stored as JSON — columns are NOT fixed)
  - AI: what_to_offer JSONB, talking_points JSONB, ai_generated bool
  - Assignment: assigned_agent_id, assigned_date, batch_id
  - Outcome: call_outcome (enum), call_outcomes JSONB (multiple), call_notes
  - Pool system: `pool` (fresh/active/interested/recycle/callback/dead)
  - Recycle: previous_agents JSONB, max_attempts (default 3), recycle_after_days (default 15), last_outcome_at
  - Pipeline: pipeline_stage, follow_up_at, deal_value, pipeline_notes
- `distribution_settings` — single-row config table:
  - leads_per_agent (default 200), auto_distribute_enabled, auto_distribute_time (PKT, default '19:00')
  - cron_secret (legacy, not used with in-app scheduler), last_auto_distributed_at

### Enum: call_outcome
pending, interested, not_interested, voicemail, busy, gatekeeper, owner_picked, callback, bad_number, dnc

### Indexes
- idx_dl_agent, idx_dl_outcome, idx_dl_agent_outcome, idx_dl_agent_date, idx_dl_batch, idx_dl_phone, idx_dl_raw_data (GIN)
- idx_dl_pool, idx_dl_pipeline (pool + pipeline_stage), idx_dl_follow_up (partial), idx_dl_agent_pipeline

## Features Completed

### 1. CSV Upload + Parse (HR)
- **Page**: `/hr/dialer-leads` (sidebar label: "Leads")
- **API**: `POST /api/hr/dialer-leads/upload` — multipart form, parses 2-row-per-lead CSV format
- **CSV Format**: Row 1 = data (firm, contact, capabilities, email, phone, website), Row 2 = address. Columns A-H only.
- Flexible parser: auto-detects headers, handles any CSV column layout via JSONB

### 2. Smart Lead Distribution (HR + Auto)
- **API**: `POST /api/hr/dialer-leads/distribute` — manual distribution by HR
- **Shared logic**: `frontend/lib/auto-distribute.ts` — used by both manual API and auto-scheduler
- **Priority order**: 1) Callback leads (same agent) → 2) Recycled leads (different agent) → 3) Fresh leads
- Recycle logic: avoids assigning to previous agents, respects recycle_after_days
- Configurable leads_per_agent, optional agent selection for manual distribute
- **Auto top-up**: If agent has 150 pending and limit is 200, only 50 new leads are assigned

### 3. Auto-Distribution (In-App Scheduler)
- **Scheduler**: `frontend/instrumentation.ts` — starts on server boot, checks every 60 seconds
- **Logic**: `frontend/lib/auto-distribute.ts` → `checkAndAutoDistribute()`
  - Checks if auto_distribute_enabled is true
  - Compares current PKT time with configured auto_distribute_time
  - Checks if already ran today (prevents duplicate runs)
  - Distributes to ALL active agents using shared distribute logic
- **Settings API**: `GET/PUT /api/hr/dialer-leads/settings`
- **Settings table**: `distribution_settings` (single row, id=1)
- **HR UI**: Toggle on/off, leads per agent input, time picker (PKT), last distributed timestamp
- **Config**: `next.config.js` → `instrumentationHook: true`
- No external cron needed — runs inside the app itself

### 4. Batch Management (HR)
- **API**: `GET /api/hr/dialer-leads/batches` — batch history + pool stats
- **API**: `POST /api/hr/dialer-leads/batches/delete` — delete a batch + all its leads
- Upload history table with per-batch stats + delete button per batch
- 7 pool stat cards: Total, Fresh, Active, Interested, Recycle, Callback, Dead
- Page title: "Leads Management" (not "Dialer")

### 5. Agent Lead Card (Agent)
- **Page**: `/agent/dialer-leads` (sidebar label: "My Leads")
- Compact card: avatar, firm name, contact, phone (copy), email, website, address, business description
- Progress bar with pool stats (counts include recycled leads via previous_agents JSONB check)
- **Multiple outcome selection** (toggle style) — agent can select multiple (e.g., Interested + Owner Picked)
- Submit & Next button + arrow skip button
- Notes field per call
- Sidebar: removed old "Import Leads" and "Power Dialer" links from agent nav

### 6. AI Lead Enrichment (GPT)
- **API**: `POST /api/agent/dialer-leads/ai-enrich`
- Auto-triggers when agent opens a lead (if not already enriched)
- GPT-4o-mini generates: "What to Offer" (service tags) + "Talking Points" (3-5 specific bullets)
- **Deep analysis prompt**: extracts website, capabilities, address, email — forces GPT to analyze the specific business type/industry, not give generic advice
- Explicitly bans generic phrases, requires industry-specific talking points
- Results cached in DB (only calls GPT once per lead)
- Manual "Generate AI Points" button as fallback
- `.env` key: `OPENAI_API_KEY`

### 7. Lead Pool System
- **Pools**: fresh → active → [interested | recycle | callback | dead]
- **Pool rules on outcome**:
  - interested / owner_picked → `interested` pool (pipeline_stage = 'new_interested')
  - callback → `callback` pool (same agent gets it back)
  - bad_number → `dead` pool
  - everything else (not_interested, VM, busy, gatekeeper, DNC) → `recycle` pool (different agent after 15 days)
  - After 3 max attempts → `dead` pool
- `previous_agents` JSONB tracks which agents already called this lead
- HR dashboard shows 7 pool stat cards

### 8. Interested Leads Pipeline
- **5 stages**: New Interested → Follow Up → Proposal Sent → Closed Won → Closed Lost

- **Agent Pipeline Page** (`/agent/pipeline`, sidebar: "Pipeline"):
  - 3 summary cards: Total Pipeline, Pipeline Value ($), Overdue follow-ups
  - Stage tab filters with overdue badges (red pulsing dot)
  - Expandable lead cards — click to edit: stage dropdown, follow-up datetime, deal value, pipeline notes
  - Contact info (phone copy, email, website) in expanded view
  - Overdue follow-ups highlighted in red
  - **API**: `GET /api/agent/pipeline` (with ?stage= filter)
  - **API**: `PUT /api/agent/pipeline` (update stage, follow_up_at, deal_value, pipeline_notes)

- **HR Pipeline Page** (`/hr/pipeline`, sidebar: "Pipeline"):
  - 4 summary cards: Total Interested, Pipeline Value, Overdue Follow-ups, Active Agents
  - 5 clickable stage cards with counts + deal values
  - Agent dropdown filter + stage filter + clear filters
  - Full table view: Lead, Agent, Stage, Follow-up, Deal Value, Notes
  - Overdue rows highlighted in red
  - Agent Pipeline Summary section (clickable to filter by agent)
  - **API**: `GET /api/hr/pipeline` (with ?stage= and ?agent_id= filters)

### 9. Agent Deactivation → Leads Return
- When an agent is deactivated (DELETE or `is_active = false` via PUT), all their **pending/uncalled leads** automatically return to the **fresh pool**
- Leads become available for redistribution to other agents
- Modified: `frontend/app/api/hr/agents/[id]/route.ts` (both PUT and DELETE handlers)

## File Structure (Key Files)

### API Routes (frontend/app/api/)
```
hr/dialer-leads/upload/route.ts        — CSV upload + parse
hr/dialer-leads/distribute/route.ts    — Manual distribution (uses shared logic)
hr/dialer-leads/batches/route.ts       — Batch history + pool stats
hr/dialer-leads/batches/delete/route.ts — Delete batch + its leads
hr/dialer-leads/settings/route.ts      — GET/PUT auto-distribution settings
hr/pipeline/route.ts                   — HR: all pipeline leads + stage counts + agent breakdown
hr/agents/[id]/route.ts               — Agent CRUD + deactivation returns leads to fresh pool
agent/dialer-leads/next/route.ts       — Get next pending lead for agent
agent/dialer-leads/outcome/route.ts    — Log outcome(s), move to correct pool
agent/dialer-leads/ai-enrich/route.ts  — GPT enrichment (deep analysis prompt)
agent/pipeline/route.ts                — Agent: GET pipeline leads, PUT update lead
cron/auto-distribute/route.ts          — External cron endpoint (legacy, kept as backup)
```

### Pages (frontend/app/(dashboard)/)
```
hr/dialer-leads/page.tsx               — HR: Upload CSV + Distribute + Auto-Dist Settings + Stats
hr/pipeline/page.tsx                   — HR: Pipeline overview (all agents, filters, table)
agent/dialer-leads/page.tsx            — Agent: Lead card + outcomes + Submit & Next
agent/pipeline/page.tsx                — Agent: My pipeline (expandable cards, edit stage/follow-up/deal)
```

### Key Config
```
frontend/lib/db.ts                     — PostgreSQL pool + query helpers
frontend/lib/api-client.ts             — API client class
frontend/lib/auto-distribute.ts        — Shared distribution logic + auto-distribute checker
frontend/instrumentation.ts            — Server boot scheduler (checks every 60s for auto-distribute)
frontend/next.config.js                — instrumentationHook: true enabled
frontend/components/layout/sidebar.tsx  — Navigation (role-based, Pipeline added for both roles)
frontend/.env                          — DB creds, JWT secret, OpenAI key, 3CX config
database/migrations/create_dialer_leads.sql — Full schema + distribution_settings table
```

## What's Next (TODO)

### Priority 1: HR Live Monitoring
- Real-time view: which agent is on which lead, how many called today
- Reassign leads between agents
- Bulk recycle / bulk reassign
- Filter by outcome, pool, agent

### Priority 2: Agent Experience
- Callback queue (separate section showing upcoming callbacks with date/time)
- Streak counter / gamification
- Daily target ring (fitness tracker style)
- Quick stats toast after each submission

### Priority 3: Analytics Dashboard
- Conversion funnel: Total → Called → Interested → Proposals → Closed
- Agent comparison (who converts more)
- Lead source quality (which CSV batch produces more interested)
- Best call times analysis

## Important Notes
- Database is PRODUCTION — never drop tables or run destructive migrations
- Deployed on **Render** (web service)
- Timezone: PKT (Asia/Karachi) — agents work US night shifts. Server may run UTC. Don't filter by `assigned_date = today` strictly — use pool-based filtering instead
- Old `leads` table and Power Dialer (`/agent/dialer`) still exist — don't touch them
- CSV columns are NOT fixed — that's why raw_data is JSONB
- Multiple outcomes per lead (call_outcomes JSONB array), primary outcome in call_outcome enum
- Recycle leads go to DIFFERENT agents (tracked via previous_agents)
- Only `bad_number` goes to dead pool. DNC, not_interested etc. all recycle
- Agent stats counter uses `previous_agents @> '[agentId]'::jsonb` to include recycled leads in the count
- All GET API routes for leads use `cache: 'no-store'` + `export const dynamic = 'force-dynamic'` to prevent caching
- JWT `userId` comes as string from payload — always use `Number(jwt.userId)` for comparisons
- SQL parameters used in both SET and WHERE/CASE need explicit `::varchar` cast to avoid "inconsistent types" error
- Agent deactivation automatically returns pending leads to fresh pool
- Auto-distribution uses in-app scheduler (instrumentation.ts), NOT external cron
