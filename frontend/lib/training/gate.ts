/**
 * "Gates before access" (B.1): live dialing for reps without LIVE_CALL_CERT.
 * Fails open — if the module isn't installed or errors, the dialer keeps working.
 */
import { queryOne } from '@/lib/db';
import { getSettings } from './settings';
import { getRampStatus } from './ramp';

export async function dialerBlockReason(userId: number): Promise<string | null> {
  try {
    const s = await getSettings();
    if (!s.gate_enabled || !s.block_dialer_until_certified) return null;
    const ramp = await getRampStatus(userId);
    if (ramp.grandfathered || ramp.certified_at) return null;
    const cert = await queryOne(
      `SELECT 1 FROM training_certifications WHERE user_id = $1 AND code = 'LIVE_CALL_CERT' AND revoked_at IS NULL`,
      [userId]
    );
    if (cert) return null;
    return 'Live calling unlocks after your Live-Calling Certification. Finish your training path first.';
  } catch {
    return null;
  }
}
