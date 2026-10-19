/**
 * Recording / QA settings that HR can change from the dashboard (system_settings
 * table) instead of editing code. Every value has a safe default.
 */
import { query } from '@/lib/db';

export interface RecordingSettings {
  /** Shift start, PKT, "HH:MM" */
  shiftStart: string;
  /** Shift end, PKT, "HH:MM" (next day when earlier than start) */
  shiftEnd: string;
  /** Extra minutes after shift end still counted in the shift (e.g. 5 → 5:05 AM) */
  shiftEndGraceMinutes: number;
  /** Recordings shorter than this are treated as broken fragments */
  recordingMinSeconds: number;
  /** How far apart call_logs.call_time and the recording's EndTime may be */
  matchWindowMinutes: number;
}

export const RECORDING_SETTING_KEYS = {
  shiftStart: 'qa_shift_start',
  shiftEnd: 'qa_shift_end',
  shiftEndGraceMinutes: 'qa_shift_end_grace_minutes',
  recordingMinSeconds: 'recording_min_seconds',
  matchWindowMinutes: 'recording_match_window_minutes',
} as const;

export const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  shiftStart: '21:00',
  shiftEnd: '05:00',
  shiftEndGraceMinutes: 5,
  recordingMinSeconds: 20,
  matchWindowMinutes: 10,
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validate one setting value; returns an error message or null. */
export function validateRecordingSetting(key: string, value: string): string | null {
  switch (key) {
    case RECORDING_SETTING_KEYS.shiftStart:
    case RECORDING_SETTING_KEYS.shiftEnd:
      return TIME_RE.test(value) ? null : 'Use 24-hour HH:MM, e.g. 21:00';
    case RECORDING_SETTING_KEYS.shiftEndGraceMinutes:
      return /^\d+$/.test(value) && Number(value) <= 120 ? null : 'Whole minutes, 0–120';
    case RECORDING_SETTING_KEYS.recordingMinSeconds:
      return /^\d+$/.test(value) && Number(value) <= 120 ? null : 'Whole seconds, 0–120';
    case RECORDING_SETTING_KEYS.matchWindowMinutes:
      return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 180 ? null : 'Whole minutes, 1–180';
    default:
      return 'Unknown setting';
  }
}

export async function getRecordingSettings(): Promise<RecordingSettings> {
  const s = { ...DEFAULT_RECORDING_SETTINGS };
  try {
    const rows = await query<{ key: string; value: string }>(
      `SELECT key, value FROM system_settings WHERE key = ANY($1)`,
      [Object.values(RECORDING_SETTING_KEYS)]
    );
    const byKey = new Map(rows.map(r => [r.key, (r.value || '').trim()]));
    for (const [field, key] of Object.entries(RECORDING_SETTING_KEYS) as [keyof RecordingSettings, string][]) {
      const v = byKey.get(key);
      if (v === undefined || validateRecordingSetting(key, v)) continue; // fall back to default
      (s as any)[field] = typeof s[field] === 'number' ? Number(v) : v;
    }
  } catch (err) {
    console.warn('[recording-settings] using defaults:', err);
  }
  return s;
}

/**
 * Shift window for a shift date (the PKT date the shift starts on), as PKT
 * wall-clock strings for SQL `::timestamp AT TIME ZONE 'Asia/Karachi'`.
 */
export function shiftWindowPKT(shiftDate: string, s: RecordingSettings): { start: string; end: string } {
  const [y, m, d] = shiftDate.split('-').map(Number);
  const [sh, sm] = s.shiftStart.split(':').map(Number);
  const [eh, em] = s.shiftEnd.split(':').map(Number);
  const overnight = eh * 60 + em <= sh * 60 + sm;
  // Date.UTC is used purely as calendar arithmetic on PKT wall-clock values.
  const start = new Date(Date.UTC(y, m - 1, d, sh, sm));
  const end = new Date(Date.UTC(y, m - 1, d + (overnight ? 1 : 0), eh, em + s.shiftEndGraceMinutes));
  const fmt = (t: Date) => t.toISOString().slice(0, 16).replace('T', ' ') + ':00';
  return { start: fmt(start), end: fmt(end) };
}
