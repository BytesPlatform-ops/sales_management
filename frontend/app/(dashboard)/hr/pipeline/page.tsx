'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api-client';
import {
  Loader2,
  Target,
  DollarSign,
  AlertTriangle,
  Users,
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
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pipeline Overview</h1>
          <p className="text-gray-500 text-sm mt-0.5">Track interested leads across all agents</p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 px-3 py-2 text-sm bg-white border rounded-lg hover:bg-gray-50">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600"><Target className="h-5 w-5" /></div>
            <div>
              <p className="text-2xl font-bold">{summary?.total || 0}</p>
              <p className="text-xs text-gray-500">Total Interested</p>
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
              <p className="text-xs text-gray-500">Overdue Follow-ups</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-50 text-purple-600"><Users className="h-5 w-5" /></div>
            <div>
              <p className="text-2xl font-bold">{summary?.agents_with_leads || 0}</p>
              <p className="text-xs text-gray-500">Agents Active</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stage Cards Row */}
      <div className="grid grid-cols-5 gap-2">
        {PIPELINE_STAGES.map((stage) => {
          const count = getStageCount(stage.value);
          const cnt = parseInt(count?.count || '0');
          const overdue = parseInt(count?.overdue || '0');
          const value = Number(count?.total_value || 0);
          const isActive = activeStage === stage.value;
          return (
            <button
              key={stage.value}
              onClick={() => setActiveStage(isActive ? null : stage.value)}
              className={cn(
                'bg-white rounded-xl border p-3 text-left transition-all hover:shadow-sm',
                isActive && 'ring-2 ring-indigo-500 border-indigo-300'
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold', stage.badge)}>{stage.short}</span>
                {overdue > 0 && (
                  <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center animate-pulse">{overdue}</span>
                )}
              </div>
              <p className="text-xl font-bold text-gray-900">{cnt}</p>
              {value > 0 && <p className="text-[10px] text-emerald-600 font-semibold">${value.toLocaleString()}</p>}
            </button>
          );
        })}
      </div>

      {/* Filter Row */}
      <div className="flex items-center gap-3">
        <select
          value={selectedAgent}
          onChange={(e) => setSelectedAgent(e.target.value)}
          className="px-3 py-2 bg-white border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        >
          <option value="">All Agents</option>
          {agentBreakdown.map(a => (
            <option key={a.id} value={a.id}>{a.full_name} ({a.lead_count} leads)</option>
          ))}
        </select>
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
        <div className="bg-white rounded-xl border p-12 text-center">
          <Target className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No pipeline leads{activeStage ? ' in this stage' : ''}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-gray-500">
                  <th className="px-4 py-3 font-medium">Lead</th>
                  <th className="px-4 py-3 font-medium">Agent</th>
                  <th className="px-4 py-3 font-medium text-center">Stage</th>
                  <th className="px-4 py-3 font-medium">Follow-up</th>
                  <th className="px-4 py-3 font-medium text-right">Deal Value</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {leads.map((lead) => {
                  const stageInfo = getStageInfo(lead.pipeline_stage);
                  const overdue = isOverdue(lead.follow_up_at);
                  return (
                    <tr key={lead.id} className={cn("hover:bg-gray-50", overdue && "bg-red-50/50")}>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-semibold text-gray-900">{lead.contact_person || 'Unknown'}</p>
                          <p className="text-xs text-gray-500 flex items-center gap-1">
                            <Building2 className="h-3 w-3" />{lead.firm_name}
                          </p>
                          <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                            <Phone className="h-3 w-3" />{lead.phone_number}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-700 font-medium">{lead.agent_name}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold', stageInfo.badge)}>
                          {stageInfo.short}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {lead.follow_up_at ? (
                          <span className={cn(
                            'text-xs font-medium flex items-center gap-1',
                            overdue ? 'text-red-600' : 'text-gray-600'
                          )}>
                            <Calendar className="h-3 w-3" />
                            {overdue && <AlertTriangle className="h-3 w-3" />}
                            {new Date(lead.follow_up_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">Not set</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {lead.deal_value != null && lead.deal_value > 0 ? (
                          <span className="text-sm font-bold text-emerald-600">${Number(lead.deal_value).toLocaleString()}</span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-gray-500 truncate max-w-[200px]">{lead.pipeline_notes || lead.call_notes || '—'}</p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Agent Breakdown */}
      {agentBreakdown.length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Agent Pipeline Summary</h3>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {agentBreakdown.map(a => (
              <div
                key={a.id}
                onClick={() => setSelectedAgent(selectedAgent === String(a.id) ? '' : String(a.id))}
                className={cn(
                  'flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all hover:shadow-sm',
                  selectedAgent === String(a.id) ? 'ring-2 ring-indigo-500 border-indigo-300 bg-indigo-50' : 'bg-gray-50'
                )}
              >
                <div>
                  <p className="text-sm font-semibold text-gray-900">{a.full_name}</p>
                  <p className="text-xs text-gray-500">{a.lead_count} leads</p>
                </div>
                {Number(a.total_value) > 0 && (
                  <span className="text-sm font-bold text-emerald-600">${Number(a.total_value).toLocaleString()}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
