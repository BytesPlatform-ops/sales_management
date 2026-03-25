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
- `lead_upload_batches` — tracks each CSV upload (file_name, total_leads, uploaded_by, leads_per_agent, state)
- `dialer_leads` — main leads table with:
  - Core: firm_name, contact_person, phone_number
  - Flexible: `raw_data JSONB` (all CSV columns stored as JSON — columns are NOT fixed)
  - AI: what_to_offer JSONB, talking_points JSONB, ai_generated bool
  - Assignment: assigned_agent_id, assigned_date, batch_id
  - Outcome: call_outcome (enum), call_outcomes JSONB (multiple), call_notes
  - Pool system: `pool` (fresh/active/interested/recycle/callback/dead)
  - Recycle: previous_agents JSONB, max_attempts (default 3), recycle_after_days (default 15), last_outcome_at
  - Pipeline: pipeline_stage, follow_up_at, deal_value, pipeline_notes
  - Routing: `state` VARCHAR(2) — US state code (FL/TX/CA) for timezone-based lead serving
- `dialer_call_logs` — call history per lead (1-to-many with dialer_leads):
  - lead_id, agent_id, call_outcome, call_outcomes JSONB, notes, pool_after, call_number, created_at
  - Preserves full history even after recycle resets dialer_leads fields
  - Indexes: idx_dcl_lead, idx_dcl_agent, idx_dcl_created
- `distribution_settings` — single-row config table:
  - leads_per_agent (default 200), auto_distribute_enabled, auto_distribute_time (PKT, default '19:00')
  - cron_secret (legacy, not used with in-app scheduler), last_auto_distributed_at

### Enum: call_outcome
pending, interested, not_interested, voicemail, busy, gatekeeper, owner_picked, callback, bad_number, dnc

### Indexes
- idx_dl_agent, idx_dl_outcome, idx_dl_agent_outcome, idx_dl_agent_date, idx_dl_batch, idx_dl_phone, idx_dl_raw_data (GIN)
- idx_dl_pool, idx_dl_pipeline (pool + pipeline_stage), idx_dl_follow_up (partial), idx_dl_agent_pipeline
- idx_dl_state, idx_dl_state_pool (state + pool + call_outcome), idx_dl_agent_state (agent + state + call_outcome)

## Features Completed

### 1. CSV Upload + Parse (HR)
- **Page**: `/hr/dialer-leads` (sidebar label: "Leads")
- **API**: `POST /api/hr/dialer-leads/upload` — multipart form, parses 2-row-per-lead CSV format
- **CSV Format**: Row 1 = data (firm, contact, capabilities, email, phone, website), Row 2 = address. Columns A-H only.
- Flexible parser: auto-detects headers, handles any CSV column layout via JSONB
- **Column keywords**: firm → (firm, company, business name, business_name), contact → (contact, owner name, owner_name, full name, full_name, name), phone → (phone, tel, mobile)
- Upload only requires file + state selection (leads_per_agent removed from upload, handled by distribution only)

### 2. Smart Lead Distribution (HR + Auto)
- **API**: `POST /api/hr/dialer-leads/distribute` — manual distribution by HR
- **Shared logic**: `frontend/lib/auto-distribute.ts` — used by both manual API and auto-scheduler
- **Priority order**: 1) Callback leads (same agent) → 2) Recycled leads (different agent) → 3) Fresh leads
- **State-aware round-robin**: Fresh leads distributed evenly across all available states (FL/TX/CA) — not just by ID order
- Recycle logic: avoids assigning to previous agents, respects recycle_after_days
- Configurable leads_per_agent (separate for manual distribute and auto-distribute), optional agent selection for manual distribute
- **Auto top-up**: If agent has 150 pending and limit is 200, only 50 new leads are assigned

