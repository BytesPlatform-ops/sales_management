-- Training module: curriculum content seed (tracks, courses, lessons, question bank,
-- flashcards, objection library, classification drill items, roleplay scenarios).
--
-- Source: "Bytes Platform Sales Onboarding and Training Module — Specification and
-- Curriculum", Parts A.5, C, D, G and H, with the business's local decisions:
--   * Onboarding is 3 days (spec: 10). Day 1 = Track 1 → PRODUCT_CERT; Day 2 = T2-C1..C3
--     + roleplay practice; Day 3 = T2-C4..C7 → LIVE_CALL_CERT. Ramp after cert unchanged.
--   * Part F (compliance) is out of scope: no compliance lessons/questions. "Remove me"
--     (#16) and roleplay 7 stay as ordinary etiquette; scorecard criterion 9 = Accuracy.
--
-- Idempotent and fill-only: rows that already exist (by code / num, or a quiz that already
-- has questions, a deck that already has cards) are left untouched, so re-running never
-- overwrites trainer edits, never changes question ids and never touches rep history.
-- Requires create_training_module.sql (rubric CALL_SCORECARD_100) to have run first.

BEGIN;

-- ---------------------------------------------------------------- tracks
INSERT INTO training_tracks (code, title, description, sort_order, is_placeholder, cert_code) VALUES
  ('T1', 'Product Knowledge', 'What we sell and to whom: government contractors, our services, the classification rubric and the 30-second website scan. Day 1 of onboarding; ends with the Product Certification (PRODUCT_CERT).', 1, false, 'PRODUCT_CERT'),
  ('T2', 'Sales Coaching', 'How to run the call: mindset, call anatomy, openers, gatekeepers, voicemail, discovery, booking, objections, psychology, tonality, follow-up, CRM discipline and KPIs. Days 2–3 of onboarding; ends with the Live-Calling Certification (LIVE_CALL_CERT).', 3, false, 'LIVE_CALL_CERT'),
  ('T3', 'How the Company Works', 'Your tools and a shift step by step, how attendance and pay are calculated (with a worked example), your training-period pay and commission, and what happens after a prospect says yes. Day 1 of onboarding.', 2, false, NULL)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------- courses
INSERT INTO training_courses (track_id, code, title, description, sort_order, required, day_number)
SELECT t.id, v.code, v.title, v.description, v.sort_order, v.required, v.day_number
FROM (VALUES
  ('T1', 'C1', 'Who we call & why', 'Government contractors in plain English, reading a SAM.gov row in 10 seconds, and the glossary. Starts with your 3-day plan.', 1, true, 1),
  ('T1', 'C2', 'Our services', 'Websites, SEO, SMM, done-for-you builds & AI automation, and the Bytescon contract-management build.', 2, true, 1),
  ('T1', 'C3', 'Classifying prospects', 'Dial-then-look, the 30-second website scan, the classification rubric & decision tree, and nine worked examples. Ends with the classification drill.', 3, true, 1),
  ('T1', 'C4', 'Product certification', 'Track 1 final exam. With the classification drill (≥8/10) it earns PRODUCT_CERT.', 4, true, 1),
  ('T1', 'C5', 'Bytescon specialist', 'Optional deep dive on the contract-management build. Quiz ≥85% + one Bytescon roleplay ≥75 earns BYTESCON_CERT.', 5, false, NULL::int),
  ('T2', 'T2-C1', 'Mindset & call anatomy', 'Rejection math, detachment, and the 7-stage structure every call follows.', 1, true, 2),
  ('T2', 'T2-C2', 'Openers, gatekeepers, voicemail & callbacks', 'Seven word-for-word openers with the data behind them, gatekeeper scripts, the voicemail policy and callback handling.', 2, true, 2),
  ('T2', 'T2-C3', 'Discovery, bridge, booking & closing', 'The problem-question bank, Label → Link → Light pitch → Question, booking two specific times, and confirming.', 3, true, 2),
  ('T2', 'T2-C4', 'Objection handling', 'A-C-I-R-R and all 17 objections with word-for-word responses. Ends with the objection drill.', 4, true, 3),
  ('T2', 'T2-C5', 'Psychology, tonality, follow-up, CRM & daily routine', 'Ethical persuasion, tonality drills, the follow-up cadence, disposition codes, the daily call-block routine and KPI targets.', 5, true, 3),
  ('T2', 'T2-C6', 'Scorecard, sample calls & roleplay practice', 'The 100-point scorecard, three annotated sample calls, and roleplay practice.', 6, true, 3),
  ('T2', 'T2-C7', 'Live-calling certification', 'Track 2 final exam + two graded roleplays (friendly and skeptical owner). Earns LIVE_CALL_CERT.', 7, true, 3),
  ('T3', 'T3-C1', 'Your tools & a shift', 'Logging in (your check-in), 3CX, every menu item, and a shift from start to finish.', 1, true, 1),
  ('T3', 'T3-C2', 'Attendance & pay', 'Check-in rules, the 3-lates-free rule, how your daily pay is calculated (worked example), your training-period pay, commission and the Golden Ticket.', 2, true, 1),
  ('T3', 'T3-C3', 'From interested lead to paid deal', 'The pipeline stages, handing over to the specialist, and logging sales and payments.', 3, true, 1)
) AS v(track_code, code, title, description, sort_order, required, day_number)
JOIN training_tracks t ON t.code = v.track_code
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------- lessons
-- C1.0: Welcome & your 3-day plan
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C1'), 'C1.0', 'reading', 'Welcome & your 3-day plan',
$md$# Welcome to Bytes Platform sales training

Bytes Platform hires reps with no sales background and no technical background, and that is fine. This training turns everything the sales lead used to teach by hand (what a website "revamp" is, what to say when an owner answers, how to handle "send me an email") into a short, repeatable path.

You learn in **small units**: most lessons take 5–10 minutes. Flashcards use spaced repetition, and a **5-minute daily drill** keeps your skills fresh after you are certified.

## Your 3-day plan

| Day | What you do | Gate / milestone |
|---|---|---|
| **Day 1** | **Track 1 – Product Knowledge.** C1 Who we call & why → C2 Our services → C3 Classifying prospects → C4 Product exam + classification drill | **PRODUCT_CERT**: Track 1 exam ≥80% **and** classification drill ≥8/10 |
| **Day 2** | **Track 2 – Sales Coaching.** T2-C1 Mindset & call anatomy → T2-C2 Openers, gatekeepers, voicemail & callbacks → T2-C3 Discovery, bridge, booking & closing. **AI roleplay practice** (aim for 5+ roleplays) | Each course quiz ≥80% |
| **Day 3** | T2-C4 Objection handling (all 17) + objection drill → T2-C5 Psychology, tonality, follow-up, CRM & daily routine → T2-C6 Scorecard, sample calls & practice → **T2-C7 final exam + 2 graded roleplays** | **LIVE_CALL_CERT**: final exam ≥80%, objection drill ≥80%, 2 exam roleplays ≥70/100 (one friendly owner, one skeptical owner; at least one reviewed by a human) |

### After you are certified (the ramp)

| Period (after LIVE_CALL_CERT) | What you do | Quota |
|---|---|---|
| Days 1–30 | Supervised live calling (60–80 dials/day), daily drill, AI-graded calls | **50% quota**; weekly scorecard average ≥60 |
| Days 31–60 | 100 dials/day; optional Bytescon specialist course (C5) | **75% quota**; optional BYTESCON_CERT |
| Day 61 onward | Full routine | **Full quota**; scorecard average ≥70 |

Your dials only count toward quota **after** LIVE_CALL_CERT. The goal is to reach your full meetings quota by about month 3. That matches The Bridge Group's 2025 benchmark of a 3.0-month average SDR ramp.

## How the path works

- Lessons unlock **in order**. Each course quiz needs **≥80%** to unlock the next course.
- Retakes are unlimited, with a **10-minute cooldown**. Questions are shuffled from the question bank.
- Track 2 opens once you finish C1–C3. You can start the mindset course (T2-C1) in parallel.
- If a certification attempt fails, repeat the failed module and re-test within 3 days.

## Placeholders you will see

Some prices and timelines are not fixed yet. You will see them as **[PRICE]**, **[TIMELINE]**, **[TOKEN_FEE]** (the yearly AI fee for the contract-management build) and **[CLOSER/SALES LEAD]** (the person who runs the meeting you book). Never guess these on a call; say the specialist will confirm.

> A note on numbers: most benchmarks in this course come from vendors (Gong, The Bridge Group) that study SaaS sales teams. Calling small government contractors will produce different numbers. Treat them as starting targets.

## Glossary (plain English)

| Term | Meaning |
|---|---|
| **Dial** | Any outbound call attempt, whether answered or not |
| **Connect / Conversation** | A real person (ideally the decision-maker) picked up and you spoke |
| **Gatekeeper** | Someone who answers for the decision-maker (receptionist, office manager) |
| **Decision-maker (DM)** | The person who can say yes, usually the owner/president at small contractors |
| **Opener** | The first 7–10 seconds of the call |
| **Pattern interrupt** | Saying something unexpected so the prospect stops their automatic "not interested" reflex |
| **Reason for call** | One sentence explaining why you're calling them |
| **Discovery / problem questions** | Questions that uncover whether they have a problem we solve |
| **Pitch / bridge** | Connecting their problem to our service in 1–2 sentences |
| **Meeting / demo** | The next step we book: a 15–30-minute call with [CLOSER/SALES LEAD] |
| **Show rate** | % of booked meetings that actually happen |
| **Objection** | A reason the prospect gives to say no or delay |
| **Brush-off** | An objection that is really a reflex ("not interested"), not a real reason |
| **Disposition** | The code you log after each call (VM, GK, NI, CB, BK, DNC…) |
| **Cadence** | The planned sequence of follow-up calls/emails/texts |
| **SAM.gov** | The federal government's registry; contractors must register to win federal work |
| **NAICS code** | A 6-digit code describing a company's industry; contracts are tagged with them |
| **Set-aside** | Contracts reserved for certain small businesses (8(a), HUBZone, WOSB, SDVOSB, etc.) |
| **Capability statement** | A one-page "resume" for a contractor that contracting officers and primes expect |
| **Contracting officer (CO)** | The government employee who awards contracts |
| **Prime / sub** | A prime holds the government contract and often hires small "subs" |
| **Solicitation / RFP / RFQ** | The government's request for bids |
| **Compliance matrix** | A checklist mapping each requirement in a solicitation to where the proposal answers it |
| **SSL** | The padlock/https on a website; missing = "Not Secure" warning in browsers |
| **SEO** | Making a website show up in Google for searches like "HVAC duct cleaning Tampa" |
| **SMM** | Social media marketing: posts, reels and ads on Facebook/Instagram/LinkedIn |
| **AI automation** | Software that does repetitive office work automatically (answers calls, sends texts, sorts emails) |
| **Ramp** | The period before a new rep is expected to hit full quota |
$md$,
  10, 1, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- C1.1: Government contractors in plain English
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C1'), 'C1.1', 'reading', 'Government contractors in plain English',
$md$# Government contractors in plain English

## What they are

Businesses that sell products or services to **federal, state or local government**. Examples: security guards for a federal building, lockers for a military base, repairs on Air Force aircraft.

Many are **small**: an owner, a few staff, and the owner often answers the phone.

## How small contractors win work (what you should understand)

1. **Register in SAM.gov.** Required to get federal contracts. That's why our lead list exists.
2. **NAICS codes say what they do.** Agencies tag each contract with a NAICS code.
3. **Set-asides:** some contracts are reserved for small businesses or for certified groups (8(a), HUBZone, women-owned, service-disabled veteran-owned).
4. **Market research:** before posting a contract, contracting officers look for capable small businesses. Many search **SBA's Small Business Search (SBS, formerly DSBS)**, and prime contractors use it to find small-business partners.
5. **Capability statement:** the one-page "business resume" COs and primes expect. Contracting officers, small business specialists and primes use it to decide quickly if a company is worth a closer look.
6. **Past performance:** proof they've done similar work before.
7. **Subcontracting to primes:** large primes on big contracts must have small-business subcontracting plans. Under FAR 19.702, as amended by the FAR Council's final rule FAC 2025-06 (effective Oct 1, 2025), the threshold is contracts **over $900,000 ($2 million for construction)**. Primes check out a potential sub before they reply, often on its website.

## Why this matters for us

A contracting officer or a prime's small-business liaison will often **search the company's name online and land on its website**. An outdated or missing website, or no downloadable capability statement, makes a company look less credible exactly when it is being checked.

> These descriptions of CO/prime behavior come from contractor-marketing guides, which have a commercial interest. Present it as **"how it commonly works,"** not as a government rule.

## Where SEO and SMM fit

Contracting officers don't usually find vendors through Google ads or Instagram.

- **Pure-federal contractor** (e.g., aircraft depot maintenance): SEO and social media matter less. The **website, the capability statement and bid tools** matter more.
- **Contractors who also sell to commercial or local customers** (HVAC, duct cleaning, security guards for private businesses, electricians): **SEO and SMM can bring in real revenue.**

Always ask: **"What % of your work is government vs. private/commercial?"**

## Who answers the phone

- Very small firms: often the **owner** (sometimes on a cell phone).
- 10–50 employees: an **office manager or receptionist**.
- Expect gatekeepers more often at larger firms.
$md$,
  8, 2, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- C1.2: Reading a SAM.gov row in 10 seconds
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C1'), 'C1.2', 'reading', 'Reading a SAM.gov row in 10 seconds',
$md$# Reading a SAM.gov row in 10 seconds

**Read in this order:** Firm name → Capabilities Narrative → City/State → Website (blank?) → Contact name.

## What the narrative tells you

| Narrative signal | Likely industry | Likely size | Likely pain points |
|---|---|---|---|
| "ARMED AND UNARMED SECURITY OFFICERS" | Guard services | 10–200 staff, many part-time | Hiring guards, scheduling shifts, winning commercial clients, compliance paperwork |
| "Aircraft CLS, depot maintenance" | Aerospace maintenance (CLS = contractor logistics support) | Specialized, often 20–500 | Credibility with primes, bids/proposals, compliance, tracking deliverables |
| "LOCKERS, SHELVING, BENCHES" | Furniture/storage supplier/reseller | Small reseller or distributor | Quote requests, catalog online, findability by facility managers |
| "Environmental testing lab" / forensic lab | Lab services | 5–50 | Sample intake & tracking, client portal, accreditation display, commercial clients |
| "electrical construction" | Electrical contractor | 5–100 | Commercial/residential leads, bidding, crew scheduling, Google visibility |
| "fasteners/industrial supply" | Distributor | 5–50 | Quote handling, inventory, online catalog, repeat orders |
| "2-way radio & tower construction" | Telecom/communications | 5–50 | Project tracking, credibility, regional commercial clients |
| "HVAC/air duct cleaning" | Home/commercial services | 3–30 | Local leads, reviews, missed calls, appointment booking, seasonal demand |
| "CCTV/access control integrator" | Security systems | 5–50 | Commercial leads, quoting, service contracts, project management |

## Size guesses (rule of thumb)

- A narrative that is **very short, ALL CAPS and lists products** → **small reseller**.
- A **long list of agencies, certifications and contract vehicles** → **larger and more sophisticated**. They are more likely to have a bid team, so they are a better fit for the contract-management build.

## Practice

Next time you open the lead list, cover the website column and try to guess industry, size and one likely pain from the narrative alone in under 10 seconds.
$md$,
  6, 3, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- C1-CARDS: C1 flashcards: contracting terms & glossary
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C1'), 'C1-CARDS', 'flashcard_deck', 'C1 flashcards: contracting terms & glossary',
$md$Flip through the C1 flashcards: government-contracting terms and the glossary words you will hear on every call. Rate each card **Again / Hard / Good / Easy**; cards you find hard come back sooner.
$md$,
  5, 4, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- C1-QUIZ: C1 quiz
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C1'), 'C1-QUIZ', 'quiz', 'C1 quiz',
$md$Course quiz for **C1 Who we call & why**. You need **80%** to unlock C2. Questions are drawn from the bank and shuffled; unlimited retakes with a 10-minute cooldown.
$md$,
  8, 5, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- C2.1: Websites
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C2'), 'C2.1', 'reading', 'Websites',
$md$# Websites

## What it is

The company's home on the internet. We build:

- **Static** – simple pages, fast, cheap to host.
- **Dynamic with admin panel** – the owner can edit content, add news/projects.
- **WordPress** – popular content system, easy edits, many plugins.
- **Frontend** – the visual part, built on an existing backend.
- **Full-stack** – frontend + backend + database, for portals and custom features.
- **Revamps** – redesign/modernize an existing site.
- **New website design.**

## Who needs it

Anyone with **no site**, a **broken site**, an **old site** (no padlock, not mobile-friendly, copyright 2016), or a site with **no capability statement or NAICS/certifications** visible.

## What's included

Pages [N], capability statement page/PDF, contact form, mobile-responsive design, SSL, basic on-page SEO, [hosting/maintenance terms]. **Price: [PRICE]. Delivery: [TIMELINE].**

## Qualifying questions

- "When was the site last updated?"
- "Do primes or contracting officers ever ask for your capability statement? Where do you send them?"
- "Does the site bring you any work today, or is it just there?"
- "Can you edit it yourself, or do you have to call someone?"
- "Who built it? Are they still around?"

## One-liner pitch

> "We build contractor websites that make you look as credible online as you are on the job: capability statement, NAICS codes and certifications front and center, so when a prime or CO looks you up, they see a real company."

## Common prospect questions

| They ask | You say |
|---|---|
| "How long does it take?" | "Usually [TIMELINE]. The specialist will confirm after a 15-minute look." |
| "Do I own it?" | [Confirm company policy; do not guess.] |
| "Can you keep my domain?" | "Yes, we work with your existing domain." [confirm] |

## Do NOT promise

Specific Google rankings, more contracts, "government-approved" anything, delivery dates, or prices outside the approved list.
$md$,
  7, 1, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- C2.2: SEO
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C2'), 'C2.2', 'reading', 'SEO',
$md$# SEO (3-month and 6-month packages)

## What it is

Work that helps a site **show up when people search Google** for what the company does in its area ("air duct cleaning Orlando"). It covers fixing the site, writing useful pages, local listings (**Google Business Profile**), and building reputation.

## Who needs it

Contractors with **commercial/local customers who search online**: HVAC, duct cleaning, electrical, security guards for private sites, integrators, labs serving private clients. **Less relevant for pure-federal firms.**

## Packages

**3-month [PRICE]** and **6-month [PRICE]**. Tell the prospect honestly that **SEO results take time**, so the 6-month package suits companies serious about local leads.

## Qualifying questions

- "When someone in [city] searches for [service], do you show up?"
- "Roughly what % of your work is private vs. government?"
- "Where do your commercial customers come from today?"

## One-liner

> "When a facility manager in [city] Googles [service], we make sure you're one of the first names they see, not the competitor down the street."

## Do NOT promise

**"#1 on Google,"** guaranteed traffic numbers, or results in weeks.
$md$,
  5, 2, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- C2.3: SMM
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C2'), 'C2.3', 'reading', 'SMM',
$md$# Social media marketing (3-month and 6-month)

## What it is

We run their social media. **Each month: 6 posts + 3 reels + an ad strategy.**

The **ad budget is separate**: the client pays **Meta (Facebook/Instagram) directly**. Our fee covers content and strategy, not the ad spend.

## Who needs it

- Companies with **private/local customers**.
- Companies that are **hiring** (security guard companies recruit constantly; social media helps with hiring).
- Contractors whose last post was years ago **look inactive** when someone checks.

## Qualifying questions

- "Do you post anywhere now? When was the last post?"
- "Are you hiring right now? How do you find [guards/technicians]?"
- "Would you be open to running a small ad budget, paid directly to Meta?"

## One-liner

> "Six posts and three reels a month, plus an ad plan, so you look active and busy to every customer, prime and job applicant who checks you out."

## Must say clearly

> "Ad spend is billed by Meta directly to you; our package is the content and strategy."

## Do NOT promise

Follower counts, leads per month or virality.
$md$,
  5, 3, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- C2.4: Done-for-you builds & AI automation
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C2'), 'C2.4', 'reading', 'Done-for-you builds & AI automation',
$md$# Done-for-you custom builds & AI automation

## What we build

- **ERPs** – one system for jobs, inventory, purchasing, billing.
- **CRMs** – track customers, quotes, follow-ups.
- **Management systems** – scheduling, dispatch, HR.
- **Mobile apps.**
- **AI voice receptionist** – answers calls 24/7, takes messages, books appointments.
- **Email automation, SMS automation**, and general **AI automations**.

## AI automation explained for a beginner

> "AI automation means teaching software to do the boring, repeatable office work a person does today."

Examples for a small contractor:

- A **missed call at 7 p.m.** → the AI receptionist answers, asks what they need and texts the owner a summary.
- A **quote request email** arrives → it's sorted, logged in the CRM and answered with a "we got it" message automatically.
- A **guard misses a shift check-in** → an automatic SMS goes to the supervisor.
- A **new solicitation matches their NAICS** → they get an email alert (this overlaps with the contract-management build).

## Who needs it

Busy owners who say "we miss calls," "we're drowning in paperwork," "everything's in spreadsheets," "scheduling is a nightmare."

## Qualifying questions

- "What happens when a call comes in after hours?"
- "What's the most repetitive task your office does every day?"
- "Where do you track jobs, quotes and invoices today? Spreadsheets? Paper?"

## One-liner

> "We build the system that takes the repetitive work off your plate, whether that's answering calls, sending follow-ups or tracking jobs, so you and your office can focus on the work that pays."

## Do NOT promise

Fixed prices before scoping (say **"[PRICE] range, confirmed after a scoping call"**), "replaces employees," or specific timelines.
$md$,
  6, 4, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- C2.5: Bytescon contract-management system
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C2'), 'C2.5', 'reading', 'Bytescon contract-management system',
$md$# Custom contract-management system (internal name: Bytescon)

## Framing rule (critical)

This is **not a subscription** and **not a platform they "sign up for."** We build them **their own system**, customized for their team.

- Say: **"We build you your own in-house system."**
- Never say: ~~"subscribe to our platform."~~

## Pricing

**$5,000–$8,000 one-time** (depends on customization) **+ a minimal yearly fee for AI token usage ([TOKEN_FEE])**.

Explain the yearly fee simply:

> "The system uses AI to read solicitations and draft documents. The yearly fee just covers that AI usage. It's not a subscription to us."

## What it does (plain English)

1. **Finds contracts** at federal level (SAM.gov) and on state & municipal portals, filtered by their state and their work.
2. **Rates each opportunity** against their expertise: a **win-probability score** and a **compliance gate** (does their NAICS match? Are they eligible for the set-aside? Do they have the required certifications?).
3. **Reads the solicitation** and pulls out every requirement into a **compliance matrix** (a checklist of what the proposal must answer).
4. **Drafts the proposal sections** for the team to edit.
5. **Pricing benchmarks** using public award data ("what did similar contracts go for?").
6. **Deadline tracking:** question deadlines, submission dates, reminders.
7. **Teaming/subcontractor handoff:** share a package with partners or subs.
8. **After award:** tracks the contract, deliverables and invoices.

## Who needs it

- **Best fits:** contractors who **bid regularly** (several solicitations a month), have **1–3 people doing business development**, mention **many agencies/contract vehicles** in their narrative, or complain about **deadlines, compliance and proposal writing**.
- **Weak fit:** firms that only subcontract to one prime, or that say they haven't bid in a year.

## Qualifying questions

- "How do you find new solicitations today: SAM.gov alerts, a bid service, someone checking manually?"
- "How many bids do you submit in a typical month?"
- "When a 60-page solicitation drops, who reads it and builds the checklist? How long does that take?"
- "Ever missed a deadline or been disqualified on a compliance detail?"
- "After award, where do you track deliverables and invoices?"

## Pitch (30 seconds)

> "A lot of contractors your size tell us the hard part isn't doing the work, it's finding the right bids and getting proposals out without missing a requirement. We build you your own system, set up for your NAICS codes, your certifications and your states. It pulls opportunities from SAM.gov and state and city portals, scores which ones you can actually win, turns a 60-page solicitation into a compliance checklist, drafts the first version of the proposal, and tracks deadlines and invoices after you win. It's a one-time build, typically $5,000 to $8,000, plus a small yearly fee for the AI usage. It's yours, not a monthly subscription. Would it be crazy to take 20 minutes to see what it would look like for your team?"

## FAQ

| Question | Answer |
|---|---|
| "Is this like GovWin/Deltek?" | "Those are subscription databases built for everyone. This is a system built for your team and workflow: it scores opportunities against your codes and certifications and goes all the way through proposal drafting and post-award tracking. Some clients keep their data service and use this for the work that comes after finding the bid." |
| "Why not just a subscription?" | "You own the build. You pay once for the system and a small yearly AI usage fee, not a monthly seat fee forever." |
| "Does it write the whole proposal?" | "It drafts and organizes; your team reviews and finalizes. You're always in control of what's submitted." |
| "Does it guarantee we win?" | "No. Nothing can. It helps you bid on the right things and not miss requirements or deadlines." |
| "How long to build?" | "[TIMELINE], confirmed after a scoping call." |
| "What's the yearly fee?" | "[TOKEN_FEE]. It covers the AI processing; it's minimal compared to the build." |

## Do NOT promise

Win rates, "approved by the government," access to non-public data, or a fixed delivery date.

> Want to pitch Bytescon on your own? After certification, take the optional **C5 Bytescon specialist** course to earn BYTESCON_CERT.
$md$,
  10, 5, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- C2-CARDS: C2 flashcards: our services
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C2'), 'C2-CARDS', 'flashcard_deck', 'C2 flashcards: our services',
$md$Flip through the C2 flashcards: our services, what each includes, and the words prospects use. Rate each card honestly so the hard ones come back sooner.
$md$,
  5, 6, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- C2-QUIZ: C2 quiz
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C2'), 'C2-QUIZ', 'quiz', 'C2 quiz',
$md$Course quiz for **C2 Our services**. You need **80%** to unlock C3. Expect questions on websites, SEO, SMM, custom builds & AI automation, and the Bytescon contract-management build (including its "not a subscription" framing).
$md$,
  10, 7, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- C3.1: Dial-then-look & 30-second scan
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C3'), 'C3.1', 'reading', 'Dial-then-look & 30-second scan',
$md$# The dial-then-look workflow & 30-second website scan

## Rule: do not research before dialing

Most dials don't connect. Gong's 300M-call analysis reports average reps connecting on **5.4% of dials** (13.3% for top reps). Pre-call research mostly gets wasted on voicemails.

## Workflow (each dial)

1. **Glance (≤10 s):** read Firm Name + Capabilities Narrative + City/State in the list. Form a one-line guess: *"Guard company, Texas, probably also does private sites."*
2. **Dial.**
3. **While it rings:** click the Website URL (or paste it in a second tab). If blank, note **"NO SITE."**
4. **Scan for up to 30 seconds** (checklist below) while ringing / during the gatekeeper / during the opener.
5. **If voicemail:** use the voicemail script (lesson D5), log **VM**, plus one website observation in notes (helps the next call and the follow-up email).
6. **If connected:** use **one live observation** in your reason-for-call or as a discovery question, **phrased as a question, not as criticism**.

## 30-second website scan checklist → what each lets you say

| # | Check (where to look) | If you see… | What you can say (as a question) |
|---|---|---|---|
| 1 | Address bar | "Not secure" / no padlock | "I noticed Chrome flags your site as 'Not secure.' Has anyone mentioned that to you?" |
| 2 | Footer | © year ≤ 2021 | "Looks like the site was last refreshed a few years back. Is that on your list?" |
| 3 | Narrow the browser / phone | Text tiny, menu broken on mobile | "On a phone your site's a bit hard to read. Do primes ever look you up on mobile?" |
| 4 | Menu/homepage | No capability statement, no NAICS/CAGE/certifications | "When a CO or prime looks you up, where do they find your capability statement?" |
| 5 | Header/footer | No social icons, or last post years ago | "Do you do anything on social, or is that not a priority?" |
| 6 | Menu | No blog/news/projects | "Is the site bringing in any private-sector work right now?" |
| 7 | Overall look | Generic template, stock photos, "Lorem ipsum", broken images | "Did someone build it for you, or was it a template?" |
| 8 | Load time | >3 seconds, pop-up errors | "It took a while to load on my end. Has that come up before?" |
| 9 | Contact page | No form, no click-to-call, only a Gmail address | "How do new customers usually reach you, phone or email?" |
| 10 | URL blank or dead | No site / domain parked | "I couldn't find a website for you. Is that intentional, or just hasn't been a priority?" |

## Tone rule

Observations are **questions, never insults**. "Your site is bad" loses the call. **"I noticed X; is that on your radar?"** opens it.

## Website-scan checklist card (keep this next to your screen)

> **30 seconds, while it rings**
>
> ☐ Padlock/https ☐ © year ☐ Mobile-friendly ☐ Capability statement / NAICS / CAGE / certifications ☐ Social links & last post ☐ Blog/news/projects ☐ Template/stock look ☐ Load speed ☐ Contact form / click-to-call ☐ No site at all
>
> → **Turn one finding into one question.**
$md$,
  8, 1, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- C3.2: Classification rubric & decision tree
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C3'), 'C3.2', 'reading', 'Classification rubric & decision tree',
$md$# Classification rubric & decision tree

The rubric tells you **which service to lead with**. You decide from three inputs: the SAM.gov row, your 30-second scan, and the prospect's first answers.

## Step 1: Government mix (ask or infer)

- **Pure-federal:** CLS, depot maintenance, specialized defense supply.
- **Mixed:** guards, HVAC, electrical, integrators, labs.

## Step 2: Score each service

Add points from the SAM row + 30-second scan + first answers:

| Signal | Website (new) | Revamp | SEO | SMM | Automation / Custom | Contract-mgmt build |
|---|---|---|---|---|---|---|
| No URL / dead site | **+5** | | | | | |
| No SSL, © ≤2021, not mobile, template look | | **+4** | +1 | | | |
| No capability statement/NAICS on site | +1 | **+2** | | | | +1 |
| Serves private/local customers (HVAC, duct, electrical, guards, integrator, lab) | | | **+3** | +2 | +1 | |
| No blog/thin content but decent site | | | **+2** | | | |
| No social links or posts >1 yr old | | | | **+2** | | |
| Hiring constantly (guards, techs) | | | | **+2** | +1 | |
| Mentions missed calls, scheduling, spreadsheets, dispatch, inventory | | | | | **+4** | |
| Field crews/shifts/sample intake/quotes volume | | | | | **+2** | |
| Bids regularly / many agencies, vehicles, certifications listed | | | | | | **+4** |
| Has 1–3 BD/proposal staff or owner writes proposals | | | | | | **+2** |
| Pure-federal | +1 | +1 | **−3** | **−2** | | +2 |

## Step 3: Lead with the top score

- Keep the **runner-up** as the "and also" in the meeting.
- **Tie-breaker:** lead with whatever the prospect said hurts.
- If nothing yet, lead with the **most visible issue**: no site > outdated site > invisible on Google.

## Decision tree (quick version)

```
Is there a working website?
├─ NO  → Lead: NEW WEBSITE (+ capability statement page)
└─ YES → Is it outdated (no SSL / old © / not mobile / no cap statement)?
         ├─ YES → Lead: REVAMP
         └─ NO  → Do they bid on many solicitations / have a BD function?
                  ├─ YES → Lead: CONTRACT-MGMT BUILD
                  └─ NO  → Do they have private/local customers?
                           ├─ YES → Missed calls/scheduling pain? → AUTOMATION
                           │        else invisible on Google?     → SEO
                           │        else inactive socials/hiring? → SMM
                           └─ NO (pure federal) → website polish / capability page,
                                                  or AUTOMATION if ops pain, else polite exit
```

## Classification rubric card

| If… | Lead with |
|---|---|
| No website | **New website** (+ capability page) |
| Old/insecure/not mobile/no capability statement | **Revamp** |
| Bids often, BD team, many agencies/certs | **Contract-management build** ($5–8k one-time + yearly AI fee) |
| Private/local customers + invisible on Google | **SEO** (3 or 6 mo) |
| Inactive socials, hiring, local brand | **SMM** (6 posts + 3 reels + ad strategy/mo; ad spend paid to Meta) |
| Missed calls, spreadsheets, scheduling, quotes chaos | **Automation / custom build / AI receptionist** |
| Pure-federal | De-prioritize SEO/SMM; **website + contract-mgmt** |
$md$,
  10, 2, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- C3.3: Worked examples (9 prospect types)
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C3'), 'C3.3', 'reading', 'Worked examples (9 prospect types)',
$md$# Worked examples (nine prospect types)

For each type: what to look for on the site, what to lead with, and a 2-sentence opening hook you can use word-for-word.

| Prospect | Look for on site | Lead with | 2-sentence opening hook |
|---|---|---|---|
| **Aerospace maintenance contractor** ("Aircraft CLS, depot maintenance") | Capability statement, CAGE/NAICS, past performance, modern look; bid volume | **Revamp** (if dated) or **Contract-mgmt build** (if site is solid and they bid a lot) | "I work with maintenance contractors who support DoD programs, and the common headache we hear is chasing solicitations and building compliance checklists by hand. I'm curious how your team handles that today." |
| **Lockers/shelving supplier** | Online catalog? Quote form? Product photos? Mobile? | **Revamp/new website** (catalog + quote form); **SEO** if they sell commercially | "When a facility manager at a base or a school searches for lockers and shelving, they usually want to see products and request a quote on the spot. I was just on your site, and I'm curious: are quote requests coming through it today?" |
| **Forensic/environmental lab** | Accreditations shown? Sample submission info? Client portal? | **Automation/custom** (sample intake, client portal) or **SEO** if commercial clients | "Labs we talk to often lose hours to sample intake, chain-of-custody paperwork and 'is my report ready?' calls. How are you handling that today: spreadsheets, a LIMS, something else?" |
| **Security guard company** ("ARMED AND UNARMED SECURITY OFFICERS") | Hiring page? Social links? Commercial clients? | **SMM** (recruiting + visibility) or **SEO** (commercial clients); automation for shift alerts | "Most guard companies we speak with tell me their two biggest headaches are finding reliable officers and winning private clients beyond government work. Which one's bigger for you right now?" |
| **Electrical contractor** | Project gallery, service area pages, reviews, mobile | **SEO** (commercial/residential leads) or **revamp** if dated | "When a GC or property manager in [city] searches for a commercial electrician, the top three names get most of the calls. I was looking at your site while we connected. Do you know where you show up today?" |
| **Industrial fastener supplier** | Line card/catalog, RFQ form, ordering | **Revamp** (catalog/RFQ) or **automation** (quote handling, inventory) | "Distributors your size tell us quote requests come in by phone, email and fax, and some fall through the cracks. How are you keeping track of RFQs today?" |
| **Radio/tower communications company** | Projects, certifications, coverage area, last update | **Revamp + capability page**; custom system for project tracking | "Tower and two-way radio firms often win work from primes who check their site before calling back. I'm on yours now. Is it showing the projects you've actually done?" |
| **HVAC/duct cleaning** | Reviews, booking button, service pages, Google presence, socials | **SEO + AI receptionist** (missed calls) | "In HVAC and duct cleaning, the company that answers first usually gets the job. What happens today when someone calls you at 7 p.m. or on a Saturday?" |
| **Security systems integrator** (CCTV/access control) | Case studies, certifications (manufacturer), service contracts | **SEO/revamp** for commercial leads; **CRM** for service contracts; **contract-mgmt** if they bid often | "Integrators we work with juggle bids, installs and service contracts all at once. Where's the bigger bottleneck for you right now: getting new projects or keeping track of the ones you have?" |

## Classification drill (for PRODUCT_CERT)

The system shows **10 SAM.gov-style rows** plus a scan result. You pick the **lead service** and one reason. **Pass = 8/10** matching the rubric.
$md$,
  10, 3, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- C3-QUIZ: C3 quiz
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C3'), 'C3-QUIZ', 'quiz', 'C3 quiz',
$md$Course quiz for **C3 Classifying prospects**: the dial-then-look workflow, the 30-second scan, the rubric and the nine worked examples. You need **80%**; after that, take the classification drill.
$md$,
  10, 4, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- C3-DRILL: Classification drill (10 SAM.gov rows)
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C3'), 'C3-DRILL', 'drill', 'Classification drill (10 SAM.gov rows)',
$md$**Classification drill.** You will see 10 SAM.gov-style rows, each with a Capabilities Narrative and a 30-second scan result. For each one, pick the **service to lead with** and give one reason. Follow the C3.2 decision tree: working site? → outdated? → bids often / BD team? → private customers (ops pain → automation, invisible → SEO, inactive socials/hiring → SMM) → pure federal (polish, automation if ops pain, else polite exit). **Pass = 8/10.** This drill is part of PRODUCT_CERT.
$md$,
  10, 5, true, 80, $j${"kind":"classification","count":10}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T1-EXAM: Track 1 final exam
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C4'), 'T1-EXAM', 'exam', 'Track 1 final exam',
$md$**Track 1 final exam (PRODUCT_CERT).** 25 questions drawn at random from the product and classification banks (17 product, 8 classification), shuffled, with a **30-minute timer**. You need **80%**. Together with the classification drill (≥8/10), this earns **PRODUCT_CERT**. If you fail, review the course you struggled with and retake after the cooldown.
$md$,
  30, 1, true, 80, $j${"draw_tags":{"product":17,"classification":8},"time_limit_min":30}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- C5.1: Bytescon deep dive & FAQ
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C5'), 'C5.1', 'reading', 'Bytescon deep dive & FAQ',
$md$# Bytescon deep dive & FAQ

This optional specialist course prepares you to pitch the custom contract-management build (internal name **Bytescon**) on your own. Finish it to earn **BYTESCON_CERT** (quiz ≥85% + 1 Bytescon roleplay ≥75/100).

## The framing rule (never break it)

We **build them their own system**, customized for their team. It is **not a subscription** and not a platform they sign up for.

- Say: **"We build you your own in-house system."**
- Never say: "subscribe to our platform." Pitching the build as a subscription is an **automatic fail** on the scorecard.

## Price, said with certainty

**$5,000–$8,000 one-time** (depends on customization) **+ a minimal yearly AI usage fee ([TOKEN_FEE])**.

> "The system uses AI to read solicitations and draft documents. The yearly fee just covers that AI usage. It's not a subscription to us."

Practice saying "five to eight thousand, one-time" with **zero hesitation**. Gong Labs found win rates were 10% higher when pricing was discussed on the first call, so don't dodge price.

## The eight things it does

1. Finds contracts on SAM.gov and state & municipal portals, filtered by their state and work.
2. Scores each opportunity: win-probability score + **compliance gate** (NAICS match, set-aside eligibility, required certifications).
3. Turns the solicitation into a **compliance matrix**.
4. Drafts proposal sections for the team to edit.
5. Pricing benchmarks from public award data.
6. Deadline tracking and reminders.
7. Teaming/subcontractor handoff packages.
8. Post-award tracking of the contract, deliverables and invoices.

## Best fits vs. weak fits

| Best fits | Weak fits |
|---|---|
| Bid regularly (several solicitations a month) | Only subcontract to one prime |
| 1–3 people doing BD, or the owner writes proposals | Haven't bid in a year |
| Narrative lists many agencies, contract vehicles, certifications | Very short ALL-CAPS product list (small reseller) |
| Complain about deadlines, compliance details, proposal writing | Pure distributor with no bidding |

## The 30-second pitch

> "A lot of contractors your size tell us the hard part isn't doing the work, it's finding the right bids and getting proposals out without missing a requirement. We build you your own system, set up for your NAICS codes, your certifications and your states. It pulls opportunities from SAM.gov and state and city portals, scores which ones you can actually win, turns a 60-page solicitation into a compliance checklist, drafts the first version of the proposal, and tracks deadlines and invoices after you win. It's a one-time build, typically $5,000 to $8,000, plus a small yearly fee for the AI usage. It's yours, not a monthly subscription. Would it be crazy to take 20 minutes to see what it would look like for your team?"

## Qualifying questions

- "How do you find new solicitations today: SAM.gov alerts, a bid service, someone checking manually?"
- "How many bids do you submit in a typical month?"
- "When a 60-page solicitation drops, who reads it and builds the checklist? How long does that take?"
- "Ever missed a deadline or been disqualified on a compliance detail?"
- "After award, where do you track deliverables and invoices?"

## FAQ

| Question | Answer |
|---|---|
| "Is this like GovWin/Deltek?" | "Those are subscription databases built for everyone. This is a system built for your team and workflow: it scores opportunities against your codes and certifications and goes all the way through proposal drafting and post-award tracking. Some clients keep their data service and use this for the work that comes after finding the bid." |
| "Why not just a subscription?" | "You own the build. You pay once for the system and a small yearly AI usage fee, not a monthly seat fee forever." |
| "Does it write the whole proposal?" | "It drafts and organizes; your team reviews and finalizes. You're always in control of what's submitted." |
| "Does it guarantee we win?" | "No. Nothing can. It helps you bid on the right things and not miss requirements or deadlines." |
| "How long to build?" | "[TIMELINE], confirmed after a scoping call." |
| "What's the yearly fee?" | "[TOKEN_FEE]. It covers the AI processing; it's minimal compared to the build." |

## Bytescon demo-question bank (rehearse these)

Questions a BD manager is likely to ask, with answers built only from what we know. If something isn't listed here, say the specialist will confirm on the call.

1. **"Where does it get the opportunities from?"** → "SAM.gov at the federal level, plus state and municipal portals, filtered by your state and your work."
2. **"How does it know which bids we can win?"** → "It scores each opportunity against your expertise and runs a compliance gate: does your NAICS match, are you eligible for the set-aside, do you have the required certifications."
3. **"We already pay for GovWin. Why would we need this?"** → "GovWin covers finding the bid. This is built for your team and covers what comes after: the compliance matrix, the first proposal draft, deadlines and post-award tracking. Some clients keep their data service."
4. **"Is it a subscription?"** → "No. It's a one-time build that's yours, plus a small yearly fee that only covers the AI usage."
5. **"What does it cost?"** → "Typically $5,000 to $8,000 one-time depending on customization, plus [TOKEN_FEE] a year for AI usage."
6. **"Will it write our proposals for us?"** → "It drafts and organizes the first version; your team reviews and finalizes. You're always in control of what's submitted."
7. **"Can you guarantee more wins?"** → "No. Nothing can. It helps you bid on the right things and not miss requirements or deadlines."
8. **"How long until we can use it?"** → "[TIMELINE], confirmed after a scoping call."
9. **"Can we share bid packages with our teaming partners?"** → "Yes, teaming/subcontractor handoff is one of the features: you share a package with partners or subs."
10. **"Does it help after we win?"** → "Yes. It tracks the contract, deliverables and invoices after award."
11. **"How would we know what to bid?"** → "It pulls pricing benchmarks from public award data, so you can see what similar contracts went for."
12. **"Does it have access to inside or non-public data?"** → "No. It works from public sources like SAM.gov, state portals and public award data. I'd never promise non-public data."
13. **"Is it government-approved?"** → "No, and nobody can honestly claim that. It's your own internal tool for finding and managing bids."
14. **"We're a small team. Is this overkill?"** → "Most of who we work with are small, often owner-run. That's exactly why the system is built just for your team instead of an enterprise platform."

## Do NOT promise

Win rates, "approved by the government," access to non-public data, or a fixed delivery date.
$md$,
  10, 1, false, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- C5-QUIZ: Bytescon quiz
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C5'), 'C5-QUIZ', 'quiz', 'Bytescon quiz',
$md$**Bytescon specialist quiz.** You need **85%** (higher than other quizzes) because you will pitch the build on your own. Focus on the framing rule, the price, the eight features, best/weak fits and the FAQ.
$md$,
  8, 2, false, 85, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- C5-RP: Bytescon certification roleplay
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'C5'), 'C5-RP', 'roleplay', 'Bytescon certification roleplay',
$md$**Bytescon certification roleplay.** You will call a BD manager at a contractor that bids often. Qualify the bid process, pitch the build in two sentences tied to their pain, say the price with certainty ($5,000–$8,000 one-time + small yearly AI fee), never call it a subscription, never promise wins, and book a specific time. You need **≥75/100** on one session to earn BYTESCON_CERT (with the quiz).
$md$,
  15, 3, false, 75, $j${"purpose":"exam","scenario_codes":["RP-BYTESCON"],"min_sessions":1,"min_score":75}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D1: Mindset & rejection
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C1'), 'D1', 'reading', 'Mindset & rejection',
$md$# Mindset & rejection

