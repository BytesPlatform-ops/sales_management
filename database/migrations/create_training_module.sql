-- Sales Onboarding & Training Module (spec: "Bytes Platform Sales Onboarding and
-- Training Module — Specification and Curriculum").
--
-- Additive only: every object is new (training_* / ai_* / v_rep_ramp_status) and
-- created IF NOT EXISTS, so this is safe to re-run against production. Existing
-- tables (users, daily_stats, call_logs, dialer_leads, ...) are only referenced.
--
-- Local deviations from the spec, by decision of the business:
--   * Onboarding is compressed to 3 days (spec: 10). Certification happens on Day 3.
--   * Part F (compliance) is out of scope: no compliance quiz/gate, no DNC
--     suppression or recording-consent controls in this module.
--
-- Roles map onto the existing users.role: 'hr' = Admin + Trainer, 'agent' = Rep.
-- Content (tracks, lessons, questions, flashcards, scenarios) is seeded separately
-- by seed_training_content.sql.

BEGIN;

-- ---------------------------------------------------------------- settings
CREATE TABLE IF NOT EXISTS training_settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT
);

-- ---------------------------------------------------------------- content
CREATE TABLE IF NOT EXISTS training_tracks (
  id SERIAL PRIMARY KEY,
  code VARCHAR(10) NOT NULL UNIQUE,              -- T1 / T2 / T3
  title VARCHAR(200) NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_placeholder BOOLEAN NOT NULL DEFAULT false,
  cert_code VARCHAR(40),                         -- certification earned at the end
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS training_courses (
  id SERIAL PRIMARY KEY,
  track_id INTEGER NOT NULL REFERENCES training_tracks(id) ON DELETE CASCADE,
  code VARCHAR(20) NOT NULL UNIQUE,              -- C1, C2, ... T2-C1, ...
  title VARCHAR(200) NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  required BOOLEAN NOT NULL DEFAULT true,
  day_number INTEGER,                            -- onboarding day (1-3) in the 3-day plan
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS training_lessons (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
  code VARCHAR(40) NOT NULL UNIQUE,              -- e.g. C1.1, C1-QUIZ, T1-EXAM
  type VARCHAR(20) NOT NULL CHECK (type IN
    ('reading', 'video', 'flashcard_deck', 'quiz', 'exam', 'roleplay', 'scenario', 'checklist', 'drill')),
  title VARCHAR(200) NOT NULL,
  body_md TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  est_minutes INTEGER NOT NULL DEFAULT 5,
  sort_order INTEGER NOT NULL DEFAULT 0,
  required BOOLEAN NOT NULL DEFAULT true,
  pass_pct INTEGER NOT NULL DEFAULT 80,          -- quizzes/exams/drills
  -- type-specific settings, e.g. exam draw counts and timer, drill kind,
  -- roleplay scenario codes, checklist items
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  published BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tl_course ON training_lessons(course_id, sort_order);

-- Snapshot taken on every publish (B.7: "publish (trainer, versioned)")
CREATE TABLE IF NOT EXISTS training_lesson_versions (
  id SERIAL PRIMARY KEY,
  lesson_id INTEGER NOT NULL REFERENCES training_lessons(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title VARCHAR(200) NOT NULL,
  body_md TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_by BIGINT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (lesson_id, version)
);

-- Question bank. lesson_id = the quiz it belongs to (NULL = bank-only).
-- tags drive exam composition: product / classification / sales (+ topic tags).
CREATE TABLE IF NOT EXISTS training_quiz_questions (
  id SERIAL PRIMARY KEY,
  lesson_id INTEGER REFERENCES training_lessons(id) ON DELETE SET NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('mcq', 'multi', 'true_false', 'short_answer', 'order')),
  prompt TEXT NOT NULL,
  -- mcq/multi/order: ["option", ...]; true_false: ["True","False"]; short_answer: []
  options_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- mcq/true_false: {"correct": 0}; multi: {"correct": [0,2]}; order: {"order": [2,0,1]}
  -- short_answer: {"keywords": ["..."], "min_matches": 1, "model_answer": "..."}
  answer_json JSONB NOT NULL,
  explanation TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tqq_lesson ON training_quiz_questions(lesson_id);
CREATE INDEX IF NOT EXISTS idx_tqq_tags ON training_quiz_questions USING GIN (tags);

CREATE TABLE IF NOT EXISTS training_flashcards (
  id SERIAL PRIMARY KEY,
  deck_lesson_id INTEGER NOT NULL REFERENCES training_lessons(id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- SM-2 style state per rep per card (E.6)
CREATE TABLE IF NOT EXISTS training_flashcard_reviews (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  flashcard_id INTEGER NOT NULL REFERENCES training_flashcards(id) ON DELETE CASCADE,
  ease NUMERIC(4,2) NOT NULL DEFAULT 2.5,
  interval_days INTEGER NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  due_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_result VARCHAR(10),
  review_count INTEGER NOT NULL DEFAULT 0,
  good_count INTEGER NOT NULL DEFAULT 0,          -- good/easy answers (retention metric)
  last_reviewed_at TIMESTAMPTZ,
  UNIQUE (user_id, flashcard_id)
);
CREATE INDEX IF NOT EXISTS idx_tfr_due ON training_flashcard_reviews(user_id, due_at);

-- D.12 objection library, stored as data so the trainer can edit it
CREATE TABLE IF NOT EXISTS training_objections (
  id SERIAL PRIMARY KEY,
  num INTEGER NOT NULL UNIQUE,
  objection TEXT NOT NULL,
  why_they_say_it TEXT,
  principle TEXT,
  responses_json JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ["(a) ...", "(b) ..."]
  quick_response TEXT,                                 -- H.1 card
  tags TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true
);

-- Classification drill items (C3.3 / PRODUCT_CERT: 10 SAM.gov-style rows)
-- services: website_new | revamp | seo | smm | automation | contract_mgmt | exit
CREATE TABLE IF NOT EXISTS training_classification_items (
  id SERIAL PRIMARY KEY,
  firm_name VARCHAR(200) NOT NULL,
  narrative TEXT NOT NULL,
  city_state VARCHAR(100),
  website_url TEXT,
  scan_flags JSONB NOT NULL DEFAULT '[]'::jsonb,      -- ["no_ssl","old_copyright",...]
  scan_summary TEXT,
  gov_mix VARCHAR(20),                                -- pure_federal | mixed | commercial
  correct_service VARCHAR(30) NOT NULL,
  acceptable_services TEXT[] NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);

-- 100-point scorecard (D.19) and any other rubric
CREATE TABLE IF NOT EXISTS training_rubrics (
  id SERIAL PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  -- [{"id":"opener","criterion":"Opener","max_points":10,"description":"...","examples":"..."}]
  criteria_json JSONB NOT NULL,
  auto_fail_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  auto_fail_cap INTEGER NOT NULL DEFAULT 40,
  pass_score INTEGER NOT NULL DEFAULT 70,
  excellent_score INTEGER NOT NULL DEFAULT 85,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS training_roleplay_scenarios (
  id SERIAL PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  title VARCHAR(200) NOT NULL,
  -- {name, firm_name, firm_type, narrative, state, size_guess, gov_mix_pct,
  --  hidden_pains[2], mood, voice_notes}
  persona_json JSONB NOT NULL,
  objective TEXT NOT NULL,
  difficulty INTEGER NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 5),
  objections_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  rubric_id INTEGER REFERENCES training_rubrics(id),
  source_lead_id BIGINT,                               -- dialer_leads.id when built from a real row
  -- No-key fallback: branching script.
  -- {"start":"n1","nodes":{"n1":{"prospect":"...","choices":[{"label":"...","next":"n2","points":{"opener":5}}]}}}
  script_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  exam_kind VARCHAR(20),                               -- friendly | skeptical | bytescon | NULL
  pass_rule VARCHAR(30),                               -- e.g. 'dnc_comply' for scenario 7
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------- learning state
CREATE TABLE IF NOT EXISTS training_lesson_progress (
  user_id BIGINT NOT NULL,
  lesson_id INTEGER NOT NULL REFERENCES training_lessons(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  best_score NUMERIC(5,2),
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS training_attempts (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  lesson_id INTEGER NOT NULL REFERENCES training_lessons(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,                              -- exam timer
  questions_json JSONB NOT NULL DEFAULT '[]'::jsonb,   -- served question ids (shuffled) / drill items
  answers_json JSONB,
  result_json JSONB,                                   -- per-question correctness + feedback
  score_pct NUMERIC(5,2),
  passed BOOLEAN
);
CREATE INDEX IF NOT EXISTS idx_ta_user_lesson ON training_attempts(user_id, lesson_id, started_at DESC);

CREATE TABLE IF NOT EXISTS training_roleplay_sessions (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  scenario_id INTEGER REFERENCES training_roleplay_scenarios(id) ON DELETE SET NULL,
  lesson_id INTEGER REFERENCES training_lessons(id) ON DELETE SET NULL,
  mode VARCHAR(10) NOT NULL DEFAULT 'text' CHECK (mode IN ('text', 'voice')),
  engine VARCHAR(10) NOT NULL DEFAULT 'ai' CHECK (engine IN ('ai', 'script')),
  purpose VARCHAR(20) NOT NULL DEFAULT 'practice' CHECK (purpose IN ('practice', 'exam', 'daily')),
  persona_json JSONB,                                  -- resolved persona (incl. SAM.gov lead personas)
  transcript JSONB NOT NULL DEFAULT '[]'::jsonb,       -- [{role:'rep'|'prospect', text, at}]
  state_json JSONB NOT NULL DEFAULT '{}'::jsonb,       -- script node + points for fallback engine
  ai_score_json JSONB,
  trainer_score_json JSONB,
  final_score NUMERIC(5,2),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'scored', 'needs_review', 'reviewed', 'abandoned')),
  human_reviewed BOOLEAN NOT NULL DEFAULT false,
  trainer_comment TEXT,
  reviewed_by BIGINT,
  reviewed_at TIMESTAMPTZ,
  duration_s INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_trs_user ON training_roleplay_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_trs_status ON training_roleplay_sessions(status);

-- Real calls graded with the scorecard. Source is either an uploaded file or a
-- call the existing QA pipeline already transcribed (call_transcripts.id).
CREATE TABLE IF NOT EXISTS training_call_reviews (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'qa_transcript')),
  call_transcript_id BIGINT,
  audio_url TEXT,
  audio_deleted_at TIMESTAMPTZ,
  duration_s INTEGER,
  transcript TEXT,
  ai_score_json JSONB,
  trainer_override_json JSONB,
  final_score NUMERIC(5,2),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'scored', 'needs_review', 'reviewed', 'failed')),
  error TEXT,
  trainer_comment TEXT,
  reviewed_by BIGINT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tcr_user ON training_call_reviews(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tcr_status ON training_call_reviews(status);

-- Uploaded audio, kept only until the retention purge (audio_retention_days).
-- Render's disk is ephemeral, so the bytes live here instead of on the filesystem.
CREATE TABLE IF NOT EXISTS training_call_audio (
  review_id INTEGER PRIMARY KEY REFERENCES training_call_reviews(id) ON DELETE CASCADE,
  mime_type VARCHAR(100) NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- OpenAI Batch API jobs (50% off) for nightly pitch precompute / flashcard generation.
CREATE TABLE IF NOT EXISTS ai_batches (
  id SERIAL PRIMARY KEY,
  openai_batch_id VARCHAR(100) NOT NULL UNIQUE,
  feature VARCHAR(40) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'submitted',
  request_count INTEGER NOT NULL DEFAULT 0,
  meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS training_certifications (
  id SERIAL PRIMARY KEY,
  code VARCHAR(40) NOT NULL,                           -- PRODUCT_CERT | LIVE_CALL_CERT | BYTESCON_CERT
  user_id BIGINT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  granted_by BIGINT,                                   -- NULL = earned automatically
  method VARCHAR(20) NOT NULL DEFAULT 'auto' CHECK (method IN ('auto', 'manual', 'grandfathered')),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by BIGINT,
  notes TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tc_active ON training_certifications(user_id, code) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS training_badges (
  id SERIAL PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  title VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(40),
  criteria_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS training_user_badges (
  user_id BIGINT NOT NULL,
  badge_id INTEGER NOT NULL REFERENCES training_badges(id) ON DELETE CASCADE,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS training_assignments (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  track_id INTEGER REFERENCES training_tracks(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES training_courses(id) ON DELETE CASCADE,
  assigned_by BIGINT,
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (track_id IS NOT NULL OR course_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_tas_user ON training_assignments(user_id);

-- Gate rules (B.5), trainer-editable. rule_json examples:
--   {"requires":[{"lesson":"T1-EXAM","min_score":80},{"lesson":"C3-DRILL","min_score":80}]}
--   {"requires":[{"cert":"PRODUCT_CERT"},{"roleplays":{"count":2,"min_score":70,"human_reviewed":1,"purpose":"exam"}}]}
--   {"requires":[{"courses_completed":["C1","C2","C3"]}]}
CREATE TABLE IF NOT EXISTS training_gates (
  id SERIAL PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('lesson', 'course', 'track', 'cert', 'permission')),
  target_ref VARCHAR(40) NOT NULL,
  rule_json JSONB NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS training_drill_log (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  drill_date DATE NOT NULL,
  items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  results_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  score_pct NUMERIC(5,2),
  completed_at TIMESTAMPTZ,
  UNIQUE (user_id, drill_date)
);

CREATE TABLE IF NOT EXISTS training_notifications (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  type VARCHAR(40) NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tn_user ON training_notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS training_coach_digests (
  id SERIAL PRIMARY KEY,
  week_start DATE NOT NULL UNIQUE,
  body_md TEXT NOT NULL,
  data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------- live-call helpers
CREATE TABLE IF NOT EXISTS training_leads_cache (
  id SERIAL PRIMARY KEY,
  narrative_hash VARCHAR(64) NOT NULL UNIQUE,
  pitch_points_json JSONB,
  persona_json JSONB,
  model VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS training_site_scans (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  url_hash VARCHAR(64) NOT NULL UNIQUE,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checks_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary_text TEXT,
  ai_used BOOLEAN NOT NULL DEFAULT false
);

-- ---------------------------------------------------------------- AI gateway (B.11)
CREATE TABLE IF NOT EXISTS ai_prompts (
  id SERIAL PRIMARY KEY,
  key VARCHAR(60) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  model VARCHAR(60),                                   -- NULL = use the feature's configured model
  system_prompt TEXT NOT NULL,
  user_template TEXT NOT NULL DEFAULT '',
  json_schema JSONB,
  temperature NUMERIC(3,2) NOT NULL DEFAULT 0.3,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (key, version)
);

CREATE TABLE IF NOT EXISTS ai_model_prices (
  model VARCHAR(60) PRIMARY KEY,
  input_per_1m NUMERIC(10,4) NOT NULL DEFAULT 0,
  cached_per_1m NUMERIC(10,4) NOT NULL DEFAULT 0,
  output_per_1m NUMERIC(10,4) NOT NULL DEFAULT 0,
  audio_input_per_1m NUMERIC(10,4) NOT NULL DEFAULT 0,
  audio_output_per_1m NUMERIC(10,4) NOT NULL DEFAULT 0,
  per_minute NUMERIC(10,5) NOT NULL DEFAULT 0,         -- transcription models
  status VARCHAR(20) NOT NULL DEFAULT 'current',
  shutdown_date DATE,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS ai_sessions (
  id SERIAL PRIMARY KEY,
  user_id BIGINT,
  feature VARCHAR(40) NOT NULL,
  model VARCHAR(60) NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  audio_seconds NUMERIC(10,2) NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  prompt_version INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ais_user_month ON ai_sessions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ais_feature ON ai_sessions(feature, created_at);

CREATE TABLE IF NOT EXISTS ai_budgets (
  user_id BIGINT NOT NULL,                             -- 0 = org-wide cap
  month CHAR(7) NOT NULL,                              -- YYYY-MM
  cap_usd NUMERIC(10,2) NOT NULL,
  spent_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  hard_stop BOOLEAN NOT NULL DEFAULT true,
  warned_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, month)
);

-- ---------------------------------------------------------------- salary-system hooks (B.9)
-- phase: TRAINING | SUPERVISED | RAMP_50 | RAMP_75 | FULL
CREATE TABLE IF NOT EXISTS training_ramp_status (
  user_id BIGINT PRIMARY KEY,
  phase VARCHAR(20) NOT NULL CHECK (phase IN ('TRAINING', 'SUPERVISED', 'RAMP_50', 'RAMP_75', 'FULL')),
  phase_started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  quota_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  certified_at TIMESTAMPTZ,                            -- LIVE_CALL_CERT date: quota credit starts
  supervised_reason TEXT,
  phase_before_supervised VARCHAR(20),
  grandfathered BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Phase timeline so payroll can apply the right rule to each past day.
CREATE TABLE IF NOT EXISTS training_ramp_history (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  phase VARCHAR(20) NOT NULL,
  quota_multiplier NUMERIC(4,2) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_trh_user ON training_ramp_history(user_id, started_at);

CREATE TABLE IF NOT EXISTS training_events_outbox (
  id SERIAL PRIMARY KEY,
  type VARCHAR(60) NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_teo_pending ON training_events_outbox(created_at) WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS training_webhooks (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  secret VARCHAR(200),
  event_types TEXT[] NOT NULL DEFAULT '{}',            -- empty = all
  active BOOLEAN NOT NULL DEFAULT true,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Integration option (a): shared view the salary system reads.
CREATE OR REPLACE VIEW v_rep_ramp_status AS
SELECT u.id AS employee_id,
       u.full_name,
       u.extension_number,
       COALESCE(r.phase, 'FULL') AS phase,
       COALESCE(r.quota_multiplier, 1.0) AS quota_multiplier,
       r.phase_started_at,
       r.certified_at,
       COALESCE(r.phase IN ('TRAINING', 'SUPERVISED', 'RAMP_50'), false) AS penalty_free,
       (r.user_id IS NULL OR r.certified_at IS NOT NULL OR r.grandfathered) AS quota_credit,
       COALESCE(r.grandfathered, true) AS grandfathered
FROM users u
LEFT JOIN training_ramp_status r ON r.user_id = u.id
WHERE u.role = 'agent';

-- ---------------------------------------------------------------- seed: config
INSERT INTO training_settings (key, value, description) VALUES
  ('gate_enabled', 'true', 'Gate dialer/quota credit behind LIVE_CALL_CERT for new reps'),
  ('block_dialer_until_certified', 'true', 'Uncertified reps cannot pull live leads in My Leads'),
  ('onboarding_days', '3', 'Length of the onboarding plan (spec default was 10)'),
  ('ramp_schedule', '{"RAMP_50":{"days":30,"multiplier":0.5},"RAMP_75":{"days":30,"multiplier":0.75}}',
     'Days in each ramp phase after LIVE_CALL_CERT, then FULL'),
  ('penalty_free_phases', '["TRAINING","SUPERVISED","RAMP_50"]',
     'Phases where payroll applies no missed-target deductions'),
  ('quiz_cooldown_minutes', '10', 'Wait after a failed quiz before retaking'),
  ('ai_models', '{"default":"gpt-6-luna","roleplay":"gpt-6-luna","grading":"gpt-6-luna","pitch":"gpt-6-luna","site_scan":"gpt-6-luna","drill":"gpt-6-luna","generate":"gpt-6-luna","digest":"gpt-6-luna","email":"gpt-6-luna","transcribe":"gpt-4o-mini-transcribe","transcribe_after_2027_02_26":"gpt-transcribe","voice":"gpt-realtime-2.1-mini"}',
     'Model per AI feature (config, never hard-coded: OpenAI retires models quickly)'),
  ('ai_caps', '{"rep_monthly_usd":5,"rep_monthly_usd_with_voice":10,"org_monthly_usd":150,"warn_at_pct":80,"voice_minutes_per_day":20}',
     'Per-rep and org AI budgets (B.11 / E.2)'),
  ('ai_enabled', 'true', 'Master switch for AI features (false = standard mode everywhere)'),
  ('voice_enabled', 'false', 'Optional voice roleplay via Realtime (capped)'),
  ('audio_retention_days', '30', 'Delete uploaded call audio after N days; transcripts and scores are kept'),
  ('supervised_threshold', '55', '4-week rolling scorecard average below which the trainer is prompted to set SUPERVISED'),
  ('training_completion_bonus', '{"amount":null,"currency":"PKR"}', 'Optional bonus on training.track_completed ([AMOUNT] in spec)'),
  ('kpi_targets', '[{"week":"1 (Days 1–3)","phase":"Training (Track 1 → Track 2) + certification","dials":"0 (roleplay only)","conversations":"—","meetings":"—","show_rate":"—","scorecard":"Roleplay ≥50 on Day 2; ≥70 at cert on Day 3"},{"week":"1 (after cert) – 2","phase":"Certified, supervised (ramp 50%)","dials":"60","conversations":"3–4","meetings":"1","show_rate":"≥60%","scorecard":"≥60"},{"week":"3–4","phase":"Ramp 50%","dials":"80","conversations":"4–5","meetings":"1–2","show_rate":"≥65%","scorecard":"≥65"},{"week":"5–6","phase":"Ramp 75% (from day 31 after cert)","dials":"100","conversations":"5–6","meetings":"2–3","show_rate":"≥70%","scorecard":"≥70"},{"week":"7–8","phase":"Toward full (full quota from day 61 after cert)","dials":"100–120","conversations":"6+","meetings":"3–4","show_rate":"≥75%","scorecard":"≥75"}]',
     'D.18 KPI targets (starting assumptions; recalibrate after 4 weeks)'),
  ('launched_at', to_jsonb(CURRENT_TIMESTAMP), 'Agents created before this are grandfathered as certified')
ON CONFLICT (key) DO NOTHING;

INSERT INTO ai_model_prices (model, input_per_1m, cached_per_1m, output_per_1m, audio_input_per_1m, audio_output_per_1m, per_minute, status, shutdown_date, notes) VALUES
  ('gpt-6-luna', 0.10, 0.01, 0.50, 0, 0, 0, 'current', NULL, 'Default for all text features (Batch: $0.05 / $0.25)'),
  ('gpt-4.1-mini', 0.40, 0.10, 1.60, 0, 0, 0, 'deprecated', '2027-01-14', 'Avoid for new builds'),
  ('gpt-4o-mini', 0.15, 0.075, 0.60, 0, 0, 0, 'deprecated', '2027-01-14', 'Replacement: gpt-6-luna'),
  ('gpt-5-mini', 0.25, 0.025, 2.00, 0, 0, 0, 'deprecated', '2026-12-11', 'Avoid'),
  ('o4-mini', 1.10, 0.275, 4.40, 0, 0, 0, 'shutdown', '2026-10-23', 'Do not use'),
  ('gpt-4o-mini-transcribe', 0, 0, 0, 0, 0, 0.003, 'deprecated', '2027-02-26', 'Cheapest transcription until shutdown'),
  ('whisper-1', 0, 0, 0, 0, 0, 0.006, 'deprecated', '2027-02-26', 'Avoid'),
  ('gpt-transcribe', 0, 0, 0, 0, 0, 0.0045, 'current', NULL, 'Transcription after Feb 2027'),
  ('gpt-realtime-2.1-mini', 0.60, 0.06, 2.40, 10.00, 20.00, 0, 'current', NULL, 'Optional voice roleplay; audio $0.30 cached')
ON CONFLICT (model) DO NOTHING;

-- D.19 100-point scorecard. Criterion 9 is "Accuracy" only (compliance is out of scope).
INSERT INTO training_rubrics (code, name, criteria_json, auto_fail_json, auto_fail_cap, pass_score, excellent_score) VALUES
  ('CALL_SCORECARD_100', 'The 100-point call scorecard', '[
    {"id":"opener","criterion":"Opener","max_points":10,"description":"Name + company + human moment; calm tone; no \"bad time?\"","examples":"Hi Mike, it''s Sara with Bytes Platform. How have you been?"},
    {"id":"reason","criterion":"Reason for call","max_points":10,"description":"Clear, specific to their industry; uses a live observation","examples":"The reason I''m calling: I''m on your website right now and noticed..."},
    {"id":"tonality","criterion":"Tonality & pace","max_points":10,"description":"Calm, confident, downward inflection, not rushed","examples":"Short sentences, pauses after questions"},
    {"id":"problem_questions","criterion":"Problem questions","max_points":15,"description":"2–4 relevant questions; at least one consequence question","examples":"What happens when someone calls you at 7 p.m.?"},
    {"id":"listening","criterion":"Listening","max_points":10,"description":"Mirrors/labels; no interrupting; builds on their words","examples":"Half of them never leave one?"},
    {"id":"classification_bridge","criterion":"Classification & bridge","max_points":10,"description":"Leads with the right service per rubric; pitch ≤2 sentences tied to their pain","examples":"Label → Link → Light pitch → Question"},
    {"id":"objection_handling","criterion":"Objection handling","max_points":15,"description":"Acknowledge → clarify → isolate → respond → re-ask; stays calm","examples":"Other than budget, is there anything else that would stop you?"},
    {"id":"next_step","criterion":"Next step","max_points":10,"description":"Specific day/time offered; invite sent; attendees confirmed","examples":"Wednesday at 10 or Thursday at 2?"},
    {"id":"accuracy","criterion":"Accuracy","max_points":5,"description":"No false promises (rankings, wins, prices outside the approved list, delivery dates)","examples":"It helps you bid on the right things; nothing guarantees a win."},
    {"id":"notes_disposition","criterion":"Notes & disposition","max_points":5,"description":"Correct code; notes in the required format (Pain | Service | Site | Next)","examples":"BK — Pain: after-hours calls | Service: AI receptionist | Site: no booking | Next: Thu 2pm ET"}
  ]', '[
    {"id":"argue_after_remove","description":"Arguing after the prospect asks to be removed"},
    {"id":"promise_results","description":"Promising rankings, #1 on Google, or contract wins"},
    {"id":"misrepresent_company","description":"Misrepresenting the company (government affiliation, fake clients, location)"},
    {"id":"bytescon_subscription","description":"Pitching the contract-management build as a subscription"}
  ]', 40, 70, 85)
ON CONFLICT (code) DO NOTHING;

-- B.5 gates with the 3-day plan and without the compliance quiz.
INSERT INTO training_gates (code, target_type, target_ref, rule_json, description) VALUES
  ('TRACK2_UNLOCK', 'track', 'T2',
     '{"requires":[{"courses_completed":["C1","C2","C3"]}],"always_open_courses":["T2-C1"]}',
     'Track 2 opens after Track 1 courses C1–C3 (mindset course T2-C1 can be started in parallel)'),
  ('PRODUCT_CERT', 'cert', 'PRODUCT_CERT',
     '{"requires":[{"lesson":"T1-EXAM","min_score":80},{"lesson":"C3-DRILL","min_score":80}]}',
     'Track 1 final exam ≥80% + classification drill ≥8/10'),
  ('LIVE_CALL_CERT', 'cert', 'LIVE_CALL_CERT',
     '{"requires":[{"cert":"PRODUCT_CERT"},{"lesson":"T2-EXAM","min_score":80},{"lesson":"T2-OBJ-DRILL","min_score":80},{"roleplays":{"count":2,"min_score":70,"human_reviewed":1,"purpose":"exam","distinct_exam_kinds":["friendly","skeptical"]}}]}',
     'PRODUCT_CERT + Track 2 final exam ≥80% + objection drill ≥80% + 2 exam roleplays ≥70 (one friendly, one skeptical; at least one human-reviewed). Compliance quiz removed.'),
  ('BYTESCON_CERT', 'cert', 'BYTESCON_CERT',
     '{"requires":[{"lesson":"C5-QUIZ","min_score":85},{"roleplays":{"count":1,"min_score":75,"exam_kind":"bytescon"}}]}',
     'Optional: Bytescon quiz ≥85% + 1 Bytescon roleplay ≥75/100'),
  ('QUOTA_CREDIT', 'permission', 'quota_credit',
     '{"requires":[{"cert":"LIVE_CALL_CERT"}]}',
     'Live calls count toward quota only after LIVE_CALL_CERT (salary hook)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO training_badges (code, title, description, icon, criteria_json) VALUES
  ('FIRST_BOOKED_MEETING', 'First Booked Meeting', 'Booked your first meeting on a live call', 'calendar-check', '{"type":"first_meeting"}'),
  ('STREAK_10', '10-Day Streak', 'Completed the daily drill 10 days in a row', 'flame', '{"type":"drill_streak","days":10}'),
  ('OBJECTION_MASTER', 'Objection Master', 'Scored ≥8/10 on every objection in the library', 'shield', '{"type":"objection_master","min":8}'),
  ('PRODUCT_CERTIFIED', 'Product Certified', 'Earned PRODUCT_CERT', 'award', '{"type":"cert","code":"PRODUCT_CERT"}'),
  ('LIVE_CERTIFIED', 'Live-Call Certified', 'Earned LIVE_CALL_CERT', 'phone', '{"type":"cert","code":"LIVE_CALL_CERT"}'),
  ('BYTESCON_SPECIALIST', 'Bytescon Specialist', 'Earned BYTESCON_CERT', 'briefcase', '{"type":"cert","code":"BYTESCON_CERT"}'),
  ('ROLEPLAY_85', 'Excellent Roleplay', 'Scored ≥85 on a roleplay', 'star', '{"type":"roleplay_score","min":85}'),
  ('FLASHCARD_100', 'Card Shark', 'Reviewed 100 flashcards', 'layers', '{"type":"flashcards_reviewed","count":100}')
ON CONFLICT (code) DO NOTHING;

-- Grandfather everyone who already works here: certified, FULL quota, no change to pay.
INSERT INTO training_ramp_status (user_id, phase, quota_multiplier, certified_at, grandfathered)
SELECT id, 'FULL', 1.0, CURRENT_TIMESTAMP, true FROM users WHERE role = 'agent'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO training_ramp_history (user_id, phase, quota_multiplier, started_at, reason)
SELECT r.user_id, 'FULL', 1.0, TIMESTAMPTZ '2000-01-01', 'grandfathered at module launch'
FROM training_ramp_status r
WHERE r.grandfathered AND NOT EXISTS (SELECT 1 FROM training_ramp_history h WHERE h.user_id = r.user_id);

INSERT INTO training_certifications (code, user_id, method, notes)
SELECT c.code, u.id, 'grandfathered', 'Existing agent at module launch'
FROM users u CROSS JOIN (VALUES ('PRODUCT_CERT'), ('LIVE_CALL_CERT')) AS c(code)
WHERE u.role = 'agent'
  AND NOT EXISTS (SELECT 1 FROM training_certifications t WHERE t.user_id = u.id AND t.code = c.code AND t.revoked_at IS NULL);

COMMIT;
