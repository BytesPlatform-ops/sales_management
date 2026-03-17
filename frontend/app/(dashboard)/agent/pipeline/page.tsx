'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api-client';
import {
  Loader2,
  Phone,
  Copy,
  Check,
  AlertTriangle,
  DollarSign,
  Calendar,
  ChevronDown,
  ChevronUp,
  Target,
  Clock,
  Trophy,
  XCircle,
  Send,
  Sparkles,
  RefreshCw,
  Building2,
  Mail,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const PIPELINE_STAGES = [
  { value: 'new_interested', label: 'New', color: 'blue', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-800' },
  { value: 'follow_up', label: 'Follow Up', color: 'amber', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-800' },
  { value: 'proposal_sent', label: 'Proposal', color: 'purple', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', badge: 'bg-purple-100 text-purple-800' },
  { value: 'closed_won', label: 'Won', color: 'emerald', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-800' },
  { value: 'closed_lost', label: 'Lost', color: 'red', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', badge: 'bg-red-100 text-red-800' },
] as const;

interface PipelineLead {
  id: number;
  firm_name: string;
  contact_person: string;
  phone_number: string;
  raw_data: Record<string, string>;
  pipeline_stage: string;
  follow_up_at: string | null;
  deal_value: number | null;
  pipeline_notes: string | null;
  call_notes: string | null;
  call_outcomes: string[] | null;
  last_called_at: string | null;
  updated_at: string;
}

interface StageCount {
  pipeline_stage: string;
  count: string;
  overdue: string;
  total_value: string;
}

export default function AgentPipelinePage() {
  useAuth();
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [stageCounts, setStageCounts] = useState<StageCount[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [expandedLead, setExpandedLead] = useState<number | null>(null);
  const [copiedPhone, setCopiedPhone] = useState<number | null>(null);

  // Edit state for expanded lead
  const [editStage, setEditStage] = useState('');
  const [editFollowUp, setEditFollowUp] = useState('');
  const [editDealValue, setEditDealValue] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const token = api.getToken();
      if (!token) return;

      const url = `/api/agent/pipeline${activeStage ? `?stage=${activeStage}` : ''}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await res.json();

      if (data.status === 'success') {
        setLeads(data.data.leads);
        setStageCounts(data.data.stageCounts);
        setSummary(data.data.summary);
      }
    } catch (err) {
      console.error('Failed to fetch pipeline:', err);
    } finally {
      setLoading(false);
    }
  }, [activeStage]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const getStageInfo = (stage: string) => PIPELINE_STAGES.find(s => s.value === stage) || PIPELINE_STAGES[0];
  const getStageCount = (stage: string) => stageCounts.find(s => s.pipeline_stage === stage);

  const expandLead = (lead: PipelineLead) => {
    if (expandedLead === lead.id) {
      setExpandedLead(null);
      return;
    }
    setExpandedLead(lead.id);
    setEditStage(lead.pipeline_stage || 'new_interested');
    setEditFollowUp(lead.follow_up_at ? new Date(lead.follow_up_at).toISOString().slice(0, 16) : '');
    setEditDealValue(lead.deal_value != null ? String(lead.deal_value) : '');
    setEditNotes(lead.pipeline_notes || '');
  };

  const saveLead = async (leadId: number) => {
    setSaving(true);
    try {
      const token = api.getToken();
      const res = await fetch('/api/agent/pipeline', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: leadId,
          pipeline_stage: editStage,
          follow_up_at: editFollowUp || null,
          deal_value: editDealValue ? parseFloat(editDealValue) : null,
          pipeline_notes: editNotes || null,
        }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setExpandedLead(null);
        fetchData();
      }
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(false);
    }
  };

  const copyPhone = (phone: string, leadId: number) => {
    navigator.clipboard.writeText(phone);
    setCopiedPhone(leadId);
    setTimeout(() => setCopiedPhone(null), 2000);
  };

  const isOverdue = (followUp: string | null) => {
    if (!followUp) return false;
    return new Date(followUp) < new Date();
  };

  const getField = (rawData: Record<string, string>, ...keys: string[]): string | null => {
    for (const key of keys) {
      const found = Object.entries(rawData).find(([k]) => k.toLowerCase().includes(key.toLowerCase()));
      if (found && found[1]) return found[1];
    }
    return null;
  };

  const totalOverdue = parseInt(summary?.total_overdue || '0');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Pipeline</h1>
          <p className="text-gray-500 text-sm mt-0.5">Track and close your interested leads</p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 px-3 py-2 text-sm bg-white border rounded-lg hover:bg-gray-50">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600"><Target className="h-5 w-5" /></div>
            <div>
              <p className="text-2xl font-bold">{summary?.total || 0}</p>
              <p className="text-xs text-gray-500">Total Pipeline</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600"><DollarSign className="h-5 w-5" /></div>
            <div>
              <p className="text-2xl font-bold">${Number(summary?.total_value || 0).toLocaleString()}</p>
              <p className="text-xs text-gray-500">Pipeline Value</p>
            </div>
          </div>
        </div>
        <div className={cn("bg-white rounded-xl border p-4", totalOverdue > 0 && "border-red-200 bg-red-50")}>
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-lg", totalOverdue > 0 ? "bg-red-100 text-red-600" : "bg-gray-50 text-gray-500")}>
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalOverdue}</p>
              <p className="text-xs text-gray-500">Overdue</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stage Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveStage(null)}
          className={cn(
            'px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border transition-all',
            !activeStage ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
          )}
        >
          All ({summary?.total || 0})
        </button>
        {PIPELINE_STAGES.map((stage) => {
          const count = getStageCount(stage.value);
          const overdue = parseInt(count?.overdue || '0');
          return (
            <button
              key={stage.value}
              onClick={() => setActiveStage(activeStage === stage.value ? null : stage.value)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border transition-all flex items-center gap-1.5',
                activeStage === stage.value
                  ? `${stage.bg} ${stage.text} ${stage.border}`
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              )}
            >
              {stage.label} ({parseInt(count?.count || '0')})
              {overdue > 0 && (
                <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {overdue}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Leads List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
        </div>
      ) : leads.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center">
          <Target className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No pipeline leads{activeStage ? ' in this stage' : ''}</p>
          <p className="text-sm text-gray-400 mt-1">Leads marked as Interested will appear here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {leads.map((lead) => {
            const stageInfo = getStageInfo(lead.pipeline_stage);
            const overdue = isOverdue(lead.follow_up_at);
            const isExpanded = expandedLead === lead.id;
            const email = getField(lead.raw_data, 'e-mail', 'email');
            const website = getField(lead.raw_data, 'www', 'url', 'website');

            return (
              <div key={lead.id} className={cn("bg-white rounded-xl border transition-all", overdue && "border-red-200")}>
                {/* Lead Row */}
                <div
                  className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-gray-50"
                  onClick={() => expandLead(lead)}
                >
                  {/* Avatar */}
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                    <span className="text-sm font-bold text-white">
                      {(lead.contact_person || lead.firm_name || '?').charAt(0).toUpperCase()}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-gray-900 truncate">{lead.contact_person || 'Unknown'}</p>
                      <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold', stageInfo.badge)}>
                        {stageInfo.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 truncate">{lead.firm_name}</p>
                  </div>

                  {/* Right side info */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {lead.deal_value != null && lead.deal_value > 0 && (
                      <span className="text-xs font-bold text-emerald-600">${Number(lead.deal_value).toLocaleString()}</span>
                    )}
                    {lead.follow_up_at && (
                      <span className={cn(
                        'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                        overdue ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                      )}>
                        {overdue && '⚠ '}
                        {new Date(lead.follow_up_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                    {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                  </div>
                </div>

                {/* Expanded Edit Panel */}
                {isExpanded && (
                  <div className="border-t px-4 py-4 space-y-4 bg-gray-50/50">
                    {/* Contact Info */}
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <button
                        onClick={(e) => { e.stopPropagation(); copyPhone(lead.phone_number, lead.id); }}
                        className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border font-mono font-semibold transition-all',
                          copiedPhone === lead.id ? 'bg-green-50 text-green-700 border-green-200' : 'bg-white text-gray-700 border-gray-200 hover:border-indigo-300'
                        )}
                      >
                        <Phone className="h-3 w-3" />
                        {lead.phone_number}
                        {copiedPhone === lead.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      </button>
                      {email && (
                        <a href={`mailto:${email}`} className="flex items-center gap-1 text-indigo-600 hover:underline font-medium">
                          <Mail className="h-3 w-3" />{email}
                        </a>
                      )}
                      {website && (
                        <a href={website.startsWith('http') ? website : `https://${website}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-indigo-600 hover:underline font-medium">
                          <ExternalLink className="h-3 w-3" />{website}
                        </a>
                      )}
                    </div>

                    {/* Call history note */}
                    {lead.call_notes && (
                      <div className="bg-white rounded-lg border p-2.5 text-xs text-gray-600">
                        <span className="font-semibold text-gray-500">Last notes: </span>{lead.call_notes}
                      </div>
                    )}

                    {/* Edit Fields */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Stage</label>
                        <select
                          value={editStage}
                          onChange={(e) => setEditStage(e.target.value)}
                          className="w-full px-3 py-2 bg-white border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                          {PIPELINE_STAGES.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Follow-up Date</label>
                        <input
                          type="datetime-local"
                          value={editFollowUp}
                          onChange={(e) => setEditFollowUp(e.target.value)}
                          className="w-full px-3 py-2 bg-white border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Deal Value ($)</label>
                        <input
                          type="number"
                          value={editDealValue}
                          onChange={(e) => setEditDealValue(e.target.value)}
                          placeholder="0"
                          min="0"
                          className="w-full px-3 py-2 bg-white border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Pipeline Notes</label>
                        <input
                          type="text"
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          placeholder="Next steps, details..."
                          className="w-full px-3 py-2 bg-white border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    <button
                      onClick={() => saveLead(lead.id)}
                      disabled={saving}
                      className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-xl text-sm font-bold hover:shadow-lg hover:shadow-indigo-500/25 transition-all disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Save Changes
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