## Key ideas

### It's a numbers game first, a skill game second

Alex Hormozi's **"Rule of 100"** from *$100M Leads* says to do **100 primary outreach actions a day** (e.g., 100 cold calls) **for 100 days**. Volume creates the reps (practice) that build skill.

### Know the math so "no" doesn't hurt

In Gong's 300M+ call analysis, the **average rep connected on 5.4% of dials** and **booked a meeting on 4.6% of connects** (top reps: **13.3%** and **16.7%**).

In other words, an average rep hears "no" or gets no answer on the vast majority of dials. **That's normal.**

### Detach from the outcome

Josh Braun teaches that you're **"sorting, not selling"**: it's fine if they want to talk and fine if they don't. Pressure shows in your voice. **Detachment lowers resistance.**

### "Not interested" is about your message, not you

Braun's point: a prospect's rejection says nothing about your self-worth. **You control** who you call, how many, what you say and how you say it.

## Daily mindset routine

- A **2-minute reset after each call block.** Say out loud:

> "I'm not for everyone. I'm looking for the few who need us."

- **Track activities (dials, conversations) as wins**, not just meetings.
$md$,
  6, 1, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D2: Call anatomy
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C1'), 'D2', 'reading', 'Call anatomy',
$md$# Call anatomy (the structure every call follows)

| Stage | Time | Goal |
|---|---|---|
| **1. Opener** | 0–10 s | Name, company, human moment ("How have you been?") |
| **2. Reason for call** | 10–25 s | One sentence why them: industry problem + live website observation |
| **3. Permission/interest check** | 25–35 s | "Is that something on your radar, or not really?" |
| **4. Problem questions** | 1–3 min | 2–4 questions (lesson D7) |
| **5. Bridge/pitch** | 30 s | Connect their answer to one service |
| **6. Book the meeting** | 1 min | Specific day/time, calendar invite, who attends |
| **7. Confirm & close** | 30 s | Recap, next step, thank you |

## What the data says

- Gong's analysis found that **successful cold calls ran longer** than unsuccessful ones, averaging **5:50 vs 3:14**.
- On successful cold calls, **reps talked about 55% of the time**. That is the opposite of the usual "listen more" advice for discovery calls. On a cold call **you carry the conversation to earn the meeting**. Full discovery happens in the meeting.
- Gong reports that successful calls used **"our/we" collaborative language** more often ("our" to "my" ratio 55% higher).

## How this fits "the more you say, the less you sell"

Hormozi's line: **the more you say, the less you sell.** Keep your pitch short, **one or two sentences, then ask a question**. You can carry the conversation without monologuing about features.

Braun's guidance: **don't talk more than about 15 seconds** without handing the conversation back with a question.
$md$,
  7, 2, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T2-C1-QUIZ: T2-C1 quiz
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C1'), 'T2-C1-QUIZ', 'quiz', 'T2-C1 quiz',
$md$Course quiz for **T2-C1 Mindset & call anatomy**. You need **80%** to unlock T2-C2. Know the Gong numbers, the Rule of 100, "sorting, not selling," and the 7 call stages in order.
$md$,
  8, 3, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D3: Openers
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C2'), 'D3', 'reading', 'Openers',
$md$# Openers (word-for-word, adapted for government contractors)

## Data to know

- In **Gong's 2018 analysis of 90,380 cold calls**, **"How have you been?"** had a **10.01% success rate vs. a 1.5% baseline (6.6x)**.
- Stating **"the reason for my call is…"** lifted success **2.1x**.
- **"Did I catch you at a bad time?"** dropped to **0.9%** (40% less likely to book).
- Gong's later 300M-call guide, as summarized by SalesHive, puts "Did I catch you at a bad time?" at **2.15%**, a **permission-based opener at 11.18%**, and **"Heard the name tossed around?" at 11.24%**.