### 3. Auto-Distribution (In-App Scheduler)
- **Scheduler**: `frontend/instrumentation.ts` — starts on server boot, checks every 60 seconds
- **Logic**: `frontend/lib/auto-distribute.ts` → `checkAndAutoDistribute()`
  - Checks if auto_distribute_enabled is true
  - Checks if already ran today (prevents duplicate runs)
  - Runs if current PKT time >= configured time (catches late server starts / restarts)
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
- **Outcome selection**: Multi-select dropdown (not button grid) — opens upward, checkboxes per outcome, selected shown as colored chips with X to remove
- 8 outcomes: Interested, Not Interested, Gatekeeper, Owner Picked, Voicemail, Busy, Callback, Bad Number
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
- **Pool rules on outcome** (priority-based, NOT array-index-based):
  - interested / owner_picked → `interested` pool (pipeline_stage = 'new_interested')
  - callback → `callback` pool (same agent gets it back)
  - bad_number / gatekeeper → `dead` pool (unreachable)
  - everything else (not_interested, VM, busy, DNC) → `recycle` pool (different agent after 15 days)
  - After 3 max attempts → `dead` pool
- **Outcome priority hierarchy**: interested > owner_picked > callback > not_interested > voicemail > busy > dnc > gatekeeper > bad_number
  - If agent selects multiple outcomes, highest-priority one determines pool + stored `call_outcome`
  - Positive outcomes (interested, callback) always win over negative (gatekeeper, bad_number)
- `previous_agents` JSONB tracks which agents already called this lead
- **Call history**: Every outcome log inserts into `dialer_call_logs` — full history preserved even after recycle
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

### 10. Timezone-Based Lead Routing (Smart Routing Engine)
- **Purpose**: Maximize US business pick-up rates by calling at optimal local times
- **State tagging**: HR selects US state (FL/TX/CA) when uploading CSV — stored on batch + each lead
- **DST-aware**: Uses `Intl.DateTimeFormat` for timezone conversion — no hardcoded offsets, handles DST automatically
- **Routing logic** (`frontend/lib/timezone-router.ts`):
  - Checks real-time US local time for each state
  - GOLDEN window: 10:00-11:30 AM local → serve fresh leads from that state
  - BEST window: 4:00-5:00 PM local → serve fresh leads from that state
  - GOOD window: 3:00-4:00 PM local → serve fresh leads from that state
  - DEAD ZONE (lunch/post-lunch): serve recycled leads only, protect fresh inventory
- **Next lead API** (`agent/dialer-leads/next/route.ts`):
  - Tries optimal state's assigned leads first
  - **Auto-pull from fresh pool**: If agent exhausts assigned leads for the golden/best state, system auto-assigns a fresh lead from that state's pool (atomic `FOR UPDATE SKIP LOCKED` — no race conditions)
  - Falls back to other states' assigned leads only if primary state fully exhausted (assigned + fresh)
  - Dead zone mode: prioritizes `call_count > 0` (recycled) leads over fresh
  - Returns `routing` info in response (slot type, target state, dead zone flag)
- **HR Upload UI**: State dropdown (FL/TX/CA) required before upload, state badge in batch history
- **Backward compatible**: Leads without `state` (legacy) still served normally as fallback
- **Migration**: `database/migrations/add_state_routing.sql` (safe ADD COLUMN, no destructive changes)

### 11. Recall Leads (HR)
- **Purpose**: HR can take back excess pending leads from agents, returning them to fresh pool
- **API**: `POST /api/hr/dialer-leads/recall` — body: `{ agent_id?: number, keep_count: number }`
- **Logic**: Keeps `keep_count` oldest pending leads per agent (ORDER BY id ASC), recalls the rest
- Recalled leads: `assigned_agent_id = NULL`, `pool = 'fresh'`, `assigned_date = NULL`
- **HR UI**: Recall section on Leads Management page — agent dropdown (or all), keep count input, recall button
- Shows breakdown per agent: how many recalled vs kept
- **Use case**: CEO tells HR "reduce to 100 per agent" → HR sets keep_count=100, clicks recall → done

## File Structure (Key Files)

