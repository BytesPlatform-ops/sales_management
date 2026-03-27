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
- `users` — agents + HR (role: 'hr' | 'agent'), has extension_number, base_salary, shift times, email_name (display name for outbound emails), email_address (agent's FROM email e.g. mike@bytesplatform.com)
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
- **Gov Officer column exclusion**: SBIR CSVs have `Gov Officer Phone/Name/Email` columns — parser now auto-detects columns with "gov officer" in header and excludes them from phone/contact matching. Prevents gov officer numbers being stored instead of actual business contact.
- Upload only requires file + state selection (leads_per_agent removed from upload, handled by distribution only)
- **Smart firm_name fallback**: If CSV has no business name column, parser combines `contact_person + license_type/trade` (e.g., "JAMES CLARK - Certified General Contractor"). Detects columns via keywords: license_type, license type, contractor trade, trade, business_type, permit type desc

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
- 7 pool stat cards: compact colored strips (Total, Fresh, Active, Interested, Recycle, Callback, Dead)
- Page title: "Leads Management" (not "Dialer")
- **Refined UI**: Upload (2-col) + Distribute (3-col) side by side, Recall + Auto-Dist side by side, uppercase section headers with icon badges, single Save button for auto-dist settings

### 5. Agent Lead Card (Agent)
- **Page**: `/agent/dialer-leads` (sidebar label: "My Leads")
- Compact card: avatar, firm name, contact, phone (copy), email, website, address, business description
- Progress bar with pool stats (counts include recycled leads via previous_agents JSONB check)
- **Outcome selection**: Multi-select dropdown (not button grid) — opens upward, checkboxes per outcome, selected shown as colored chips with X to remove
- 8 outcomes: Interested, Not Interested, Gatekeeper, Owner Picked, Voicemail, Busy, Callback, Bad Number
- Submit & Next button + arrow skip button
- Notes field per call
- Sidebar: removed old "Import Leads" and "Power Dialer" links from agent nav

### 6. AI Lead Enrichment (Scraping + GPT) — COMPLETED
- **API**: `POST /api/agent/dialer-leads/ai-enrich`
- Auto-triggers when agent opens a lead (if not already enriched)
- **Flow**: Scrape website → feed scraped content to GPT → generate specific talking points
- **Website Scraping Pipeline** (ported from email-backend-second-prompt NestJS → plain TS functions):
  1. **Strategy 1 - Direct URL**: If website found in raw_data → scrape it (Cheerio first, Playwright for SPAs)
  2. **Strategy 2 - Email Domain**: If email found → extract domain (skip free emails like gmail/yahoo) → Google Custom Search `site:domain.com` → scrape
  3. **Strategy 3 - Business Name Search**: Google Custom Search with `"business name" + state + zip` → scrape discovered URL
  4. **Strategy 4 - Fallback**: If all scraping fails → GPT generates from raw CSV data only
- **Multi-page scraping**: Scrapes homepage + discovers nav links → scrapes services, products, contact, solutions, features, blog pages
- **Hash section extraction**: Single-page sites with `#hash` navigation → extracts section content directly from homepage HTML
- **SPA detection**: Checks for React/Vue/Angular/Next.js → uses Playwright (full browser) instead of Cheerio (HTTP-only)
- **Contact enrichment**: Extracts emails/phones from footer + contact page if not found on homepage
- **Proxy support**: 10 Webshare proxies with round-robin rotation, failure tracking, auto-reset (env: `WEBSHARE_PROXIES`)
- **Cloudflare bypass**: Playwright with stealth settings (webdriver false, fake chrome runtime, plugins), mouse simulation, 30s challenge wait
- **GPT prompt** (CEO directive): Scraped website content fed to GPT with two focus areas:
  1. **"How we can advertise your business"** (points 1-3) — website, SEO, Google Business, social media angles specific to their industry
  2. **"How we can reduce your operational cost"** (points 4-5) — digital tools that save time/money for their specific business type
- GPT-4o-mini generates: "What to Offer" (2-4 service tags) + "Talking Points" (5 specific bullets — conversational, phone-ready)
- Response includes `scrape_method` and `scrape_success` for debugging which strategy was used
- Results cached in DB (only calls GPT once per lead)
- Manual "Generate AI Points" button as fallback
- `.env` keys: `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID`, `WEBSHARE_PROXIES`
- **Scraper files** (all in `frontend/lib/scrapers/`):
  - `proxy-manager.ts` — Webshare proxy rotation (singleton, round-robin, failure tracking)
  - `cheerio-scraper.ts` — Fast HTTP scraper for static sites (axios + cheerio)
  - `playwright-scraper.ts` — Full browser scraper for SPAs (Chromium, stealth mode, Cloudflare bypass)
  - `google-search.ts` — Google Custom Search API (business name + domain search, 5 query variations)
  - `scraping-service.ts` — Orchestrator (3-strategy pipeline, multi-page discovery, contact enrichment, hash sections)

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
  - 4 compact summary stats: Total Interested, Pipeline Value, Overdue Follow-ups, Agents Active
  - 5 color-coded stage cards with arrow connectors (visual funnel), clickable to filter, overdue badges
  - Agent quick-filter chips (first name + lead count + value) + dropdown filter + clear filters
  - Full table view: Lead, Agent, Stage, Follow-up, Deal Value, Notes (uppercase tracking headers)
  - Overdue rows highlighted in red
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

### 12. Send Email During Call (Agent)
- **Purpose**: Agent clicks "Send Email" while on the phone → personalized email sent to client instantly via SendGrid
- **API**: `POST /api/agent/dialer-leads/send-email` — body: `{ lead_id: number }`
- **Flow**:
  1. Extracts recipient email from lead's `raw_data` (auto-detects "email"/"e-mail" columns)
  2. Scrapes business website (same pipeline as AI enrichment — direct URL / email domain / Google search)
  3. Generates personalized email via GPT-4o-mini using **FULL gold standard prompt** (exact copy from email-backend-second-prompt NestJS, adapted for on-call context)
  4. Converts to HTML with Bytes Platform signature (logo, phone numbers, website)
  5. Sends via SendGrid REST API with open/click tracking enabled — **FROM agent's own email** (e.g., mike@bytesplatform.com)
  6. Logs in `dialer_email_logs` table + marks lead `email_sent = true`
- **Email prompt** (FULL port from email-backend, includes all steps GPT must follow):
  - STEP 0: Competitor Detection (10-item checklist — is target a dev/tech/marketing company?)
  - STEP 1: Q1-Q4 Analysis (what do they do, specific interesting thing, real-world urgency, growth+efficiency fit)
  - STEP 2: Write Email — 4 paragraphs with per-paragraph BANNED words and strict rules
  - P1: "It was great speaking with you just now. I'm [Agent] from Bytes Platform..." + genuine business compliment (4 opener variations)
  - P2: Real-world market tension (BANNED: "many companies face", "competitive landscape", "businesses struggle", etc.)
  - P3: Growth (SEO/marketing) + Efficiency (automation/CRM) — one flowing paragraph, less is more
  - P4: "As I mentioned on the call..." + Calendly booking link via `{{BOOKING_LINK}}` placeholder
  - BYTES PLATFORM SERVICES list included (22 services from Web Dev to Blockchain)
  - Subject lines: MUST include business name or contact's first name (not generic marketing headlines)
  - Icebreaker: 25-35 words, sounds like a real sales call opener
- **Per-agent FROM email**: Each agent sends from their own `email_address` (e.g., mike@bytesplatform.com, matt@bytesplatform.com). Falls back to `info@bytesplatform.com` if not set.
- **Competitor detection**: If business is a dev/tech company → only pitch SEO/marketing, never imply missing capability
- **Signature**: Bytes Platform branding with logo, bytesplatform.com, info@bytesplatform.com, phone numbers (833-323-0371, 945-723-0190)
- **Frontend**: "Send Email" button on agent lead card — only shows if lead has email, shows loading spinner, turns to "Email Sent" checkmark after success
- **Tracking**: `dialer_email_logs` table (lead_id, agent_id, recipient_email, subject, body_html, sendgrid_message_id, status, created_at)
- `.env` keys: `SENDGRID_API_KEY`, `SENDER_EMAIL` (fallback: info@bytesplatform.com)

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
agent/dialer-leads/send-email/route.ts — Send personalized email during call (GPT + SendGrid)
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
frontend/.env                          — DB creds, JWT secret, OpenAI key, SendGrid key, 3CX config
database/migrations/create_dialer_leads.sql — Full schema + distribution_settings table
database/migrations/create_call_logs.sql   — dialer_call_logs table (call history per lead)
database/migrations/add_email_sending.sql  — email_sent on dialer_leads + dialer_email_logs table
frontend/lib/scrapers/proxy-manager.ts     — Webshare proxy rotation (singleton)
frontend/lib/scrapers/cheerio-scraper.ts   — Fast HTTP scraper (static sites)
frontend/lib/scrapers/playwright-scraper.ts — Browser scraper (SPAs, Cloudflare bypass)
frontend/lib/scrapers/google-search.ts     — Google Custom Search API wrapper
frontend/lib/scrapers/scraping-service.ts  — Scraping orchestrator (3-strategy pipeline)
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
- AI enrichment scraping pipeline: website → email domain → Google search → fallback GPT-only. Ported from email-backend (NestJS/Prisma) to plain TS functions
- Scraping needs `cheerio`, `axios`, `playwright` npm packages + `npx playwright install chromium`
- Google Search API needs `GOOGLE_API_KEY` + `GOOGLE_SEARCH_ENGINE_ID` in .env
- Proxy rotation optional (`WEBSHARE_PROXIES` env) — works without proxies using direct connection
- TDLR data: filtered version (`tdlr_contractors_only.csv`) removes 50K salons/spas, keeps 18K contractors/specialists for better pickup ratio
- CSV data sources ranked by pickup ratio: CA Sole Owners (35-45%) > FL Contractors (30-40%) > SBIR TX/FL/CA (30-40%) > Austin Permits (30-35%) > TDLR filtered (25-35%) > FL Lodging (skip)
- Upload CSV parser auto-detects: `contractor company name`, `contractor full name`, `contractor trade` columns (Austin permits format)
- SBIR CSV phone bug (fixed 2026-03-27): Gov Officer Phone was being picked instead of actual business Phone. Parser now excludes "gov officer" columns. 1,816 existing SBIR leads fixed via direct DB update + 250 wrongly-called leads reset to pending/fresh.
- `next.config.js`: `serverComponentsExternalPackages` includes `undici`, `cheerio`, `axios`, `playwright` — prevents webpack parsing errors with private class fields
- Send Email feature uses SendGrid REST API directly (no `@sendgrid/mail` npm package) — `SENDGRID_API_KEY` env var required
- Email generation prompt is EXACT copy from email-backend-second-prompt (NestJS) gold standard — includes all steps (Q1-Q4, competitor detection, per-paragraph rules, banned words, opener variations). Only adapted: "I came across today" → "It was great speaking with you just now" for on-call context. max_tokens: 2000.
- `dialer_email_logs` table tracks sent emails (lead_id, agent_id, recipient, subject, body, sendgrid message ID)
- `email_sent` boolean on `dialer_leads` prevents double-sending to same lead
- `email_name` column on `users` table — display name for emails (e.g., abbas→Mike, murtaza→Matt, AHMED→Ahmed, hasan→Daniel Smith, sameer→Sameer). Falls back to `username` if null.
- `email_address` column on `users` table — agent's FROM email (mike@bytesplatform.com, matt@bytesplatform.com, daniel@bytesplatform.com, ahmed@bytesplatform.com, sameer@bytesplatform.com). Falls back to `SENDER_EMAIL` env if null.
- Email prompt is FULL copy from email-backend-second-prompt — includes Q1-Q4 analysis, per-paragraph banned words, 4 opener variations, competitor detection (10 items), BYTES PLATFORM SERVICES list. Only change: "I came across today" → "It was great speaking with you just now" for on-call context.
- Subject line rules: MUST include business name or contact first name. Good: "A thought on growing [Business]". Bad: "Rising demand for secure website solutions".
- Business name cleaned before Google search: removes `*MAIN*`, `*BRANCH*` tags and special chars (CSV artifacts)
- Zip codes cleaned before search: removes `.0` decimal suffix from CSV number formatting (e.g., `78759.0` → `78759`)
