'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api-client';
import {
  Loader2,
  Target,
  RefreshCw,
  Phone,
  Calendar,
  Building2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const PIPELINE_STAGES = [
  { value: 'new_interested', label: 'New Interested', short: 'New', badge: 'bg-blue-100 text-blue-800' },
  { value: 'follow_up', label: 'Follow Up', short: 'Follow Up', badge: 'bg-amber-100 text-amber-800' },
  { value: 'proposal_sent', label: 'Proposal Sent', short: 'Proposal', badge: 'bg-purple-100 text-purple-800' },
  { value: 'closed_won', label: 'Closed Won', short: 'Won', badge: 'bg-emerald-100 text-emerald-800' },
  { value: 'closed_lost', label: 'Closed Lost', short: 'Lost', badge: 'bg-red-100 text-red-800' },
] as const;

interface PipelineLead {
  id: number;
  firm_name: string;
  contact_person: string;
  phone_number: string;
  pipeline_stage: string;
  follow_up_at: string | null;
  deal_value: number | null;
  pipeline_notes: string | null;
  call_notes: string | null;
  last_called_at: string | null;
  updated_at: string;
  agent_name: string;
  agent_id: number;
}

interface StageCount {
  pipeline_stage: string;
  count: string;
  overdue: string;
  total_value: string;
}

interface AgentBreakdown {
  id: number;
  full_name: string;
  lead_count: string;
  total_value: string;
}

export default function HRPipelinePage() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<PipelineLead[]>([]);
  const [stageCounts, setStageCounts] = useState<StageCount[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [agentBreakdown, setAgentBreakdown] = useState<AgentBreakdown[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string>('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const token = api.getToken();
      if (!token) return;

      const params = new URLSearchParams();
      if (activeStage) params.set('stage', activeStage);
      if (selectedAgent) params.set('agent_id', selectedAgent);
      const query = params.toString() ? `?${params}` : '';

      const res = await fetch(`/api/hr/pipeline${query}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await res.json();

      if (data.status === 'success') {
        setLeads(data.data.leads);
        setStageCounts(data.data.stageCounts);
        setSummary(data.data.summary);
        setAgentBreakdown(data.data.agentBreakdown);
      }
    } catch (err) {
      console.error('Failed to fetch pipeline:', err);
    } finally {
      setLoading(false);
    }
  }, [activeStage, selectedAgent]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const getStageInfo = (stage: string) => PIPELINE_STAGES.find(s => s.value === stage) || PIPELINE_STAGES[0];
  const getStageCount = (stage: string) => stageCounts.find(s => s.pipeline_stage === stage);

  const isOverdue = (followUp: string | null) => {
    if (!followUp) return false;
    return new Date(followUp) < new Date();
  };

  const totalOverdue = parseInt(summary?.total_overdue || '0');

  if (!user || user.role !== 'hr') {
    return <div className="flex items-center justify-center h-64"><p className="text-gray-500">Access denied. HR only.</p></div>;
  }

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pipeline Overview</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track interested leads across all agents</p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* Summary Stats — compact row */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Interested', value: summary?.total || 0, color: 'bg-blue-50 border-blue-200', text: 'text-blue-700', prefix: '' },
          { label: 'Pipeline Value', value: `$${Number(summary?.total_value || 0).toLocaleString()}`, color: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', prefix: '' },
          { label: 'Overdue Follow-ups', value: totalOverdue, color: totalOverdue > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200', text: totalOverdue > 0 ? 'text-red-600' : 'text-gray-500', prefix: '' },
          { label: 'Agents Active', value: summary?.agents_with_leads || 0, color: 'bg-purple-50 border-purple-200', text: 'text-purple-700', prefix: '' },
        ].map((s) => (
          <div key={s.label} className={`${s.color} border rounded-lg px-4 py-3`}>
            <p className={`text-2xl font-bold ${s.text}`}>{s.value}</p>
            <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wide mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Pipeline Stages — visual funnel */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex gap-2">
          {PIPELINE_STAGES.map((stage, idx) => {
            const count = getStageCount(stage.value);
            const cnt = parseInt(count?.count || '0');
            const overdue = parseInt(count?.overdue || '0');
            const value = Number(count?.total_value || 0);
            const isActive = activeStage === stage.value;

            const stageColors: Record<string, string> = {
              new_interested: 'border-blue-300 bg-blue-50',
              follow_up: 'border-amber-300 bg-amber-50',
              proposal_sent: 'border-purple-300 bg-purple-50',
              closed_won: 'border-emerald-300 bg-emerald-50',
              closed_lost: 'border-red-300 bg-red-50',
            };
            const activeRing: Record<string, string> = {
              new_interested: 'ring-blue-400',
              follow_up: 'ring-amber-400',
              proposal_sent: 'ring-purple-400',
              closed_won: 'ring-emerald-400',
              closed_lost: 'ring-red-400',
            };

            return (
              <button
                key={stage.value}
                onClick={() => setActiveStage(isActive ? null : stage.value)}
                className={cn(
                  'flex-1 rounded-lg border-2 p-3 text-left transition-all hover:shadow-sm relative',
                  stageColors[stage.value] || 'border-gray-200 bg-gray-50',
                  isActive && `ring-2 ${activeRing[stage.value] || 'ring-indigo-400'}`
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={cn('text-[11px] font-bold uppercase tracking-wide', stage.badge.replace(/bg-\S+/, '').trim())}>
                    {stage.short}
                  </span>
                  {overdue > 0 && (
                    <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center animate-pulse">{overdue}</span>
                  )}
                </div>
                <p className="text-2xl font-bold text-gray-900 mt-1">{cnt}</p>
                {value > 0 && <p className="text-[11px] text-emerald-600 font-semibold">${value.toLocaleString()}</p>}
                {/* Arrow connector */}
                {idx < PIPELINE_STAGES.length - 1 && (
                  <div className="absolute -right-[9px] top-1/2 -translate-y-1/2 text-gray-300 z-10 text-sm">&#9654;</div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter + Agent Chips */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={selectedAgent}
          onChange={(e) => setSelectedAgent(e.target.value)}
          className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        >
          <option value="">All Agents</option>
          {agentBreakdown.map(a => (
            <option key={a.id} value={a.id}>{a.full_name} ({a.lead_count})</option>
          ))}
        </select>

        {/* Agent quick-filter chips */}
        <div className="flex gap-1.5 flex-wrap">
          {agentBreakdown.map(a => (
            <button
              key={a.id}
              onClick={() => setSelectedAgent(selectedAgent === String(a.id) ? '' : String(a.id))}
              className={cn(
                'px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border',
                selectedAgent === String(a.id)
                  ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              )}
            >
              {a.full_name.split(' ')[0]} <span className="text-gray-400 ml-0.5">{a.lead_count}</span>
              {Number(a.total_value) > 0 && <span className="text-emerald-600 ml-1">${Number(a.total_value).toLocaleString()}</span>}
            </button>
          ))}
        </div>

        {(activeStage || selectedAgent) && (
          <button
            onClick={() => { setActiveStage(null); setSelectedAgent(''); }}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">{leads.length} leads</span>
      </div>

      {/* Leads Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
        </div>
      ) : leads.length === 0 ? (
        <div className="bg-white rounded-xl border p-10 text-center">
          <Target className="h-10 w-10 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No pipeline leads{activeStage ? ' in this stage' : ''}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left">
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Lead</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Agent</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide text-center">Stage</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Follow-up</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide text-right">Deal Value</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {leads.map((lead) => {
                  const stageInfo = getStageInfo(lead.pipeline_stage);
                  const overdue = isOverdue(lead.follow_up_at);
                  return (
                    <tr key={lead.id} className={cn("hover:bg-gray-50/50 transition-colors", overdue && "bg-red-50/40")}>
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-gray-900 text-sm">{lead.contact_person || 'Unknown'}</p>
                        <p className="text-xs text-gray-400 flex items-center gap-1">
                          <Building2 className="h-3 w-3 flex-shrink-0" />{lead.firm_name}
                        </p>
                        <p className="text-[11px] text-gray-400 flex items-center gap-1">
                          <Phone className="h-3 w-3 flex-shrink-0" />{lead.phone_number}
                        </p>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs text-gray-700 font-medium">{lead.agent_name}</span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold', stageInfo.badge)}>
                          {stageInfo.short}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {lead.follow_up_at ? (
                          <span className={cn('text-xs font-medium flex items-center gap-1', overdue ? 'text-red-600' : 'text-gray-500')}>
                            <Calendar className="h-3 w-3 flex-shrink-0" />
                            {new Date(lead.follow_up_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">Not set</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {lead.deal_value != null && lead.deal_value > 0 ? (
                          <span className="text-sm font-bold text-emerald-600">${Number(lead.deal_value).toLocaleString()}</span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-xs text-gray-500 truncate max-w-[180px]">{lead.pipeline_notes || lead.call_notes || '—'}</p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