### API Routes (frontend/app/api/)
```
hr/dialer-leads/upload/route.ts        — CSV upload + parse (requires state: FL/TX/CA)
hr/dialer-leads/distribute/route.ts    — Manual distribution (uses shared logic)
hr/dialer-leads/batches/route.ts       — Batch history + pool stats
hr/dialer-leads/batches/delete/route.ts — Delete batch + its leads
hr/dialer-leads/recall/route.ts        — Recall excess leads from agents back to fresh pool
hr/dialer-leads/settings/route.ts      — GET/PUT auto-distribution settings
hr/pipeline/route.ts                   — HR: all pipeline leads + stage counts + agent breakdown
hr/agents/[id]/route.ts               — Agent CRUD + deactivation returns leads to fresh pool
agent/dialer-leads/next/route.ts       — Get next pending lead (timezone-routed by state)
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
frontend/lib/timezone-router.ts        — DST-aware timezone routing engine (state → optimal call window)
frontend/instrumentation.ts            — Server boot scheduler (checks every 60s for auto-distribute)
frontend/next.config.js                — instrumentationHook: true enabled
frontend/components/layout/sidebar.tsx  — Navigation (role-based, Pipeline added for both roles)
frontend/.env                          — DB creds, JWT secret, OpenAI key, 3CX config
database/migrations/create_dialer_leads.sql — Full schema + distribution_settings table
database/migrations/create_call_logs.sql   — dialer_call_logs table (call history per lead)
```

## Timezone-Based Lead Routing (Smart Routing Engine)

### Business Context
- Sales team works **8:00 PM - 4:00 AM PKT** (night shift), calling US businesses
- Target states: **Florida (EDT/EST)**, **Texas (CDT/CST)**, **California (PDT/PST)**
- Goal: Serve leads from the right US state based on current time to maximize pick-up rates
- Pakistan does NOT observe DST. US observes DST (March–November).

### Research: Best B2B Cold Calling Times (US Local)
- **10:00 - 11:30 AM** — GOLDEN window (highest connect rate, CallHippo/Revenue.io confirmed)
- **4:00 - 5:00 PM** — Second-best window (end-of-day engagement, InsideSales.com)
- **12:00 - 2:00 PM** — DEAD ZONE (lunch, post-lunch slump, avoid fresh leads)
- **2:00 - 3:00 PM** — Post-lunch slump (low response, use for recycled leads only)
- **Best days**: Tuesday - Thursday

### DST Handling (CRITICAL)
- **Must be programmatic** — never hardcode timezone offsets
- Use `Intl.DateTimeFormat` or `date-fns-tz` / `luxon` for conversion
- PKT (UTC+5) to US timezone differences shift by 1 hour when DST toggles
- DST active: ~March 2nd Sunday → November 1st Sunday

### Timezone Offsets Reference
| Timezone | Standard (Nov–Mar) | Daylight (Mar–Nov) |
|---|---|---|
| PKT | UTC+5 (always) | UTC+5 (always) |
| Florida (Eastern) | EST = UTC-5 (10hr diff) | EDT = UTC-4 (9hr diff) |
| Texas (Central) | CST = UTC-6 (11hr diff) | CDT = UTC-5 (10hr diff) |
| California (Pacific) | PST = UTC-8 (13hr diff) | PDT = UTC-7 (12hr diff) |

### Finalized Call Schedule (DST Active — March to November)
| PKT Time | Target State | US Local Time | Slot Type |
|---|---|---|---|
| 8:00 - 9:30 PM | **Texas** (primary) + Florida (secondary, 11-11:30 AM EDT) | 10:00 - 11:30 AM CDT | GOLDEN — Opening act |
| 9:30 - 10:00 PM | Florida | 12:30 - 1:00 PM EDT | DEAD ZONE — Recycle/follow-up only |
| 10:00 - 11:30 PM | **California** | 10:00 - 11:30 AM PDT | GOLDEN — West Coast prime |
| 11:30 PM - 1:00 AM | Texas | 1:30 - 3:00 PM CDT | DEAD ZONE — Recycle/follow-up only |
| 1:00 - 2:00 AM | **Florida** | 4:00 - 5:00 PM EDT | BEST — East Coast closing |
| 2:00 - 3:00 AM | **Texas** | 4:00 - 5:00 PM CDT | BEST — Mid-West closing |
| 3:00 - 4:00 AM | **California** | 3:00 - 4:00 PM PDT | GOOD — West Coast pre-closing |