**Caveats:** these are **correlations from vendor data, not controlled experiments**. Some trainers (e.g., *30 Minutes to President's Club*) prefer permission-based or "heard the name" openers over "how's it going." **Test 2–3 openers** and let your own data decide (track the opener used in the CRM).

## Opener 1 — Gong "How have you been?"

> "Hi [First name], it's [Your name] with Bytes Platform. How have you been?"

*(pause, let them answer, respond like a human)*

> "The reason for my call is: we work with [security/HVAC/aerospace] contractors who are registered on SAM.gov, and I was just looking at your website. Quick question: is it bringing you any work right now, or is it more of a business card?"

## Opener 2 — Permission-based (honest cold call)

> "Hi [First name], [Your name] from Bytes Platform. I'll be honest: this is a cold call. Can I take 30 seconds to tell you why I called, and then you can tell me if it's worth a conversation?"

## Opener 3 — "Heard the name tossed around?"

Only use it while it's honest. If they say no, just move on.

> "Hi [First name], [Your name] with Bytes Platform. Have you heard our name tossed around?"

"No." →

> "No worries, we're the team that builds websites and bid-management systems for government contractors. The reason I'm calling…"

## Opener 4 — Chris Voss "no-oriented" opener

> "Hi [First name], [Your name] from Bytes Platform. Would it be a terrible idea if I took 30 seconds to explain why I called?"

Voss's method frames questions so **"no" is the safe answer**, which lowers defensiveness. "No, go ahead" is the typical reply.

**Do not use "Is now a bad time?"** Even though Voss mentions it as a no-oriented question, Gong's cold-call data shows the "bad time" wording performs worst on cold calls.

## Opener 5 — Josh Braun "poke the bear" (problem-first)

> "Hi [First name], [Your name] with Bytes Platform. The reason for my call: a lot of small contractors we talk to are finding solicitations late, sometimes a week before they're due, because they're checking SAM.gov and state portals by hand. Just out of curiosity, how are you finding new bids today?"

Braun: describe a common problem, then ask a **neutral question about how they do it today**, with no agenda.

## Opener 6 — Live-observation opener (uses the dial-then-look scan)

> "Hi [First name], it's [Your name] with Bytes Platform. How have you been? … The reason I'm calling: I'm on your website right now while we talk, and I noticed it doesn't have your capability statement or NAICS codes on it. When a prime or contracting officer looks you up, where do they usually find that?"

## Opener 7 — Pattern interrupt (light humor, for experienced reps only)

> "Hi [First name], [Your name] here. You're probably going to want to hang up on me because this is a cold call… can I have 30 seconds, and then you decide?"

## Tonality for all openers

**Calm, slower than normal, a smile in your voice, a downward tone at the end of statements.** Avoid sounding nervous with rising "uptones."
$md$,
  10, 1, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D4: Gatekeeper scripts
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C2'), 'D4', 'reading', 'Gatekeeper scripts',
$md$# Gatekeeper scripts

**Principles:** be **polite, brief and confident**. Use the owner's **first name**. Treat the gatekeeper as an **ally, not a wall**.

## Standard

> "Hi, this is [Name] with Bytes Platform. Is [First name] around?"

## When they push back

| Gatekeeper says | You say |
|---|---|
| "What's this regarding?" | "It's about how [Company] shows up when primes and contracting officers look you up online. Is [First name] the right person for that, or is someone else in charge of the website and bids?" |
| "Is this a sales call?" | "It is. I'll be quick. I'm trying to find out who handles your website and bid process. Would that be [First name], or someone else?" |
| "He's busy." | "No problem. When's usually a good time to catch them, early morning or end of day?" *(log **CB** with time)* |
| "Send an email." | "Happy to. What's the best email for [First name]? And so I send something useful: is the website or the bid process the bigger priority right now?" |

## Make them a referral source

> "You probably know this better than anyone: who updates the website there?"

Log **GK** with the gatekeeper's name, the decision-maker's name and the best time to call.
$md$,
  6, 2, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D5: Voicemail policy & scripts
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C2'), 'D5', 'reading', 'Voicemail policy & scripts',
$md$# Voicemail policy & scripts

## Policy

- Gong's 300M-call guide advises leaving **1–2 voicemails** to boost email replies and **moving on after about 5 dials**, because connect rates fall after that.
- Gong Engage data also reports that **leaving a voicemail doubles the likelihood of an email reply**.

**Rule:** leave a voicemail on **dial #1 and dial #3 (or #4) only**, each followed by an **email within 5 minutes**. Other attempts: hang up and log **VM-NL** (no message).

## Voicemail #1 (≤20 seconds, points to email)

> "Hi [First name], [Your name] with Bytes Platform. I was looking at [Company]'s website and had a quick idea about [your capability statement / how you show up online / finding bids faster]. I'll send you a short email with the subject line '[Company] – quick idea.' My number is [number]. Again, [Your name], [number]."

## Voicemail #2 (different angle)

> "Hi [First name], [Your name] again from Bytes Platform. I sent a note about [observation]. Other [industry] contractors told us [pain] was costing them [time/bids]. If that's not an issue for you, just reply 'no' to my email and I'll close the loop. [number]."

## Voicemail checklist

- ≤20 seconds
- Your name **twice**, your number **twice**
- One **specific observation** from the site
- Points to the **email** you are about to send
$md$,
  6, 3, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D6: Callback handling
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C2'), 'D6', 'reading', 'Callback handling',
$md$# Callback handling

## Inbound callback ("You called me?")

> "Thanks for calling back, [First name]. It's [Name] with Bytes Platform. I left a message about [observation]. Do you have two minutes, or should we set a better time?"

## Scheduled callback

Call **at the exact minute promised**. Open with:

> "Hi [First name], [Name] from Bytes Platform. You asked me to call back today at 10 about [topic]."

## Logging

Log **every callback** with **date/time/time zone** and a reminder (disposition **CB**).
$md$,
  5, 4, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- H2: Opener cheat sheet
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C2'), 'H2', 'reading', 'Opener cheat sheet',
$md$# Opener cheat sheet

1. "Hi [Name], [Me] with Bytes Platform. How have you been? … The reason for my call is…"
2. "This is a cold call. Can I take 30 seconds to say why, then you decide?"
3. "Have you heard our name tossed around?" (honest follow-up if no)
4. "Would it be a terrible idea if I took 30 seconds to explain why I called?"
5. "A lot of contractors we talk to are finding bids late… how are you finding them today?"
6. "I'm on your website right now and noticed [X]. Is that on your radar?"
7. "You're probably going to want to hang up on me because this is a cold call… can I have 30 seconds, and then you decide?" (experienced reps only)

> **Never:** "Did I catch you at a bad time?"
$md$,
  5, 5, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T2-C2-QUIZ: T2-C2 quiz
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C2'), 'T2-C2-QUIZ', 'quiz', 'T2-C2 quiz',
$md$Course quiz for **T2-C2 Openers, gatekeepers, voicemail & callbacks**. You need **80%** to unlock T2-C3.
$md$,
  10, 6, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D7: Problem-identification question bank
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C3'), 'D7', 'reading', 'Problem-identification question bank',
$md$# Problem-identification question bank (by service)

## Pull from the frameworks

- **Sandler pain funnel:** "Tell me more about that…", "Can you give me an example?", "How long has that been a problem?", "What have you tried?", "How much has it cost you?", "How do you feel about it?"
- **NEPQ:** connecting → situation → problem awareness → solution awareness → consequence → commitment questions.
- **SPIN:** Situation → Problem → Implication → Need-payoff. NEPQ's middle stages map closely to SPIN's.

## Question bank

| Service | Situation | Problem | Consequence / implication |
|---|---|---|---|
| **Website/revamp** | "Who manages your site today?" | "Does it bring in any work?" / "Can primes find your capability statement on it?" | "If a prime checks you out and the site looks outdated, what do you think that does to their first impression?" |
| **SEO** | "Where do private customers find you now?" | "When someone searches [service] in [city], where do you show up?" | "If competitors get those calls instead, what's that worth over a year?" |
| **SMM** | "Do you post anywhere now?" | "How are you recruiting [officers/techs]?" | "What does an unfilled shift or job cost you?" |
| **Automation** | "What happens to a call after hours?" | "What's the most repetitive task in your office?" | "How many hours a week does that take? What would you do with that time back?" |
| **Contract-mgmt** | "How do you find solicitations today? How many bids a month?" | "Who reads the solicitation and builds the checklist? How long does that take?" | "Have you ever missed a deadline or been knocked out on a compliance detail? What did that cost?" |

## Rule

**Ask 2–4 questions max on a cold call.** Gong's guidance is to avoid long discovery on cold calls; save it for the meeting. Aim for **at least one consequence question**: it is what the scorecard rewards.
$md$,
  8, 1, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D8: Bridging to the pitch
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C3'), 'D8', 'reading', 'Bridging to the pitch',
$md$# Bridging to the pitch

## Formula: Label → Link → Light pitch → Question

> "It sounds like bids are coming in late and the checklist is built by hand **(label)**. That's exactly the piece we automate **(link)**: we build contractors their own system that pulls opportunities from SAM.gov and state portals and turns the solicitation into a compliance checklist **(light pitch)**. Would it be worth 20 minutes to see what that would look like for your team? **(question)**"

## Where this comes from

This mirrors Hormozi's **CLOSER** sequence: **C**larify, **L**abel, **O**verview past pain, **S**ell the vacation not the plane flight, **E**xplain away concerns, **R**einforce the decision.

On a cold call you only do a **light C-L-S** to earn the meeting. Keep the pitch to **two sentences or fewer**, tied to the pain they just told you.
$md$,
  5, 2, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D9: Booking the meeting
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C3'), 'D9', 'reading', 'Booking the meeting',
$md$# Booking the meeting

- **Suggest two specific times:**

> "Does Wednesday at 10 or Thursday at 2 work better, your time?"

Offer 2 options, **not "when are you free?"**

- **Make it concrete:**

> "It's 20 minutes with [specialist]. They'll look at your site and your bid process and show you 2–3 ideas. If it's not a fit, they'll tell you."

- **Sandler upfront contract for the meeting:**

> "At the end of the 20 minutes, if it's not useful, is it fair for you to tell us no? And if it is, we'll agree on a next step."

Agreeing up front on **time, agenda and what each outcome means (including "no")** reduces stalls later.

- Gong advises **setting the next step during the call** rather than leaving it vague: *"Do you have your calendar handy?"*
$md$,
  6, 3, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D10: Closing & confirming
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C3'), 'D10', 'reading', 'Closing & confirming',
$md$# Closing & confirming

1. **Recap:** "So: Thursday at 2 Eastern, 20 minutes, you and [partner?], and we'll look at [site/bids]."
2. **Send the invite while on the phone:** "I just sent the invite. Can you see it?" (reduces no-shows)
3. **Get a reason to show:** "What's the one thing you want to get out of that call?" (commitment and consistency)
4. **Confirm the right people:** "Anyone else who should be there, a partner or office manager?"
5. **Reinforce:** "Great, I think you'll get something useful out of it either way."
6. **Confirmation cadence:** email immediately, SMS reminder 24h before **only if they agreed to texts**, and a call or email 1h before.
$md$,
  5, 4, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T2-C3-QUIZ: T2-C3 quiz
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C3'), 'T2-C3-QUIZ', 'quiz', 'T2-C3 quiz',
$md$Course quiz for **T2-C3 Discovery, bridge, booking & closing**. You need **80%**. This completes Day 2; spend the rest of the day on AI roleplay practice.
$md$,
  8, 5, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D11: The A-C-I-R-R framework
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C4'), 'D11', 'reading', 'The A-C-I-R-R framework',
$md$# Objection-handling framework (A-C-I-R-R)

1. **Acknowledge** — "That's fair…" / Voss label: "It sounds like you've been burned by agencies before."
2. **Clarify** — "When you say not interested, is it the timing or the idea itself?"
3. **Isolate** — "Other than [X], is there anything else that would stop you from taking a quick look?"
4. **Respond** — short answer, story or reframe.
5. **Re-ask** — return to a small next step.

## Know what you're facing

Gong's breakdown of cold-call objections:

| Type | Share | Example |
|---|---|---|
| Dismissive brush-offs | **49.5%** | "Not interested" |
| Situational | **42.6%** | Budget, timing, fit |
| Existing solution | **7.9%** | "We already have a guy" |

The **top five objections make up 74%** of all objections. **Master the top five first.**

Stay calm the whole time. The scorecard gives 15 points for objection handling, and calm counts as much as the words.
$md$,
  6, 1, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D12: Full objection library (all 17)
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C4'), 'D12', 'reading', 'Full objection library (all 17)',
$md$# Full objection library (all 17)

For each objection: why they say it, the principle behind your answer, and responses you can use word-for-word (pick one).

## 1. "Not interested."
- **Why:** Reflex; doesn't know what you do yet.
- **Principle:** Pattern interrupt, labeling, curiosity.
- **(a)** "Totally fair, you don't know what I do yet. Can I ask one quick question, and if it's not relevant I'll let you go?"
- **(b)** "Makes sense. Most contractors I call say that. Is it because the website's already handled, or because bids aren't a priority right now?"
- **(c)** Braun: "No problem. Just out of curiosity, how are you finding new solicitations today?"

## 2. "Send me an email."
- **Why:** Polite exit.
- **Principle:** Commitment, clarify.
- **(a)** "Happy to. So it's not spam, what should it focus on: the website or the bid process?"
- **(b)** "Will do. If it makes sense, would you be against a 15-minute look on Thursday so it's not just another email?"

## 3. "We already have a website / a guy / an agency."
- **Why:** Status quo; loyalty.
- **Principle:** Contrast, no-oriented question.
- **(a)** "Great, so you're covered. Is the site bringing in work, or mostly a business card?"
- **(b)** "Good to hear. When did they last update it? I noticed [observation]."
- **(c)** "Would it be crazy to get a second opinion, free, just to compare?"

## 4. "No budget."
- **Why:** Real or brush-off; doesn't see ROI.
- **Principle:** Isolate, reframe cost of inaction.
- **(a)** "Understood. If budget weren't an issue, would this be worth looking at?"
- **(b)** "Fair. Most clients didn't budget for it either; they looked when they saw what the outdated site was costing them. Would a 15-minute look hurt?"
- **(c)** For the contract-mgmt build: "It's a one-time build, not a subscription. One contract won usually covers it many times over." *(no win guarantees)*

## 5. "Call me later / I'm busy."
- **Why:** Timing; could be real.
- **Principle:** Specific commitment.
- **(a)** "Of course. Is tomorrow at 9 or 4 better?"
- **(b)** "No problem. 20 seconds now so I know if it's even worth calling back?"

## 6. "How did you get my number?"
- **Why:** Privacy concern.
- **Principle:** Transparency, authority.
- "Fair question. Your business is registered on SAM.gov, which lists contact info for contractors. We reach out to registered contractors in [industry] because we build tools for exactly that market."

## 7. "We don't need SEO."
- **Why:** Pure-federal, or doesn't understand.
- **Principle:** Agree & isolate.
- **(a)** "You might be right. Is your work 100% government, or do you do private jobs too?"
- **(b)** If pure-federal: "Then SEO isn't the priority. Where do primes see your capability statement?" *(switch services)*

## 8. "We don't do social media."
- **Why:** Thinks it's for consumers.
- **Principle:** Reframe purpose.
- **(a)** "Most contractors don't. Are you hiring right now? Many guard and trade companies use it mainly for recruiting."
- **(b)** "Fair. When a prime checks you out and finds a page last posted in 2019, does that matter? Maybe not, just curious."

## 9. "We get all our work from government; we don't need marketing."
- **Why:** True for pure-federal.
- **Principle:** Agreement, relevance shift.
- "That makes sense, and that's why I'm not calling about ads. When a CO or prime looks you up during market research, what do they find? And how are you finding the solicitations to begin with?"

## 10. "We're too small."
- **Why:** Thinks it's expensive/complex.
- **Principle:** Social proof (real only), scale down.
- "Most of who we work with are small, often owner-run. That's exactly why the system is built just for your team instead of an enterprise platform."

## 11. "Is this a sales call?"
- **Why:** Testing honesty.
- **Principle:** Honesty disarms.
- "It is. Want me to tell you in 20 seconds why I called, and you can hang up if it's not relevant?"

## 12. "We don't trust overseas/agencies."
- **Why:** Bad past experience.
- **Principle:** Labeling, accusation audit (Voss).
- "It sounds like you've been burned before. You're probably thinking we'll take a deposit and disappear. What happened last time? … [Then: process, milestones, ownership, references, per company policy.]"
- **Never misrepresent where the team is located.**

## 13. "We already use a bid service / GovWin / Deltek."
- **Why:** Has a data source.
- **Principle:** Complement, not replace.
- "Good, you've got the finding part covered. What happens after you find a bid: who builds the compliance matrix and drafts the proposal? That's the part we build for your team."

## 14. "What does it cost?"
- **Why:** Interest or screening.
- **Principle:** Anchoring, honesty.
- **(a)** Website/SEO/SMM: "It depends on scope. Packages start at [PRICE]. The 20-minute call gets you an exact number."
- **(b)** Contract-mgmt: "It's a one-time build, typically $5,000–$8,000, plus a small yearly AI usage fee. Not a subscription."
- Gong Labs' 2020 analysis of 11,331 opportunities found **win rates were 10% higher when pricing was discussed on the first call**, so don't dodge price.

## 15. "I need to talk to my partner."
- **Why:** Real shared decision or stall.
- **Principle:** Include the decision-maker.
- "Makes sense. Would it be easier if they joined the 20-minute call, so you don't have to relay everything? Thursday at 2 work for both?"

## 16. "Remove me from your list / don't call again."
- **Why:** Clear request.
- **Principle:** Respect it; no rebuttal.
- "Understood, I'll remove you right now. Sorry for the interruption, have a good day."
- → **Log DNC immediately. Never argue.**

## 17. "We tried an agency/website before and it didn't work."
- **Why:** Past pain.
- **Principle:** NEPQ solution-awareness.
- "What did they do, and what didn't work? … So if it were done right, what would 'working' look like for you?"

## Summary table

| # | Objection | Principle | Go-to line |
|---|---|---|---|
| 1 | Not interested | Pattern interrupt, labeling, curiosity | "Totally fair, you don't know what I do yet. Can I ask one quick question…?" |
| 2 | Send me an email | Commitment, clarify | "Happy to. What should it focus on: the website or the bid process?" |
| 3 | Already have a website/guy/agency | Contrast, no-oriented question | "Is the site bringing in work, or mostly a business card?" |
| 4 | No budget | Isolate, cost of inaction | "If budget weren't an issue, would this be worth looking at?" |
| 5 | Call me later / busy | Specific commitment | "Is tomorrow at 9 or 4 better?" |
| 6 | How did you get my number? | Transparency, authority | "Your business is registered on SAM.gov…" |
| 7 | Don't need SEO | Agree & isolate | "Is your work 100% government, or private jobs too?" |
| 8 | Don't do social media | Reframe purpose | "Are you hiring right now?" |
| 9 | All our work is government | Agreement, relevance shift | "That's why I'm not calling about ads. What do primes find…?" |
| 10 | Too small | Social proof (real only), scale down | "Most of who we work with are small, often owner-run." |
| 11 | Is this a sales call? | Honesty disarms | "It is. 20 seconds to tell you why?" |
| 12 | Don't trust overseas/agencies | Labeling, accusation audit | "It sounds like you've been burned before. What happened last time?" |
| 13 | Use a bid service / GovWin / Deltek | Complement, not replace | "Who builds the compliance matrix after you find a bid?" |
| 14 | What does it cost? | Anchoring, honesty | "[PRICE]… / $5,000–$8,000 one-time + small yearly AI fee." |
| 15 | Talk to my partner | Include the decision-maker | "Would it be easier if they joined the 20-minute call?" |
| 16 | Remove me / don't call again | Respect it; no rebuttal | "Understood, I'll remove you right now." → DNC |
| 17 | Tried an agency before | NEPQ solution-awareness | "What would 'working' look like for you?" |
$md$,
  10, 2, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- H1: Objection quick-reference card
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C4'), 'H1', 'reading', 'Objection quick-reference card',
$md$# Objection quick-reference card

| They say | You say (short) |
|---|---|
| Not interested | "Fair, you don't know what I do yet. One quick question, then I'll let you go?" |
| Send me an email | "Will do. Website or bids: which should it focus on?" |
| Already have a website/guy | "Great. Is it bringing in work, or more of a business card?" |
| No budget | "Understood. If budget weren't an issue, would this be worth a look?" |
| Call me later | "Sure. Tomorrow at 9 or 4?" |
| How'd you get my number? | "You're registered on SAM.gov; we work with registered contractors in [industry]." |
| Don't need SEO | "Is your work 100% government, or some private too?" |
| Don't do social | "Most contractors don't. Are you hiring right now?" |
| All work is government | "That's why I'm not calling about ads. What do primes find when they look you up?" |
| Too small | "Most of our clients are owner-run; that's why it's built just for your team." |
| Is this a sales call? | "It is. 20 seconds to tell you why, then you decide?" |
| Don't trust agencies | "It sounds like you've been burned. What happened last time?" |
| Use GovWin/Deltek | "Great for finding bids. Who builds the compliance matrix after?" |
| What does it cost? | "[PRICE] for X; the contract-mgmt build is $5–8k one-time + small yearly AI fee." |
| Talk to partner | "Want them on the 20-minute call? Tuesday or Wednesday?" |
| Remove me | "Understood, removing you now. Sorry for the interruption." → DNC |
| Tried before, didn't work | "What happened? What would 'working' look like?" |
$md$,
  5, 3, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T2-C4-QUIZ: T2-C4 quiz
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C4'), 'T2-C4-QUIZ', 'quiz', 'T2-C4 quiz',
$md$Course quiz for **T2-C4 Objection handling**. You need **80%**. Then take the objection drill.
$md$,
  10, 4, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T2-OBJ-DRILL: Objection drill (10 objections)
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C4'), 'T2-OBJ-DRILL', 'drill', 'Objection drill (10 objections)',
$md$**Objection drill.** 10 objections from the library, rapid-fire (about 5 minutes). For each one, answer out loud or in text using **A-C-I-R-R**: acknowledge, clarify, isolate, respond, re-ask. Each answer is scored 0–10 (or self-rated against the model answer from D12 in standard mode). You need **80%**; this is part of LIVE_CALL_CERT. For "remove me," the only correct answer is to comply immediately with no rebuttal.
$md$,
  10, 5, true, 80, $j${"kind":"objection","count":10}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D13: Psychology principles: do / don't
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C5'), 'D13', 'reading', 'Psychology principles: do / don''t',
$md$# Psychology principles: do this / don't do this

| Principle | Do this | Don't do this |
|---|---|---|
| **Reciprocity** | Give a free, specific observation ("your site shows 'Not secure', here's why that matters") | Fake "free gifts" with strings attached |
| **Social proof** | "Other [guard companies] tell us…" (only true statements) | Invent clients or numbers |
| **Authority** | Know NAICS, set-asides and capability statements cold | Claim government affiliation |
| **Scarcity/urgency (ethical)** | Real deadlines ("the solicitation you mentioned closes on the 15th") | Fake "price ends today" |
| **Loss aversion** | "What does a missed after-hours call cost you?" | Fear-mongering |
| **Labeling (Voss)** | "It sounds like you're stretched thin." "It seems like bids are the priority." | "I hear you saying…" (Voss avoids "I hear…" because it shifts focus to you) |
| **Mirroring (Voss)** | Repeat their last 1–3 words as a question: "…too many bids?" then pause 4 seconds | Parrot everything |
| **Tonality/pace** | Calm, slower "late-night FM DJ voice," downward inflection on statements | Fast, high-pitched, uptone on everything |
| **Silence** | Ask, then stop talking | Fill every gap |
| **Assumptive language** | "When you see the mockup…" / "Wednesday or Thursday?" | "Would you maybe possibly be interested…" |
| **"Because" justification** | "I'm calling because you're registered on SAM.gov in [industry]…" | No reason given |
| **Contrast/anchoring** | Compare the one-time build to a year of subscription fees, or to one lost contract | Misleading comparisons |
| **Commitment & consistency** | Small yeses ("Fair to say the site could be better?") lead to the meeting | Trick questions |
| **Name usage** | Use their first name 2–3 times | Every sentence |
| **Calibrated questions (Voss)** | "How are you finding bids today?" "What would make this worth your time?" | "Why…?" (sounds accusatory) |
| **Detachment (Braun)** | "If it's not a fit, no problem at all." | Desperation, arguing |
$md$,
  8, 1, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D14: Tonality & pacing drills
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C5'), 'D14', 'checklist', 'Tonality & pacing drills',
$md$# Tonality & pacing drills (daily, 5 minutes)

Do these five drills every day before your first call block. Tick each one off as you finish it.

1. **Downward inflection:** read the opener 5 times, ending every statement on a lower note. Record and replay.
2. **Slow-down:** read the reason-for-call at about **140 words/minute** (the AI or the trainer times you).
3. **Mirror-and-pause:** a partner says a sentence; you mirror the last 3 words and count **4 seconds** silently.
4. **Smile test:** read the same line with and without smiling; the trainer guesses which.
5. **Belfort-style certainty:** Jordan Belfort's "Straight Line" system stresses tone that conveys certainty and control. Practice saying the price (**"five to eight thousand, one-time"**) with zero hesitation.

> Goal: calm, slower than normal, a smile in your voice, a downward tone at the end of statements. No nervous uptones.
$md$,
  5, 2, true, 80, $j${"items":["Downward inflection: read the opener 5 times, ending every statement on a lower note. Record and replay.","Slow-down: read the reason-for-call at about 140 words/minute (timed by the AI or the trainer).","Mirror-and-pause: a partner says a sentence; mirror the last 3 words and count 4 seconds silently.","Smile test: read the same line with and without smiling; the trainer guesses which.","Certainty: say the price (\"five to eight thousand, one-time\") with zero hesitation (Belfort-style)."]}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D15: Follow-up cadence
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C5'), 'D15', 'reading', 'Follow-up cadence',
$md$# Follow-up cadence (email + call + SMS)

Gong reports that **cold calling nearly doubles cold-email reply rates (3.44% vs 1.81%)** even when the call doesn't connect, so calls and emails should run together.

| Day | Action |
|---|---|
| 1 | Call #1 (**VM #1**) + email #1 ("[Company] – quick idea" with one site observation) |
| 3 | Call #2 (no VM) |
| 5 | Call #3 (**VM #2**) + email #2 (different angle: bids or automation) |
| 8 | Call #4 (no VM) |
| 12 | Call #5 + email #3 (breakup, no-oriented: "Have you given up on improving [X]?") |
| 30–60 | Move to nurture; re-try with a new angle next quarter |

**SMS:** text only prospects who agreed to texts during a call (for example, meeting reminders). No cold texts.
$md$,
  5, 3, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D16: CRM notes & disposition codes
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C5'), 'D16', 'reading', 'CRM notes & disposition codes',
$md$# CRM/notes discipline & disposition codes

| Code | Meaning | Required notes |
|---|---|---|
| **VM** | Voicemail left | Observation used |
| **VM-NL** | Voicemail, no message | — |
| **NA** | No answer / rang out | — |
| **GK** | Spoke to gatekeeper | GK name, DM name, best time |
| **NI** | Not interested | Reason given + service pitched |
| **CB** | Callback scheduled | Date/time + time zone + topic |
| **BK** | Meeting booked | Date/time, attendees, pain, service, website notes |
| **WN** | Wrong number / bad data | — |
| **DNC** | Requested no further contact | Date/time, exact wording; stop all contact immediately |
| **NF** | Not a fit | Why |

## Rule

**Notes must be written before the next dial.** Format:

> **Pain: … | Service: … | Site: … | Next: …**

Example:

> BK — Pain: after-hours calls go to voicemail | Service: AI receptionist | Site: no booking/quote form | Next: Thu 2pm ET, owner + wife (books)
$md$,
  6, 4, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D17: Daily routine & call blocks
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C5'), 'D17', 'reading', 'Daily routine & call blocks',
$md$# Daily routine & call blocks

| Time (prospect local) | Block |
|---|---|
| 8:30–9:00 | Daily drill (5 min), flashcards, review callbacks |
| 9:00–11:00 | Call block 1 (aim for 40–50 dials) |
| 11:00–12:00 | Call block 2 (**prime time**): Gong's data shows the best cold-call success rates on **Wednesday/Thursday between 11 a.m. and noon or 4–5 p.m.**, the prospect's time |
| 12:00–1:00 | Lunch; follow-up emails |
| 1:00–2:00 | Roleplay/coaching, call review |
| 2:00–4:00 | Call block 3 (time zones further west) |
| 4:00–5:00 | Call block 4 (**prime time**) |
| 5:00–5:15 | Log, plan tomorrow's list |

## Use time zones

- Dial the **East Coast in your morning** and the **West Coast later**.
- **Wednesday/Thursday** are generally the strongest days. **Monday mornings and Friday afternoons** are typically weaker.
- Sources disagree on Tuesday vs. Wednesday, so **trust your own data after week 4**.
$md$,
  5, 5, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D18: KPI targets, weeks 1–8
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C5'), 'D18', 'reading', 'KPI targets, weeks 1–8',
$md$# KPI targets, weeks 1–8 (starting assumptions; recalibrate)

For reference, **The Bridge Group's 2025 SDR survey** reports a median of **112 activities/day (44 phone)**, **4.1 quality conversations/day** and a median quota of **10 held meetings per month** (down 40% since 2018). The survey covered 351 B2B companies, 83% of them SaaS. Its **phone-centric teams averaged 56 dials and 4.6 quality conversations per day**, which is closer to our phone-heavy model.

With the 3-day onboarding plan you are certified at the end of Day 3, so live calling starts in week 1.

| Week | Phase | Dials/day | Conversations/day | Meetings booked/week | Show rate | Scorecard avg |
|---|---|---|---|---|---|---|
| 1 (Days 1–3) | Training (Track 1 → Track 2) + certification | 0 (roleplay only) | — | — | — | Roleplay ≥50 on Day 2; ≥70 at cert on Day 3 |
| 1 (after cert) – 2 | Certified, supervised (ramp 50%) | 60 | 3–4 | 1 | ≥60% | ≥60 |
| 3–4 | Ramp 50% | 80 | 4–5 | 1–2 | ≥65% | ≥65 |
| 5–6 | Ramp 75% (from day 31 after cert) | 100 | 5–6 | 2–3 | ≥70% | ≥70 |
| 7–8 | Toward full (full quota from day 61 after cert) | 100–120 | 6+ | 3–4 | ≥75% | ≥75 |

## Math check

At Gong's average **5.4% connect rate, 100 dials ≈ 5 conversations**. At the average **4.6% meeting-per-connect rate**, that is about **1 meeting per 4 days** for an average rep. Top-quartile rates (13.3% / 16.7%) give about **2 per day**. Small-contractor owners may pick up more often than SaaS buyers. Track and adjust.
$md$,
  6, 6, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T2-CARDS: Track 2 flashcards
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C5'), 'T2-CARDS', 'flashcard_deck', 'Track 2 flashcards',
$md$Flip through the Track 2 flashcards: frameworks (A-C-I-R-R, CLOSER, upfront contract, poke the bear), Voss techniques, Gong numbers and the disposition codes. Review them daily; they are part of your 5-minute drill.
$md$,
  5, 7, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T2-C5-QUIZ: T2-C5 quiz
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C5'), 'T2-C5-QUIZ', 'quiz', 'T2-C5 quiz',
$md$Course quiz for **T2-C5 Psychology, tonality, follow-up, CRM & daily routine**. You need **80%** to unlock T2-C6.
$md$,
  10, 8, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D19: The 100-point scorecard
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C6'), 'D19', 'reading', 'The 100-point scorecard',
$md$# The 100-point call scorecard (shared by the AI and the sales lead)

Every roleplay and every graded live call uses this scorecard.

| # | Criterion | Points | Full marks when… |
|---|---|---|---|
| 1 | Opener | 10 | Name + company + human moment; calm tone; no "bad time?" |
| 2 | Reason for call | 10 | Clear, specific to their industry; uses a live observation |
| 3 | Tonality & pace | 10 | Calm, confident, downward inflection, not rushed |
| 4 | Problem questions | 15 | 2–4 relevant questions; at least one consequence question |
| 5 | Listening | 10 | Mirrors/labels; no interrupting; builds on their words |
| 6 | Classification & bridge | 10 | Leads with the right service per rubric; pitch ≤2 sentences tied to their pain |
| 7 | Objection handling | 15 | Acknowledge → clarify → isolate → respond → re-ask; stays calm |
| 8 | Next step | 10 | Specific day/time offered; invite sent; attendees confirmed |
| 9 | Accuracy | 5 | No false promises (rankings, wins, prices outside the approved list, delivery dates) |
| 10 | Notes & disposition | 5 | Correct code; notes in the required format (Pain \| Service \| Site \| Next) |
| | **Total** | **100** | **Pass ≥70; Excellent ≥85** |

## Automatic fails (score capped at 40)

- Arguing after a prospect asks to be removed from the list
- Promising rankings or wins
- Misrepresenting the company
- Pitching the contract-management build as a subscription
$md$,
  6, 1, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- D20: Sample call transcripts
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C6'), 'D20', 'reading', 'Sample call transcripts',
$md$# Sample call transcripts

Read each call out loud with a partner. Notice where each scorecard point is earned.

## Transcript 1: Good call (HVAC/duct cleaning, mixed commercial/government)

> **Rep:** Hi Mike, it's Sara with Bytes Platform. How have you been?
>
> **Mike:** Uh… fine. Do I know you?
>
> **Rep:** You don't, this is a cold call, so I'll be quick. The reason I'm calling: we work with HVAC and duct-cleaning companies on SAM.gov, and I'm actually on your website right now. I noticed there's no way to book or request a quote after hours. Quick question: what happens when someone calls you at 7 p.m.?
>
> **Mike:** Goes to voicemail. Half of them never leave one.
>
> **Rep:** Half of them never leave one?
>
> **Mike:** Yeah, they just call the next guy.
>
> **Rep:** It sounds like those after-hours calls are leaking straight to competitors. Roughly how many a week, would you guess?
>
> **Mike:** Maybe ten, more in summer.
>
> **Rep:** And if even a few of those were jobs, what's an average job worth to you?
>
> **Mike:** Four, five hundred for a duct cleaning. More for HVAC.
>
> **Rep:** That adds up. We build an AI receptionist that answers those calls, asks what they need, books the appointment and texts you a summary. Would it be worth 20 minutes with our specialist to see how it would work for your business? Wednesday at 10 or Thursday at 2?
>
> **Mike:** Thursday at 2 works.
>
> **Rep:** Great. Thursday at 2 Eastern, 20 minutes. Anyone else who should join, office manager?
>
> **Mike:** My wife does the books, I'll bring her.
>
> **Rep:** Perfect. I've just sent the invite to mike@… Can you see it? … And what's the one thing you'd want to get out of the call?
>
> **Mike:** Whether it sounds like a robot.
>
> **Rep:** Fair. We'll play you a sample call. Talk Thursday, Mike.

**Score ~88:** strong opener, live observation, mirror, label, consequence question, two-option close, invite sent.

## Transcript 2: Objections handled (aerospace maintenance contractor, pure-federal)

> **Rep:** Hi Linda, it's Omar with Bytes Platform. How have you been?
>
> **Linda:** Busy. What's this about?
>
> **Rep:** I'll be quick. We work with maintenance contractors supporting DoD programs. The reason for my call: teams your size tell us they're tracking solicitations and building compliance checklists by hand. How are you finding new bids today?
>
> **Linda:** We have GovWin. We don't need anything.
>
> **Rep:** Good, so the finding part's covered. After GovWin flags something, who reads the solicitation and builds the compliance matrix?
>
> **Linda:** Me. And one other person.
>
> **Rep:** Just the two of you. How long does a typical one take?
>
> **Linda:** A few days for a big one. We passed on two last quarter because we didn't have time.
>
> **Rep:** It sounds like you're leaving bids on the table because of bandwidth, not capability.
>
> **Linda:** Pretty much. But we don't have budget for another subscription.
>
> **Rep:** That's fair, and it's not a subscription. We build your team its own system: it takes the solicitation, extracts the requirements into a compliance matrix, drafts the first version of the proposal and tracks deadlines. It's a one-time build, typically $5,000 to $8,000, plus a small yearly fee for the AI usage. Other than budget, is there anything else that would stop you from taking a look?
>
> **Linda:** I'd need my partner to see it.
>
> **Rep:** Makes sense. Would it be easier if he joined the call so you don't have to relay it? Is Tuesday at 11 or Wednesday at 3 better for both of you?
>
> **Linda:** Wednesday at 3.
>
> **Rep:** Done. Wednesday at 3 Central, 30 minutes. I'll send the invite to both of you. What's his email?

**Score ~85:** handled the existing-solution, budget and partner objections with A-C-I-R-R; correct "not a subscription" framing.

## Transcript 3: Polite no (lockers/shelving supplier)

> **Rep:** Hi Tom, it's Jay with Bytes Platform. How have you been?
>
> **Tom:** Fine, what's up?
>
> **Rep:** The reason I'm calling: I'm on your site right now, and I didn't see a product catalog or quote form. When a base facility manager wants lockers, how do they usually reach you?
>
> **Tom:** Honestly, 90% comes through two distributors. We don't sell direct.
>
> **Rep:** Ah, so the distributors are the storefront.
>
> **Tom:** Right. The website barely matters for us.
>
> **Rep:** That makes sense. Is there any part of the business where you're doing things by hand, quotes, inventory, anything?
>
> **Tom:** No, the distributors handle all that. We're fine.
>
> **Rep:** Got it, Tom. Sounds like you're well set up. I won't take more of your time. Would it be OK if I checked back in six months, in case anything changes?
>
> **Tom:** Sure.
>
> **Rep:** Thanks, Tom. Have a good one.

**Score ~75:** correct, detached exit; logged **NF** with reason "sells via distributors," nurture in 6 months. **Detaching is a success, not a failure.**
$md$,
  10, 2, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T2-RP-PRACTICE: Roleplay practice
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C6'), 'T2-RP-PRACTICE', 'roleplay', 'Roleplay practice',
$md$**Roleplay practice.** Run at least **2 practice sessions** from the eight scenarios below. Scores here don't gate anything; they are for learning. Aim for 5+ sessions across Day 2 and Day 3.

1. Friendly owner, no website (security guard company, TX)
2. Busy owner, outdated site (electrical contractor, FL)
3. Skeptical BD manager (aerospace CLS, OK)
4. Gatekeeper wall (integrator, CA)
5. Burned before (HVAC, GA)
6. Pure-federal, no fit (fasteners via distributors): graceful exit + correct disposition
7. "Remove me" request: pass only if you comply instantly with no rebuttal
8. Lab owner (environmental lab, NJ): sample intake chaos → automation pitch

If no AI key is configured, the roleplay runs as a branching script: pick the line you would say at each step and read the coaching note after each choice.
$md$,
  30, 3, true, 80, $j${"purpose":"practice","scenario_codes":["RP1","RP2","RP3","RP4","RP5","RP6","RP7","RP8"],"min_sessions":2,"min_score":0}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T2-C6-QUIZ: T2-C6 quiz
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C6'), 'T2-C6-QUIZ', 'quiz', 'T2-C6 quiz',
$md$Course quiz for **T2-C6 Scorecard, sample calls & roleplay practice**. You need **80%** to unlock the live-calling certification.
$md$,
  8, 4, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T2-EXAM: Track 2 final exam
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C7'), 'T2-EXAM', 'exam', 'Track 2 final exam',
$md$**Track 2 final exam (LIVE_CALL_CERT).** 40 questions drawn from the whole bank (17 product, 10 classification, 13 sales process/objections), shuffled, with a **45-minute timer**. You need **80%**. Together with PRODUCT_CERT, the objection drill (≥80%) and two graded roleplays (≥70), this earns **LIVE_CALL_CERT**, after which your dials count toward quota.
$md$,
  45, 1, true, 80, $j${"draw_tags":{"product":17,"classification":10,"sales":13},"time_limit_min":45}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T2-RP-EXAM: Graded certification roleplays
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T2-C7'), 'T2-RP-EXAM', 'roleplay', 'Graded certification roleplays',
$md$**Graded certification roleplays.** Complete **two** roleplays scored with the 100-point scorecard: one **friendly owner** and one **skeptical owner with 3 objections**. Each must score **≥70/100**, and at least one is confirmed by a human reviewer. Remember the automatic fails: arguing after "remove me," promising rankings or wins, misrepresenting the company, or calling the contract-management build a subscription.
$md$,
  30, 2, true, 70, $j${"purpose":"exam","scenario_codes":["RP-EXAM-FRIENDLY","RP-EXAM-SKEPTICAL"],"min_sessions":2,"min_score":70}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T3-C1.1: Your tools & logins
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T3-C1'), 'T3-C1.1', 'reading', 'Your tools & logins',
$md$# Your tools & logins

Everything you need for the job lives in **one place: the Salary System** (this website). Your calls run through the **3CX phone system** on your own extension. This lesson shows you what each part is for.

## Logging in

- HR creates your account and gives you a **username** and **password**. Log in at the start of every shift.
- **Your first login of the shift is your check-in.** The system records the time and decides whether you are on time, late or a half day (see the *Attendance & pay* course). Logging in again later in the same shift does not change it.
- You don't need to log in on weekends. Shifts that start on **Saturday or Sunday** are not tracked ("Weekend – system paused").
- Keep your password to yourself. Everything you do in the system (calls, notes, sales) is recorded under your name.

## Your phone: 3CX

- Every agent has their own **3CX extension** (HR sets it on your profile). Always call from your own extension.
- 3CX automatically sends each call to the Salary System: the number, the time and the **duration**. That is how your **calls** and **talk time** are counted for pay, so there is nothing to type in.
- Calls are **recorded** by 3CX. Recordings are used for coaching, quality checks and training.

## The menu, item by item

| Menu item | What it's for |
|---|---|
| **Dashboard** | Today's calls, talk time and performance score, what you have earned so far this month, your attendance and your "Golden Ticket" sales gauge |
| **My Leads** | Your call list. Shows one lead at a time with the company details, AI talking points, a **Send Email** button and the outcome picker. **Submit & Next** saves the outcome and gives you the next lead |
| **Pipeline** | Every lead you marked **Interested**: follow-up dates, deal value, notes, stage |
| **Sales** | Log a closed deal and record the payments the client makes; shows your commission |
| **Recordings** | Request the recording of a call (approved automatically or by HR), then play or download it |
| **Daily Report** | Your call-quality scores from the automatic QA system |
| **My Coaching** | Your weekly coaching report: strengths, what to fix and suggested scripts |
| **Training** | This training: your path, today's drill, flashcards, roleplays, graded calls, scoreboard |
| **Live Assist** | Help during a call: talking points, a 30-second website scan, which service to pitch, a follow-up email draft. Also opens from the **Live Assist** button inside My Leads |
| **Leaderboard** | Today's and this month's team rankings |

## Ground rules

- **Before your Live-Calling Certification, My Leads is locked.** You practise with roleplays until you are certified (end of Day 3).
- Write your call notes **before the next dial** (format: `Pain | Service | Site | Next`).
- If something looks wrong (missing calls, wrong attendance, a lead with bad data), tell HR the same day. HR can correct attendance and add meeting time.
$md$,
  7, 1, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T3-C1.2: A shift, step by step
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T3-C1'), 'T3-C1.2', 'reading', 'A shift, step by step',
$md$# A shift, step by step

Your shift times are on your profile. Most of the team works the **night shift, 9:00 PM – 5:00 AM Pakistan time (PKT)**, which is the US business day.

## 1. Start of shift
1. **Log in** (this is your check-in). Aim to be logged in **before** your shift starts; you have a 30-minute grace period.
2. Open **Training → Today** and do the **5-minute daily drill** (flashcards, two objections, one lead to classify, a short tonality recording).
3. Check **Pipeline** for follow-ups and callbacks due today.

## 2. Call blocks
1. Open **My Leads**. The system picks your next lead based on **US time zones**: it serves leads from the state where it's currently a good time to call (around 10:00–11:30 AM and 4:00–5:00 PM local), and older leads in the lunch hours.
2. **Dial first, look while it rings**: glance at the firm name and narrative, dial, then open the website (or the **Live Assist** scan) while it rings.
3. After the call, pick the **outcome(s)**: Interested, Not Interested, Gatekeeper, Owner Picked, Voicemail, Busy, Callback, Bad Number. You can pick more than one; the most important one decides where the lead goes.
4. Write your note and press **Submit & Next**.

## 3. What happens to a lead after your outcome

| Outcome | Where the lead goes |
|---|---|
| Interested / Owner Picked | Your **Pipeline** (stage "New interested") |
| Callback | Back to **you** for the callback |
| Not interested, Voicemail, Busy, Do-not-call | **Recycle**: after ~15 days it goes to a **different** agent |
| Gatekeeper, Bad number | **Dead** (can't be reached) |
| Any lead after 3 attempts | **Dead** |

## 4. During the shift
- On a good call where the prospect gave an email, use **Send Email** on the lead card: a personalised follow-up goes out from your company email straight away.
- Mark callbacks with the exact date, time and time zone.

## 5. End of shift
- Update **Pipeline** (stages, follow-up dates, deal values).
- Your calls and talk time are already counted from 3CX; check your **Dashboard** to see today's score.
$md$,
  6, 2, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T3-C1-QUIZ: Tools & shift quiz
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T3-C1'), 'T3-C1-QUIZ', 'quiz', 'Tools & shift quiz',
$md$**Tools & shift quiz.** Six quick questions on the system you will use every day. You need **80%**.
$md$,
  5, 3, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T3-C2.1: Shift timing, attendance & lates
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T3-C2'), 'T3-C2.1', 'reading', 'Shift timing, attendance & lates',
$md$# Shift timing, attendance & lates

Your pay for each working day depends on **two things**: whether you were there (**attendance**) and how much you did (**performance**). This lesson covers attendance.

## How check-in works
Your **first login of the shift** sets your attendance for that day, compared with your shift start time:

| You log in… | Status | What it means for that day |
|---|---|---|
| Up to **30 minutes** after shift start | **On time** | Full day |
| **31–90 minutes** late | **Late** | Full day, but it counts as a "late" (see below) |
| **91+ minutes** late | **Half day** | That day pays **50%** |
| You don't log in at all | **Absent** | That day pays **0** |

## The "3 lates free" rule
- Your **first 3 lates each month are free**.
- From the **4th late** in the same month, **each late costs half a day's pay**.
- Lates reset at the start of every month.

## Weekends
Shifts that start on **Saturday or Sunday** are not tracked: no attendance, no absences, no targets.

## Mistakes and exceptions
HR can review and correct attendance (for example if the system was down when you logged in) and can add **meeting time** for Zoom / Google Meet demos that 3CX doesn't see. Tell HR the same day.
$md$,
  5, 1, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T3-C2.2: How your salary is calculated
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T3-C2'), 'T3-C2.2', 'reading', 'How your salary is calculated',
$md$# How your salary is calculated

Your salary is **earned day by day**. The Dashboard shows what you have earned so far this month and a projection for the full month.

## Step 1: your daily potential
**Daily potential = monthly base salary ÷ working days (Monday–Friday) in the month.**

Example: base salary **100,000**, a month with **20 working days** → daily potential **5,000**.

## Step 2: your performance score for the day (0–100%)
Two things are scored: **calls** and **talk time**. Your targets are set by HR and shown on your Dashboard. At the time of writing they are:

| | Calls per day | Talk time per day |
|---|---|---|
| Full-time | 300 | 100 minutes |
| Part-time | 75 | 30 minutes |

- **Hit both targets → 100%.**
- Otherwise: **calls are worth up to 60%** and **talk time up to 40%**, in proportion to how close you got.
- **Talk time only counts calls of 30 seconds or more** (so very short calls don't add talk time, but they do count as calls).
- Leads are shown on your Dashboard but are **not** part of the score.

## Step 3: what you earn that day
**Day's pay = daily potential × performance score × attendance** (on time/late = 100%, half day = 50%, absent = 0).

## Worked example (full-time, daily potential 5,000)

| Day | Attendance | Calls | Talk time | Score | Pay |
|---|---|---|---|---|---|
| Mon | On time | 300 | 105 min | both targets hit → **100%** | **5,000** |
| Tue | On time | 240 | 70 min | 240/300 × 60% = 48% + 70/100 × 40% = 28% → **76%** | **3,800** |
| Wed | Late (2nd this month, free) | 240 | 70 min | **76%** | **3,800** |
| Thu | Half day | 300 | 100 min | **100%** | 5,000 × 50% = **2,500** |
| Fri | Absent | 0 | 0 | — | **0** |

That week earns **15,100**. If Wednesday had been your **4th** late of the month, half a day (**2,500**) would be deducted as well.

## Things that surprise new agents
- **Every working day counts.** A missed day earns 0, so attendance matters as much as performance.
- **Talk time is usually what's short.** 300 calls with 90 minutes of talk scores 60% + 36% = **96%**, not 100%. Stay on good conversations; both targets must be hit for the full day.
- **Days before your start date don't count against you.** If you join mid-month, your first month is simply the working days from your start.
- **Payday and payment method:** your monthly payout is confirmed by HR from the Payroll page. [PAYDAY: ask HR for the payout date and method]
$md$,
  8, 2, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T3-C2.3: Your training period, commission & the Golden Ticket
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T3-C2'), 'T3-C2.3', 'reading', 'Your training period, commission & the Golden Ticket',
$md$# Your training period, commission & the Golden Ticket

## Your pay while you train (new agents)
New agents start in a **training phase**. Your quota grows step by step, and you are **not penalised for missed targets** while you learn:

| Phase | When | Targets | Effect on pay |
|---|---|---|---|
| **Training** | Days 1–3, until you pass the Live-Calling Certification | none (you practise) | every working day you attend counts as **100% performance** |
| **Ramp 50%** | Days 1–30 after certification | half quota | **no missed-target deductions** (100% performance) |
| **Ramp 75%** | Days 31–60 after certification | **75% of the normal targets** (e.g. 225 calls and 75 minutes) | scored against the reduced targets |
| **Full** | From day 61 | full targets | normal pay rules |

- **Attendance still counts** in every phase: absent days pay 0, half days pay 50%.
- Your trainer can put you in **Supervised** for extra coaching. While supervised there are **no missed-target deductions**; your base pay is not affected.
- Your current phase is shown on your Dashboard and on your training page.

## Commission on sales
- When a client buys, log the deal in **Sales** (customer name, total deal value, any first payment). **HR approves** each sale.
- Record each payment the client makes on that sale; **HR approves each payment**.
- When the **full deal value has been collected**, you earn **5% of the total deal value** as commission. Example: a **$2,000** website project → **$100** commission once the client has paid the whole $2,000. Commission is recorded on your Sales page, separately from your daily salary.
- Partly paid deals don't pay commission yet; the Sales page shows how much has been collected.

## The Golden Ticket
HR can set a **daily sales target** for you. When the sales you log in a shift reach it, your Dashboard shows the **Golden Ticket**. It's recognition for a great day; it does **not** change your salary calculation.

## Leaderboards and badges
The **Leaderboard** ranks the team; the **Training scoreboard** ranks drills, roleplays and meetings booked. Badges (10-day drill streak, first booked meeting, Objection Master…) are for recognition and don't change pay.
$md$,
  6, 3, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T3-C2-QUIZ: Attendance & pay quiz
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T3-C2'), 'T3-C2-QUIZ', 'quiz', 'Attendance & pay quiz',
$md$**Attendance & pay quiz.** Check you know exactly how your pay is worked out. You need **80%**.
$md$,
  6, 4, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T3-C3.1: From interested lead to booked meeting
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T3-C3'), 'T3-C3.1', 'reading', 'From interested lead to booked meeting',
$md$# From interested lead to booked meeting

Your job on the phone is to **book the meeting**, not to close the deal. This is what happens after a prospect says yes.

## The pipeline
When you mark a lead **Interested** (or **Owner Picked** with interest), it moves to your **Pipeline**. Each lead goes through five stages:

| Stage | Meaning | Your job |
|---|---|---|
| **New interested** | They want to hear more | Book the meeting; send the invite while still on the phone |
| **Follow up** | Meeting booked or a follow-up is due | Set the **follow-up date and time** (their time zone) |
| **Proposal sent** | The specialist has sent the proposal / quote | Keep in touch, answer questions |
| **Closed won** | They bought | Log the sale in **Sales** |
| **Closed lost** | They said no | Note the reason |

- **Overdue follow-ups are shown in red.** Clear them first at the start of every shift.
- Add the **deal value** when you know it, so the team can see the pipeline total.

## Handing over to the specialist
The meeting is with **[CLOSER/SALES LEAD]**. A good handover means the specialist never has to ask the client the same questions again. Before the meeting, the lead's notes must answer:

1. **Who** is attending (name, role, the partner/office manager if they're joining)
2. **When**: day, time **and time zone**
3. **Pain**: what's not working, in the client's own words
4. **Service**: what you think they need (new website, revamp, SEO, SMM, automation, contract-management build)
5. **Site**: what you noticed on their website
6. **What they want out of the meeting** (ask: "What's the one thing you want to get out of that call?")

Use the notes format: `Pain: … | Service: … | Site: … | Next: <day time TZ, attendees>`.

## Confirming the meeting
- Send the calendar invite during the call and ask "Can you see it?"
- Send a confirmation email straight after (the **Send Email** button on the lead card does this).
- Text reminders only if the client agreed to texts on the call.
$md$,
  6, 1, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T3-C3.2: Logging sales & payments
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T3-C3'), 'T3-C3.2', 'reading', 'Logging sales & payments',
$md$# Logging sales & payments

When a client buys, the sale and every payment are recorded in the system. This is what your **commission** is calculated from, so do it carefully.

## Logging a sale
1. Open **Sales → Log a sale**.
2. Enter the **customer name**, the **total deal value**, and any **first payment** already received (it can't be more than the deal value).
3. Submit. The sale shows as **pending** until **HR approves** it.

## Recording payments
- Clients often pay in parts (a deposit, then the balance). Each time the client pays, add the **payment** to that sale.
- Each payment is **pending until HR approves it**. Only approved payments count as collected.
- The Sales page shows each deal's **progress** (collected ÷ total).

## When commission is paid
- When the approved payments reach the **full deal value**, the sale becomes **completed** and you earn **5% of the total deal value**.
- Commission is recorded on your **Sales** page ("commission earned"). It is separate from the daily salary calculation above. [COMMISSION PAYOUT: confirm with HR when and how commission is paid]

## Common mistakes
- **Logging a deal under the wrong amount**: always use the total agreed with the client, not the deposit.
- **Logging a payment twice**: check the sale's history first. If you make a mistake, tell HR before they approve it.
- **Not logging at all**: unlogged deals earn no commission.
$md$,
  5, 2, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- T3-C3-QUIZ: Pipeline & sales quiz
INSERT INTO training_lessons (course_id, code, type, title, body_md, est_minutes, sort_order, required, pass_pct, config)
VALUES ((SELECT id FROM training_courses WHERE code = 'T3-C3'), 'T3-C3-QUIZ', 'quiz', 'Pipeline & sales quiz',
$md$**Pipeline & sales quiz.** Six questions on the handover, the pipeline and how commission works. You need **80%**.
$md$,
  5, 3, true, 80, $j${}$j$::jsonb)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------- question bank
-- C1-QUIZ (11 questions)
INSERT INTO training_quiz_questions (lesson_id, type, prompt, options_json, answer_json, explanation, tags)
SELECT l.id, v.type, v.prompt, v.options_json, v.answer_json, v.explanation, v.tags
FROM training_lessons l, (VALUES
  ('mcq', 'What does a NAICS code describe?', $j$["The company's annual revenue band","The company's industry / type of work","Whether the company is a small business","Which agency the company works for"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'C1.1: NAICS codes say what a company does; agencies tag each contract with a NAICS code.', ARRAY['product', 'C1']::text[]),
  ('true_false', 'A pure-federal aircraft maintenance contractor is our best SEO prospect.', $j$["True","False"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'C1.1: for pure-federal contractors SEO and social matter less; the website, capability statement and bid tools matter more.', ARRAY['product', 'C1']::text[]),
  ('multi', 'Which of these may a contracting officer or prime check before contacting a small business? (Select all that apply.)', $j$["Their website","Their capability statement","Their SBS profile","Their Instagram follower count","Their past performance"]$j$::jsonb, $j${"correct":[0,1,2,4]}$j$::jsonb, 'C1.1: COs and primes look at the website, the capability statement, SBA''s Small Business Search profile and past performance.', ARRAY['product', 'C1']::text[]),
  ('mcq', 'Which question tells you whether SEO/SMM is relevant for a prospect?', $j$["\"Who built your website?\"","\"How many employees do you have?\"","\"Are you registered on SAM.gov?\"","\"What % of your work is government vs. private/commercial?\""]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'C1.1: SEO and SMM bring real revenue only when the contractor also sells to commercial or local customers, so always ask the government/private mix.', ARRAY['product', 'C1']::text[]),
  ('mcq', 'Under FAR 19.702 (as amended by FAC 2025-06, effective Oct 1, 2025), large primes need small-business subcontracting plans on contracts over what amount?', $j$["Over $250,000 ($500,000 for construction)","Over $750,000 ($1.5 million for construction)","Over $900,000 ($2 million for construction)","Over $5 million for all contracts"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'C1.1: the threshold is contracts over $900,000 ($2 million for construction).', ARRAY['product', 'C1']::text[]),
  ('mcq', 'What is SBS?', $j$["SBA's Small Business Search (formerly DSBS), which COs and primes use to find small businesses","A private bid-subscription service like GovWin","The FAR clause that defines set-asides","A Google listing for local businesses"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'C1.1: many contracting officers search SBA''s Small Business Search during market research, and primes use it to find partners.', ARRAY['product', 'C1']::text[]),
  ('order', 'Put the fields of a SAM.gov row in the order you should read them.', $j$["Website (blank?)","Firm name","Contact name","Capabilities Narrative","City/State"]$j$::jsonb, $j${"order":[1,3,4,0,2]}$j$::jsonb, 'C1.2: Firm name → Capabilities Narrative → City/State → Website (blank?) → Contact name.', ARRAY['product', 'C1']::text[]),
  ('mcq', 'A Capabilities Narrative is very short, ALL CAPS and just lists products. What does that usually suggest?', $j$["A small reseller","A large prime with a bid team","A sophisticated firm on many contract vehicles","A lab with commercial clients"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'C1.2 size rule of thumb: short ALL-CAPS product lists → small reseller; long lists of agencies and vehicles → larger, more sophisticated.', ARRAY['product', 'C1']::text[]),
  ('true_false', 'At contractors with 10–50 employees you will often reach an office manager or receptionist before the owner.', $j$["True","False"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'C1.1: very small firms often have the owner answer; at 10–50 employees expect an office manager or receptionist.', ARRAY['product', 'C1']::text[]),
  ('mcq', 'What is a set-aside?', $j$["A deposit a contractor pays to bid","A contract reserved for certain small businesses or certified groups (8(a), HUBZone, WOSB, SDVOSB)","A portion of a contract the prime keeps","A delay before a solicitation is posted"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'C1 glossary: set-asides are contracts reserved for certain small businesses or certified groups.', ARRAY['product', 'C1']::text[]),
  ('mcq', 'How should you describe the idea that COs and primes check contractors'' websites?', $j$["As an official government rule","As something you heard from a friend","As how it commonly works, not as a government rule","You shouldn't mention it at all"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'C1.1: the description comes from contractor-marketing guides with a commercial interest, so present it as "how it commonly works."', ARRAY['product', 'C1']::text[])
) AS v(type, prompt, options_json, answer_json, explanation, tags)
WHERE l.code = 'C1-QUIZ'
  AND NOT EXISTS (SELECT 1 FROM training_quiz_questions q WHERE q.lesson_id = l.id);

-- C2-QUIZ (18 questions)
INSERT INTO training_quiz_questions (lesson_id, type, prompt, options_json, answer_json, explanation, tags)
SELECT l.id, v.type, v.prompt, v.options_json, v.answer_json, v.explanation, v.tags
FROM training_lessons l, (VALUES
  ('mcq', 'In our SMM packages, who is the ad budget paid to?', $j$["Bytes Platform, as part of the package","Meta, directly by the client","The SEO team","Google Ads"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'C2.3: the client pays Meta (Facebook/Instagram) directly; our fee covers content and strategy, not the ad spend.', ARRAY['product', 'C2.3']::text[]),
  ('mcq', 'What is included in one SMM month?', $j$["4 posts + 1 reel, ad spend included","10 posts, no reels","Daily posts + weekly reels","6 posts + 3 reels + an ad strategy"]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'C2.3: each month is 6 posts + 3 reels + an ad strategy.', ARRAY['product', 'C2.3']::text[]),
  ('mcq', 'Is the contract-management build (Bytescon) a subscription?', $j$["Yes, a monthly platform subscription","No: a custom one-time build of $5–8k plus a small yearly AI token fee","Yes, an annual subscription of $5–8k","No: it's free, and clients only pay for AI tokens"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'C2.5: it is a one-time build ($5,000–$8,000) plus a minimal yearly fee for AI token usage ([TOKEN_FEE]). Never call it a subscription.', ARRAY['product', 'C2.5']::text[]),
  ('multi', 'Which of these does the contract-management system do? (Select all that apply.)', $j$["Finds contracts on SAM.gov and state/municipal portals","Guarantees a higher win rate","Turns the solicitation into a compliance matrix","Drafts proposal sections for the team to edit","Gives access to non-public government data","Tracks deadlines, deliverables and invoices"]$j$::jsonb, $j${"correct":[0,2,3,5]}$j$::jsonb, 'C2.5 lists eight features; it never guarantees wins and never uses non-public data.', ARRAY['product', 'C2.5']::text[]),
  ('mcq', 'Which prospect is the weakest SEO fit?', $j$["An HVAC company","A duct-cleaning company","A pure-federal depot-maintenance contractor","An electrical contractor with commercial clients"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'C2.2: SEO is less relevant for pure-federal firms; it fits contractors with commercial/local customers who search online.', ARRAY['product', 'C2.2']::text[]),
  ('short_answer', 'Explain AI automation in one sentence a contractor would understand.', $j$[]$j$::jsonb, $j${"keywords":["repetitive","boring","repeatable","automatically","office work","does the work"],"min_matches":1,"model_answer":"AI automation means teaching software to do the boring, repeatable office work a person does today."}$j$::jsonb, 'C2.4: "AI automation means teaching software to do the boring, repeatable office work a person does today."', ARRAY['product', 'C2.4']::text[]),
  ('mcq', 'What should you never promise about SEO?', $j$["\"#1 on Google,\" guaranteed traffic, or results in weeks","That results take time","That the 6-month package suits companies serious about local leads","That we work on their Google Business Profile"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'C2.2: never promise "#1 on Google," guaranteed traffic numbers, or results in weeks.', ARRAY['product', 'C2.2']::text[]),
  ('mcq', 'What makes a website "dynamic"?', $j$["It has animations","It loads faster than a static site","It has an admin panel so the owner can edit content","It is built only on WordPress"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'C2.1: a dynamic site has an admin panel; the owner can edit content and add news/projects.', ARRAY['product', 'C2.1']::text[]),
  ('mcq', 'What is a "revamp"?', $j$["A brand-new site for a company with no website","A monthly maintenance plan","An SEO package","A redesign/modernization of an existing site"]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'C2.1: a revamp redesigns or modernizes an existing site.', ARRAY['product', 'C2.1']::text[]),
  ('mcq', 'A prospect asks, "Do I own the website?" What do you do?', $j$["Say \"Yes, always\"","Confirm company policy; do not guess","Say \"No, we keep ownership\"","Say \"Only after 12 months\""]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'C2.1: ownership is a policy question; confirm company policy and never guess.', ARRAY['product', 'C2.1']::text[]),
  ('true_false', 'You should tell prospects honestly that SEO results take time, so the 6-month package suits companies serious about local leads.', $j$["True","False"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'C2.2: be honest that SEO takes time; the 6-month package suits companies serious about local leads.', ARRAY['product', 'C2.2']::text[]),
  ('mcq', 'Which prospect is the best fit for SMM?', $j$["A pure-federal depot-maintenance firm","A guard company that is hiring constantly and has private clients","A supplier that sells only through two distributors","A firm that hasn't bid in a year"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'C2.3: SMM fits companies with private/local customers or that are hiring; guard companies recruit constantly.', ARRAY['product', 'C2.3']::text[]),
  ('mcq', 'What does an AI voice receptionist do?', $j$["Replaces the office manager","Cold-calls prospects for the client","Answers calls 24/7, takes messages and books appointments","Writes proposals"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'C2.4: the AI voice receptionist answers calls 24/7, takes messages and books appointments.', ARRAY['product', 'C2.4']::text[]),
  ('mcq', 'What do you say about price for a custom build or AI automation before scoping?', $j$["Give a fixed price to build trust","\"[PRICE] range, confirmed after a scoping call\"","Say the first month is free","Refuse to discuss price"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'C2.4: never promise fixed prices before scoping; say "[PRICE] range, confirmed after a scoping call."', ARRAY['product', 'C2.4']::text[]),
  ('mcq', 'Which line follows the Bytescon framing rule?', $j$["\"Subscribe to our platform.\"","\"Sign up for our bid portal.\"","\"We build you your own in-house system.\"","\"Join our contractor network.\""]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'C2.5: say "We build you your own in-house system." Never say "subscribe to our platform."', ARRAY['product', 'C2.5']::text[]),
  ('mcq', 'In the contract-management system, what is the "compliance gate"?', $j$["A check of NAICS match, set-aside eligibility and required certifications for each opportunity","The login screen","A legal review of the proposal","A filter that blocks late submissions"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'C2.5: each opportunity gets a win-probability score and a compliance gate (NAICS match, set-aside eligibility, certifications).', ARRAY['product', 'C2.5']::text[]),
  ('true_false', 'It''s fine to tell a prospect our websites are "government-approved" if it helps them trust us.', $j$["True","False"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'C2.1: never promise "government-approved" anything.', ARRAY['product', 'C2.1']::text[]),
  ('mcq', 'Which prospect is a WEAK fit for the contract-management build?', $j$["Bids several solicitations a month","Has 2 people doing business development","Only subcontracts to one prime and hasn't bid in a year","Lists many agencies and contract vehicles"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'C2.5: weak fits only subcontract to one prime or haven''t bid in a year.', ARRAY['product', 'C2.5']::text[])
) AS v(type, prompt, options_json, answer_json, explanation, tags)
WHERE l.code = 'C2-QUIZ'
  AND NOT EXISTS (SELECT 1 FROM training_quiz_questions q WHERE q.lesson_id = l.id);

-- C5-QUIZ (12 questions)
INSERT INTO training_quiz_questions (lesson_id, type, prompt, options_json, answer_json, explanation, tags)
SELECT l.id, v.type, v.prompt, v.options_json, v.answer_json, v.explanation, v.tags
FROM training_lessons l, (VALUES
  ('mcq', 'What is the price of the contract-management build?', $j$["$500 a month","$50,000 one-time","$5,000–$8,000 one-time + a minimal yearly AI usage fee ([TOKEN_FEE])","$5,000–$8,000 per year"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'C5.1: $5,000–$8,000 one-time (depends on customization) plus a minimal yearly AI token fee.', ARRAY['product', 'bytescon']::text[]),
  ('mcq', 'What does the yearly fee cover?', $j$["The AI usage for reading solicitations and drafting documents","A subscription to Bytes Platform","Unlimited support hours","Access to GovWin"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'C5.1: "The yearly fee just covers that AI usage. It''s not a subscription to us."', ARRAY['product', 'bytescon']::text[]),
  ('mcq', 'A BD manager asks, "Is this like GovWin/Deltek?" What is the best answer?', $j$["\"Yes, but cheaper.\"","\"No, GovWin is outdated.\"","\"It replaces GovWin completely.\"","\"Those are subscription databases built for everyone. This is a system built for your team that goes through proposal drafting and post-award tracking.\""]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'C5.1 FAQ: complement, not replace. Some clients keep their data service and use this for the work after finding the bid.', ARRAY['product', 'bytescon']::text[]),
  ('true_false', 'When asked "Does it guarantee we win?", you answer: "No. Nothing can. It helps you bid on the right things and not miss requirements or deadlines."', $j$["True","False"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'C5.1 FAQ: never promise win rates.', ARRAY['product', 'bytescon']::text[]),
  ('mcq', 'Which prospect is the BEST fit for Bytescon?', $j$["A supplier that sells only through distributors","A contractor bidding several solicitations a month with 1–3 BD people","A firm that subcontracts only to one prime","A firm that hasn't bid in a year"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'C5.1: best fits bid regularly and have 1–3 people doing BD (or the owner writes proposals).', ARRAY['product', 'bytescon']::text[]),
  ('mcq', '"Does it write the whole proposal?" What do you say?', $j$["\"Yes, fully automatically.\"","\"No, it only finds bids.\"","\"It drafts and organizes; your team reviews and finalizes. You're always in control of what's submitted.\"","\"Only for set-aside contracts.\""]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'C5.1 FAQ: it drafts and organizes; the team reviews and finalizes.', ARRAY['product', 'bytescon']::text[]),
  ('true_false', 'Pitching the contract-management build as a subscription is an automatic fail on the scorecard (score capped at 40).', $j$["True","False"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D19 / C5.1: pitching the build as a subscription is one of the four automatic fails.', ARRAY['product', 'bytescon']::text[]),
  ('mcq', 'Which of these can you promise a Bytescon prospect?', $j$["A fixed delivery date","That the system is government-approved","Access to non-public data","None of these: the timeline is [TIMELINE], confirmed after a scoping call"]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'C5.1: do not promise win rates, government approval, non-public data or a fixed delivery date.', ARRAY['product', 'bytescon']::text[]),
  ('order', 'Put the 30-second Bytescon pitch''s description of the system in order.', $j$["Drafts the first version of the proposal","Pulls opportunities from SAM.gov and state/city portals","Tracks deadlines and invoices after you win","Scores which ones you can actually win","Turns a 60-page solicitation into a compliance checklist"]$j$::jsonb, $j${"order":[1,3,4,0,2]}$j$::jsonb, 'C5.1 pitch: pulls opportunities → scores them → compliance checklist → first draft → tracks deadlines and invoices.', ARRAY['product', 'bytescon']::text[]),
  ('mcq', '"Why not just a subscription?" What is the FAQ answer?', $j$["\"Subscriptions are illegal for government contractors.\"","\"You own the build. You pay once for the system and a small yearly AI usage fee, not a monthly seat fee forever.\"","\"We might offer one later.\"","\"Because we're cheaper than GovWin.\""]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'C5.1 FAQ: you own the build; pay once plus a small yearly AI usage fee.', ARRAY['product', 'bytescon']::text[]),
  ('mcq', 'Where do the system''s pricing benchmarks come from?', $j$["Competitors' internal price lists","Non-public agency budgets","Public award data (\"what did similar contracts go for?\")","The prospect's past invoices only"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'C5.1: pricing benchmarks use public award data.', ARRAY['product', 'bytescon']::text[]),
  ('mcq', 'What does "teaming/subcontractor handoff" mean in the system?', $j$["It finds new employees","It replaces the prime contractor","It submits the proposal for you","It shares a bid package with partners or subs"]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'C5.1: teaming/subcontractor handoff lets the team share a package with partners or subs.', ARRAY['product', 'bytescon']::text[])
) AS v(type, prompt, options_json, answer_json, explanation, tags)
WHERE l.code = 'C5-QUIZ'
  AND NOT EXISTS (SELECT 1 FROM training_quiz_questions q WHERE q.lesson_id = l.id);

-- C3-QUIZ (23 questions)
INSERT INTO training_quiz_questions (lesson_id, type, prompt, options_json, answer_json, explanation, tags)
SELECT l.id, v.type, v.prompt, v.options_json, v.answer_json, v.explanation, v.tags
FROM training_lessons l, (VALUES
  ('mcq', 'When do you open the prospect''s website?', $j$["Before dialing, to prepare","While it's ringing / during the gatekeeper or opener, never before dialing","Only after booking the meeting","Only if the prospect asks"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'C3.1: do not research before dialing; click the URL while it rings.', ARRAY['classification', 'C3.1']::text[]),
  ('mcq', 'You see "Not secure" in the address bar and © 2017 in the footer. Which service do you lead with?', $j$["New website","SEO","Revamp","SMM"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'C3.2: a working but outdated site (no SSL / old ©) → Revamp.', ARRAY['classification', 'C3.2']::text[]),
  ('mcq', 'A pure-federal depot-maintenance firm has a modern site and bids monthly. Which service?', $j$["SEO","SMM","Revamp","Contract-management build"]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'C3.2 decision tree: working, up-to-date site + bids on many solicitations → contract-mgmt build.', ARRAY['classification', 'C3.2']::text[]),
  ('short_answer', 'Rephrase "Your site looks old" as a question you could ask on the call.', $j$[]$j$::jsonb, $j${"keywords":["refreshed","on your list","on your radar","last updated","few years"],"min_matches":1,"model_answer":"\"Looks like the site was last refreshed a few years back. Is that on your list?\""}$j$::jsonb, 'C3.1 tone rule: observations are questions, never insults.', ARRAY['classification', 'C3.1']::text[]),
  ('mcq', 'Why don''t we research prospects before dialing?', $j$["Average reps connect on only 5.4% of dials (13.3% for top reps), so pre-call research is mostly wasted on voicemails","Research is against company policy","Prospects prefer reps who know nothing","The website is never useful"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'C3.1: Gong''s 300M-call analysis shows most dials don''t connect.', ARRAY['classification', 'C3.1']::text[]),
  ('mcq', 'The Website URL is blank and you find nothing when you search. What do you lead with?', $j$["SEO","New website (+ capability statement page)","SMM","Contract-management build"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'C3.2 decision tree: no working website → NEW WEBSITE (+ capability statement page).', ARRAY['classification', 'C3.2']::text[]),
  ('mcq', 'Two services score the same. What is the tie-breaker?', $j$["Pick the more expensive one","Pick SEO","Lead with whatever the prospect said hurts","Ask the prospect to choose"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'C3.2 step 3: tie-breaker is whatever the prospect said hurts.', ARRAY['classification', 'C3.2']::text[]),
  ('mcq', 'If the prospect hasn''t told you a pain yet, which order of "most visible issue" do you follow?', $j$["Invisible on Google > outdated site > no site","No site > outdated site > invisible on Google","Outdated site > no site > invisible on Google","Always lead with SMM"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'C3.2 step 3: no site > outdated site > invisible on Google.', ARRAY['classification', 'C3.2']::text[]),
  ('mcq', 'An HVAC company has a modern site and mostly private customers. The owner says after-hours calls go to voicemail and half never leave a message. Lead with?', $j$["Revamp","Contract-management build","SMM","Automation (AI receptionist)"]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'C3.2: private customers + missed-calls pain → AUTOMATION. C3.3 HVAC: SEO + AI receptionist.', ARRAY['classification', 'C3.3']::text[]),
  ('mcq', 'An electrical contractor has a modern, secure site, mostly commercial customers, no ops pain mentioned, and doesn''t show up when you search "[service] [city]". Lead with?', $j$["SEO","New website","Contract-management build","Polite exit"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'C3.2: private/local customers + invisible on Google → SEO.', ARRAY['classification', 'C3.2']::text[]),
  ('mcq', 'A guard company has a decent site, is hiring constantly, mentions no ops pain, and its last Facebook post was in 2019. Lead with?', $j$["Contract-management build","Revamp","SMM","Automation"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'C3.2: private customers, no ops pain, inactive socials/hiring → SMM.', ARRAY['classification', 'C3.2']::text[]),
  ('mcq', 'A fastener supplier sells 90% through two distributors, is pure-federal, has a working site, doesn''t bid, and does nothing by hand. Best move?', $j$["Push SEO","Polite exit; log NF and offer to check back in 6 months","Pitch SMM","Pitch the contract-management build"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'C3.2: pure federal with no ops pain → polite exit (see Transcript 3).', ARRAY['classification', 'C3.2']::text[]),
  ('mcq', 'In the scoring table, how does "Pure-federal" affect the SEO score?', $j$["+3","+1","0","−3"]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'C3.2 scoring: pure-federal gives SEO −3 and SMM −2.', ARRAY['classification', 'C3.2']::text[]),
  ('mcq', 'How many points does "No URL / dead site" add to Website (new)?', $j$["+5","+2","+1","+4"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'C3.2 scoring: no URL / dead site → Website (new) +5.', ARRAY['classification', 'C3.2']::text[]),
  ('true_false', 'Website observations should be phrased as questions, never as criticism.', $j$["True","False"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'C3.1 tone rule: "I noticed X; is that on your radar?" opens the call; "Your site is bad" loses it.', ARRAY['classification', 'C3.1']::text[]),
  ('mcq', 'During the 30-second scan, what do you check in the footer?', $j$["The phone number","The © year (≤ 2021 suggests the site is dated)","The privacy policy","The font"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'C3.1 checklist #2: footer © year ≤ 2021.', ARRAY['classification', 'C3.1']::text[]),
  ('mcq', 'You reach voicemail. What do you log?', $j$["Nothing, try again tomorrow","NA","VM, plus one website observation in the notes","NI"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'C3.1 workflow step 5: log VM plus one website observation (helps the next call and follow-up email).', ARRAY['classification', 'C3.1']::text[]),
  ('mcq', 'An environmental lab says sample intake and "is my report ready?" calls eat their week. Lead with?', $j$["Automation/custom (sample intake, client portal)","SMM","New website","Polite exit"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'C3.3 lab: automation/custom (sample intake, client portal), or SEO if commercial clients.', ARRAY['classification', 'C3.3']::text[]),
  ('mcq', 'A lockers/shelving supplier''s dated site has no product catalog and no quote form. Lead with?', $j$["SMM","Contract-management build","Automation","Revamp/new website (catalog + quote form)"]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'C3.3 lockers/shelving: revamp/new website with catalog + quote form; SEO if they sell commercially.', ARRAY['classification', 'C3.3']::text[]),
  ('mcq', 'Which signal adds +4 to the contract-management build score?', $j$["No social links","Bids regularly / many agencies, vehicles, certifications listed","Serves private/local customers","No SSL"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'C3.2 scoring: bids regularly / many agencies, vehicles, certifications → contract-mgmt +4.', ARRAY['classification', 'C3.2']::text[]),
  ('true_false', 'If a working site is outdated, the decision tree says lead with Revamp, even if the firm also bids often.', $j$["True","False"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'C3.2 decision tree: the "outdated?" check comes before the "bids often?" check. Keep the contract-mgmt build as the runner-up.', ARRAY['classification', 'C3.2']::text[]),
  ('mcq', 'What do you do with the runner-up service?', $j$["Pitch it first","Never mention it","Keep it as the \"and also\" in the meeting","Email it after the call"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'C3.2 step 3: lead with the top score; keep the runner-up as the "and also" in the meeting.', ARRAY['classification', 'C3.2']::text[]),
  ('multi', 'Which scan findings point to a Revamp? (Select all that apply.)', $j$["No padlock / \"Not secure\"","© 2016 in the footer","Menu broken on a phone","No website at all","No capability statement or NAICS on the site"]$j$::jsonb, $j${"correct":[0,1,2,4]}$j$::jsonb, 'C3.2: outdated = no SSL / old © / not mobile / no capability statement → Revamp. No site at all → New website.', ARRAY['classification', 'C3.1']::text[])
) AS v(type, prompt, options_json, answer_json, explanation, tags)
WHERE l.code = 'C3-QUIZ'
  AND NOT EXISTS (SELECT 1 FROM training_quiz_questions q WHERE q.lesson_id = l.id);

-- T2-C1-QUIZ (9 questions)
INSERT INTO training_quiz_questions (lesson_id, type, prompt, options_json, answer_json, explanation, tags)
SELECT l.id, v.type, v.prompt, v.options_json, v.answer_json, v.explanation, v.tags
FROM training_lessons l, (VALUES
  ('mcq', 'What is Hormozi''s "Rule of 100"?', $j$["100 dials per week","100 primary outreach actions a day for 100 days","100 meetings per quarter","100 seconds per call"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'D1: the Rule of 100 from $100M Leads: 100 primary outreach actions a day for 100 days.', ARRAY['sales', 'D1']::text[]),
  ('mcq', 'In Gong''s 300M+ call analysis, what are the average rep''s connect and meeting rates?', $j$["50% of dials connect; 25% of connects book","20% connect; 10% book","5.4% of dials connect; 4.6% of connects book","1% connect; 1% book"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'D1: average 5.4% connect and 4.6% meeting-per-connect (top reps 13.3% and 16.7%).', ARRAY['sales', 'D1']::text[]),
  ('mcq', 'What does Josh Braun mean by "sorting, not selling"?', $j$["It's fine if they want to talk and fine if they don't; detachment lowers resistance","Sort your lead list alphabetically","Only call prospects who already want to buy","Push hard until they say yes"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D1: detach from the outcome; pressure shows in your voice.', ARRAY['sales', 'D1']::text[]),
  ('order', 'Put the 7 stages of call anatomy in order.', $j$["Book the meeting","Opener","Problem questions","Confirm & close","Reason for call","Bridge/pitch","Permission/interest check"]$j$::jsonb, $j${"order":[1,4,6,2,5,0,3]}$j$::jsonb, 'D2: Opener → Reason → Permission/interest check → Problem questions → Bridge/pitch → Book → Confirm & close.', ARRAY['sales', 'D2']::text[]),
  ('mcq', 'On successful cold calls, roughly what % of the time did reps talk?', $j$["~25%","~40%","~55%","~80%"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'D2: Gong found reps talked about 55% of the time on successful cold calls; you carry the conversation to earn the meeting.', ARRAY['sales', 'D2']::text[]),
  ('mcq', 'How long were successful cold calls on average compared with unsuccessful ones (Gong)?', $j$["1:30 vs 3:00","3:14 vs 5:50","10:00 vs 2:00","5:50 vs 3:14"]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'D2: successful cold calls averaged 5:50 vs 3:14.', ARRAY['sales', 'D2']::text[]),
  ('mcq', 'Per Braun, what is the longest you should talk before handing the conversation back with a question?', $j$["About 15 seconds","About 1 minute","About 2 minutes","As long as it takes to explain all features"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D2: don''t talk more than about 15 seconds without handing it back with a question.', ARRAY['sales', 'D2']::text[]),
  ('true_false', 'You should track activities (dials, conversations) as wins, not just meetings.', $j$["True","False"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D1 daily mindset routine: track activities as wins.', ARRAY['sales', 'D1']::text[]),
  ('mcq', 'What is the goal of the "Reason for call" stage (10–25 seconds)?', $j$["List all our services","One sentence on why them: industry problem + live website observation","Ask for the meeting","Confirm the prospect's email"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'D2: reason for call = one sentence why them, industry problem + live website observation.', ARRAY['sales', 'D2']::text[])
) AS v(type, prompt, options_json, answer_json, explanation, tags)
WHERE l.code = 'T2-C1-QUIZ'
  AND NOT EXISTS (SELECT 1 FROM training_quiz_questions q WHERE q.lesson_id = l.id);

-- T2-C2-QUIZ (12 questions)
INSERT INTO training_quiz_questions (lesson_id, type, prompt, options_json, answer_json, explanation, tags)
SELECT l.id, v.type, v.prompt, v.options_json, v.answer_json, v.explanation, v.tags
FROM training_lessons l, (VALUES
  ('mcq', 'Per Gong, which opener performed worst?', $j$["\"How have you been?\"","\"Have you heard our name tossed around?\"","A permission-based opener","\"Did I catch you at a bad time?\""]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'D3: "Did I catch you at a bad time?" dropped to 0.9% in the 2018 analysis (2.15% in the later guide).', ARRAY['sales', 'D3']::text[]),
  ('mcq', 'What lifted success 2.1x in Gong''s data?', $j$["Stating the reason for the call","Using the prospect's last name","Calling on Mondays","Speaking faster"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D3: stating "the reason for my call is…" lifted success 2.1x.', ARRAY['sales', 'D3']::text[]),
  ('mcq', 'In Gong''s 2018 analysis of 90,380 cold calls, what was the success rate of "How have you been?"', $j$["1.5%","10.01% (vs. a 1.5% baseline)","25%","0.9%"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'D3: 10.01% vs 1.5% baseline (6.6x).', ARRAY['sales', 'D3']::text[]),
  ('short_answer', 'Give an example of a no-oriented question (Chris Voss).', $j$[]$j$::jsonb, $j${"keywords":["terrible idea","against","crazy","given up","bad idea"],"min_matches":1,"model_answer":"\"Would it be a terrible idea if I took 30 seconds to explain why I called?\""}$j$::jsonb, 'D3 Opener 4: Voss frames questions so "no" is the safe answer. Avoid the "bad time?" wording.', ARRAY['sales', 'D3']::text[]),
  ('mcq', 'How many voicemails do you leave per cadence?', $j$["None","1 on every dial","2 (dial #1 and dial #3 or #4)","5"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'D5: leave a voicemail on dial #1 and dial #3 (or #4) only, each followed by an email within 5 minutes.', ARRAY['sales', 'D5']::text[]),
  ('mcq', 'The gatekeeper asks, "What''s this regarding?" Best answer?', $j$["\"It's personal.\"","\"It's about how [Company] shows up when primes and contracting officers look you up online. Is [First name] the right person for that?\"","\"I'd rather tell him directly.\"","\"Just put me through, please.\""]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'D4: be specific and honest, and ask who handles the website and bids.', ARRAY['sales', 'D4']::text[]),
  ('mcq', 'The gatekeeper says, "He''s busy." What do you say?', $j$["\"No problem. When's usually a good time to catch them, early morning or end of day?\" and log CB with time","\"It'll only take a minute, please put me through.\"","\"Okay, bye.\"","\"Can I leave a voicemail on his cell?\""]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D4: ask for the best time and log CB with the time.', ARRAY['sales', 'D4']::text[]),
  ('mcq', 'How long should Voicemail #1 be?', $j$["About 60 seconds","As long as needed","5 seconds","≤20 seconds"]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'D5: Voicemail #1 is ≤20 seconds and points to the email.', ARRAY['sales', 'D5']::text[]),
  ('mcq', 'You promised to call back at 10:00. What do you do?', $j$["Call sometime that morning","Wait for them to call you","Call at the exact minute promised and remind them they asked for the call","Send an email instead"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'D6: call at the exact minute promised: "You asked me to call back today at 10 about [topic]."', ARRAY['sales', 'D6']::text[]),
  ('true_false', 'The "Have you heard our name tossed around?" opener should only be used while it''s honest; if they say no, just move on.', $j$["True","False"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D3 Opener 3: only use it while it''s honest.', ARRAY['sales', 'D3']::text[]),
  ('mcq', 'After leaving a voicemail, when do you send the email?', $j$["The next day","Within 5 minutes","Only if they call back","After the third voicemail"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'D5: each voicemail is followed by an email within 5 minutes; Gong reports voicemails double the likelihood of an email reply.', ARRAY['sales', 'D5']::text[]),
  ('mcq', 'What tonality should you use for all openers?', $j$["Calm, slower than normal, a smile in your voice, a downward tone at the end of statements","Fast and high-energy so they don't hang up","Rising \"uptones\" to sound friendly","Monotone, like reading a script"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D3: calm, slower, smile, downward tone; avoid nervous uptones.', ARRAY['sales', 'D3']::text[])
) AS v(type, prompt, options_json, answer_json, explanation, tags)
WHERE l.code = 'T2-C2-QUIZ'
  AND NOT EXISTS (SELECT 1 FROM training_quiz_questions q WHERE q.lesson_id = l.id);

-- T2-C3-QUIZ (10 questions)
INSERT INTO training_quiz_questions (lesson_id, type, prompt, options_json, answer_json, explanation, tags)
SELECT l.id, v.type, v.prompt, v.options_json, v.answer_json, v.explanation, v.tags
FROM training_lessons l, (VALUES
  ('mcq', 'What is the bridging formula?', $j$["Feature → Benefit → Price","Problem → Agitate → Solve","Label → Link → Light pitch → Question","Hook → Story → Close"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'D8: Label → Link → Light pitch → Question.', ARRAY['sales', 'D8']::text[]),
  ('mcq', 'How many problem questions should you ask on a cold call?', $j$["As many as possible","2–4 max","None, just pitch","Exactly 10"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'D7: ask 2–4 questions max; save full discovery for the meeting.', ARRAY['sales', 'D7']::text[]),
  ('mcq', 'Which of these is a consequence/implication question?', $j$["\"Who manages your site today?\"","\"Do you post anywhere now?\"","\"How do you find solicitations today?\"","\"If competitors get those calls instead, what's that worth over a year?\""]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'D7: consequence questions size the cost of the problem; the scorecard wants at least one.', ARRAY['sales', 'D7']::text[]),
  ('mcq', 'What is the best way to ask for the meeting?', $j$["\"Does Wednesday at 10 or Thursday at 2 work better, your time?\"","\"When are you free?\"","\"Let me know if you're ever interested.\"","\"Can I send you a calendar link?\""]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D9: offer two specific options, not "when are you free?"', ARRAY['sales', 'D9']::text[]),
  ('mcq', 'What is a Sandler upfront contract for the meeting?', $j$["A signed purchase agreement","A deposit to hold the slot","Agreeing up front on time, agenda and what each outcome means, including \"no\"","A promise that they will buy"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'D9: agree on time, agenda and acceptable outcomes (including "no") to reduce stalls later.', ARRAY['sales', 'D9']::text[]),
  ('mcq', 'Why send the calendar invite while you''re still on the phone?', $j$["It's faster for you","It reduces no-shows","It's required by the CRM","So they can forward it"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'D10: "I just sent the invite. Can you see it?" reduces no-shows.', ARRAY['sales', 'D10']::text[]),
  ('mcq', 'What does Hormozi''s CLOSER stand for?', $j$["Call, Listen, Offer, Sell, Earn, Repeat","Connect, Lead, Open, Solve, End, Review","Clarify, List, Offer, Sell, Explain, Return","Clarify, Label, Overview past pain, Sell the vacation, Explain away concerns, Reinforce"]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'D8: on a cold call you only do a light C-L-S to earn the meeting.', ARRAY['sales', 'D8']::text[]),
  ('true_false', 'In the confirmation cadence, you send an SMS reminder 24 hours before the meeting only if the prospect agreed to texts.', $j$["True","False"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D10 step 6: email immediately, SMS 24h before only if they agreed to texts, call or email 1h before.', ARRAY['sales', 'D10']::text[]),
  ('mcq', 'Why ask "What''s the one thing you want to get out of that call?"', $j$["It gives them a reason to show (commitment and consistency)","To fill time","To find out their budget","To qualify them out"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D10 step 3: a reason to show uses commitment and consistency.', ARRAY['sales', 'D10']::text[]),
  ('multi', 'Which of these are Sandler pain-funnel questions? (Select all that apply.)', $j$["\"Tell me more about that…\"","\"How long has that been a problem?\"","\"Why didn't you fix it already?\"","\"How much has it cost you?\"","\"Would you maybe possibly be interested?\""]$j$::jsonb, $j${"correct":[0,1,3]}$j$::jsonb, 'D7: the pain funnel includes "Tell me more…", "How long has that been a problem?", "How much has it cost you?". "Why…?" sounds accusatory.', ARRAY['sales', 'D7']::text[])
) AS v(type, prompt, options_json, answer_json, explanation, tags)
WHERE l.code = 'T2-C3-QUIZ'
  AND NOT EXISTS (SELECT 1 FROM training_quiz_questions q WHERE q.lesson_id = l.id);

-- T2-C4-QUIZ (12 questions)
INSERT INTO training_quiz_questions (lesson_id, type, prompt, options_json, answer_json, explanation, tags)
SELECT l.id, v.type, v.prompt, v.options_json, v.answer_json, v.explanation, v.tags
FROM training_lessons l, (VALUES
  ('order', 'Put the five steps of A-C-I-R-R in order.', $j$["Respond","Isolate","Acknowledge","Re-ask","Clarify"]$j$::jsonb, $j${"order":[2,4,1,0,3]}$j$::jsonb, 'D11: Acknowledge → Clarify → Isolate → Respond → Re-ask.', ARRAY['sales', 'D11', 'objections']::text[]),
  ('mcq', 'A prospect says "Remove me from your list." What do you do?', $j$["Ask why first","Comply immediately, log DNC, no rebuttal","Offer to email instead","Try one more benefit"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'D12 #16: "Understood, I''ll remove you right now. Sorry for the interruption." Log DNC. Never argue.', ARRAY['sales', 'D12', 'objections']::text[]),
  ('mcq', 'In Gong''s breakdown, what share of cold-call objections are dismissive brush-offs like "not interested"?', $j$["7.9%","25%","49.5%","74%"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'D11: 49.5% brush-offs, 42.6% situational, 7.9% existing solution.', ARRAY['sales', 'D11', 'objections']::text[]),
  ('mcq', 'What share of all objections do the top five make up?', $j$["74%","49.5%","42.6%","90%"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D11: the top five make up 74%. Master them first.', ARRAY['sales', 'D11', 'objections']::text[]),
  ('mcq', '"We already use GovWin." What is the principle behind the response?', $j$["Attack the competitor","Offer a discount","Ask for a referral","Complement, not replace: ask who builds the compliance matrix after they find a bid"]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'D12 #13: "Good, you''ve got the finding part covered. What happens after you find a bid…?"', ARRAY['sales', 'D12', 'objections']::text[]),
  ('mcq', '"How did you get my number?" Best answer?', $j$["\"I'd rather not say.\"","\"Your business is registered on SAM.gov, which lists contact info for contractors. We reach out to registered contractors in [industry]…\"","\"From a list we bought.\"","\"The government gave it to us.\""]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'D12 #6: transparency and authority. Never imply government affiliation.', ARRAY['sales', 'D12', 'objections']::text[]),
  ('mcq', '"We don''t need SEO." What is your first response?', $j$["\"Everyone needs SEO.\"","\"Okay, bye.\"","\"You might be right. Is your work 100% government, or do you do private jobs too?\"","\"SEO will get you to #1.\""]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'D12 #7: agree and isolate; if pure-federal, switch services.', ARRAY['sales', 'D12', 'objections']::text[]),
  ('mcq', '"What does it cost?" for the contract-management build. What do you say?', $j$["\"It's a one-time build, typically $5,000–$8,000, plus a small yearly AI usage fee. Not a subscription.\"","\"I can't discuss price.\"","\"It's a small monthly subscription.\"","\"Whatever your budget is.\""]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D12 #14: don''t dodge price. Gong Labs found win rates 10% higher when pricing came up on the first call.', ARRAY['sales', 'D12', 'objections']::text[]),
  ('mcq', 'Which line is an example of the "Isolate" step?', $j$["\"That's fair…\"","\"When you say not interested, is it the timing or the idea?\"","\"Would Thursday at 2 work?\"","\"Other than budget, is there anything else that would stop you from taking a quick look?\""]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'D11: Isolate = "Other than [X], is there anything else…?"', ARRAY['sales', 'D11', 'objections']::text[]),
  ('mcq', '"We don''t trust overseas/agencies." What must you never do?', $j$["Label their past experience","Misrepresent where the team is located","Ask what happened last time","Explain the process and milestones"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'D12 #12: use labeling and an accusation audit; never misrepresent where the team is located.', ARRAY['sales', 'D12', 'objections']::text[]),
  ('mcq', '"I need to talk to my partner." Best response?', $j$["\"Can't you decide yourself?\"","\"Okay, call me when you've talked.\"","\"Would it be easier if they joined the 20-minute call, so you don't have to relay everything? Thursday at 2 work for both?\"","\"I'll send a contract you can both sign.\""]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'D12 #15: include the decision-maker in the meeting.', ARRAY['sales', 'D12', 'objections']::text[]),
  ('true_false', 'For "No budget" on the contract-management build, you may say "One contract won usually covers it many times over," as long as you don''t guarantee a win.', $j$["True","False"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D12 #4(c): reframe the cost of inaction, with no win guarantees.', ARRAY['sales', 'D12', 'objections']::text[])
) AS v(type, prompt, options_json, answer_json, explanation, tags)
WHERE l.code = 'T2-C4-QUIZ'
  AND NOT EXISTS (SELECT 1 FROM training_quiz_questions q WHERE q.lesson_id = l.id);

-- T2-C5-QUIZ (13 questions)
INSERT INTO training_quiz_questions (lesson_id, type, prompt, options_json, answer_json, explanation, tags)
SELECT l.id, v.type, v.prompt, v.options_json, v.answer_json, v.explanation, v.tags
FROM training_lessons l, (VALUES
  ('mcq', 'Which days and times does Gong''s data favor for cold calls?', $j$["Monday 8–9 a.m.","Wednesday/Thursday, 11 a.m.–noon and 4–5 p.m., the prospect's time","Friday afternoons","Any day at 7 p.m."]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'D17: Wed/Thu, 11–12 and 4–5 p.m. prospect''s time; Monday mornings and Friday afternoons are weaker.', ARRAY['sales', 'D17']::text[]),
  ('mcq', 'What is the Voss mirroring technique?', $j$["Repeat their last 1–3 words as a question, then pause","Copy their accent","Repeat everything they say","Match their speaking speed"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D13: mirror the last 1–3 words as a question ("…too many bids?"), then pause about 4 seconds.', ARRAY['sales', 'D13']::text[]),
  ('mcq', 'Why does Voss avoid "I hear you saying…" when labeling?', $j$["It sounds too formal","It takes too long","It shifts the focus to you; say \"It sounds like…\" instead","It is a closing technique"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'D13: labels start with "It sounds like…" or "It seems like…".', ARRAY['sales', 'D13']::text[]),
  ('mcq', 'Which question style should you avoid because it sounds accusatory?', $j$["\"How are you finding bids today?\"","\"What would make this worth your time?\"","\"How long has that been a problem?\"","\"Why…?\""]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'D13: use calibrated "How/What" questions; "Why…?" sounds accusatory.', ARRAY['sales', 'D13']::text[]),
  ('mcq', 'What is the required notes format?', $j$["Name | Phone | Email","Pain: … | Service: … | Site: … | Next: …","Date | Time | Outcome","Free text, any format"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'D16: notes must follow Pain | Service | Site | Next and be written before the next dial.', ARRAY['sales', 'D16']::text[]),
  ('mcq', 'What notes does a CB (callback scheduled) disposition require?', $j$["Date/time + time zone + topic","Nothing","GK name only","Reason given + service pitched"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D16: CB = date/time + time zone + topic.', ARRAY['sales', 'D16']::text[]),
  ('mcq', 'What does the disposition NF mean?', $j$["No answer","Not interested","Not a fit (note why)","Number forwarded"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'D16: NF = not a fit; required note is why. NI = not interested; NA = no answer.', ARRAY['sales', 'D16']::text[]),
  ('mcq', 'What happens on Day 12 of the follow-up cadence?', $j$["Call #2, no voicemail","Move to nurture","Voicemail #2","Call #5 + email #3 (breakup, no-oriented: \"Have you given up on improving [X]?\")"]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'D15: Day 12 is call #5 + the breakup email.', ARRAY['sales', 'D15']::text[]),
  ('mcq', 'Gong reports that cold calling nearly doubles cold-email reply rates. What are the numbers?', $j$["3.44% vs 1.81%","10% vs 5%","50% vs 25%","1.5% vs 0.9%"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D15: 3.44% vs 1.81%, even when the call doesn''t connect.', ARRAY['sales', 'D15']::text[]),
  ('mcq', 'In the slow-down drill, about what pace should you read the reason-for-call?', $j$["80 words/minute","200 words/minute","About 140 words/minute","As fast as possible"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'D14 drill 2: about 140 words/minute.', ARRAY['sales', 'D14']::text[]),
  ('mcq', 'At Gong''s average 5.4% connect rate, about how many conversations do 100 dials produce?', $j$["About 1","About 5","About 20","About 50"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'D18 math check: 100 dials ≈ 5 conversations; at 4.6% meeting-per-connect, about 1 meeting per 4 days.', ARRAY['sales', 'D18']::text[]),
  ('true_false', 'Notes must be written before the next dial.', $j$["True","False"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D16 rule: notes before the next dial.', ARRAY['sales', 'D16']::text[]),
  ('mcq', 'The Bridge Group''s phone-centric SDR teams averaged how many dials and quality conversations per day?', $j$["112 activities and 10 conversations","20 dials and 1 conversation","200 dials and 15 conversations","56 dials and 4.6 quality conversations"]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'D18: phone-centric teams averaged 56 dials and 4.6 quality conversations a day.', ARRAY['sales', 'D18']::text[])
) AS v(type, prompt, options_json, answer_json, explanation, tags)
WHERE l.code = 'T2-C5-QUIZ'
  AND NOT EXISTS (SELECT 1 FROM training_quiz_questions q WHERE q.lesson_id = l.id);

-- T2-C6-QUIZ (9 questions)
INSERT INTO training_quiz_questions (lesson_id, type, prompt, options_json, answer_json, explanation, tags)
SELECT l.id, v.type, v.prompt, v.options_json, v.answer_json, v.explanation, v.tags
FROM training_lessons l, (VALUES
  ('mcq', 'On the 100-point scorecard, what are the pass and excellent scores?', $j$["Pass ≥50; Excellent ≥75","Pass ≥60; Excellent ≥90","Pass ≥70; Excellent ≥85","Pass ≥80; Excellent ≥95"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'D19: Pass ≥70; Excellent ≥85.', ARRAY['sales', 'D19']::text[]),
  ('multi', 'Which of these are automatic fails (score capped at 40)? (Select all that apply.)', $j$["Arguing after a \"remove me\" request","Promising #1 on Google or contract wins","Using the prospect's first name twice","Pitching the contract-management build as a subscription","Asking a consequence question","Misrepresenting the company"]$j$::jsonb, $j${"correct":[0,1,3,5]}$j$::jsonb, 'D19: the four automatic fails.', ARRAY['sales', 'D19']::text[]),
  ('mcq', 'Which two criteria are worth 15 points each?', $j$["Problem questions and objection handling","Opener and reason for call","Tonality and listening","Next step and accuracy"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D19: problem questions (15) and objection handling (15).', ARRAY['sales', 'D19']::text[]),
  ('mcq', 'In Transcript 1 the rep says "Half of them never leave one?" Which technique is that?', $j$["Labeling","Mirroring","Anchoring","Upfront contract"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'D20 / D13: repeating the last words as a question is a Voss mirror.', ARRAY['sales', 'D20']::text[]),
  ('mcq', 'In Transcript 3 (lockers supplier who sells through distributors), what is the correct disposition?', $j$["BK","NI","CB","NF with reason \"sells via distributors,\" nurture in 6 months"]$j$::jsonb, $j${"correct":3}$j$::jsonb, 'D20: the polite no is logged NF with the reason; detaching is a success, not a failure.', ARRAY['sales', 'D20']::text[]),
  ('mcq', 'What earns full marks on criterion 9, Accuracy?', $j$["Reading the script word for word","Quoting the lowest price","No false promises (rankings, wins, unapproved prices, delivery dates)","Correct spelling in notes"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'D19: criterion 9 is Accuracy: no false promises.', ARRAY['sales', 'D19']::text[]),
  ('true_false', 'In Transcript 2, the rep answered "no budget for another subscription" by saying it''s not a subscription, stating the one-time price, and isolating.', $j$["True","False"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D20 Transcript 2 (~85): correct "not a subscription" framing with A-C-I-R-R.', ARRAY['sales', 'D20']::text[]),
  ('mcq', 'If a call triggers an automatic fail, what is the score capped at?', $j$["0","40","50","70"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'D19: automatic fails cap the score at 40.', ARRAY['sales', 'D19']::text[]),
  ('mcq', 'What earns full marks on "Next step"?', $j$["Specific day/time offered, invite sent, attendees confirmed","\"I'll call you sometime\"","Sending a brochure","Asking \"When are you free?\""]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'D19: specific day/time offered; invite sent; attendees confirmed.', ARRAY['sales', 'D19']::text[])
) AS v(type, prompt, options_json, answer_json, explanation, tags)
WHERE l.code = 'T2-C6-QUIZ'
  AND NOT EXISTS (SELECT 1 FROM training_quiz_questions q WHERE q.lesson_id = l.id);

-- T3-C1-QUIZ (7 questions)
INSERT INTO training_quiz_questions (lesson_id, type, prompt, options_json, answer_json, explanation, tags)
SELECT l.id, v.type, v.prompt, v.options_json, v.answer_json, v.explanation, v.tags
FROM training_lessons l, (VALUES
  ('mcq', 'What counts as your check-in for a shift?', $j$["Pressing a check-in button at any time","Your first login of the shift","Your first call in 3CX","HR marking you present"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'T3-C1.1: your first login of the shift records your attendance; logging in again later doesn''t change it.', ARRAY['company', 'T3-C1']::text[]),
  ('mcq', 'Where do your call counts and talk time come from?', $j$["You type them into the Daily Report","HR enters them at the end of the shift","3CX sends every call on your extension to the system automatically","They are estimated from your leads"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'T3-C1.1: 3CX sends each call (number, time, duration) automatically; always call from your own extension.', ARRAY['company', 'T3-C1']::text[]),
  ('true_false', 'Before your Live-Calling Certification you can call live leads from My Leads.', $j$["True","False"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'T3-C1.1: My Leads is locked until you are certified; you practise with roleplays first.', ARRAY['company', 'T3-C1']::text[]),
  ('mcq', 'You mark a lead "Callback". Where does it go?', $j$["To a different agent after 15 days","Back to you for the callback","To the dead pool","To HR"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'T3-C1.2: callbacks come back to the same agent.', ARRAY['company', 'T3-C1']::text[]),
  ('mcq', 'You mark a lead "Not interested". What happens to it?', $j$["It is deleted","It goes to your Pipeline","It is recycled to a different agent after about 15 days","It comes back to you tomorrow"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'T3-C1.2: not interested, voicemail, busy and do-not-call leads are recycled to a different agent after ~15 days.', ARRAY['company', 'T3-C1']::text[]),
  ('mcq', 'Which menu item shows your call-quality scores from the automatic QA system?', $j$["Pipeline","Daily Report","Leaderboard","Sales"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'T3-C1.1: the Daily Report shows your QA call-quality scores; My Coaching has the weekly report.', ARRAY['company', 'T3-C1']::text[]),
  ('true_false', 'Shifts that start on Saturday or Sunday are not tracked for attendance.', $j$["True","False"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'T3-C1.1: weekend shifts show "Weekend – system paused".', ARRAY['company', 'T3-C1']::text[])
) AS v(type, prompt, options_json, answer_json, explanation, tags)
WHERE l.code = 'T3-C1-QUIZ'
  AND NOT EXISTS (SELECT 1 FROM training_quiz_questions q WHERE q.lesson_id = l.id);

-- T3-C2-QUIZ (9 questions)
INSERT INTO training_quiz_questions (lesson_id, type, prompt, options_json, answer_json, explanation, tags)
SELECT l.id, v.type, v.prompt, v.options_json, v.answer_json, v.explanation, v.tags
FROM training_lessons l, (VALUES
  ('mcq', 'You log in 45 minutes after your shift starts. What is your status?', $j$["On time","Late","Half day","Absent"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'T3-C2.1: up to 30 minutes is on time, 31–90 minutes is late, 91+ is a half day.', ARRAY['company', 'T3-C2']::text[]),
  ('mcq', 'How many lates per month are free?', $j$["None","1","3","5"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'T3-C2.1: the first 3 lates each month are free; from the 4th, each late costs half a day.', ARRAY['company', 'T3-C2']::text[]),
  ('mcq', 'Your base salary is 110,000 and the month has 22 working days. What is your daily potential?', $j$["3,667","5,000","5,500","4,400"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'T3-C2.2: daily potential = base ÷ working days = 110,000 ÷ 22 = 5,000.', ARRAY['company', 'T3-C2']::text[]),
  ('mcq', 'Full-time targets are 300 calls and 100 minutes. You made 150 calls and 50 minutes of talk. What is your performance score?', $j$["30%","50%","75%","100%"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'T3-C2.2: calls 150/300 × 60% = 30% plus talk 50/100 × 40% = 20% → 50%.', ARRAY['company', 'T3-C2']::text[]),
  ('true_false', 'A 20-second call adds to your talk time.', $j$["True","False"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'T3-C2.2: talk time only counts calls of 30 seconds or more (the call still counts as a call).', ARRAY['company', 'T3-C2']::text[]),
  ('mcq', 'You hit both targets but it was a half day. What do you earn for that day?', $j$["100% of your daily potential","50% of your daily potential","Nothing","75% of your daily potential"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'T3-C2.2: day''s pay = daily potential × performance (100%) × attendance (half day = 50%).', ARRAY['company', 'T3-C2']::text[]),
  ('mcq', 'You are in Ramp 50% (first 30 days after certification) and miss your targets. What happens?', $j$["Normal deductions apply","No missed-target deductions: the day counts as 100% performance","You are moved back to training","Half your salary is deducted"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'T3-C2.3: in Training, Supervised and Ramp 50% there are no missed-target deductions; attendance still counts.', ARRAY['company', 'T3-C2']::text[]),
  ('mcq', 'When do you earn commission on a sale?', $j$["As soon as you log the sale","When HR approves the sale","When the full deal value has been collected (5% of the total)","At the end of the month on all logged sales"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'T3-C2.3: commission is 5% of the total deal value once the whole amount has been collected and approved.', ARRAY['company', 'T3-C2']::text[]),
  ('true_false', 'Hitting your Golden Ticket raises your salary for the day.', $j$["True","False"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'T3-C2.3: the Golden Ticket is recognition for hitting your daily sales target; it doesn''t change the salary calculation.', ARRAY['company', 'T3-C2']::text[])
) AS v(type, prompt, options_json, answer_json, explanation, tags)
WHERE l.code = 'T3-C2-QUIZ'
  AND NOT EXISTS (SELECT 1 FROM training_quiz_questions q WHERE q.lesson_id = l.id);

-- T3-C3-QUIZ (6 questions)
INSERT INTO training_quiz_questions (lesson_id, type, prompt, options_json, answer_json, explanation, tags)
SELECT l.id, v.type, v.prompt, v.options_json, v.answer_json, v.explanation, v.tags
FROM training_lessons l, (VALUES
  ('order', 'Put the pipeline stages in order.', $j$["Proposal sent","New interested","Closed won","Follow up"]$j$::jsonb, $j${"order":[1,3,0,2]}$j$::jsonb, 'T3-C3.1: New interested → Follow up → Proposal sent → Closed won (or Closed lost).', ARRAY['company', 'T3-C3']::text[]),
  ('mcq', 'What is your main goal on the phone?', $j$["Close the deal","Book the meeting with the specialist","Send a proposal","Collect a deposit"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'T3-C3.1: your job on the phone is to book the meeting; the specialist runs it.', ARRAY['company', 'T3-C3']::text[]),
  ('multi', 'What must your notes include before the specialist meets the client? (Select all that apply.)', $j$["Who is attending","Day, time and time zone","The client's pain in their own words","Your guess at their annual revenue","The service you think they need","What you noticed on their website"]$j$::jsonb, $j${"correct":[0,1,2,4,5]}$j$::jsonb, 'T3-C3.1: who, when (with time zone), pain, service, site, and what they want from the meeting.', ARRAY['company', 'T3-C3']::text[]),
  ('mcq', 'A client agrees to a $4,000 website and pays a $1,000 deposit today. How do you log it?', $j$["Log a sale of $1,000","Log a sale with a total deal value of $4,000 and a first payment of $1,000","Wait until they pay everything, then log $4,000","Ask HR to log it"]$j$::jsonb, $j${"correct":1}$j$::jsonb, 'T3-C3.2: always log the total agreed value; record the deposit as the first payment.', ARRAY['company', 'T3-C3']::text[]),
  ('true_false', 'Payments you record count as collected only after HR approves them.', $j$["True","False"]$j$::jsonb, $j${"correct":0}$j$::jsonb, 'T3-C3.2: each sale and each payment is pending until HR approves it.', ARRAY['company', 'T3-C3']::text[]),
  ('mcq', 'A $4,000 deal has been fully paid and approved. What commission do you earn?', $j$["$40","$100","$200","$400"]$j$::jsonb, $j${"correct":2}$j$::jsonb, 'T3-C3.2: 5% of the total deal value: 5% × $4,000 = $200.', ARRAY['company', 'T3-C3']::text[])
) AS v(type, prompt, options_json, answer_json, explanation, tags)
WHERE l.code = 'T3-C3-QUIZ'
  AND NOT EXISTS (SELECT 1 FROM training_quiz_questions q WHERE q.lesson_id = l.id);

-- ---------------------------------------------------------------- flashcards (insert only into empty decks)
INSERT INTO training_flashcards (deck_lesson_id, front, back, tags, sort_order)
SELECT l.id, v.front, v.back, v.tags, v.sort_order
FROM training_lessons l, (VALUES
  ('Set-aside', 'Contracts reserved for small or certified businesses (8(a), HUBZone, WOSB, SDVOSB).', ARRAY['C1', 'glossary']::text[], 1),
  ('Capability statement', 'A one-page business resume for government buyers (COs and primes).', ARRAY['C1', 'glossary']::text[], 2),
  ('Prime', 'The company holding the main government contract; it often hires small subs.', ARRAY['C1', 'glossary']::text[], 3),
  ('SBS', 'SBA''s Small Business Search (formerly DSBS): the database COs and primes use to find small businesses.', ARRAY['C1']::text[], 4),
  ('NAICS code', 'A 6-digit code describing a company''s industry; contracts are tagged with them.', ARRAY['C1', 'glossary']::text[], 5),
  ('SAM.gov', 'The federal registry; contractors must register to win federal work.', ARRAY['C1', 'glossary']::text[], 6),
  ('Contracting officer (CO)', 'The government employee who awards contracts.', ARRAY['C1', 'glossary']::text[], 7),
  ('Solicitation / RFP / RFQ', 'The government''s request for bids.', ARRAY['C1', 'glossary']::text[], 8),
  ('Past performance', 'Proof a contractor has done similar work before.', ARRAY['C1']::text[], 9),
  ('Subcontracting plan threshold (FAR 19.702)', 'Contracts over $900,000 ($2 million for construction), per FAC 2025-06.', ARRAY['C1']::text[], 10),
  ('Gatekeeper', 'Someone who answers for the decision-maker: receptionist or office manager.', ARRAY['C1', 'glossary']::text[], 11),
  ('Decision-maker (DM)', 'The person who can say yes, usually the owner/president at small contractors.', ARRAY['C1', 'glossary']::text[], 12),
  ('Dial vs. connect', 'Dial = any call attempt. Connect = a real person picked up and you spoke.', ARRAY['C1', 'glossary']::text[], 13),
  ('Brush-off', 'A reflex objection ("not interested"), not a real reason.', ARRAY['C1', 'glossary']::text[], 14),
  ('Pattern interrupt', 'Saying something unexpected so the prospect drops the automatic "not interested" reflex.', ARRAY['C1', 'glossary']::text[], 15),
  ('Show rate', 'The % of booked meetings that actually happen.', ARRAY['C1', 'glossary']::text[], 16),
  ('Ramp', 'The period before a new rep is expected to hit full quota.', ARRAY['C1', 'glossary']::text[], 17),
  ('Question that decides SEO/SMM fit', '"What % of your work is government vs. private/commercial?"', ARRAY['C1']::text[], 18),
  ('SAM.gov row reading order', 'Firm name → Capabilities Narrative → City/State → Website → Contact name.', ARRAY['C1']::text[], 19)
) AS v(front, back, tags, sort_order)
WHERE l.code = 'C1-CARDS'
  AND NOT EXISTS (SELECT 1 FROM training_flashcards f WHERE f.deck_lesson_id = l.id);

INSERT INTO training_flashcards (deck_lesson_id, front, back, tags, sort_order)
SELECT l.id, v.front, v.back, v.tags, v.sort_order
FROM training_lessons l, (VALUES
  ('Revamp', 'Redesign of an existing site.', ARRAY['C2.1']::text[], 1),
  ('Dynamic site', 'Has an admin panel so the owner can edit content.', ARRAY['C2.1']::text[], 2),
  ('Static site', 'Simple pages: fast and cheap to host.', ARRAY['C2.1']::text[], 3),
  ('Full-stack build', 'Frontend + backend + database, for portals and custom features.', ARRAY['C2.1']::text[], 4),
  ('Compliance matrix', 'Checklist mapping every solicitation requirement to where the proposal answers it.', ARRAY['C2.5']::text[], 5),
  ('Compliance gate', 'NAICS / set-aside / certification eligibility check on each opportunity.', ARRAY['C2.5']::text[], 6),
  ('AI receptionist', 'Answers calls 24/7, takes messages, books appointments.', ARRAY['C2.4']::text[], 7),
  ('Bytescon framing', '"We build you your own system." Never "subscribe to our platform."', ARRAY['C2.5', 'bytescon']::text[], 8),
  ('Bytescon price', '$5,000–$8,000 one-time + a minimal yearly AI token fee ([TOKEN_FEE]).', ARRAY['C2.5', 'bytescon']::text[], 9),
  ('One SMM month', '6 posts + 3 reels + an ad strategy.', ARRAY['C2.3']::text[], 10),
  ('SMM ad spend', 'Billed by Meta directly to the client; our fee covers content and strategy.', ARRAY['C2.3']::text[], 11),
  ('SEO packages', '3-month and 6-month. Results take time; never promise #1 on Google.', ARRAY['C2.2']::text[], 12),
  ('Google Business Profile', 'The local Google listing; part of our SEO work on local visibility.', ARRAY['C2.2']::text[], 13),
  ('AI automation (one sentence)', 'Teaching software to do the boring, repeatable office work a person does today.', ARRAY['C2.4']::text[], 14),
  ('ERP', 'One system for jobs, inventory, purchasing and billing.', ARRAY['C2.4']::text[], 15),
  ('CRM', 'Tracks customers, quotes and follow-ups.', ARRAY['C2.4']::text[], 16),
  ('Custom build pricing before scoping', '"[PRICE] range, confirmed after a scoping call." Never a fixed price.', ARRAY['C2.4']::text[], 17)
) AS v(front, back, tags, sort_order)
WHERE l.code = 'C2-CARDS'
  AND NOT EXISTS (SELECT 1 FROM training_flashcards f WHERE f.deck_lesson_id = l.id);

INSERT INTO training_flashcards (deck_lesson_id, front, back, tags, sort_order)
SELECT l.id, v.front, v.back, v.tags, v.sort_order
FROM training_lessons l, (VALUES
  ('Poke the bear', 'A neutral question about how they do it today (Josh Braun).', ARRAY['D3']::text[], 1),
  ('Upfront contract', 'Agree on time, agenda and acceptable outcomes, including "no" (Sandler).', ARRAY['D9']::text[], 2),
  ('Label', '"It sounds like…" / "It seems like…" (Voss).', ARRAY['D13']::text[], 3),
  ('Mirror', 'Repeat their last 1–3 words as a question, then pause about 4 seconds.', ARRAY['D13']::text[], 4),
  ('Calibrated question', 'An open "How/What" question (Voss). Avoid "Why…?"', ARRAY['D13']::text[], 5),
  ('CLOSER', 'Clarify, Label, Overview past pain, Sell the vacation, Explain concerns, Reinforce (Hormozi).', ARRAY['D8']::text[], 6),
  ('A-C-I-R-R', 'Acknowledge, Clarify, Isolate, Respond, Re-ask.', ARRAY['D11']::text[], 7),
  ('Bridge formula', 'Label → Link → Light pitch → Question.', ARRAY['D8']::text[], 8),
  ('Rule of 100', '100 outreach actions a day for 100 days (Hormozi).', ARRAY['D1']::text[], 9),
  ('Sorting, not selling', 'Braun: fine if they talk, fine if they don''t. Detachment lowers resistance.', ARRAY['D1']::text[], 10),
  ('Worst opener (Gong)', '"Did I catch you at a bad time?"', ARRAY['D3']::text[], 11),
  ('No-oriented question', 'Framed so "no" is the safe answer: "Would it be a terrible idea if…?"', ARRAY['D3']::text[], 12),
  ('Voicemail rule', 'Leave VMs on dial #1 and #3 (or #4), each followed by an email within 5 minutes.', ARRAY['D5']::text[], 13),
  ('Best call times (Gong)', 'Wed/Thu, 11 a.m.–noon or 4–5 p.m., the prospect''s time.', ARRAY['D17']::text[], 14),
  ('Notes format', 'Pain: … | Service: … | Site: … | Next: … (before the next dial).', ARRAY['D16']::text[], 15),
  ('Disposition VM', 'Voicemail left. Note the observation used.', ARRAY['D16', 'disposition']::text[], 16),
  ('Disposition VM-NL', 'Voicemail reached, no message left.', ARRAY['D16', 'disposition']::text[], 17),
  ('Disposition NA', 'No answer / rang out.', ARRAY['D16', 'disposition']::text[], 18),
  ('Disposition GK', 'Spoke to gatekeeper. Note GK name, DM name, best time.', ARRAY['D16', 'disposition']::text[], 19),
  ('Disposition NI', 'Not interested. Note the reason given and the service pitched.', ARRAY['D16', 'disposition']::text[], 20),
  ('Disposition CB', 'Callback scheduled, with date/time, time zone and topic.', ARRAY['D16', 'disposition']::text[], 21),
  ('Disposition BK', 'Meeting booked. Date/time, attendees, pain, service, website notes.', ARRAY['D16', 'disposition']::text[], 22),
  ('Disposition WN', 'Wrong number / bad data.', ARRAY['D16', 'disposition']::text[], 23),
  ('Disposition DNC', 'Asked for no further contact. Note date/time and exact wording.', ARRAY['D16', 'disposition']::text[], 24),
  ('Disposition NF', 'Not a fit. Note why.', ARRAY['D16', 'disposition']::text[], 25),
  ('Scorecard thresholds', 'Pass ≥70, Excellent ≥85. Automatic fails cap the score at 40.', ARRAY['D19']::text[], 26),
  ('"Remove me from your list"', '"Understood, I''ll remove you right now. Sorry for the interruption." Log DNC. Never argue.', ARRAY['D12']::text[], 27)
) AS v(front, back, tags, sort_order)
WHERE l.code = 'T2-CARDS'
  AND NOT EXISTS (SELECT 1 FROM training_flashcards f WHERE f.deck_lesson_id = l.id);

-- ---------------------------------------------------------------- objection library (D.12 + H.1)
INSERT INTO training_objections (num, objection, why_they_say_it, principle, responses_json, quick_response, tags) VALUES
  (1, 'Not interested.', 'Reflex; doesn''t know what you do yet', 'Pattern interrupt, labeling, curiosity', $j$["(a) \"Totally fair, you don't know what I do yet. Can I ask one quick question, and if it's not relevant I'll let you go?\"","(b) \"Makes sense. Most contractors I call say that. Is it because the website's already handled, or because bids aren't a priority right now?\"","(c) Braun: \"No problem. Just out of curiosity, how are you finding new solicitations today?\""]$j$::jsonb, '"Fair, you don''t know what I do yet. One quick question, then I''ll let you go?"', ARRAY['brush-off', 'top5']::text[]),
  (2, 'Send me an email.', 'Polite exit', 'Commitment, clarify', $j$["(a) \"Happy to. So it's not spam, what should it focus on: the website or the bid process?\"","(b) \"Will do. If it makes sense, would you be against a 15-minute look on Thursday so it's not just another email?\""]$j$::jsonb, '"Will do. Website or bids: which should it focus on?"', ARRAY['brush-off', 'top5']::text[]),
  (3, 'We already have a website / a guy / an agency.', 'Status quo; loyalty', 'Contrast, no-oriented question', $j$["(a) \"Great, so you're covered. Is the site bringing in work, or mostly a business card?\"","(b) \"Good to hear. When did they last update it? I noticed [observation].\"","(c) \"Would it be crazy to get a second opinion, free, just to compare?\""]$j$::jsonb, '"Great. Is it bringing in work, or more of a business card?"', ARRAY['existing-solution', 'top5']::text[]),
  (4, 'No budget.', 'Real or brush-off; doesn''t see ROI', 'Isolate, reframe cost of inaction', $j$["(a) \"Understood. If budget weren't an issue, would this be worth looking at?\"","(b) \"Fair. Most clients didn't budget for it either; they looked when they saw what the outdated site was costing them. Would a 15-minute look hurt?\"","(c) For the contract-mgmt build: \"It's a one-time build, not a subscription. One contract won usually covers it many times over.\" (no win guarantees)"]$j$::jsonb, '"Understood. If budget weren''t an issue, would this be worth a look?"', ARRAY['situational', 'budget', 'top5']::text[]),
  (5, 'Call me later / I''m busy.', 'Timing; could be real', 'Specific commitment', $j$["(a) \"Of course. Is tomorrow at 9 or 4 better?\"","(b) \"No problem. 20 seconds now so I know if it's even worth calling back?\""]$j$::jsonb, '"Sure. Tomorrow at 9 or 4?"', ARRAY['situational', 'timing', 'top5']::text[]),
  (6, 'How did you get my number?', 'Privacy concern', 'Transparency, authority', $j$["\"Fair question. Your business is registered on SAM.gov, which lists contact info for contractors. We reach out to registered contractors in [industry] because we build tools for exactly that market.\""]$j$::jsonb, '"You''re registered on SAM.gov; we work with registered contractors in [industry]."', ARRAY['trust']::text[]),
  (7, 'We don''t need SEO.', 'Pure-federal, or doesn''t understand', 'Agree & isolate', $j$["(a) \"You might be right. Is your work 100% government, or do you do private jobs too?\"","(b) If pure-federal: \"Then SEO isn't the priority. Where do primes see your capability statement?\" (switch services)"]$j$::jsonb, '"Is your work 100% government, or some private too?"', ARRAY['fit', 'seo']::text[]),
  (8, 'We don''t do social media.', 'Thinks it''s for consumers', 'Reframe purpose', $j$["(a) \"Most contractors don't. Are you hiring right now? Many guard and trade companies use it mainly for recruiting.\"","(b) \"Fair. When a prime checks you out and finds a page last posted in 2019, does that matter? Maybe not, just curious.\""]$j$::jsonb, '"Most contractors don''t. Are you hiring right now?"', ARRAY['fit', 'smm']::text[]),
  (9, 'We get all our work from government; we don''t need marketing.', 'True for pure-federal', 'Agreement, relevance shift', $j$["\"That makes sense, and that's why I'm not calling about ads. When a CO or prime looks you up during market research, what do they find? And how are you finding the solicitations to begin with?\""]$j$::jsonb, '"That''s why I''m not calling about ads. What do primes find when they look you up?"', ARRAY['fit', 'pure-federal']::text[]),
  (10, 'We''re too small.', 'Thinks it''s expensive/complex', 'Social proof (real only), scale down', $j$["\"Most of who we work with are small, often owner-run. That's exactly why the system is built just for your team instead of an enterprise platform.\""]$j$::jsonb, '"Most of our clients are owner-run; that''s why it''s built just for your team."', ARRAY['fit']::text[]),
  (11, 'Is this a sales call?', 'Testing honesty', 'Honesty disarms', $j$["\"It is. Want me to tell you in 20 seconds why I called, and you can hang up if it's not relevant?\""]$j$::jsonb, '"It is. 20 seconds to tell you why, then you decide?"', ARRAY['trust', 'brush-off']::text[]),
  (12, 'We don''t trust overseas/agencies.', 'Bad past experience', 'Labeling, accusation audit (Voss)', $j$["\"It sounds like you've been burned before. You're probably thinking we'll take a deposit and disappear. What happened last time? … [Then: process, milestones, ownership, references, per company policy.]\" (Never misrepresent where the team is located.)"]$j$::jsonb, '"It sounds like you''ve been burned. What happened last time?"', ARRAY['trust']::text[]),
  (13, 'We already use a bid service / GovWin / Deltek.', 'Has a data source', 'Complement, not replace', $j$["\"Good, you've got the finding part covered. What happens after you find a bid: who builds the compliance matrix and drafts the proposal? That's the part we build for your team.\""]$j$::jsonb, '"Great for finding bids. Who builds the compliance matrix after?"', ARRAY['existing-solution', 'bytescon']::text[]),
  (14, 'What does it cost?', 'Interest or screening', 'Anchoring, honesty', $j$["(a) Website/SEO/SMM: \"It depends on scope. Packages start at [PRICE]. The 20-minute call gets you an exact number.\"","(b) Contract-mgmt: \"It's a one-time build, typically $5,000–$8,000, plus a small yearly AI usage fee. Not a subscription.\" (Gong Labs' 2020 analysis of 11,331 opportunities found win rates were 10% higher when pricing was discussed on the first call, so don't dodge price.)"]$j$::jsonb, '"[PRICE] for X; the contract-mgmt build is $5–8k one-time + small yearly AI fee."', ARRAY['situational', 'price']::text[]),
  (15, 'I need to talk to my partner.', 'Real shared decision or stall', 'Include the decision-maker', $j$["\"Makes sense. Would it be easier if they joined the 20-minute call, so you don't have to relay everything? Thursday at 2 work for both?\""]$j$::jsonb, '"Want them on the 20-minute call? Tuesday or Wednesday?"', ARRAY['situational', 'decision-maker']::text[]),
  (16, 'Remove me from your list / don''t call again.', 'Clear request', 'Respect the request; no rebuttal', $j$["\"Understood, I'll remove you right now. Sorry for the interruption, have a good day.\" → log DNC immediately. Never argue."]$j$::jsonb, '"Understood, removing you now. Sorry for the interruption." → DNC', ARRAY['dnc']::text[]),
  (17, 'We tried an agency/website before and it didn''t work.', 'Past pain', 'NEPQ solution-awareness', $j$["\"What did they do, and what didn't work? … So if it were done right, what would 'working' look like for you?\""]$j$::jsonb, '"What happened? What would ''working'' look like?"', ARRAY['trust', 'past-pain']::text[])
ON CONFLICT (num) DO NOTHING;

-- ---------------------------------------------------------------- classification drill items (insert only when empty)
INSERT INTO training_classification_items
  (firm_name, narrative, city_state, website_url, scan_flags, scan_summary, gov_mix, correct_service, acceptable_services, reason)
SELECT v.firm_name, v.narrative, v.city_state, v.website_url, v.scan_flags, v.scan_summary, v.gov_mix,
       v.correct_service, v.acceptable_services, v.reason
FROM (VALUES
  ('Lone Mesa Security Services LLC', 'ARMED AND UNARMED SECURITY OFFICERS. PATROL. FIRE WATCH. EVENT SECURITY.', 'Killeen, TX', NULL::text, $j$["no_site","private_customers","hiring"]$j$::jsonb, 'No URL on the SAM row; a name search finds nothing but a directory listing.', 'mixed', 'website_new', ARRAY['smm']::text[], 'Decision tree step 1: no working website → lead with a new website (+ capability statement page); "No URL / dead site" scores +5 for Website (new).'),
  ('Brightwater Duct & Air LLC', 'HVAC SERVICE, AIR DUCT CLEANING, DRYER VENT CLEANING. RESIDENTIAL, COMMERCIAL AND GOVERNMENT.', 'Lakeland, FL', 'http://brightwater-duct.example.com', $j$["no_site","private_customers"]$j$::jsonb, 'URL shows a parked domain ("This domain may be for sale").', 'mixed', 'website_new', ARRAY[]::text[], 'A parked domain is a dead site, so the first branch of the tree applies: no working website → new website.'),
  ('Prairie Line Electric Inc.', 'Commercial and industrial electrical construction, service upgrades, lighting retrofits and generator installation for municipal, federal and private clients.', 'Wichita, KS', 'http://prairielineelectric.example.com', $j$["no_ssl","old_copyright","not_mobile","private_customers"]$j$::jsonb, 'Chrome shows "Not secure"; footer © 2017; menu breaks on a phone.', 'mixed', 'revamp', ARRAY['seo']::text[], 'Working but outdated site (no SSL, © 2017, not mobile) → Revamp (+4); SEO is the runner-up because they serve private customers.'),
  ('Summit Ridge Storage Solutions', 'LOCKERS, SHELVING, BENCHES, STORAGE CABINETS.', 'Columbus, OH', 'http://summitridgestorage.example.com', $j$["old_copyright","template_look","no_contact_form","not_mobile"]$j$::jsonb, 'Template site with stock photos, © 2016, no product catalog or quote form.', 'mixed', 'revamp', ARRAY['website_new']::text[], 'Outdated template site with no catalog or quote form → Revamp (catalog + quote form), per the lockers/shelving worked example.'),
  ('Cumberland Radio & Tower LLC', '2-WAY RADIO SALES AND SERVICE, P25 SYSTEMS, TOWER CONSTRUCTION, LINE AND ANTENNA SWEEPS.', 'Knoxville, TN', 'http://cumberlandradiotower.example.com', $j$["old_copyright","no_capability_statement","no_ssl"]$j$::jsonb, 'Footer © 2018, not secure, no projects page or capability statement.', 'mixed', 'revamp', ARRAY[]::text[], 'Outdated site with no capability statement → Revamp + capability page, per the radio/tower worked example.'),
  ('Red Canyon Aero Services LLC', 'Contractor logistics support (CLS), depot-level maintenance and field service for rotary and fixed-wing aircraft supporting USAF, US Army and DLA. SDVOSB. AS9100D. Multiple IDIQ vehicles.', 'Oklahoma City, OK', 'https://redcanyonaero.example.com', $j$["modern_site","bids_often","bd_staff","pure_federal"]$j$::jsonb, 'Modern, secure site with capability statement, CAGE and NAICS; narrative lists many agencies and contract vehicles.', 'pure_federal', 'contract_mgmt', ARRAY[]::text[], 'Working, up-to-date site + bids on many solicitations with a BD function → contract-management build (+4 bids regularly, +2 BD staff, +2 pure-federal).'),
  ('Harbor Point Facility Services Inc.', 'Facilities O&M, janitorial, grounds maintenance and minor construction for DoD, GSA and VA. 8(a), WOSB. GSA MAS and multiple agency BPAs.', 'Norfolk, VA', 'https://harborpointfs.example.com', $j$["modern_site","bids_often","bd_staff"]$j$::jsonb, 'Modern site with contract vehicles listed; BD manager and a proposal writer on the team page; bids several solicitations a month.', 'pure_federal', 'contract_mgmt', ARRAY[]::text[], 'Modern site, bids regularly, 1–3 BD/proposal staff → contract-management build per the decision tree.'),
  ('Granite State Depot Maintenance Co.', 'DEPOT MAINTENANCE, OVERHAUL AND REPAIR OF GROUND SUPPORT EQUIPMENT FOR DOD. BIDS MONTHLY ON ARMY AND AIR FORCE SOLICITATIONS.', 'Manchester, NH', 'https://granitestatedepot.example.com', $j$["modern_site","bids_often","pure_federal"]$j$::jsonb, 'Modern, secure site with capability statement and past performance; owner writes the proposals.', 'pure_federal', 'contract_mgmt', ARRAY[]::text[], 'Pure-federal firm with a modern site that bids monthly → contract-management build (the C3 quiz example).'),
  ('Magnolia Comfort Air LLC', 'HVAC installation, maintenance and repair; air duct cleaning; indoor air quality. Residential, commercial and government facilities.', 'Macon, GA', 'https://magnoliacomfortair.example.com', $j$["modern_site","private_customers","missed_calls_pain","no_contact_form"]$j$::jsonb, 'Modern site (2023) but no booking or quote button; the narrative and reviews mention calls that go unanswered after hours.', 'mixed', 'automation', ARRAY['seo']::text[], 'Working, current site; no bidding; private customers + missed-calls pain → AUTOMATION (AI receptionist), with SEO as the runner-up.'),
  ('Pinelands Environmental Labs LLC', 'NELAP-accredited environmental testing laboratory: drinking water, wastewater, soil and air; PFAS; field sampling for federal, state, municipal and commercial clients. High sample volume.', 'Edison, NJ', 'https://pinelandslabs.example.com', $j$["modern_site","private_customers","no_contact_form"]$j$::jsonb, 'Modern site with accreditations shown; no client portal or online sample submission; high sample-intake volume.', 'mixed', 'automation', ARRAY['seo']::text[], 'Private clients + sample-intake volume (+2 automation) with a current site → automation/custom (intake workflow, client portal), per the lab worked example.'),
  ('Bluegrass Power & Light Electric', 'Commercial and residential electrical contracting, service calls, panel upgrades, EV chargers. Serving Lexington and central Kentucky.', 'Lexington, KY', 'https://bluegrasspowerlight.example.com', $j$["modern_site","private_customers","no_blog"]$j$::jsonb, 'Modern, secure site but only 4 thin pages, no project gallery or service-area pages; doesn''t appear in a "[service] [city]" search.', 'commercial', 'seo', ARRAY['automation']::text[], 'Decent site, no bidding, private customers, no ops pain mentioned, invisible on Google → SEO (+3 private customers, +2 thin content).'),
  ('Clearview Duct Cleaning Co.', 'AIR DUCT CLEANING, DRYER VENT CLEANING, COIL CLEANING. COMMERCIAL AND RESIDENTIAL.', 'Orlando, FL', 'https://clearviewductorlando.example.com', $j$["modern_site","private_customers","no_blog"]$j$::jsonb, 'Clean modern site with a booking button; no blog or service pages; not on page one for "air duct cleaning Orlando".', 'commercial', 'seo', ARRAY[]::text[], 'Working current site with booking already handled; private customers and invisible on Google → SEO.'),
  ('Tidewater Shield Protective Services', 'ARMED AND UNARMED SECURITY OFFICERS, MOBILE PATROL, CONCIERGE SECURITY. FEDERAL, MUNICIPAL AND COMMERCIAL CLIENTS.', 'Chesapeake, VA', 'https://tidewatershield.example.com', $j$["modern_site","no_social","hiring","private_customers"]$j$::jsonb, 'Recently redesigned site with a careers page "always hiring"; no social icons; Facebook last post 2019.', 'mixed', 'smm', ARRAY['seo']::text[], 'Current site, no ops pain, private customers, inactive socials + constant hiring → SMM (+2 no social, +2 hiring, +2 private customers).'),
  ('Desert Sentinel Integrated Systems', 'CCTV, ACCESS CONTROL, INTRUSION DETECTION AND INTERCOM DESIGN, INSTALLATION AND SERVICE. AUTHORIZED DEALER FOR MAJOR MANUFACTURERS.', 'Tucson, AZ', 'https://desertsentinel.example.com', $j$["modern_site","no_social","hiring","private_customers"]$j$::jsonb, 'Modern site with case studies and blog; no social links; hiring two technicians.', 'mixed', 'smm', ARRAY['seo']::text[], 'Site is current and has content (so not invisible), no bidding or ops pain; inactive socials and hiring techs → SMM.'),
  ('Keystone Bolt & Fastener Supply', 'FASTENERS. BOLTS, NUTS, WASHERS, SCREWS, RIVETS. MIL-SPEC HARDWARE.', 'Allentown, PA', 'https://keystonebolt.example.com', $j$["pure_federal","modern_site"]$j$::jsonb, 'Basic but working, secure site; owner''s note says 90% of sales go through two distributors; no bidding, no manual quoting mentioned.', 'pure_federal', 'exit', ARRAY[]::text[], 'Pure federal, distributor-only, current site, no bidding and no ops pain → polite exit (log NF, check back in 6 months).'),
  ('Iron Range Industrial Supply', 'INDUSTRIAL SUPPLY, ABRASIVES, CUTTING TOOLS, MRO. SOLD THROUGH DLA PRIME VENDORS.', 'Duluth, MN', 'https://ironrangeindustrial.example.com', $j$["pure_federal","modern_site"]$j$::jsonb, 'Simple modern site with a line card; sells only through prime vendors; doesn''t bid directly.', 'pure_federal', 'exit', ARRAY['revamp']::text[], 'Pure federal reseller with a working site, no bidding and no ops pain: the tree ends at "else polite exit".'),
  ('Patriot Defense Components LLC', 'SPECIALIZED DEFENSE SUPPLY: CONNECTORS, CABLE ASSEMBLIES, HARNESSES FOR GROUND VEHICLES.', 'Huntsville, AL', 'https://patriotdefensecomponents.example.com', $j$["pure_federal","modern_site","missed_calls_pain"]$j$::jsonb, 'Modern site with capability statement; rarely bids; owner says inventory and RFQs live in spreadsheets and quotes slip through the cracks.', 'pure_federal', 'automation', ARRAY['contract_mgmt']::text[], 'Pure federal with a current site and no BD function, but ops pain (spreadsheets, RFQs) → AUTOMATION (+4 for spreadsheets/inventory).'),
  ('Sierra Vista Forensic Labs Inc.', 'Forensic toxicology and DNA testing laboratory serving federal, state and private clients. ISO/IEC 17025 accredited.', 'Sierra Vista, AZ', 'http://sierravistaforensic.example.com', $j$["no_ssl","old_copyright","no_capability_statement","private_customers"]$j$::jsonb, 'Not secure, © 2015, accreditations not shown, no capability statement.', 'mixed', 'revamp', ARRAY['automation']::text[], 'The site works but is outdated (no SSL, © 2015, no capability statement) → Revamp comes before automation in the decision tree.'),
  ('Northstar Aviation Logistics LLC', 'AIRCRAFT CLS, DEPOT MAINTENANCE, SUPPLY CHAIN SUPPORT FOR USAF AND NAVY PROGRAMS. MULTIPLE IDIQ AND BPA VEHICLES.', 'Dayton, OH', 'http://northstaraviationlogistics.example.com', $j$["no_ssl","old_copyright","not_mobile","bids_often","bd_staff","pure_federal"]$j$::jsonb, 'Bids several solicitations a month with a BD team, but the site is "Not secure", © 2019 and not mobile.', 'pure_federal', 'revamp', ARRAY['contract_mgmt']::text[], 'Decision tree checks "outdated?" before "bids often?": lead with Revamp and keep the contract-management build as the "and also".')
) AS v(firm_name, narrative, city_state, website_url, scan_flags, scan_summary, gov_mix, correct_service, acceptable_services, reason)
WHERE NOT EXISTS (SELECT 1 FROM training_classification_items);

-- ---------------------------------------------------------------- roleplay scenarios (D.21 + exam + Bytescon)
-- RP1: Friendly owner, no website (security guard company, TX)
INSERT INTO training_roleplay_scenarios (code, title, persona_json, objective, difficulty, objections_json, rubric_id, script_json, exam_kind, pass_rule, active)
VALUES ('RP1', 'Friendly owner, no website (security guard company, TX)',
  $j${"name":"Darnell Price","firm_name":"Ridgeline Guard Services LLC","firm_type":"Security guard company","narrative":"ARMED AND UNARMED SECURITY OFFICERS. PATROL SERVICES. EVENT SECURITY. ACCESS CONTROL FOR FEDERAL FACILITIES.","state":"TX","size_guess":"25–40 officers, many part-time","gov_mix_pct":60,"hidden_pains":["Property managers ask for a website and he sends a PDF; he thinks he lost a private apartment contract because of it","Always short on reliable officers"],"mood":"friendly","website_observation":"No website listed on SAM.gov and none found by searching the company name","voice_notes":"Warm, chatty, a little distracted (heading to a post). Says \"yes sir\" a lot. Will book if the rep is clear and honest about price."}$j$::jsonb,
  'Open well, use the "no website found" observation, ask 2–4 problem questions (one consequence question), answer "How much?" honestly without inventing a price, lead with a new website + capability statement page, and book a specific time.',
  1, $j$["How much does something like that cost?"]$j$::jsonb,
  (SELECT id FROM training_rubrics WHERE code = 'CALL_SCORECARD_100'),
  $j${"start":"n1","nodes":{"n1":{"prospect":"Ridgeline Guard Services, this is Darnell.","choices":[{"label":"Hi Darnell, it's [Your name] with Bytes Platform. How have you been?","next":"n2","points":{"opener":10,"tonality":2},"feedback":"Name, company and a human moment: the \"How have you been?\" opener Gong found worked best."},{"label":"Hi Darnell, this is [Your name] with Bytes Platform. We build websites for government contractors.","next":"n2","points":{"opener":7,"tonality":1},"feedback":"Name and company are there, but you skipped the human moment and went straight to a pitch."},{"label":"Hi, is this Darnell? Did I catch you at a bad time?","next":"end_badtime","points":{},"feedback":"Gong: \"Did I catch you at a bad time?\" is the worst-performing opener (0.9%). You handed them an easy exit."}]},"n2":{"prospect":"Doing alright, busy as always. What can I do for you?","choices":[{"label":"Glad to hear it. The reason I'm calling: we work with security companies registered on SAM.gov, and while we were talking I went to look you up and couldn't find a website for Ridgeline. Is that intentional, or just hasn't been a priority?","next":"n3","points":{"reason":10,"tonality":1},"feedback":"Clear reason plus a live observation, phrased as a question rather than a criticism."},{"label":"We help government contractors get more work online. I wanted to see if you'd be interested in a new website.","next":"n3","points":{"reason":7,"tonality":1},"feedback":"There is a reason, but it is generic and asks for interest before you know his pain. Use the observation (no site found)."},{"label":"So we do websites, SEO, social media, AI receptionists, ERPs, CRMs, mobile apps, basically everything digital. Our packages are really popular and I think you'd love them.","next":"n4","points":{},"feedback":"Feature dump. \"The more you say, the less you sell.\" He skips straight to price before you know anything about his business."}]},"n3":{"prospect":"Honestly, it just never happened. My nephew was going to build one. Most of our work is the federal building contract and a couple of apartment complexes.","choices":[{"label":"Makes sense, a lot of owner-run guard companies are in the same spot. Roughly what percent of your work is government versus private sites like those apartment complexes?","next":"n3b","points":{"problem_questions":7,"listening":3},"feedback":"Builds on his words, and the government/private mix tells you which services matter."},{"label":"Okay. Do you have a capability statement?","next":"n3b","points":{"problem_questions":5,"listening":2},"feedback":"Relevant question, but it ignores what he just told you about private clients."},{"label":"Well, without a website you're basically invisible. You really need one, and we can build it fast.","next":"n4","points":{},"feedback":"That is a judgment, not a question, and it skipped discovery. Observations are questions, never insults."}]},"n3b":{"prospect":"Maybe 60/40 government. I'd love more private contracts, and I'm always short on officers. When a property manager asks for our website I just send them a PDF.","choices":[{"label":"It sounds like that PDF is doing the job a website should. When a property manager can't find you online, what do you think that does to your chances against the guard company that has a site?","next":"n4","points":{"problem_questions":6,"listening":5,"tonality":1},"feedback":"A label plus a consequence question: exactly what the scorecard rewards."},{"label":"Got it. How many officers do you have right now?","next":"n4","points":{"problem_questions":4,"listening":3,"tonality":1},"feedback":"Fine situation question, but you missed the chance to ask what having no website costs him."},{"label":"Yeah, PDFs are terrible. Anyway, let me tell you about our website packages.","next":"n4","points":{},"feedback":"You talked past his pain. Mirror or label it, then ask a consequence question."}]},"n4":{"prospect":"Okay, I'm listening. So what does something like that cost?","choices":[{"label":"Fair question. It depends on scope, like how many pages and the capability statement page. Packages start at [PRICE], and the 20-minute call with our specialist gets you an exact number. Other than price, is there anything else you'd want to know before taking a look?","next":"n5","points":{"objection_handling":15,"tonality":2},"feedback":"Honest anchor, no dodging price, and you isolated the objection. Gong found discussing price on the first call goes with higher win rates."},{"label":"Our websites usually start at [PRICE].","next":"n5","points":{"objection_handling":10,"tonality":2},"feedback":"Honest, but you stopped there. Add the next step (the 20-minute call gets an exact number) and isolate."},{"label":"Oh, it's super cheap, probably a few hundred bucks, and I can have it live by Friday.","next":"end_toogood","points":{},"feedback":"You invented a price and a delivery date. Never quote outside the approved list or promise timelines."}]},"n5":{"prospect":"That's fair. So what would you actually build for us?","choices":[{"label":"From what you said, private clients find nothing and you're sending a PDF. We'd build Ridgeline a site with your capability statement, NAICS codes and certifications front and center, so property managers and primes see a real company. Would it be worth 20 minutes with our specialist to see what that would look like?","next":"n6","points":{"classification_bridge":10,"accuracy":5},"feedback":"Right service per the rubric (no site → new website + capability page), tied to his pain, in two sentences."},{"label":"We could do a website, SEO, social media to help you recruit officers, honestly whatever you need, we do it all.","next":"n6","points":{"classification_bridge":7,"accuracy":5},"feedback":"Too many services. Lead with the top score (new website) and keep SMM for recruiting as the \"and also.\""},{"label":"We'll build you a site and get you ranked #1 on Google for security guards in Texas, guaranteed.","next":"n6","points":{},"feedback":"Automatic-fail territory: never promise rankings."}]},"n6":{"prospect":"Yeah, I could do a quick call. When?","choices":[{"label":"Does Wednesday at 10 or Thursday at 2 work better, Central time? I'll send the invite while we're on the phone. Anyone else who should join, like your operations manager?","next":"d1","points":{"next_step":10},"feedback":"Two specific times, invite sent on the call, attendees confirmed."},{"label":"Great, when are you free next week?","next":"d1","points":{"next_step":7},"feedback":"Open-ended \"when are you free?\" invites stalls. Offer two specific options."},{"label":"Cool, I'll just email you some info and you can reach out if you're interested.","next":"end_cb","points":{},"feedback":"You had a yes and gave it away. Set the next step during the call."}]},"d1":{"prospect":"Thursday at 2 works. My ops manager Keisha should be on it too. (The call ends. Log it before your next dial.)","choices":[{"label":"Log BK: \"Pain: no website; private clients and primes find nothing, he sends a PDF | Service: new website + capability page (SMM for recruiting as the and-also) | Site: none found | Next: Thu 2pm CT, Darnell + Keisha (ops), invite sent\"","next":"end_bk","points":{"notes_disposition":5},"feedback":"Correct code and the required Pain | Service | Site | Next format."},{"label":"Log BK: \"Nice guy, wants a website, call Thursday.\"","next":"end_bk","points":{"notes_disposition":3},"feedback":"Right code, but the notes don't follow the format. The specialist needs pain, service, site and attendees."},{"label":"Log CB: \"callback Thursday.\"","next":"end_bk","points":{},"feedback":"Wrong code: a meeting was booked (BK), not a callback."}]},"end_bk":{"prospect":"Meeting booked: Thursday 2pm CT with Darnell and Keisha.","end":true,"outcome":"booked"},"end_badtime":{"prospect":"Kind of, yeah. I'm about to head out to a post. Bye. (click)","end":true,"outcome":"not_interested"},"end_toogood":{"prospect":"Huh. That sounds too good to be true. Let me think about it and get back to you. (He never does.)","end":true,"outcome":"not_interested"},"end_cb":{"prospect":"Sure, send it over. (The email gets buried and no meeting is booked.)","end":true,"outcome":"callback"}}}$j$::jsonb,
  NULL, NULL, true)
ON CONFLICT (code) DO NOTHING;

-- RP2: Busy owner, outdated site (electrical contractor, FL)
INSERT INTO training_roleplay_scenarios (code, title, persona_json, objective, difficulty, objections_json, rubric_id, script_json, exam_kind, pass_rule, active)
VALUES ('RP2', 'Busy owner, outdated site (electrical contractor, FL)',
  $j${"name":"Rick Alvarez","firm_name":"Bayshore Electrical Contractors Inc.","firm_type":"Electrical contractor","narrative":"Commercial and industrial electrical construction, service upgrades, lighting retrofits, and generator installation for federal, municipal and private clients in the Tampa Bay area.","state":"FL","size_guess":"15–30 electricians, 4 crews","gov_mix_pct":30,"hidden_pains":["GCs check him out on their phones and the site shows \"Not secure\" and a 2016 footer","Work comes almost only from referrals; no new commercial leads from the site"],"mood":"busy","website_observation":"Chrome shows \"Not secure\"; footer says © 2016; menu breaks on a phone","voice_notes":"Calls from a job site, background noise, clipped answers. Softens if the rep is quick and specific. Protective of \"his guy.\""}$j$::jsonb,
  'Handle "Call me later" with a specific commitment, use the "Not secure" / © 2016 observation, handle "We have a guy" with contrast and a no-oriented question, lead with a revamp, and book an early or late slot that fits a field owner.',
  2, $j$["I'm on a job site. Can you call me later?","We already have a guy for the website."]$j$::jsonb,
  (SELECT id FROM training_rubrics WHERE code = 'CALL_SCORECARD_100'),
  $j${"start":"n1","nodes":{"n1":{"prospect":"(Power saw in the background) Bayshore Electric, Rick.","choices":[{"label":"Hi Rick, it's [Your name] with Bytes Platform. How have you been?","next":"n2","points":{"opener":10,"tonality":2},"feedback":"Calm, human opener. With busy owners, slow down rather than speed up."},{"label":"Hi Rick, [Your name] with Bytes Platform, I'm calling about your website.","next":"n2","points":{"opener":7,"tonality":1},"feedback":"Clear, but no human moment."},{"label":"Hi Rick, did I catch you at a bad time?","next":"end_badtime","points":{},"feedback":"Gong: \"Did I catch you at a bad time?\" is the worst-performing opener (0.9%). You handed them an easy exit."}]},"n2":{"prospect":"Busy. I'm on a job site. Can you call me later?","choices":[{"label":"Of course. 20 seconds now so I know if it's even worth calling back? The reason I'm calling: I'm on your website right now and Chrome flags it as \"Not secure,\" and the footer says 2016. Has anyone mentioned that to you?","next":"n3","points":{"reason":10,"objection_handling":5,"tonality":1},"feedback":"Specific-commitment answer to \"call me later,\" then a reason with a live observation phrased as a question."},{"label":"No problem, I'll be quick: we work with electrical contractors on SAM.gov and help with websites. Is yours bringing in any work?","next":"n3","points":{"reason":7,"objection_handling":3,"tonality":1},"feedback":"You stayed on the call, but didn't ask for the 20 seconds and used no live observation."},{"label":"This will only take a minute, I promise. So we're a full-service agency and we do websites, SEO, social media, apps…","next":"end_hangup","points":{},"feedback":"He told you he's busy and you launched a monologue. Ask for 20 seconds, then make it about him."}]},"n3":{"prospect":"Huh. No, nobody's said anything. Our guy built it years ago.","choices":[{"label":"Got it. Does the site bring you any work today, or is it more of a business card? And roughly how much of your work is private versus government?","next":"n3b","points":{"problem_questions":7,"listening":3},"feedback":"Good problem question plus the government/private mix question that decides SEO relevance."},{"label":"When was it last updated?","next":"n3b","points":{"problem_questions":5,"listening":2},"feedback":"He basically just told you (\"years ago\"). Build on his words instead."},{"label":"Well, honestly it looks pretty bad. Old sites like that drive customers away.","next":"n4","points":{},"feedback":"Criticism, not a question. \"Your site is bad\" loses the call."}]},"n3b":{"prospect":"Mostly private. GCs and property managers. The website doesn't really bring anything in. Work comes from referrals.","choices":[{"label":"Mostly referrals? … So when a GC who doesn't know you checks you out on their phone and sees a \"Not secure\" warning, what do you think that does to their first impression?","next":"n4","points":{"problem_questions":6,"listening":5,"tonality":1},"feedback":"Mirror, pause, then a consequence question. Strong."},{"label":"Okay. How many crews do you run?","next":"n4","points":{"problem_questions":4,"listening":3,"tonality":1},"feedback":"Situation question; you missed the consequence of the outdated site."},{"label":"Referrals won't last forever. You need to get serious about your online presence.","next":"n4","points":{},"feedback":"A lecture, not a question. Owners tune out lectures."}]},"n4":{"prospect":"Look, we already have a guy for the website.","choices":[{"label":"Great, so you're covered. When did he last update it? I noticed the 2016 footer and the \"Not secure\" warning. Would it be crazy to get a second opinion, free, just to compare?","next":"n5","points":{"objection_handling":10,"tonality":2},"feedback":"Contrast plus a no-oriented question (#3 in the library). You didn't attack his guy."},{"label":"Okay, but we could probably do a better job than him.","next":"n5","points":{"objection_handling":7,"tonality":1},"feedback":"Competing with his guy creates defensiveness. Use contrast and a no-oriented question instead."},{"label":"Your guy obviously isn't doing his job if your site says 2016. You should fire him.","next":"end_ni","points":{},"feedback":"Insulting his guy insults his judgment. Call over."}]},"n5":{"prospect":"Second opinion… alright. What would you even change?","choices":[{"label":"From what you said, GCs check you out and the site shows \"Not secure\" and a 2016 footer. We'd revamp it: secure, mobile-friendly, with your projects and certifications front and center. Would it be worth 20 minutes to see a quick mockup?","next":"n6","points":{"classification_bridge":10,"accuracy":5},"feedback":"Right lead per the decision tree (working but outdated site → Revamp), tied to his pain."},{"label":"We'd do SEO so you show up on Google, plus social media.","next":"n6","points":{"classification_bridge":7,"accuracy":5},"feedback":"SEO is the runner-up. The most visible issue is the outdated site, so lead with the revamp."},{"label":"We'd redo it and get you to #1 on Google for \"electrician Tampa\" within a month.","next":"n6","points":{},"feedback":"Never promise rankings or results in weeks. Automatic-fail territory."}]},"n6":{"prospect":"Fine. But I'm in the field all day.","choices":[{"label":"Understood. Does Wednesday at 7:30 a.m. or Thursday at 4:30 p.m. work better, Eastern? It's 20 minutes. I'll send the invite to your email now. Anyone else who should see it, like whoever runs your office?","next":"d1","points":{"next_step":10,"objection_handling":3},"feedback":"Two specific times that fit a field owner, invite, attendees."},{"label":"When's a good time for you next week?","next":"d1","points":{"next_step":7,"objection_handling":2},"feedback":"Open-ended. Offer two options that fit his day."},{"label":"No worries, I'll call you back sometime next week.","next":"end_cb","points":{},"feedback":"Vague callbacks rarely happen. Book a specific time now."}]},"d1":{"prospect":"Thursday 4:30. My wife Ana runs the office, add her. (The call ends. Log it before your next dial.)","choices":[{"label":"Log BK: \"Pain: site 'Not secure', © 2016, not mobile; GCs check him out | Service: revamp (SEO as the and-also) | Site: no SSL, © 2016, has a web guy | Next: Thu 4:30pm ET, Rick + Ana, invite sent\"","next":"end_bk","points":{"notes_disposition":5},"feedback":"Correct code and format."},{"label":"Log BK: \"revamp, Thursday.\"","next":"end_bk","points":{"notes_disposition":3},"feedback":"Right code, thin notes. Add pain, site and attendees."},{"label":"Log NI: \"busy, has a guy.\"","next":"end_bk","points":{},"feedback":"Wrong code: you booked a meeting."}]},"end_bk":{"prospect":"Meeting booked: Thursday 4:30pm ET with Rick and Ana.","end":true,"outcome":"booked"},"end_badtime":{"prospect":"Yeah, actually. I'm on a job. (click)","end":true,"outcome":"not_interested"},"end_hangup":{"prospect":"I said I'm busy. (click)","end":true,"outcome":"not_interested"},"end_ni":{"prospect":"Excuse me? He's been with us ten years. We're done here. (click)","end":true,"outcome":"not_interested"},"end_cb":{"prospect":"Yeah, whatever. (He doesn't pick up next week.)","end":true,"outcome":"callback"}}}$j$::jsonb,
  NULL, NULL, true)
ON CONFLICT (code) DO NOTHING;

-- RP3: Skeptical BD manager (aerospace CLS, OK)
INSERT INTO training_roleplay_scenarios (code, title, persona_json, objective, difficulty, objections_json, rubric_id, script_json, exam_kind, pass_rule, active)
VALUES ('RP3', 'Skeptical BD manager (aerospace CLS, OK)',
  $j${"name":"Karen Whitfield","firm_name":"Red River Aero Logistics LLC","firm_type":"Aerospace maintenance contractor (CLS, depot maintenance)","narrative":"Contractor logistics support (CLS), depot-level maintenance and field service for rotary and fixed-wing aircraft. Supporting USAF, US Army and DLA programs. SDVOSB. AS9100D. Holds positions on multiple IDIQ vehicles.","state":"OK","size_guess":"60–120 employees; 2-person BD team","gov_mix_pct":100,"hidden_pains":["She and one colleague build every compliance matrix by hand; a big one takes days","They passed on two bids last quarter for lack of time"],"mood":"skeptical","website_observation":"Modern, secure site with capability statement, CAGE and NAICS listed","voice_notes":"Short, guarded answers. Tests whether the rep knows the difference between finding bids and writing them. Warms up when the rep names her bandwidth problem."}$j$::jsonb,
  'Handle three objections with A-C-I-R-R ("We use GovWin," "No budget for another subscription," "Need to talk to my partner"), frame the contract-management build correctly (not a subscription, $5,000–$8,000 one-time + small yearly AI fee), and book with the partner on the call.',
  4, $j$["We use GovWin. We don't need anything.","We don't have budget for another subscription.","I'd need my partner to see it."]$j$::jsonb,
  (SELECT id FROM training_rubrics WHERE code = 'CALL_SCORECARD_100'),
  $j${"start":"n1","nodes":{"n1":{"prospect":"Red River Aero, this is Karen.","choices":[{"label":"Hi Karen, it's [Your name] with Bytes Platform. How have you been?","next":"n2","points":{"opener":10,"tonality":2},"feedback":"Calm, human opener."},{"label":"Hi Karen, [Your name] with Bytes Platform. We help aerospace contractors with bids.","next":"n2","points":{"opener":7,"tonality":1},"feedback":"Clear but rushed; no human moment."},{"label":"Hi Karen, sorry to bother you. Is now a bad time?","next":"end_badtime","points":{},"feedback":"Gong: \"Did I catch you at a bad time?\" is the worst-performing opener (0.9%). You handed them an easy exit."}]},"n2":{"prospect":"Busy. What's this about?","choices":[{"label":"I'll be quick. We work with maintenance contractors supporting DoD programs. The reason for my call: teams your size tell us they're tracking solicitations and building compliance checklists by hand. How are you finding new bids today?","next":"n3","points":{"reason":10,"tonality":1},"feedback":"Industry-specific reason plus a neutral \"how do you do it today\" question."},{"label":"We build websites and software for government contractors. Is that something you'd be interested in?","next":"n3","points":{"reason":7,"tonality":1},"feedback":"Generic, and \"are you interested?\" invites a no."},{"label":"We have an amazing AI platform you can subscribe to for bids. It's like GovWin but better.","next":"end_sub","points":{},"feedback":"Automatic fail: the contract-management build is never a subscription. It is a one-time build plus a small yearly AI fee."}]},"n3":{"prospect":"We have GovWin. We don't need anything.","choices":[{"label":"Good, so the finding part's covered. After GovWin flags something, who reads the solicitation and builds the compliance matrix?","next":"n3b","points":{"objection_handling":5,"problem_questions":6,"listening":3},"feedback":"Objection #13: complement, not replace. You moved to the part GovWin doesn't do."},{"label":"GovWin is expensive though. Our system is cheaper.","next":"n3b","points":{"objection_handling":3,"problem_questions":4,"listening":2},"feedback":"Price-comparing invites an argument. Acknowledge, then ask what happens after a bid is found."},{"label":"Oh, GovWin is outdated. You should really switch to us.","next":"end_ni","points":{},"feedback":"Attacking her tool makes her defend it. Complement, don't replace."}]},"n3b":{"prospect":"It's me and one other person reading every solicitation and building the compliance matrix by hand. A big one takes a few days. We passed on two last quarter because we didn't have time.","choices":[{"label":"Just the two of you… It sounds like you're leaving bids on the table because of bandwidth, not capability. What did passing on those two cost you?","next":"n4","points":{"problem_questions":7,"listening":5,"tonality":1},"feedback":"Mirror, label, consequence question. This is the moment she warms up."},{"label":"How many bids do you submit a month?","next":"n4","points":{"problem_questions":5,"listening":3,"tonality":1},"feedback":"Useful situation question, but you skipped the pain she just handed you."},{"label":"Wow, that's inefficient. You definitely need our system.","next":"n4","points":{},"feedback":"Judgment plus a pitch. Label the pain instead."}]},"n4":{"prospect":"Pretty much. But we don't have budget for another subscription.","choices":[{"label":"That's fair, and it's not a subscription. We build your team its own system: a one-time build, typically $5,000 to $8,000, plus a small yearly fee for the AI usage. Other than budget, is there anything else that would stop you from taking a look?","next":"n5","points":{"objection_handling":7,"tonality":2},"feedback":"Acknowledge, correct \"not a subscription\" framing, honest price, isolate. Textbook A-C-I-R-R."},{"label":"I understand. If budget weren't an issue, would this be worth looking at?","next":"n5","points":{"objection_handling":5,"tonality":1},"feedback":"Good isolate, but she still thinks it's a subscription. Correct that."},{"label":"It's only a small monthly subscription, way less than GovWin.","next":"end_sub","points":{},"feedback":"Automatic fail: the contract-management build is never a subscription. It is a one-time build plus a small yearly AI fee."}]},"n5":{"prospect":"Okay. So what would it actually do for us?","choices":[{"label":"Since the bottleneck is reading solicitations and building the matrix by hand, the system pulls opportunities for your NAICS codes from SAM.gov and state portals, turns each solicitation into a compliance matrix and drafts the first version of the proposal for your team to edit. Would it be worth 20 minutes to see what that looks like for your team?","next":"n6","points":{"classification_bridge":10,"accuracy":5},"feedback":"Right service (modern site + bids often + BD team → contract-mgmt build), tied to her pain."},{"label":"It does a lot: finds bids, scores them, drafts proposals, pricing benchmarks, teaming, post-award tracking, deadline reminders…","next":"n6","points":{"classification_bridge":7,"accuracy":5},"feedback":"All true, but it's a feature list. Keep the pitch to two sentences tied to her pain."},{"label":"It'll basically guarantee you win more contracts. Our clients double their win rate.","next":"n6","points":{},"feedback":"Never promise wins or invent results. Automatic-fail territory."}]},"n6":{"prospect":"I'd need my partner to see it.","choices":[{"label":"Makes sense. Would it be easier if he joined the call so you don't have to relay it? Is Tuesday at 11 or Wednesday at 3 better for both of you, Central?","next":"d1","points":{"objection_handling":3,"next_step":10},"feedback":"Objection #15: include the decision-maker, with two specific times."},{"label":"Makes sense. When could you both do a call next week?","next":"d1","points":{"objection_handling":2,"next_step":7},"feedback":"Right idea, but open-ended. Offer two times."},{"label":"Can't you just decide yourself? It's a no-brainer.","next":"end_ni","points":{},"feedback":"Pressure after a real shared-decision objection kills trust."}]},"d1":{"prospect":"Wednesday at 3 works. Send the invite to both of us. His name is Dale. (The call ends. Log it before your next dial.)","choices":[{"label":"Log BK: \"Pain: 2 people build compliance matrices by hand; passed on 2 bids last quarter | Service: contract-mgmt build ($5–8k one-time + yearly AI fee) | Site: modern; uses GovWin | Next: Wed 3pm CT, Karen + Dale (partner), invite sent\"","next":"end_bk","points":{"notes_disposition":5},"feedback":"Correct code and format."},{"label":"Log BK: \"interested in Bytescon, Wednesday.\"","next":"end_bk","points":{"notes_disposition":3},"feedback":"Right code; notes too thin, and use plain service names in notes."},{"label":"Log CB: \"partner needs to see it.\"","next":"end_bk","points":{},"feedback":"Wrong code: a meeting was booked."}]},"end_bk":{"prospect":"Meeting booked: Wednesday 3pm CT with Karen and Dale.","end":true,"outcome":"booked"},"end_badtime":{"prospect":"It is, actually. (click)","end":true,"outcome":"not_interested"},"end_sub":{"prospect":"A subscription? That's exactly what we don't need. Thanks. (click)","end":true,"outcome":"not_interested"},"end_ni":{"prospect":"We're fine, thanks. (click)","end":true,"outcome":"not_interested"}}}$j$::jsonb,
  NULL, NULL, true)
ON CONFLICT (code) DO NOTHING;

-- RP4: Gatekeeper wall (integrator, CA)
INSERT INTO training_roleplay_scenarios (code, title, persona_json, objective, difficulty, objections_json, rubric_id, script_json, exam_kind, pass_rule, active)
VALUES ('RP4', 'Gatekeeper wall (integrator, CA)',
  $j${"name":"Greg Holloway","firm_name":"Pacific Crest Security Systems Inc.","firm_type":"Security systems integrator (CCTV/access control)","narrative":"Design, installation and service of CCTV, access control, intrusion detection and intercom systems for federal, municipal, education and commercial facilities. Authorized dealer for major manufacturers. Service contracts available.","state":"CA","size_guess":"12–25 employees","gov_mix_pct":45,"hidden_pains":["Site footer says © 2019 and shows no case studies or manufacturer certifications","Half of commercial leads are referrals; the site \"has been on his list forever\""],"mood":"busy","website_observation":"Footer © 2019; no case studies; certifications not shown","voice_notes":"Office manager Patty answers first: polite, protective, repeats \"send an email.\" Greg is friendly once on the line but short on time."}$j$::jsonb,
  'Get past the office manager politely ("What''s this regarding?", "Is this a sales call? Send an email"), make her a referral source, then open the owner with a live observation, lead with a revamp and book.',
  3, $j$["What's this regarding?","Is this a sales call? He usually just says to send an email."]$j$::jsonb,
  (SELECT id FROM training_rubrics WHERE code = 'CALL_SCORECARD_100'),
  $j${"start":"n1","nodes":{"n1":{"prospect":"Pacific Crest Security, this is Patty.","choices":[{"label":"Hi Patty, this is [Your name] with Bytes Platform. Is Greg around?","next":"n2","points":{"opener":10,"tonality":2},"feedback":"Polite, brief, confident, and you used the owner's first name."},{"label":"Hi, can I speak to the owner, please?","next":"n2","points":{"opener":7,"tonality":1},"feedback":"Use the owner's first name. \"The owner\" signals a cold call."},{"label":"Hi Patty! How are you doing today? Did I catch you at a bad time?","next":"end_gk_block","points":{},"feedback":"Gong: \"Did I catch you at a bad time?\" is the worst-performing opener (0.9%). You handed them an easy exit."}]},"n2":{"prospect":"What's this regarding?","choices":[{"label":"It's about how Pacific Crest shows up when primes and contracting officers look you up online. Is Greg the right person for that, or is someone else in charge of the website and bids?","next":"n3","points":{"reason":10,"tonality":1},"feedback":"The gatekeeper script, word for word: specific and honest, and it asks who the right person is."},{"label":"It's a business matter. I'd rather discuss it with him.","next":"n3","points":{"reason":7,"tonality":1},"feedback":"Evasive answers make gatekeepers more protective."},{"label":"I'm calling from Bytes Platform about an exciting offer on websites, SEO and AI tools!","next":"end_gk_block","points":{},"feedback":"Hype gets you screened out. Be specific and calm."}]},"n3":{"prospect":"Is this a sales call? He usually just says to send an email.","choices":[{"label":"It is. I'll be quick. Happy to send an email: what's the best email for Greg? And so I send something useful, you probably know this better than anyone: who updates the website there?","next":"n4","points":{"objection_handling":10,"listening":3,"tonality":1},"feedback":"Honesty disarms, and you turned the gatekeeper into a referral source."},{"label":"Okay, what's his email?","next":"n4","points":{"objection_handling":7,"listening":2,"tonality":1},"feedback":"You got the email but missed the chance to learn who handles the site."},{"label":"Come on, it'll just take two minutes. Please just put me through.","next":"end_gk_block","points":{},"feedback":"Begging the gatekeeper treats her as a wall, not an ally."}]},"n4":{"prospect":"(Patty) It's greg@pacificcrest.example. He does the website himself, actually. Oh, he just walked in. Hold on. … (Greg) This is Greg. Patty says you're calling about the website?","choices":[{"label":"Hi Greg, thanks for taking it. I'll be quick. I'm on your site now: the footer says 2019 and I couldn't find case studies or your manufacturer certifications. When a prime or property manager checks you out, what do they usually look for?","next":"n5","points":{"problem_questions":7,"listening":2},"feedback":"A live observation turned into a problem question."},{"label":"Yes, we build websites. Are you interested in a new one?","next":"n5","points":{"problem_questions":5,"listening":1},"feedback":"Asking for interest before finding a problem invites a no."},{"label":"Yeah, your website is really outdated. You need a new one.","next":"n5","points":{},"feedback":"Criticism, not a question."}]},"n5":{"prospect":"Mostly past projects. Honestly half our commercial leads come from referrals. The site's been on my list forever.","choices":[{"label":"On your list forever… It sounds like the site isn't pulling its weight. If a property manager compares you to an integrator with a current site full of case studies, what do you think that costs you over a year?","next":"n6","points":{"problem_questions":6,"listening":5,"tonality":1},"feedback":"Mirror, label, consequence question."},{"label":"How many installs do you do a month?","next":"n6","points":{"problem_questions":4,"listening":3,"tonality":1},"feedback":"Situation question; you skipped the pain."},{"label":"Well, we can fix that. Let me tell you everything we do.","next":"n6","points":{},"feedback":"Monologue alert. Ask, don't tell."}]},"n6":{"prospect":"Probably a few jobs. What would you do about it?","choices":[{"label":"We'd revamp the site with your case studies, manufacturer certifications and capability statement front and center, so primes and property managers see the work you've done; SEO can come after. It's 20 minutes with our specialist: does Tuesday at 10 or Wednesday at 2 work better, Pacific? I'll send the invite now.","next":"d1","points":{"classification_bridge":10,"accuracy":5,"next_step":9},"feedback":"Right lead (dated site → Revamp), runner-up kept as the and-also, two specific times."},{"label":"We'd do a new site plus SEO plus social. When are you free for a call?","next":"d1","points":{"classification_bridge":7,"accuracy":5,"next_step":6},"feedback":"Too many services and an open-ended time."},{"label":"We'd rebuild it and get you to #1 on Google. I'll email you a proposal.","next":"end_cb","points":{},"feedback":"Ranking promise plus no booked time. Automatic-fail territory."}]},"d1":{"prospect":"Wednesday at 2 works. (The call ends. Log it before your next dial.)","choices":[{"label":"Log BK: \"Pain: site © 2019, no case studies; commercial leads mostly referrals | Service: revamp (SEO as the and-also) | Site: © 2019, no certifications shown | Next: Wed 2pm PT, Greg (GK: Patty, office mgr; greg@pacificcrest.example), invite sent\"","next":"end_bk","points":{"notes_disposition":5},"feedback":"Correct code, format, and the gatekeeper's name for next time."},{"label":"Log BK: \"talked to Greg after Patty.\"","next":"end_bk","points":{"notes_disposition":3},"feedback":"Right code; add pain, service, site and time."},{"label":"Log GK: \"spoke to Patty.\"","next":"end_bk","points":{},"feedback":"You reached the decision-maker and booked: the code is BK."}]},"end_bk":{"prospect":"Meeting booked: Wednesday 2pm PT with Greg.","end":true,"outcome":"booked"},"end_gk_block":{"prospect":"(Patty) He's not taking sales calls. You can email info@. Bye.","end":true,"outcome":"not_interested"},"end_cb":{"prospect":"(Greg) Sure, send it. (No meeting booked; the proposal sits unread.)","end":true,"outcome":"callback"}}}$j$::jsonb,
  NULL, NULL, true)
ON CONFLICT (code) DO NOTHING;

-- RP5: Burned before (HVAC, GA)
INSERT INTO training_roleplay_scenarios (code, title, persona_json, objective, difficulty, objections_json, rubric_id, script_json, exam_kind, pass_rule, active)
VALUES ('RP5', 'Burned before (HVAC, GA)',
  $j${"name":"Tony Russo","firm_name":"Peachtree Air & Duct LLC","firm_type":"HVAC / air duct cleaning","narrative":"HVAC installation, maintenance and repair; air duct cleaning and indoor air quality services for residential, commercial and government facilities in Middle Georgia.","state":"GA","size_guess":"8–15 technicians","gov_mix_pct":20,"hidden_pains":["After-hours calls go to voicemail and half never leave a message","Paid an agency $4,000 last year; they built a site and stopped answering"],"mood":"skeptical","website_observation":"Modern site (built 2023) but no booking or quote button and no after-hours option","voice_notes":"Guarded and a little bitter about agencies. Respects straight talk; hates \"we're different.\""}$j$::jsonb,
  'Label the "agencies took our money" objection (Voss accusation audit), ask what "working" would look like (NEPQ), uncover the after-hours missed-call pain, lead with the AI receptionist without overpromising, and book.',
  3, $j$["We paid an agency before and they disappeared. Agencies took our money."]$j$::jsonb,
  (SELECT id FROM training_rubrics WHERE code = 'CALL_SCORECARD_100'),
  $j${"start":"n1","nodes":{"n1":{"prospect":"Peachtree Air, Tony speaking.","choices":[{"label":"Hi Tony, it's [Your name] with Bytes Platform. How have you been?","next":"n2","points":{"opener":10,"tonality":2},"feedback":"Good human opener."},{"label":"Hi Tony, [Your name] from Bytes Platform. We work with HVAC companies.","next":"n2","points":{"opener":7,"tonality":1},"feedback":"Fine, but no human moment."},{"label":"Hi Tony, did I catch you at a bad time?","next":"end_badtime","points":{},"feedback":"Gong: \"Did I catch you at a bad time?\" is the worst-performing opener (0.9%). You handed them an easy exit."}]},"n2":{"prospect":"Fine. What's this about?","choices":[{"label":"The reason I'm calling: we work with HVAC and duct-cleaning companies on SAM.gov, and I'm on your website right now. I noticed there's no way to book or request a quote after hours. Quick question: what happens when someone calls you at 7 p.m.?","next":"n3","points":{"reason":10,"problem_questions":4,"tonality":1},"feedback":"Industry, live observation, and a pointed problem question."},{"label":"We help HVAC companies get more leads online. Is that something you're working on?","next":"n3","points":{"reason":7,"problem_questions":3,"tonality":1},"feedback":"Generic; no observation."},{"label":"We're a digital agency and we have some amazing packages for HVAC companies this month.","next":"n3","points":{},"feedback":"You led with \"agency\" and \"packages\" to a man who was burned by one."}]},"n3":{"prospect":"Look, before you go on: we paid an agency $4,000 last year and they disappeared. Agencies took our money.","choices":[{"label":"It sounds like you've been burned before. You're probably thinking we'll take a deposit and disappear too. What happened last time?","next":"n3b","points":{"objection_handling":8,"listening":4,"tonality":2},"feedback":"Voss label + accusation audit: you said his fear out loud before he could."},{"label":"I'm sorry to hear that. We're different, we're very reliable.","next":"n3b","points":{"objection_handling":5,"listening":3,"tonality":1},"feedback":"\"We're different\" is what every agency says. Label it and ask what happened."},{"label":"Well, that's not our fault. Do you want to hear about our services or not?","next":"end_ni","points":{},"feedback":"Defensive and dismissive. He hangs up."}]},"n3b":{"prospect":"They built a site, then stopped answering emails. Never got a single lead from it.","choices":[{"label":"Never a single lead… So if it were done right, what would \"working\" look like for you?","next":"n4","points":{"objection_handling":4,"problem_questions":4,"listening":4},"feedback":"Objection #17: NEPQ solution-awareness. He defines success for you."},{"label":"That's rough. So how many calls do you miss a week?","next":"n4","points":{"problem_questions":4,"listening":3,"objection_handling":3},"feedback":"Good question, but you moved on from his frustration too fast."},{"label":"Yeah, a lot of agencies are scams. Anyway, we also do websites…","next":"n4","points":{},"feedback":"Agreeing that agencies are scams, then pitching websites, confirms his fear."}]},"n4":{"prospect":"Working would be the phone actually turning into jobs. Half the after-hours callers never leave a voicemail. They just call the next guy.","choices":[{"label":"They just call the next guy? … Roughly how many a week, and what's an average job worth to you?","next":"n5","points":{"problem_questions":5,"listening":4,"tonality":1},"feedback":"Mirror plus a consequence question that sizes the pain."},{"label":"Okay. Do you have a CRM?","next":"n5","points":{"problem_questions":3,"listening":3,"tonality":1},"feedback":"Off-thread. Stay on the missed calls."},{"label":"We can definitely fix all of that for you.","next":"n5","points":{},"feedback":"Promise before understanding. Ask one more question."}]},"n5":{"prospect":"Maybe ten a week in summer. A duct cleaning's four, five hundred. More for HVAC.","choices":[{"label":"That adds up. We build an AI receptionist that answers those calls, asks what they need, books the appointment and texts you a summary. On the call our specialist walks you through the process, milestones and what you own, so you're not taking anything on faith. Would 20 minutes be worth it?","next":"n6","points":{"classification_bridge":10,"accuracy":5,"objection_handling":3},"feedback":"Right service (private customers + missed-call pain → automation), and you answered the trust fear with process, not promises."},{"label":"We could redo your website and do SEO too.","next":"n6","points":{"classification_bridge":7,"accuracy":5,"objection_handling":2},"feedback":"His site is new; the pain is missed calls. The rubric says automation."},{"label":"Our AI replaces your office staff and guarantees you'll never miss a job again.","next":"n6","points":{},"feedback":"Never promise \"replaces employees\" or guarantees."}]},"n6":{"prospect":"If I can hear what it sounds like first, maybe.","choices":[{"label":"Fair. We'll play you a sample call. Does Wednesday at 10 or Thursday at 2 work better, Eastern? I'll send the invite while we're on the phone. Anyone else who should join?","next":"d1","points":{"next_step":10},"feedback":"Answers his condition, two times, invite, attendees."},{"label":"Sure, when works for you?","next":"d1","points":{"next_step":7},"feedback":"Open-ended. Offer two options."},{"label":"I'll email you a recording and you can call us if you like it.","next":"end_cb","points":{},"feedback":"You gave away the next step."}]},"d1":{"prospect":"Thursday at 2. My office manager Dee should be on it. (The call ends. Log it before your next dial.)","choices":[{"label":"Log BK: \"Pain: after-hours calls go to VM, ~10/wk in summer, $400–500/job; burned by agency | Service: AI receptionist (SEO as the and-also) | Site: modern, no booking/quote button | Next: Thu 2pm ET, Tony + Dee, play sample call\"","next":"end_bk","points":{"notes_disposition":5},"feedback":"Correct code and format, including the trust concern for the specialist."},{"label":"Log BK: \"AI receptionist, Thursday.\"","next":"end_bk","points":{"notes_disposition":3},"feedback":"Right code; notes too thin."},{"label":"Log NI: \"burned by agency.\"","next":"end_bk","points":{},"feedback":"Wrong code: a meeting was booked."}]},"end_bk":{"prospect":"Meeting booked: Thursday 2pm ET with Tony and Dee.","end":true,"outcome":"booked"},"end_badtime":{"prospect":"Every time is a bad time for sales calls. (click)","end":true,"outcome":"not_interested"},"end_ni":{"prospect":"No. (click)","end":true,"outcome":"not_interested"},"end_cb":{"prospect":"Sure. (He never calls.)","end":true,"outcome":"callback"}}}$j$::jsonb,
  NULL, NULL, true)
ON CONFLICT (code) DO NOTHING;

-- RP6: Pure-federal, no fit (fasteners via distributors)
INSERT INTO training_roleplay_scenarios (code, title, persona_json, objective, difficulty, objections_json, rubric_id, script_json, exam_kind, pass_rule, active)
VALUES ('RP6', 'Pure-federal, no fit (fasteners via distributors)',
  $j${"name":"Walt Brenner","firm_name":"Keystone Fastener Supply Co.","firm_type":"Industrial fastener supplier (sells via distributors)","narrative":"FASTENERS. BOLTS, NUTS, WASHERS, SCREWS, RIVETS. MIL-SPEC HARDWARE. INDUSTRIAL SUPPLY.","state":"PA","size_guess":"5–10 employees","gov_mix_pct":100,"hidden_pains":["None that we solve: distributors handle quoting and inventory","Mild: the website is basic, but it doesn't matter to his sales"],"mood":"friendly","website_observation":"Basic working site; no line card or RFQ form","voice_notes":"Polite, matter-of-fact. Gets irritated only if pushed after he has explained the distributor model."}$j$::jsonb,
  'Recognize there is no fit (sells through distributors, pure-federal, no manual work), check for an automation angle once, then exit gracefully with permission to check back in six months and log NF with the reason.',
  2, $j$["90% goes through two distributors. The website barely matters.","We get all our work through government buys; we don't need marketing."]$j$::jsonb,
  (SELECT id FROM training_rubrics WHERE code = 'CALL_SCORECARD_100'),
  $j${"start":"n1","nodes":{"n1":{"prospect":"Keystone Fastener, Walt speaking.","choices":[{"label":"Hi Walt, it's [Your name] with Bytes Platform. How have you been?","next":"n2","points":{"opener":10,"tonality":2},"feedback":"Good opener."},{"label":"Hi Walt, [Your name] with Bytes Platform. We work with government suppliers.","next":"n2","points":{"opener":7,"tonality":1},"feedback":"Okay; add a human moment."},{"label":"Hi Walt, did I catch you at a bad time?","next":"end_badtime","points":{},"feedback":"Gong: \"Did I catch you at a bad time?\" is the worst-performing opener (0.9%). You handed them an easy exit."}]},"n2":{"prospect":"Fine, what's up?","choices":[{"label":"The reason I'm calling: I'm on your site right now, and I didn't see a line card or an RFQ form. When a buyer needs fasteners, how do they usually reach you?","next":"n3","points":{"reason":10,"problem_questions":4,"tonality":1},"feedback":"Live observation turned into a question about how they sell."},{"label":"We help suppliers like you get more customers online. Is that something you're interested in?","next":"n3","points":{"reason":7,"problem_questions":3,"tonality":1},"feedback":"Generic; no observation."},{"label":"Your website doesn't have a catalog, which is a big problem. We can fix that for you.","next":"n3","points":{},"feedback":"Criticism framed as a problem you decided he has."}]},"n3":{"prospect":"Honestly, 90% goes through two distributors. We don't sell direct. The website barely matters for us.","choices":[{"label":"Ah, so the distributors are the storefront. That makes sense. Is there any part of the business where you're still doing things by hand: quotes, inventory, anything?","next":"n4","points":{"problem_questions":8,"listening":5},"feedback":"Mirror, accept his reality, and check the one service that could still fit (automation) per the decision tree."},{"label":"Okay, but don't you want to sell direct? A new site with a catalog could change that.","next":"n4","points":{"problem_questions":5,"listening":3},"feedback":"You're pushing a goal he didn't state."},{"label":"Every business needs a great website. Let me tell you about our packages.","next":"n5","points":{},"feedback":"He told you the website doesn't matter to his sales. Listen."}]},"n4":{"prospect":"No, the distributors handle all that. And we get all our work through government buys, so we don't need marketing.","choices":[{"label":"That makes sense, and that's why I'm not going to pitch you ads. It sounds like you're well set up, so I won't take more of your time. Would it be OK if I checked back in six months, in case anything changes?","next":"n6","points":{"objection_handling":12,"classification_bridge":10,"listening":3,"tonality":2},"feedback":"Correct classification: pure-federal, distributor-only, no ops pain → polite exit. Detaching is a success."},{"label":"Are you sure? Even pure-federal firms benefit from SEO and social media.","next":"n5","points":{"objection_handling":8,"classification_bridge":7,"listening":2,"tonality":1},"feedback":"The rubric gives SEO −3 and SMM −2 for pure-federal. Don't push them."},{"label":"Everyone says that until their distributor drops them. You really should think about this.","next":"n5","points":{},"feedback":"Fear-mongering. The \"don't\" column of D13."}]},"n5":{"prospect":"I'm sure. Look, I've got to go.","choices":[{"label":"Understood, Walt. Sorry to push. Thanks for your time, and good luck this quarter.","next":"d1","points":{"objection_handling":3,"classification_bridge":4,"tonality":1},"feedback":"Good recovery: you let him go gracefully."},{"label":"Okay, can I at least send you some info?","next":"d1","points":{"objection_handling":2,"classification_bridge":3,"tonality":1},"feedback":"He's already said no twice. Exit cleanly."},{"label":"Just give me two more minutes. I think you're missing out.","next":"end_hangup","points":{},"feedback":"Arguing with a clear no. He hangs up."}]},"n6":{"prospect":"Sure, check back in six months.","choices":[{"label":"Thanks, Walt. I'll make a note to check in around then. Have a good one.","next":"d1","points":{"next_step":10,"tonality":1},"feedback":"The right next step for a no-fit: a nurture date, not a meeting."},{"label":"Great, and can I send you our full services brochure in the meantime?","next":"d1","points":{"next_step":7,"tonality":1},"feedback":"Unneeded; it slightly undoes the clean exit."},{"label":"Actually, while I have you, can I tell you about our AI receptionist?","next":"n5","points":{},"feedback":"He just agreed to a clean exit. Pitching now burns it."}]},"d1":{"prospect":"(Walt hangs up. Log the call before your next dial.)","choices":[{"label":"Log NF: \"Pain: none; 90% of sales via two distributors, no manual quoting/inventory | Service: none (pure-federal, distributor-only) | Site: basic, no line card/RFQ form | Next: nurture, check back in 6 months\"","next":"end_exit","points":{"notes_disposition":5,"accuracy":5},"feedback":"Correct: NF (not a fit) with the reason, plus the nurture date."},{"label":"Log NI: \"not interested.\"","next":"end_exit","points":{"notes_disposition":3,"accuracy":5},"feedback":"NI means they rejected a pitch. This was a no-fit (NF) and the reason matters for the next rep."},{"label":"Log CB: \"call back next week to pitch SEO.\"","next":"end_exit","points":{},"feedback":"Wrong code and wrong plan: SEO is the weakest fit for pure-federal."}]},"end_exit":{"prospect":"Call logged. Polite exit complete.","end":true,"outcome":"exit"},"end_badtime":{"prospect":"Kind of. What is it? … Actually, never mind. (click)","end":true,"outcome":"not_interested"},"end_hangup":{"prospect":"No. Goodbye. (click)","end":true,"outcome":"not_interested"}}}$j$::jsonb,
  NULL, NULL, true)
ON CONFLICT (code) DO NOTHING;

-- RP7: "Remove me from your list" request
INSERT INTO training_roleplay_scenarios (code, title, persona_json, objective, difficulty, objections_json, rubric_id, script_json, exam_kind, pass_rule, active)
VALUES ('RP7', '"Remove me from your list" request',
  $j${"name":"Brenda Coleman","firm_name":"Coleman Janitorial & Facility Services LLC","firm_type":"Janitorial / facility services","narrative":"JANITORIAL SERVICES, FLOOR CARE, POST-CONSTRUCTION CLEANING, FACILITY SUPPORT SERVICES FOR FEDERAL AND COMMERCIAL BUILDINGS.","state":"OH","size_guess":"20–50 staff","gov_mix_pct":50,"hidden_pains":["Gets several sales calls a day and is fed up","Short on time between site visits"],"mood":"skeptical","website_observation":"Template site with stock photos; no capability statement","voice_notes":"Curt from the first word. Answers one question, then firmly asks to be removed. Escalates sharply if the rep argues."}$j$::jsonb,
  'When the prospect says "remove me from your list / don''t call again," comply immediately with no rebuttal ("Understood, I''ll remove you right now. Sorry for the interruption, have a good day.") and log DNC with the date/time and exact wording. Any pushback fails the scenario.',
  2, $j$["Remove me from your list and don't call again."]$j$::jsonb,
  (SELECT id FROM training_rubrics WHERE code = 'CALL_SCORECARD_100'),
  $j${"start":"n1","nodes":{"n1":{"prospect":"Coleman Facility Services.","choices":[{"label":"Hi, is this Brenda? It's [Your name] with Bytes Platform. How have you been?","next":"n2","points":{"opener":10,"tonality":2},"feedback":"Good opener."},{"label":"Hi, [Your name] with Bytes Platform. I'm looking for the owner.","next":"n2","points":{"opener":6,"tonality":1},"feedback":"Use her first name."},{"label":"Hi! Did I catch you at a bad time?","next":"n3","points":{},"feedback":"Gong: \"Did I catch you at a bad time?\" is the worst-performing opener (0.9%). You handed them an easy exit."}]},"n2":{"prospect":"This is Brenda. Who is this and what is this about?","choices":[{"label":"The reason I'm calling: we work with facility-services contractors on SAM.gov, and I'm on your site right now. I didn't see a capability statement on it. When a prime or contracting officer looks you up, where do they usually find that?","next":"n3","points":{"reason":10,"problem_questions":6,"classification_bridge":6,"tonality":1},"feedback":"Specific reason and a live observation as a question."},{"label":"We build websites for government contractors. Are you interested?","next":"n3","points":{"reason":5,"problem_questions":2},"feedback":"Generic."},{"label":"We're a full-service digital agency with websites, SEO, social, apps, AI…","next":"n3","points":{},"feedback":"Feature dump."}]},"n3":{"prospect":"You know what, I get these calls every day. Remove me from your list and don't call again.","choices":[{"label":"Understood, I'll remove you right now. Sorry for the interruption, have a good day.","next":"d1","points":{"objection_handling":15,"listening":10,"next_step":10,"classification_bridge":4,"problem_questions":4,"tonality":3},"feedback":"Perfect: immediate compliance, no rebuttal. This is the only passing answer."},{"label":"Understood. Before I go, could I just send you one quick email so you have our info?","next":"d1","points":{},"feedback":"This is still a rebuttal. \"Remove me\" means remove, with nothing added. This fails the scenario."},{"label":"Wait, just give me 30 seconds. I really think this could help you win more contracts.","next":"n4","points":{},"feedback":"Automatic fail: arguing after a removal request. Never argue."},{"label":"Why? We haven't even talked yet.","next":"n4","points":{},"feedback":"Automatic fail: challenging a removal request. Never argue."}]},"n4":{"prospect":"I said remove me. Are you deaf?","choices":[{"label":"You're right. I'm sorry. I'll remove you right now. Have a good day.","next":"d1","points":{},"feedback":"Compliance at last, but the first answer already failed the scenario. Comply the first time."},{"label":"Okay, okay. I'll take you off.","next":"d1","points":{},"feedback":"Too late, and grudging."},{"label":"Ma'am, I'm just trying to help your business.","next":"end_angry","points":{},"feedback":"Arguing twice. This is how complaints happen."}]},"d1":{"prospect":"(The call ends. Log it before your next dial.)","choices":[{"label":"Log DNC: \"Date/time: today, 10:42am ET. Exact wording: 'Remove me from your list and don't call again.' Stop all contact (calls and email).\"","next":"end_removed","points":{"notes_disposition":5,"accuracy":5},"feedback":"Correct: DNC with the date/time and her exact wording, logged before the next dial."},{"label":"Log NI: \"not interested, rude.\"","next":"end_removed","points":{},"feedback":"Wrong code. A removal request is DNC, not NI, and \"rude\" is not a useful note."},{"label":"Log CB: \"try again in a month with a different angle.\"","next":"end_removed","points":{},"feedback":"Wrong code and wrong plan: she asked for no further contact."}]},"end_removed":{"prospect":"Call logged.","end":true,"outcome":"removed"},"end_angry":{"prospect":"Unbelievable. I'm reporting this. (click)","end":true,"outcome":"removed"}}}$j$::jsonb,
  NULL, 'dnc_comply', true)
ON CONFLICT (code) DO NOTHING;

-- RP8: Lab owner (environmental lab, NJ)
INSERT INTO training_roleplay_scenarios (code, title, persona_json, objective, difficulty, objections_json, rubric_id, script_json, exam_kind, pass_rule, active)
VALUES ('RP8', 'Lab owner (environmental lab, NJ)',
  $j${"name":"Dr. Priya Raman","firm_name":"Garden State Environmental Testing Labs LLC","firm_type":"Environmental testing laboratory","narrative":"NELAP-accredited environmental testing laboratory: drinking water, wastewater, soil and air analysis; PFAS testing; field sampling for federal, state, municipal and commercial clients.","state":"NJ","size_guess":"15–30 staff","gov_mix_pct":40,"hidden_pains":["Office manager spends half her day on \"is my report ready?\" calls","A chain-of-custody form went missing last month, forcing a re-sample"],"mood":"busy","website_observation":"Modern site with accreditations shown; no client portal or online sample submission","voice_notes":"Precise, analytical, impatient with vague claims. Engages when the rep speaks her language (intake, chain of custody, turnaround)."}$j$::jsonb,
  'Use the lab hook (sample intake, chain-of-custody, "is my report ready?" calls), size the pain with a consequence question, handle "send me an email," lead with automation (sample intake workflow + client portal) and book with a confirmed reason to show.',
  3, $j$["Just send me an email with some information."]$j$::jsonb,
  (SELECT id FROM training_rubrics WHERE code = 'CALL_SCORECARD_100'),
  $j${"start":"n1","nodes":{"n1":{"prospect":"Garden State Labs, Priya Raman.","choices":[{"label":"Hi Priya, it's [Your name] with Bytes Platform. How have you been?","next":"n2","points":{"opener":10,"tonality":2},"feedback":"Good opener."},{"label":"Hi Dr. Raman, [Your name] with Bytes Platform. We work with labs.","next":"n2","points":{"opener":7,"tonality":1},"feedback":"Okay; add a human moment."},{"label":"Hi, did I catch you at a bad time?","next":"end_badtime","points":{},"feedback":"Gong: \"Did I catch you at a bad time?\" is the worst-performing opener (0.9%). You handed them an easy exit."}]},"n2":{"prospect":"Busy. What do you need?","choices":[{"label":"I'll be quick. Labs we talk to often lose hours to sample intake, chain-of-custody paperwork and \"is my report ready?\" calls. How are you handling that today: spreadsheets, a LIMS, something else?","next":"n3","points":{"reason":10,"problem_questions":3,"tonality":1},"feedback":"The C3.3 lab hook: industry-specific reason plus a neutral question."},{"label":"We build websites and software for labs. Would you be interested in a new website?","next":"n3","points":{"reason":7,"problem_questions":2,"tonality":1},"feedback":"Her site is fine. The lab pain is intake, not the website."},{"label":"We have an AI that can run your whole lab office. It's amazing.","next":"end_ni","points":{},"feedback":"Vague hype to an analytical buyer. She's gone."}]},"n3":{"prospect":"Ugh. Spreadsheets, mostly, and a LIMS nobody likes. My office manager spends half her day answering \"is my report ready?\" calls.","choices":[{"label":"Half her day? … How many hours a week does that add up to, and what would she do with that time back?","next":"n4","points":{"problem_questions":6,"listening":5,"tonality":1},"feedback":"Mirror plus a consequence question from the automation row of D7."},{"label":"Which LIMS do you use?","next":"n4","points":{"problem_questions":4,"listening":3,"tonality":1},"feedback":"Detail you can save for the meeting. Stay on the pain."},{"label":"Spreadsheets are a nightmare. Our system fixes all of that.","next":"n5","points":{},"feedback":"You skipped discovery and made a claim you can't back yet."}]},"n4":{"prospect":"Probably fifteen, twenty hours. And intake errors: we had a chain-of-custody form go missing last month and had to re-sample.","choices":[{"label":"It sounds like intake is where the chaos starts. What did that re-sample cost you, in time and with the client?","next":"n5","points":{"problem_questions":5,"listening":4},"feedback":"Label plus a second consequence question."},{"label":"Okay, got it.","next":"n5","points":{"problem_questions":3,"listening":3},"feedback":"You let a big pain go by without exploring it."},{"label":"That's really bad. You could lose your accreditation over that.","next":"n5","points":{},"feedback":"Fear-mongering is in the \"don't\" column."}]},"n5":{"prospect":"A few thousand and a very unhappy client. Look, just send me an email with some information.","choices":[{"label":"Happy to. So it's not just another email, should it focus on sample intake or the \"is my report ready?\" calls? And if it makes sense, would you be against a 15-minute look on Thursday, so it's not just another email?","next":"n6","points":{"objection_handling":15,"tonality":2},"feedback":"Objection #2, both responses: clarify the focus, then a no-oriented ask for a specific day."},{"label":"Sure, what's your email? And what should it focus on?","next":"n6","points":{"objection_handling":10,"tonality":1},"feedback":"Good clarify, but you didn't try for the meeting."},{"label":"Emails just get ignored. Can't you give me 15 minutes right now?","next":"end_ni","points":{},"feedback":"Arguing with a polite exit turns it into a real no."}]},"n6":{"prospect":"Intake, definitely. What would you actually build?","choices":[{"label":"We'd build a sample-intake workflow with digital chain-of-custody and a client portal where customers check report status themselves, so your office manager stops fielding those calls. Does Tuesday at 11 or Thursday at 2 work better for a 20-minute look, Eastern?","next":"n7","points":{"classification_bridge":10,"accuracy":5,"next_step":5},"feedback":"Right service (ops pain → automation/custom), tied to her words, two specific times."},{"label":"We could do SEO to get you more commercial clients, and a new website too.","next":"n7","points":{"classification_bridge":7,"accuracy":5,"next_step":3},"feedback":"SEO is the runner-up at best. Her pain is intake: automation."},{"label":"Our automation will eliminate intake errors completely and replace your office manager.","next":"n7","points":{},"feedback":"Never promise \"replaces employees\" or perfection."}]},"n7":{"prospect":"Thursday at 2.","choices":[{"label":"Great: Thursday at 2 Eastern, 20 minutes. I just sent the invite; can you see it? Anyone else who should join, like your office manager? And what's the one thing you'd want to get out of it?","next":"d1","points":{"next_step":5,"tonality":1},"feedback":"Recap, invite on the call, attendees, reason to show."},{"label":"Great, talk then.","next":"d1","points":{"next_step":3,"tonality":1},"feedback":"Send the invite while on the phone and confirm attendees."},{"label":"Great, I'll send something over at some point.","next":"d1","points":{},"feedback":"Vague. No-shows start here."}]},"d1":{"prospect":"Yes, I see it. Add Linda, my office manager. I want to see the portal. (The call ends. Log it before your next dial.)","choices":[{"label":"Log BK: \"Pain: 15–20 hrs/wk on report-status calls; lost chain-of-custody form forced a re-sample | Service: automation: intake workflow + client portal | Site: modern, accreditations shown, no portal | Next: Thu 2pm ET, Priya + Linda (office mgr), wants to see the portal\"","next":"end_bk","points":{"notes_disposition":5},"feedback":"Correct code and format."},{"label":"Log BK: \"lab, Thursday, portal.\"","next":"end_bk","points":{"notes_disposition":3},"feedback":"Right code; thin notes."},{"label":"Log CB: \"send email.\"","next":"end_bk","points":{},"feedback":"Wrong code: you booked a meeting."}]},"end_bk":{"prospect":"Meeting booked: Thursday 2pm ET with Priya and Linda.","end":true,"outcome":"booked"},"end_badtime":{"prospect":"Yes. (click)","end":true,"outcome":"not_interested"},"end_ni":{"prospect":"Not interested. (click)","end":true,"outcome":"not_interested"}}}$j$::jsonb,
  NULL, NULL, true)
ON CONFLICT (code) DO NOTHING;

-- RP-EXAM-FRIENDLY: Certification roleplay: friendly owner (radio & tower company, TN)
INSERT INTO training_roleplay_scenarios (code, title, persona_json, objective, difficulty, objections_json, rubric_id, script_json, exam_kind, pass_rule, active)
VALUES ('RP-EXAM-FRIENDLY', 'Certification roleplay: friendly owner (radio & tower company, TN)',
  $j${"name":"Bill Haskins","firm_name":"Cumberland Tower & Radio LLC","firm_type":"Two-way radio & tower construction","narrative":"2-WAY RADIO SALES AND SERVICE, P25 SYSTEMS, TOWER CONSTRUCTION, ERECTION AND MAINTENANCE, LINE AND ANTENNA SWEEPS, DAS INSTALLATION.","state":"TN","size_guess":"10–20 employees","gov_mix_pct":55,"hidden_pains":["Primes check the site before calling back and it shows none of their recent tower projects","Site last updated 2018; no capability statement"],"mood":"friendly","website_observation":"Footer © 2018; no projects page or capability statement; not secure","voice_notes":"Easygoing, likes to talk about towers. Asks practical questions about cost and timing. Books if the rep is specific."}$j$::jsonb,
  'Run the full call anatomy with a friendly owner: opener, reason with a live observation, 2–4 problem questions including a consequence question, honest answers on price and timing, lead with a revamp + capability page, book a specific time and log BK in the required format. Pass ≥70.',
  2, $j$["What does something like that cost?","How long does it take?"]$j$::jsonb,
  (SELECT id FROM training_rubrics WHERE code = 'CALL_SCORECARD_100'),
  $j${"start":"n1","nodes":{"n1":{"prospect":"Cumberland Tower, this is Bill.","choices":[{"label":"Hi Bill, it's [Your name] with Bytes Platform. How have you been?","next":"n2","points":{"opener":10,"tonality":2},"feedback":"Name, company, human moment."},{"label":"Hi Bill, [Your name] with Bytes Platform. We do websites for contractors.","next":"n2","points":{"opener":7,"tonality":1},"feedback":"Clear but skips the human moment."},{"label":"Hi Bill, did I catch you at a bad time?","next":"end_badtime","points":{},"feedback":"Gong: \"Did I catch you at a bad time?\" is the worst-performing opener (0.9%). You handed them an easy exit."}]},"n2":{"prospect":"Can't complain. Just got back from a tower job. What can I do for you?","choices":[{"label":"The reason I'm calling: tower and two-way radio firms often win work from primes who check their site before calling back. I'm on yours now, and the footer says 2018. Is it showing the projects you've actually done?","next":"n3","points":{"reason":10,"tonality":1},"feedback":"The C3.3 tower hook with a live observation."},{"label":"We help contractors with their websites. Is yours working for you?","next":"n3","points":{"reason":7,"tonality":1},"feedback":"Generic; use what you saw on the site."},{"label":"Your website is really out of date, man. Like, 2018.","next":"n4","points":{},"feedback":"An insult, not an observation-as-question."}]},"n3":{"prospect":"Ha, no. My daughter built that years ago. We've done a dozen towers since then and none of them are on there.","choices":[{"label":"A dozen towers and none of them on there… When a prime is deciding whether to call you back, where do they see your past performance and capability statement today?","next":"n3b","points":{"problem_questions":7,"listening":4},"feedback":"Mirror plus a problem question about how primes vet subs."},{"label":"When was it last updated?","next":"n3b","points":{"problem_questions":5,"listening":3},"feedback":"He just told you. Build on his words."},{"label":"We can put all of those on a brand-new site for you.","next":"n4","points":{},"feedback":"Pitching before you understand the problem."}]},"n3b":{"prospect":"Mostly I email them a PDF if they ask. Honestly I don't know how many check the site and just move on.","choices":[{"label":"It sounds like the site might be costing you callbacks you never hear about. If a prime compares you to a tower company whose site shows recent projects, what do you think happens?","next":"n4","points":{"problem_questions":6,"listening":5,"tonality":1},"feedback":"Label plus consequence question."},{"label":"How many primes do you work with?","next":"n4","points":{"problem_questions":4,"listening":3,"tonality":1},"feedback":"Situation question; you skipped the consequence."},{"label":"Yeah, they definitely move on. Old sites kill deals.","next":"n4","points":{},"feedback":"You answered your own question with a scare line."}]},"n4":{"prospect":"Fair point. So what does something like that cost, and how long does it take?","choices":[{"label":"Fair questions. It depends on scope, like the projects page and the capability statement. Packages start at [PRICE], and timing is usually [TIMELINE]; the specialist confirms both after a 15-minute look. Other than price and timing, anything else you'd want to know before taking a look?","next":"n5","points":{"objection_handling":15,"accuracy":3,"tonality":2},"feedback":"Honest on both, no invented numbers, and you isolated."},{"label":"It's usually [PRICE]. Timeline depends.","next":"n5","points":{"objection_handling":10,"accuracy":3,"tonality":1},"feedback":"Honest but thin. Point to the specialist and isolate."},{"label":"About two grand, and we'll have it done in a week, guaranteed.","next":"n5","points":{},"feedback":"Invented price and a guaranteed date. Never promise delivery dates or unapproved prices."}]},"n5":{"prospect":"Okay. What exactly would you do?","choices":[{"label":"Since primes check you out before calling back, we'd revamp the site with a projects gallery of those dozen towers, your certifications and a downloadable capability statement, secure and mobile-friendly. Would it be worth 20 minutes with our specialist to see a mockup?","next":"n6","points":{"classification_bridge":10,"accuracy":2},"feedback":"Right lead (dated site → Revamp + capability page), two sentences, tied to his pain."},{"label":"We'd do a new site, SEO, social media, maybe a custom project tracker too.","next":"n6","points":{"classification_bridge":7,"accuracy":2},"feedback":"Lead with one service. Keep the project tracker as the and-also."},{"label":"We'd rebuild it and get you to the top of Google so primes find you first.","next":"n6","points":{},"feedback":"Ranking promise. Also, primes rarely find subs through Google."}]},"n6":{"prospect":"Sure, I'd look at that.","choices":[{"label":"Great. Does Wednesday at 10 or Thursday at 2 work better, Eastern? I'll send the invite while we're on the phone. Anyone else who should join, maybe your daughter?","next":"d1","points":{"next_step":10},"feedback":"Two times, invite, attendees."},{"label":"Great, when are you free next week?","next":"d1","points":{"next_step":7},"feedback":"Offer two specific options."},{"label":"Great, I'll send you an email and you can pick a time whenever.","next":"end_cb","points":{},"feedback":"Leaving the next step vague loses easy meetings."}]},"d1":{"prospect":"Thursday at 2. Yeah, add my daughter Jess; she'd want to see it. (The call ends. Log it before your next dial.)","choices":[{"label":"Log BK: \"Pain: primes check the site, which shows none of ~12 recent tower projects; no capability statement | Service: revamp + capability page (project tracker as the and-also) | Site: © 2018, not secure, no projects | Next: Thu 2pm ET, Bill + Jess, invite sent\"","next":"end_bk","points":{"notes_disposition":5},"feedback":"Correct code and format."},{"label":"Log BK: \"Bill, towers, Thursday.\"","next":"end_bk","points":{"notes_disposition":3},"feedback":"Right code; thin notes."},{"label":"Log CB: \"Thursday.\"","next":"end_bk","points":{},"feedback":"Wrong code: a meeting was booked."}]},"end_bk":{"prospect":"Meeting booked: Thursday 2pm ET with Bill and Jess.","end":true,"outcome":"booked"},"end_badtime":{"prospect":"Eh, sort of. Call back another time. (click)","end":true,"outcome":"not_interested"},"end_cb":{"prospect":"Sure. (The email gets buried; no meeting.)","end":true,"outcome":"callback"}}}$j$::jsonb,
  'friendly', NULL, true)
ON CONFLICT (code) DO NOTHING;

-- RP-EXAM-SKEPTICAL: Certification roleplay: skeptical owner with 3 objections (security guard company, VA)
INSERT INTO training_roleplay_scenarios (code, title, persona_json, objective, difficulty, objections_json, rubric_id, script_json, exam_kind, pass_rule, active)
VALUES ('RP-EXAM-SKEPTICAL', 'Certification roleplay: skeptical owner with 3 objections (security guard company, VA)',
  $j${"name":"Frank DeLuca","firm_name":"Old Dominion Protective Services Inc.","firm_type":"Security guard company","narrative":"ARMED AND UNARMED SECURITY OFFICERS, MOBILE PATROL, FIRE WATCH, CONCIERGE SECURITY. SERVING FEDERAL, MUNICIPAL AND COMMERCIAL CLIENTS IN HAMPTON ROADS.","state":"VA","size_guess":"60–100 officers","gov_mix_pct":50,"hidden_pains":["Can't cover about two shifts a week; one client threatened to pull a contract","Facebook page untouched since 2019; recruiting runs on Indeed and word of mouth"],"mood":"skeptical","website_observation":"Decent, secure site redesigned recently by \"a guy\"; no social icons; Facebook last post 2019","voice_notes":"Gruff and dismissive at first; tests the rep three times. Softens when the rep asks about hiring instead of pitching the website."}$j$::jsonb,
  'Handle exactly three objections with A-C-I-R-R ("Not interested," "We already have a guy for the website," "Just send me an email"), discover the recruiting pain, lead with SMM per the rubric (working site + hiring + inactive socials), state the Meta ad-spend rule, book a specific time and log BK. Pass ≥70.',
  4, $j$["Not interested.","We already have a guy who does our website.","Just send me an email."]$j$::jsonb,
  (SELECT id FROM training_rubrics WHERE code = 'CALL_SCORECARD_100'),
  $j${"start":"n1","nodes":{"n1":{"prospect":"Old Dominion, Frank.","choices":[{"label":"Hi Frank, it's [Your name] with Bytes Platform. How have you been?","next":"n2","points":{"opener":10,"tonality":2},"feedback":"Calm human opener, even with a gruff prospect."},{"label":"Hi Frank, [Your name] with Bytes Platform. We work with security companies.","next":"n2","points":{"opener":7,"tonality":1},"feedback":"Okay; add the human moment."},{"label":"Hi Frank, did I catch you at a bad time?","next":"end_badtime","points":{},"feedback":"Gong: \"Did I catch you at a bad time?\" is the worst-performing opener (0.9%). You handed them an easy exit."}]},"n2":{"prospect":"Not interested.","choices":[{"label":"Totally fair, you don't know what I do yet. Can I ask one quick question, and if it's not relevant I'll let you go? We work with guard companies on SAM.gov, and most tell me their two biggest headaches are finding reliable officers and winning private clients. Which one's bigger for you right now?","next":"n3","points":{"objection_handling":5,"reason":10,"tonality":1},"feedback":"Objection #1 handled with curiosity, then the C3.3 guard-company hook as the reason."},{"label":"Okay, but we help security companies with websites and marketing.","next":"n3","points":{"reason":7,"objection_handling":3,"tonality":1},"feedback":"You pushed through without acknowledging. Acknowledge, then ask one question."},{"label":"You haven't even heard what I'm offering yet!","next":"end_ni","points":{},"feedback":"Arguing with a brush-off makes it a real no."}]},"n3":{"prospect":"Finding officers, obviously. Always hiring. But we already have a guy who does our website.","choices":[{"label":"Great, so the website's covered. I'm not calling about the site. You said you're always hiring: how are you finding officers right now?","next":"n4","points":{"objection_handling":5,"problem_questions":6,"listening":4},"feedback":"Objection #3 acknowledged, and you followed his real pain (hiring) instead of defending a website pitch."},{"label":"Okay, but when did he last update it?","next":"n4","points":{"objection_handling":3,"problem_questions":4,"listening":3},"feedback":"A valid #3 response, but it ignores the hiring pain he just gave you."},{"label":"Website guys usually don't know marketing. You should switch to us.","next":"n4","points":{},"feedback":"Attacking his guy. Contrast, don't compete."}]},"n4":{"prospect":"Indeed ads and word of mouth. I can't cover about two shifts a week. And our Facebook page hasn't been touched since 2019.","choices":[{"label":"Two shifts a week… What does an unfilled shift cost you, with the client and in overtime?","next":"n5","points":{"problem_questions":7,"listening":5,"tonality":1},"feedback":"Mirror plus the SMM consequence question from D7."},{"label":"How many officers do you have?","next":"n5","points":{"problem_questions":5,"listening":3,"tonality":1},"feedback":"Situation question; ask about the cost of the pain."},{"label":"Wow, 2019? That looks really bad to applicants.","next":"n5","points":{},"feedback":"Judgment, not a question."}]},"n5":{"prospect":"Overtime, and one client threatened to pull a contract. So what is it you do?","choices":[{"label":"It sounds like recruiting is the bottleneck. We run social media for guard companies: six posts and three reels a month plus an ad plan, with the ad spend paid directly to Meta, so applicants and private clients see an active, hiring company. Would it be worth 20 minutes to see what that would look like for you?","next":"n6","points":{"classification_bridge":10,"accuracy":5},"feedback":"Right service per the rubric (working site + hiring + inactive socials → SMM), correct package and Meta ad-spend rule."},{"label":"We'd redo your website and do SEO.","next":"n6","points":{"classification_bridge":7,"accuracy":5},"feedback":"His site is covered and isn't the pain. The rubric points to SMM."},{"label":"We'll get you hundreds of applicants and thousands of followers in the first month.","next":"n6","points":{},"feedback":"Never promise follower counts or leads. Automatic-fail territory."}]},"n6":{"prospect":"Just send me an email.","choices":[{"label":"Happy to. So it's not just another email, should it focus on recruiting or on private clients? And would you be against a 15-minute look on Thursday so it's not just another email: 10 or 2, Eastern?","next":"d1","points":{"objection_handling":5,"next_step":10},"feedback":"Objection #2: clarify, then a no-oriented ask with two times. That's three objections handled."},{"label":"Sure. And would it make sense to set up a quick call to go over it? When are you free?","next":"d1","points":{"objection_handling":3,"next_step":7},"feedback":"Right instinct; make it specific."},{"label":"Okay, I'll email you.","next":"end_cb","points":{},"feedback":"Accepting the brush-off ends the call with nothing booked."}]},"d1":{"prospect":"Fine. Thursday at 10. Send it to my email. (The call ends. Log it before your next dial.)","choices":[{"label":"Log BK: \"Pain: can't cover ~2 shifts/wk; client threatened to pull a contract; Facebook idle since 2019 | Service: SMM (recruiting + visibility; ad spend paid to Meta) | Site: decent, has a web guy, no social icons | Next: Thu 10am ET, Frank, invite sent\"","next":"end_bk","points":{"notes_disposition":5},"feedback":"Correct code and format."},{"label":"Log BK: \"social media, Thursday.\"","next":"end_bk","points":{"notes_disposition":3},"feedback":"Right code; thin notes."},{"label":"Log NI: \"has a website guy.\"","next":"end_bk","points":{},"feedback":"Wrong code: you booked a meeting."}]},"end_bk":{"prospect":"Meeting booked: Thursday 10am ET with Frank.","end":true,"outcome":"booked"},"end_badtime":{"prospect":"Always. (click)","end":true,"outcome":"not_interested"},"end_ni":{"prospect":"And I don't need to. (click)","end":true,"outcome":"not_interested"},"end_cb":{"prospect":"Yeah. (He never opens it.)","end":true,"outcome":"callback"}}}$j$::jsonb,
  'skeptical', NULL, true)
ON CONFLICT (code) DO NOTHING;

-- RP-BYTESCON: Bytescon roleplay: BD manager at a contractor that bids often (facilities, MD)
INSERT INTO training_roleplay_scenarios (code, title, persona_json, objective, difficulty, objections_json, rubric_id, script_json, exam_kind, pass_rule, active)
VALUES ('RP-BYTESCON', 'Bytescon roleplay: BD manager at a contractor that bids often (facilities, MD)',
  $j${"name":"Marcus Lee","firm_name":"Chesapeake Facilities Group LLC","firm_type":"Facilities maintenance / O&M contractor","narrative":"Facilities operations and maintenance, janitorial, grounds, HVAC O&M and minor construction for DoD, GSA, VA and state agencies. 8(a), WOSB. GSA MAS, multiple agency BPAs and IDIQs. ISO 9001.","state":"MD","size_guess":"150–300 employees; BD manager + 1 proposal writer","gov_mix_pct":95,"hidden_pains":["Bids 6–8 solicitations a month; building each compliance matrix takes a day or two","Missed a question deadline twice this year, including on a recompete they wanted"],"mood":"skeptical","website_observation":"Modern, secure site with capability statement and contract vehicles listed","voice_notes":"Sharp and well-informed; compares everything to GovWin. Listens for the word \"subscription.\" Respects precise, honest answers."}$j$::jsonb,
  'Qualify the bid process, handle "Is this like GovWin?", "What does it cost / is it a subscription?" and "Does it guarantee we win?", frame the build correctly ("we build you your own in-house system," $5,000–$8,000 one-time + small yearly AI fee, never a subscription, no win guarantees), and book with the decision-maker. Pass ≥75 for BYTESCON_CERT.',
  4, $j$["Is this like GovWin?","What does it cost? Is it a subscription?","Does it guarantee we'll win more?"]$j$::jsonb,
  (SELECT id FROM training_rubrics WHERE code = 'CALL_SCORECARD_100'),
  $j${"start":"n1","nodes":{"n1":{"prospect":"Business development, Marcus Lee.","choices":[{"label":"Hi Marcus, it's [Your name] with Bytes Platform. How have you been?","next":"n2","points":{"opener":10,"tonality":2},"feedback":"Good opener."},{"label":"Hi Marcus, [Your name] with Bytes Platform. We work with government contractors on bids.","next":"n2","points":{"opener":7,"tonality":1},"feedback":"Okay; add the human moment."},{"label":"Hi Marcus, is now a bad time?","next":"end_badtime","points":{},"feedback":"Gong: \"Did I catch you at a bad time?\" is the worst-performing opener (0.9%). You handed them an easy exit."}]},"n2":{"prospect":"Fine, swamped with proposals. What's this about?","choices":[{"label":"I'll be quick. The reason for my call: contractors who bid as much as you do tell us the hard part isn't finding bids, it's getting proposals out without missing a requirement. How is your team building compliance matrices today?","next":"n3","points":{"reason":10,"problem_questions":3,"tonality":1},"feedback":"Problem-first reason that fits a BD manager (Braun \"poke the bear\")."},{"label":"We have a system that helps contractors with bids. Would you be interested?","next":"n3","points":{"reason":7,"problem_questions":2,"tonality":1},"feedback":"Vague, and \"interested?\" invites a no."},{"label":"We have a bid platform you can subscribe to. It's really affordable.","next":"end_sub","points":{},"feedback":"Automatic fail: the contract-management build is never a subscription. It is a one-time build plus a small yearly AI fee."}]},"n3":{"prospect":"We use GovWin for finding bids. Is this like GovWin?","choices":[{"label":"Those are subscription databases built for everyone. This is a system we build for your team: it scores opportunities against your codes and certifications and goes all the way through the compliance matrix, proposal drafting and post-award tracking. After GovWin flags something, who builds the compliance matrix today?","next":"n3b","points":{"objection_handling":5,"problem_questions":3,"accuracy":1},"feedback":"The FAQ answer, word for word, then back to a question."},{"label":"Kind of, but better.","next":"n3b","points":{"objection_handling":3,"problem_questions":2,"accuracy":1},"feedback":"Vague comparison. Use the FAQ answer: built for your team, goes past finding the bid."},{"label":"Yes, it's basically GovWin but cheaper. You'd subscribe to us instead.","next":"end_sub","points":{},"feedback":"Automatic fail: the contract-management build is never a subscription. It is a one-time build plus a small yearly AI fee."}]},"n3b":{"prospect":"Me and one proposal writer. We bid six to eight a month. The matrix alone eats a day or two per bid, and we've missed a question deadline twice this year.","choices":[{"label":"Six to eight a month with two people… What did missing those question deadlines cost you?","next":"n4","points":{"problem_questions":8,"listening":5,"tonality":1},"feedback":"Mirror plus the contract-mgmt consequence question from D7."},{"label":"How do you track deadlines now?","next":"n4","points":{"problem_questions":5,"listening":3,"tonality":1},"feedback":"Reasonable, but ask about the cost first."},{"label":"That's a lot. You definitely need our system.","next":"n4","points":{},"feedback":"Pitch before pain. Ask one more question."}]},"n4":{"prospect":"One was a recompete we really wanted. Okay: what does it cost? And is this a subscription?","choices":[{"label":"It's not a subscription. We build you your own in-house system. It's a one-time build, typically $5,000 to $8,000 depending on customization, plus a small yearly fee that just covers the AI usage. Other than price, is there anything that would stop you from taking a look?","next":"n5","points":{"objection_handling":6,"accuracy":2,"tonality":2},"feedback":"Correct framing, said with certainty, then isolate."},{"label":"It's around $5,000 to $8,000, plus a yearly fee.","next":"n5","points":{"objection_handling":4,"accuracy":2,"tonality":1},"feedback":"Right numbers, but say \"one-time\" and \"not a subscription,\" and isolate."},{"label":"It's a monthly subscription, but very affordable.","next":"end_sub","points":{},"feedback":"Automatic fail: the contract-management build is never a subscription. It is a one-time build plus a small yearly AI fee."}]},"n5":{"prospect":"Does it guarantee we'll win more?","choices":[{"label":"No. Nothing can. It helps you bid on the right things and not miss requirements or deadlines, like those question deadlines you mentioned. For your team it would pull your opportunities, turn each solicitation into a compliance matrix and draft the first version for your writer to edit.","next":"n6","points":{"objection_handling":4,"classification_bridge":10,"accuracy":2},"feedback":"Honest FAQ answer, then a two-sentence bridge tied to his pain."},{"label":"It doesn't guarantee wins, but it'll make your process a lot better.","next":"n6","points":{"objection_handling":3,"classification_bridge":7,"accuracy":1},"feedback":"Honest, but tie it to his specific pain (matrix time, missed deadlines)."},{"label":"Absolutely. Our clients double their win rate.","next":"n6","points":{},"feedback":"Never promise win rates. Automatic fail."}]},"n6":{"prospect":"Alright. I'd want our president to see it.","choices":[{"label":"Makes sense. Would it be easier if she joined the 20-minute call so you don't have to relay it? Is Tuesday at 11 or Wednesday at 3 better for both of you, Eastern? I'll send the invite now.","next":"d1","points":{"next_step":10,"tonality":1},"feedback":"Include the decision-maker, two times, invite."},{"label":"Sure, when can you both do it?","next":"d1","points":{"next_step":7,"tonality":1},"feedback":"Offer two specific times."},{"label":"Can't you just decide? Let me email you the contract.","next":"end_cb","points":{},"feedback":"Pressure plus skipping the meeting. No."}]},"d1":{"prospect":"Wednesday at 3. Her name's Angela. (The call ends. Log it before your next dial.)","choices":[{"label":"Log BK: \"Pain: 2-person bid team, 6–8 bids/mo, matrix by hand, missed 2 question deadlines incl. a recompete | Service: contract-mgmt build ($5–8k one-time + yearly AI fee) | Site: modern; uses GovWin | Next: Wed 3pm ET, Marcus + Angela (president), invite sent\"","next":"end_bk","points":{"notes_disposition":5},"feedback":"Correct code and format."},{"label":"Log BK: \"bid tool, Wednesday.\"","next":"end_bk","points":{"notes_disposition":3},"feedback":"Right code; thin notes."},{"label":"Log CB: \"president needs to see it.\"","next":"end_bk","points":{},"feedback":"Wrong code: you booked a meeting."}]},"end_bk":{"prospect":"Meeting booked: Wednesday 3pm ET with Marcus and Angela.","end":true,"outcome":"booked"},"end_badtime":{"prospect":"It is. (click)","end":true,"outcome":"not_interested"},"end_sub":{"prospect":"Another subscription? We have enough of those. Thanks. (click)","end":true,"outcome":"not_interested"},"end_cb":{"prospect":"No thanks. (click)","end":true,"outcome":"not_interested"}}}$j$::jsonb,
  'bytescon', NULL, true)
ON CONFLICT (code) DO NOTHING;

COMMIT;
