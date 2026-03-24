/**
 * Timezone-Based Lead Routing Engine
 *
 * Determines which US state's leads should be served to agents
 * based on current PKT time, converting to US local time dynamically.
 * Handles DST automatically using Intl.DateTimeFormat.
 *
 * Schedule strategy:
 * - GOLDEN slots: Fresh leads (10:00-11:30 AM US local)
 * - BEST slots: Fresh leads (4:00-5:00 PM US local)
 * - GOOD slots: Fresh leads (3:00-4:00 PM US local)
 * - DEAD ZONE slots: Recycle/callback leads only (lunch/post-lunch)
 */

// US timezone identifiers for each state
const STATE_TIMEZONES: Record<string, string> = {
  FL: 'America/New_York',
  TX: 'America/Chicago',
  CA: 'America/Los_Angeles',
};

interface TimeSlot {
  state: string;
  type: 'golden' | 'best' | 'good' | 'dead_zone';
  label: string;
}

/**
 * Get current hour and minute in a US timezone.
 * Uses Intl.DateTimeFormat which handles DST automatically.
 */
function getUSLocalTime(timezone: string): { hour: number; minute: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);

  return { hour, minute };
}

/**
 * Convert hour:minute to total minutes since midnight for easy comparison.
 */
function toMinutes(hour: number, minute: number): number {
  return hour * 60 + minute;
}

/**
 * Check if a given US local time falls within a specific window.
 */
function isInWindow(usTime: { hour: number; minute: number }, startH: number, startM: number, endH: number, endM: number): boolean {
  const current = toMinutes(usTime.hour, usTime.minute);
  const start = toMinutes(startH, startM);
  const end = toMinutes(endH, endM);
  return current >= start && current < end;
}

/**
 * Determine the current routing slot based on real-time US local times.
 * Returns which state to target and slot type (golden/best/dead_zone).
 *
 * This checks each state's ACTUAL local time right now and matches
 * against known optimal calling windows:
 * - 10:00-11:30 AM → GOLDEN
 * - 3:00-4:00 PM → GOOD
 * - 4:00-5:00 PM → BEST
 * - Everything else during shift → DEAD ZONE
 */
export function getCurrentSlot(): TimeSlot | null {
  // Check each state in priority order for golden/best windows
  const states = ['FL', 'TX', 'CA'] as const;

  // Priority 1: Check for GOLDEN window (10:00-11:30 AM)
  for (const state of states) {
    const usTime = getUSLocalTime(STATE_TIMEZONES[state]);
    if (isInWindow(usTime, 10, 0, 11, 30)) {
      return { state, type: 'golden', label: `${state} Morning Golden (${usTime.hour}:${String(usTime.minute).padStart(2, '0')} local)` };
    }
  }

  // Priority 2: Check for BEST window (4:00-5:00 PM)
  for (const state of states) {
    const usTime = getUSLocalTime(STATE_TIMEZONES[state]);
    if (isInWindow(usTime, 16, 0, 17, 0)) {
      return { state, type: 'best', label: `${state} Afternoon Best (${usTime.hour}:${String(usTime.minute).padStart(2, '0')} local)` };
    }
  }

  // Priority 3: Check for GOOD window (3:00-4:00 PM)
  for (const state of states) {
    const usTime = getUSLocalTime(STATE_TIMEZONES[state]);
    if (isInWindow(usTime, 15, 0, 16, 0)) {
      return { state, type: 'good', label: `${state} Afternoon Good (${usTime.hour}:${String(usTime.minute).padStart(2, '0')} local)` };
    }
  }

  // Priority 4: Check for extended morning (11:30 AM - 12:00 PM) — still decent
  for (const state of states) {
    const usTime = getUSLocalTime(STATE_TIMEZONES[state]);
    if (isInWindow(usTime, 11, 30, 12, 0)) {
      return { state, type: 'good', label: `${state} Late Morning (${usTime.hour}:${String(usTime.minute).padStart(2, '0')} local)` };
    }
  }

  // No premium window active — dead zone
  return { state: 'ANY', type: 'dead_zone', label: 'Dead Zone — Recycle Mode' };
}

/**
 * Get the ordered list of states to try for lead serving.
 * Returns states in priority order based on current time.
 *
 * During golden/best/good: target state first, then others as fallback
 * During dead zone: return all states (will use recycle pool)
 */
export function getStateRoutingOrder(): { states: string[]; isDeadZone: boolean; slotInfo: TimeSlot } {
  const slot = getCurrentSlot();

  if (!slot || slot.state === 'ANY') {
    return {
      states: ['FL', 'TX', 'CA'],
      isDeadZone: true,
      slotInfo: slot || { state: 'ANY', type: 'dead_zone', label: 'Dead Zone' },
    };
  }

  // Primary state first, then others as fallback
  const otherStates = ['FL', 'TX', 'CA'].filter(s => s !== slot.state);
  return {
    states: [slot.state, ...otherStates],
    isDeadZone: false,
    slotInfo: slot,
  };
}

/**
 * Get a debug view of all timezones right now.
 * Useful for HR dashboard / monitoring.
 */
export function getTimezoneDebugInfo(): {
  pkt: string;
  states: Array<{
    state: string;
    localTime: string;
    timezone: string;
    inGolden: boolean;
    inBest: boolean;
    inGood: boolean;
  }>;
  currentSlot: TimeSlot | null;
} {
  const now = new Date();
  const pkt = now.toLocaleString('en-US', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: true });

  const states = Object.entries(STATE_TIMEZONES).map(([state, tz]) => {
    const usTime = getUSLocalTime(tz);
    return {
      state,
      localTime: `${usTime.hour}:${String(usTime.minute).padStart(2, '0')}`,
      timezone: tz,
      inGolden: isInWindow(usTime, 10, 0, 11, 30),
      inBest: isInWindow(usTime, 16, 0, 17, 0),
      inGood: isInWindow(usTime, 15, 0, 16, 0),
    };
  });

  return {
    pkt,
    states,
    currentSlot: getCurrentSlot(),
  };
}