### Finalized Call Schedule (Standard Time — November to March)
| PKT Time | Target State | US Local Time | Slot Type |
|---|---|---|---|
| 8:00 - 9:30 PM | **Florida** | 10:00 - 11:30 AM EST | GOLDEN |
| 9:30 - 11:00 PM | **Texas** | 10:30 AM - 12:00 PM CST | GOLDEN |
| 11:00 PM - 12:30 AM | **California** | 10:00 - 11:30 AM PST | GOLDEN |
| 12:30 - 1:00 AM | — | — | DEAD ZONE — Recycle only |
| 1:00 - 2:00 AM | — | — | DEAD ZONE — Recycle only |
| 2:00 - 3:00 AM | **Florida** | 4:00 - 5:00 PM EST | BEST |
| 3:00 - 4:00 AM | **Texas** | 4:00 - 5:00 PM CST | BEST |

### Dead Zone Strategy (Recycle Mode)
- During dead zone slots (lunch/post-lunch US time), system switches to **B-Tier routing**:
  1. **Never serve fresh leads** — protect premium inventory for golden hours
  2. **Serve recycled leads** — previously no-answer/voicemail, already "used" leads
  3. **Serve callbacks** — only if callback's scheduled time falls in this window
  4. **Callbacks at prospect's requested time** — always respected, not forced into dead zones

### Implementation Status: COMPLETED
- Schema: `state` VARCHAR(2) added to `dialer_leads` + `lead_upload_batches` — `database/migrations/add_state_routing.sql`
- Upload API: requires state (FL/TX/CA) — `frontend/app/api/hr/dialer-leads/upload/route.ts`
- HR UI: state dropdown + state badge in batch history — `frontend/app/(dashboard)/hr/dialer-leads/page.tsx`
- Routing engine: DST-aware via `Intl.DateTimeFormat` — `frontend/lib/timezone-router.ts`
- Next Lead API: state-prioritized serving + dead zone recycle mode — `frontend/app/api/agent/dialer-leads/next/route.ts`
- Backward compatible: legacy leads (state=NULL) served as fallback

### Key Constraint
- Shift starts at 8:00 PM PKT = 11:00 AM EDT (DST) — Florida's 10:00 AM golden window is **before shift start**, unavoidable
- Texas 10:00 AM CDT = 8:00 PM PKT — perfectly aligns with shift start during DST

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
- Multiple outcomes per lead (call_outcomes JSONB array), primary outcome determined by priority hierarchy (NOT array order)
- Recycle leads go to DIFFERENT agents (tracked via previous_agents)
- `bad_number` and `gatekeeper` go to dead pool. DNC, not_interested etc. all recycle
- Agent stats counter uses `previous_agents @> '[agentId]'::jsonb` to include recycled leads in the count
- Manual distribute has its own "Leads Per Agent" input (separate from auto-distribution settings)
- HR can recall excess leads via Recall section — keeps N leads per agent, returns rest to fresh pool
- All GET API routes for leads use `cache: 'no-store'` + `export const dynamic = 'force-dynamic'` to prevent caching
- JWT `userId` comes as string from payload — always use `Number(jwt.userId)` for comparisons
- SQL parameters used in both SET and WHERE/CASE need explicit `::varchar` cast to avoid "inconsistent types" error
- Agent deactivation automatically returns pending leads to fresh pool
- Auto-distribution uses in-app scheduler (instrumentation.ts), NOT external cron
- Auto-distribute runs if current time >= configured time (not exact match) — handles late server starts
- Fresh lead distribution is state-aware round-robin — agents get leads from all uploaded states evenly
- Next lead auto-pulls from fresh pool during golden/best hours if agent's assigned leads for that state are exhausted
- Auto-pull uses `FOR UPDATE SKIP LOCKED` to prevent race conditions between agents
- `dialer_call_logs` preserves full call history — `call_logs` table is for 3CX recordings (DO NOT TOUCH)
- Existing `call_logs` table (3CX) has 11k+ records — completely separate from dialer system
