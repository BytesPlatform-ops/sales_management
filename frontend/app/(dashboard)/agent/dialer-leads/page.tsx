'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api-client';
import {
  Phone,
  Globe,
  Mail,
  MapPin,
  Building2,
  ArrowRight,
  CheckCircle,
  XCircle,
  PhoneOff,
  Clock,
  Ban,
  Voicemail,
  Shield,
  UserCheck,
  Loader2,
  Copy,
  Check,
  BarChart3,
  Sparkles,
  ExternalLink,
  MessageSquare,
  Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface DialerLead {
  id: number;
  firm_name: string;
  contact_person: string;
  phone_number: string;
  raw_data: Record<string, string>;
  what_to_offer: string[] | null;
  talking_points: string[] | null;
  ai_generated: boolean;
  call_outcome: string;
  call_notes: string;
  call_count: number;
  last_called_at: string | null;
}

interface LeadStats {
  total: string;
  called: string;
  interested: string;
  not_interested: string;
  voicemail: string;
  gatekeeper: string;
  owner_picked: string;
  callback: string;
  busy: string;
  bad_number: string;
  dnc: string;
}

const OUTCOME_BUTTONS = [
  { value: 'interested', label: 'Interested', icon: CheckCircle, bg: 'bg-emerald-500', ring: 'ring-emerald-500', selected: 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30', unselected: 'bg-white text-emerald-600 border-emerald-200 hover:bg-emerald-50' },
  { value: 'not_interested', label: 'Not Interested', icon: XCircle, bg: 'bg-red-500', ring: 'ring-red-500', selected: 'bg-red-500 text-white shadow-lg shadow-red-500/30', unselected: 'bg-white text-red-500 border-red-200 hover:bg-red-50' },
  { value: 'gatekeeper', label: 'Gatekeeper', icon: Shield, bg: 'bg-amber-500', ring: 'ring-amber-500', selected: 'bg-amber-500 text-white shadow-lg shadow-amber-500/30', unselected: 'bg-white text-amber-600 border-amber-200 hover:bg-amber-50' },
  { value: 'owner_picked', label: 'Owner Picked', icon: UserCheck, bg: 'bg-blue-500', ring: 'ring-blue-500', selected: 'bg-blue-500 text-white shadow-lg shadow-blue-500/30', unselected: 'bg-white text-blue-600 border-blue-200 hover:bg-blue-50' },
  { value: 'voicemail', label: 'Voicemail', icon: Voicemail, bg: 'bg-purple-500', ring: 'ring-purple-500', selected: 'bg-purple-500 text-white shadow-lg shadow-purple-500/30', unselected: 'bg-white text-purple-500 border-purple-200 hover:bg-purple-50' },
  { value: 'busy', label: 'Busy', icon: PhoneOff, bg: 'bg-orange-500', ring: 'ring-orange-500', selected: 'bg-orange-500 text-white shadow-lg shadow-orange-500/30', unselected: 'bg-white text-orange-500 border-orange-200 hover:bg-orange-50' },
  { value: 'callback', label: 'Call Back', icon: Clock, bg: 'bg-cyan-500', ring: 'ring-cyan-500', selected: 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/30', unselected: 'bg-white text-cyan-600 border-cyan-200 hover:bg-cyan-50' },
  { value: 'bad_number', label: 'Bad Number', icon: Ban, bg: 'bg-gray-500', ring: 'ring-gray-500', selected: 'bg-gray-500 text-white shadow-lg shadow-gray-500/30', unselected: 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50' },
] as const;

export default function AgentDialerLeadsPage() {
  useAuth();
  const [lead, setLead] = useState<DialerLead | null>(null);
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [noMoreLeads, setNoMoreLeads] = useState(false);
  const [notes, setNotes] = useState('');
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [selectedOutcomes, setSelectedOutcomes] = useState<string[]>([]);

  const fetchNextLead = useCallback(async () => {
    console.log('🔵 fetchNextLead called');
    try {
      setLoading(true);
      setNotes('');
      setSelectedOutcomes([]);
      const token = api.getToken();
      if (!token) { console.log('🔴 No token!'); return; }

      const url = `/api/agent/dialer-leads/next?t=${Date.now()}`;
      console.log('🔵 Fetching:', url);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await res.json();
      console.log('🔵 Next lead API response:', { status: data.status, leadId: data.data?.id, hasMore: data.hasMore, stats: data.stats });

      if (data.status === 'success') {
        setLead(data.data);
        setStats(data.stats);
        setNoMoreLeads(!data.data);
        if (data.data && !data.data.ai_generated) {
          enrichWithAI(data.data.id);
        }
      } else {
        console.error('🔴 Next lead API non-success:', data);
      }
    } catch (err) {
      console.error('🔴 Failed to fetch lead:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const enrichWithAI = async (leadId: number) => {
    setAiLoading(true);
    try {
      const token = api.getToken();
      const res = await fetch('/api/agent/dialer-leads/ai-enrich', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId }),
      });
      const data = await res.json();
      if (data.status === 'success' && data.data && !data.data.already_cached) {
        setLead((prev) =>
          prev ? { ...prev, what_to_offer: data.data.what_to_offer, talking_points: data.data.talking_points, ai_generated: true } : prev
        );
      }
    } catch (err) {
      console.error('AI enrichment failed:', err);
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => { fetchNextLead(); }, [fetchNextLead]);

  const toggleOutcome = (value: string) => {
    setSelectedOutcomes((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const submitOutcomes = async () => {
    console.log('🔵 submitOutcomes called', { leadId: lead?.id, selectedOutcomes, submitting });
    if (!lead || submitting || selectedOutcomes.length === 0) {
      console.log('🔴 submitOutcomes blocked:', { hasLead: !!lead, submitting, outcomes: selectedOutcomes.length });
      return;
    }
    setSubmitting(true);
    try {
      const token = api.getToken();
      console.log('🔵 POSTing outcome for lead:', lead.id, 'outcomes:', selectedOutcomes);
      const res = await fetch('/api/agent/dialer-leads/outcome', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.id, outcomes: selectedOutcomes, notes: notes || null }),
      });
      const data = await res.json();
      console.log('🔵 Outcome API response:', JSON.stringify(data));
      if (data.status === 'success') {
        console.log('🟢 Outcome success, fetching next lead...');
        await fetchNextLead();
        console.log('🟢 fetchNextLead completed');
      } else {
        console.error('🔴 Outcome API returned non-success:', data);
      }
    } catch (err) {
      console.error('🔴 Failed to log outcome:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const copyPhone = () => {
    if (lead?.phone_number) {
      navigator.clipboard.writeText(lead.phone_number);
      setCopiedPhone(true);
      setTimeout(() => setCopiedPhone(false), 2000);
    }
  };

  const getField = (lead: DialerLead, ...keys: string[]): string | null => {
    for (const key of keys) {
      const found = Object.entries(lead.raw_data).find(([k]) => k.toLowerCase().includes(key.toLowerCase()));
      if (found && found[1]) return found[1];
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
      </div>
    );
  }

  const calledCount = stats ? parseInt(stats.called) : 0;
  const totalCount = stats ? parseInt(stats.total) : 0;
  const progressPct = totalCount > 0 ? (calledCount / totalCount) * 100 : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      {/* Compact Progress Bar */}
      {stats && (
        <div className="bg-gradient-to-r from-slate-900 to-indigo-900 rounded-xl px-4 py-3 text-white flex items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-slate-400 font-medium">{calledCount} / {totalCount} called</span>
              <span className="text-xs font-bold text-emerald-400">{Math.round(progressPct)}%</span>
            </div>
            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all duration-700" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {parseInt(stats.interested) > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded font-bold">{stats.interested} int</span>}
            {parseInt(stats.gatekeeper) > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded font-bold">{stats.gatekeeper} gk</span>}
            {parseInt(stats.owner_picked) > 0 && <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-300 rounded font-bold">{stats.owner_picked} own</span>}
          </div>
        </div>
      )}

      {noMoreLeads ? (
        <div className="bg-gradient-to-br from-emerald-50 to-cyan-50 rounded-2xl border border-emerald-200 p-10 text-center">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
            <CheckCircle className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-xl font-black text-gray-900 mb-1">All Done!</h2>
          <p className="text-gray-500 text-sm">You&apos;ve completed all leads for today.</p>
          {stats && (
            <div className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 bg-white rounded-lg text-emerald-700 font-bold text-sm shadow-sm border border-emerald-200">
              <BarChart3 className="h-4 w-4" /> {calledCount} calls
            </div>
          )}
        </div>
      ) : lead ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-lg shadow-gray-200/50 overflow-hidden">
          {/* Header: Avatar + Name + Phone */}
          <div className="bg-gradient-to-br from-slate-50 to-blue-50 px-5 pt-4 pb-3 border-b">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md shadow-indigo-500/25">
                <span className="text-lg font-black text-white">
                  {(lead.contact_person || lead.firm_name || '?').charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold text-gray-900 leading-tight truncate">
                  {lead.contact_person || 'Unknown Contact'}
                </h2>
                <p className="text-xs text-gray-500 font-medium truncate">{lead.firm_name || 'Unknown Company'}</p>
              </div>
              <div className="flex gap-1.5">
                {getField(lead, 'www', 'url', 'website') ? (
                  <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[10px] font-bold">Website</span>
                ) : (
                  <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[10px] font-bold">No Site</span>
                )}
              </div>
            </div>
          </div>

          {/* Phone + Copy */}
          <div className="px-5 py-2.5 flex items-center justify-between border-b bg-indigo-50/50">
            <div className="flex items-center gap-2.5">
              <Phone className="h-4 w-4 text-indigo-600" />
              <span className="text-base font-bold font-mono text-gray-900">{lead.phone_number}</span>
            </div>
            <button onClick={copyPhone} className={cn('flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md transition-all border', copiedPhone ? 'bg-green-50 text-green-700 border-green-200' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300')}>
              {copiedPhone ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copiedPhone ? 'Copied' : 'Copy'}
            </button>
          </div>

          {/* Quick Info Row */}
          <div className="px-5 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs border-b">
            {getField(lead, 'e-mail', 'email') && (
              <a href={`mailto:${getField(lead, 'e-mail', 'email')}`} className="inline-flex items-center gap-1 text-indigo-600 hover:underline font-medium">
                <Mail className="h-3 w-3" />{getField(lead, 'e-mail', 'email')}
              </a>
            )}
            {getField(lead, 'www', 'url', 'website') && (
              <a href={getField(lead, 'www', 'url', 'website')!.startsWith('http') ? getField(lead, 'www', 'url', 'website')! : `https://${getField(lead, 'www', 'url', 'website')}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline font-medium">
                <ExternalLink className="h-3 w-3" />{getField(lead, 'www', 'url', 'website')}
              </a>
            )}
            {getField(lead, 'address', 'city') && (
              <span className="inline-flex items-center gap-1 text-gray-500">
                <MapPin className="h-3 w-3" />{extractCity(getField(lead, 'address', 'city')!)}
              </span>
            )}
          </div>

          {/* Business Description - Compact */}
          {getField(lead, 'capabilities', 'narrative', 'description') && (
            <div className="mx-5 mt-3 mb-2 bg-slate-50 rounded-lg p-3 border border-slate-200">
              <div className="flex items-center gap-1.5 mb-1">
                <Building2 className="h-3 w-3 text-slate-400" />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Business</span>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">
                {getField(lead, 'capabilities', 'narrative', 'description')}
              </p>
            </div>
          )}

          {/* AI: What to Offer */}
          {lead.what_to_offer && lead.what_to_offer.length > 0 ? (
            <div className="mx-5 mt-2 mb-1">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles className="h-3 w-3 text-amber-500" />
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">What to Offer</span>
                <span className="text-[9px] px-1 py-px bg-amber-100 text-amber-700 rounded font-bold">AI</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {lead.what_to_offer.map((item, i) => (
                  <span key={i} className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-xs font-semibold">{item}</span>
                ))}
              </div>
            </div>
          ) : aiLoading ? (
            <div className="mx-5 mt-2 flex items-center gap-1.5 text-xs text-indigo-500 py-2">
              <Loader2 className="h-3 w-3 animate-spin" /><span className="font-medium">AI analyzing...</span>
            </div>
          ) : !lead.ai_generated ? (
            <div className="mx-5 mt-2">
              <button onClick={() => enrichWithAI(lead.id)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors">
                <Sparkles className="h-3 w-3" />Generate AI Points
              </button>
            </div>
          ) : null}

          {/* AI: Talking Points */}
          {lead.talking_points && lead.talking_points.length > 0 && (
            <div className="mx-5 mt-2 mb-2 bg-gradient-to-br from-indigo-50 to-blue-50 rounded-lg p-3 border border-indigo-100">
              <div className="flex items-center gap-1.5 mb-2">
                <MessageSquare className="h-3 w-3 text-indigo-500" />
                <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">Talking Points</span>
                <span className="text-[9px] px-1 py-px bg-indigo-100 text-indigo-700 rounded font-bold">AI</span>
              </div>
              <ul className="space-y-1.5">
                {lead.talking_points.map((point, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-indigo-500 text-white text-[10px] font-bold flex items-center justify-center mt-px">{i + 1}</span>
                    <span className="leading-relaxed">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Notes - Single Line */}
          <div className="mx-5 my-2">
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes..."
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:bg-white transition-colors placeholder:text-gray-400"
            />
          </div>

          {/* Outcome Buttons - Toggle Style */}
          <div className="border-t px-5 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Log Outcome</span>
              {selectedOutcomes.length > 0 && (
                <span className="text-[10px] text-indigo-600 font-semibold">{selectedOutcomes.length} selected</span>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {OUTCOME_BUTTONS.map((btn) => {
                const Icon = btn.icon;
                const isSelected = selectedOutcomes.includes(btn.value);
                return (
                  <button
                    key={btn.value}
                    onClick={() => toggleOutcome(btn.value)}
                    className={cn(
                      'flex flex-col items-center gap-1 px-2 py-2 rounded-lg text-[10px] font-bold border transition-all',
                      isSelected ? btn.selected : btn.unselected
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {btn.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Submit + Next Arrow */}
          <div className="border-t px-5 py-2.5 flex items-center gap-2">
            <button
              onClick={submitOutcomes}
              disabled={submitting || selectedOutcomes.length === 0}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all',
                selectedOutcomes.length > 0
                  ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white hover:shadow-lg hover:shadow-indigo-500/25 active:scale-[0.98]'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              )}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit & Next
            </button>
            <button
              onClick={fetchNextLead}
              disabled={submitting}
              className="w-11 h-11 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-all active:scale-95"
              title="Skip to next lead"
            >
              <ArrowRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function extractCity(address: string): string {
  const match = address.match(/,\s*([A-Z]{2})\s/);
  if (match) {
    const parts = address.split(',');
    if (parts.length >= 2) {
      const city = parts[parts.length - 2].replace(/\d+.*$/, '').trim();
      const stateZip = parts[parts.length - 1].trim().split(' ')[0];
      if (city && stateZip) return `${city}, ${stateZip}`;
    }
  }
  return address.length > 25 ? address.substring(0, 25) + '...' : address;
}
