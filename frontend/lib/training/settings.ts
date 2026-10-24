/**
 * training_settings access with a short in-process cache. Every value has a
 * code default so the module keeps working if a row is missing.
 */
import { query } from '@/lib/db';

export interface TrainingSettings {
  gate_enabled: boolean;
  block_dialer_until_certified: boolean;
  onboarding_days: number;
  ramp_schedule: Record<'RAMP_50' | 'RAMP_75', { days: number; multiplier: number }>;
  penalty_free_phases: string[];
  quiz_cooldown_minutes: number;
  ai_models: Record<string, string>;
  ai_caps: {
    rep_monthly_usd: number;
    rep_monthly_usd_with_voice: number;
    org_monthly_usd: number;
    warn_at_pct: number;
    voice_minutes_per_day: number;
  };
  ai_enabled: boolean;
  voice_enabled: boolean;
  audio_retention_days: number;
  supervised_threshold: number;
  training_completion_bonus: { amount: number | null; currency: string };
  kpi_targets: any[];
  launched_at: string;
}

export const DEFAULT_SETTINGS: TrainingSettings = {
  gate_enabled: true,
  block_dialer_until_certified: true,
  onboarding_days: 3,
  ramp_schedule: {
    RAMP_50: { days: 30, multiplier: 0.5 },
    RAMP_75: { days: 30, multiplier: 0.75 },
  },
  penalty_free_phases: ['TRAINING', 'SUPERVISED', 'RAMP_50'],
  quiz_cooldown_minutes: 10,
  ai_models: {
    default: 'gpt-6-luna',
    transcribe: 'gpt-4o-mini-transcribe',
    transcribe_after_2027_02_26: 'gpt-transcribe',
    voice: 'gpt-realtime-2.1-mini',
  },
  ai_caps: {
    rep_monthly_usd: 5,
    rep_monthly_usd_with_voice: 10,
    org_monthly_usd: 150,
    warn_at_pct: 80,
    voice_minutes_per_day: 20,
  },
  ai_enabled: true,
  voice_enabled: false,
  audio_retention_days: 30,
  supervised_threshold: 55,
  training_completion_bonus: { amount: null, currency: 'PKR' },
  kpi_targets: [],
  launched_at: '2026-10-24T00:00:00Z',
};

const TTL_MS = 30_000;
let cache: { at: number; value: TrainingSettings } | null = null;

export async function getSettings(): Promise<TrainingSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value: TrainingSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  try {
    const rows = await query<{ key: string; value: any }>('SELECT key, value FROM training_settings');
    for (const row of rows) {
      if (row.key in value) {
        const def = (DEFAULT_SETTINGS as any)[row.key];
        // Merge objects so a partial row doesn't drop defaulted keys.
        (value as any)[row.key] =
          def && typeof def === 'object' && !Array.isArray(def) && row.value && typeof row.value === 'object'
            ? { ...def, ...row.value }
            : row.value;
      }
    }
  } catch (err) {
    // Module not installed yet — defaults keep callers (payroll, dialer) safe.
    if (!/does not exist/.test(String((err as Error)?.message))) console.error('[training] settings', err);
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function setSetting(key: keyof TrainingSettings, value: unknown, userId?: number) {
  await query(
    `INSERT INTO training_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [key, JSON.stringify(value), userId ?? null]
  );
  cache = null;
}

export function invalidateSettings() {
  cache = null;
}
