/**
 * Performance Targets (server-side)
 * Reads HR-configurable daily targets from the performance_targets table,
 * falling back to the historical hardcoded defaults if the table is empty
 * or unreachable.
 */

import { query } from './db';
import { DAILY_TARGETS, DailyTargets } from './salary-utils';

export interface AllTargets {
  full_time: DailyTargets;
  part_time: DailyTargets;
}

interface TargetRow {
  employment_type: 'full_time' | 'part_time';
  calls_target: number;
  talk_time_seconds: number;
  leads_target: number;
  updated_at: string;
  updated_by: string | null;
}

/**
 * Fetch targets for both employment types from the DB.
 * Falls back to DAILY_TARGETS defaults per-type if a row is missing.
 */
export async function getAllTargets(): Promise<AllTargets> {
  try {
    const rows = await query<TargetRow>(
      `SELECT employment_type, calls_target, talk_time_seconds, leads_target
       FROM performance_targets`
    );

    const result: AllTargets = {
      full_time: { ...DAILY_TARGETS.full_time },
      part_time: { ...DAILY_TARGETS.part_time },
    };

    for (const row of rows) {
      result[row.employment_type] = {
        calls: Number(row.calls_target),
        talk_time_seconds: Number(row.talk_time_seconds),
        leads: Number(row.leads_target),
      };
    }

    return result;
  } catch (error) {
    console.error('Failed to load performance_targets, using defaults:', error);
    return {
      full_time: { ...DAILY_TARGETS.full_time },
      part_time: { ...DAILY_TARGETS.part_time },
    };
  }
}
