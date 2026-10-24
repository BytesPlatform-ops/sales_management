/**
 * Live-call helpers (E.7 pitch generator, C3.2 classify, E.11 email drafter).
 * Pitch results are cached by hash(narrative + flags); a nightly job pre-fills
 * the cache for tomorrow's leads through the Batch API (see batch.ts).
 */
import crypto from 'crypto';
import { query, queryOne } from '@/lib/db';
import { chatJSON, stripPII, AiUnavailableError, STANDARD_MODE_MESSAGE } from './ai';
import { classify, keywordPitch, SERVICE_LABELS, Service } from './classify';
import { HttpError } from './http';

export interface PitchInput { narrative: string; firm?: string; state?: string; flags?: string[]; contact?: string | null }

export function pitchHash(narrative: string, flags: string[] = []) {
  return crypto.createHash('sha256').update(`${narrative.trim().toLowerCase()}|${[...flags].sort().join(',')}`).digest('hex');
}

const VALID_SERVICES = new Set(Object.keys(SERVICE_LABELS));

export async function generatePitch(userId: number, input: PitchInput) {
  const narrative = stripPII(input.narrative || '', [input.contact]);
  if (!narrative.trim()) throw new HttpError(400, 'Paste the Capabilities Narrative');
  const flags = input.flags || [];
  const hash = pitchHash(narrative, flags);
  const fallback = keywordPitch(narrative, flags);

  const cached = await queryOne<any>(`SELECT pitch_points_json, model FROM training_leads_cache WHERE narrative_hash = $1`, [hash]);
  if (cached?.pitch_points_json) return { ...cached.pitch_points_json, cached: true, ai_used: cached.model !== 'keyword', ai_message: null };

  try {
    const r = await chatJSON<any>({
      feature: 'pitch', userId, promptKey: 'pitch_points',
      vars: { narrative, firm: input.firm || '', state: input.state || '', flags: flags.join(', ') || 'none' },
      maxTokens: 400,
    });
    const data = {
      ...r.data,
      lead_service: VALID_SERVICES.has(r.data.lead_service) ? r.data.lead_service : fallback.lead_service,
      talking_points: (r.data.talking_points || []).slice(0, 3),
      look_for: fallback.look_for,
    };
    await query(
      `INSERT INTO training_leads_cache (narrative_hash, pitch_points_json, model) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (narrative_hash) DO UPDATE SET pitch_points_json = EXCLUDED.pitch_points_json, model = EXCLUDED.model, created_at = NOW()`,
      [hash, JSON.stringify(data), r.model]
    );
    return { ...data, cached: false, ai_used: true, ai_message: null };
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) throw err;
    return { ...fallback, cached: false, ai_used: false, ai_message: err.message || STANDARD_MODE_MESSAGE };
  }
}

/** Classify a lead from its narrative + website-scan flags (+ anything the rep learned on the call). */
export async function classifyLead(input: { narrative: string; flags?: string[]; answers?: string[]; scan_id?: number | null }) {
  let flags = [...(input.flags || []), ...(input.answers || [])];
  if (input.scan_id) {
    const scan = await queryOne<any>(`SELECT checks_json FROM training_site_scans WHERE id = $1`, [input.scan_id]);
    if (scan?.checks_json?.flags) flags = [...flags, ...scan.checks_json.flags];
  }
  const inferred = keywordPitch(input.narrative || '', flags).flags;
  const c = classify(Array.from(new Set([...flags, ...inferred])));
  return {
    ...c,
    lead_label: SERVICE_LABELS[c.lead as Service],
    runner_up_label: c.runner_up ? SERVICE_LABELS[c.runner_up as Service] : null,
    flags_used: Array.from(new Set([...flags, ...inferred])),
  };
}

/** Lead row the rep is currently on in My Leads (auto-load for the Live Assist panel). */
export async function currentLeadFor(userId: number, leadId?: number) {
  const lead = await queryOne<any>(
    leadId
      ? `SELECT id, firm_name, contact_person, raw_data, state FROM dialer_leads WHERE id = $1 AND assigned_agent_id = $2`
      : `SELECT id, firm_name, contact_person, raw_data, state FROM dialer_leads
         WHERE assigned_agent_id = $1 AND call_outcome = 'pending' AND pool = 'active'
         ORDER BY last_called_at DESC NULLS LAST, id LIMIT 1`,
    leadId ? [leadId, userId] : [userId]
  );
  if (!lead) return null;
  const raw = lead.raw_data || {};
  const pick = (re: RegExp) => {
    for (const [k, v] of Object.entries(raw)) if (re.test(k) && v) return String(v);
    return '';
  };
  return {
    id: lead.id,
    firm_name: lead.firm_name,
    narrative: pick(/capabilit|narrative|description|business_desc|services/i),
    website: pick(/website|url|web/i),
    city_state: [pick(/city/i), lead.state || pick(/^state$/i)].filter(Boolean).join(', '),
    state: lead.state,
  };
}

export async function draftFollowupEmail(userId: number, input: { company: string; observation: string; rep: string }) {
  try {
    const r = await chatJSON<{ subject: string; body: string }>({
      feature: 'email', userId, promptKey: 'email_followup',
      vars: { company: input.company, observation: stripPII(input.observation), rep: input.rep }, maxTokens: 300,
    });
    return { ...r.data, ai_used: true, ai_message: null };
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) throw err;
    return {
      subject: `${input.company} – quick idea`,
      body: `Hi {CONTACT},\n\nI left you a quick voicemail. I was looking at ${input.company}'s website and noticed ${input.observation || '[observation]'}. When a prime or contracting officer looks you up, that's often the first thing they see.\n\nWould it be worth a 15-minute look at a couple of ideas? If it's not a priority, just reply "no" and I'll close the loop.\n\n${input.rep}\nBytes Platform`,
      ai_used: false,
      ai_message: STANDARD_MODE_MESSAGE,
    };
  }
}
