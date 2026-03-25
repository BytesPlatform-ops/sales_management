'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api-client';
import {
  Upload,
  FileSpreadsheet,
  Users,
  Send,
  CheckCircle,
  AlertCircle,
  Loader2,
  BarChart3,
  RefreshCw,
  Recycle,
  Trash2,
  Zap,
} from 'lucide-react';

interface Batch {
  id: number;
  file_name: string;
  total_leads: number;
  distributed: boolean;
  created_at: string;
  uploaded_by_name: string;
  actual_leads: string;
  assigned_leads: string;
  called_leads: string;
  state: string | null;
}

interface Stats {
  total_leads: string;
  fresh: string;
  active: string;
  interested: string;
  recycle: string;
  callback: string;
  dead: string;
  called: string;
}

interface Agent {
  id: number;
  full_name: string;
  is_active: boolean;
}

interface DistributionResult {
  agent: string;
  count: number;
}

interface DistSettings {
  leads_per_agent: number;
  auto_distribute_enabled: boolean;
  auto_distribute_time: string;
  last_auto_distributed_at: string | null;
  has_cron_secret: boolean;
  cron_secret?: string;
}

export default function DialerLeadsPage() {
  const { user } = useAuth();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedState, setSelectedState] = useState<string>('');

  // Delete state
  const [deletingBatchId, setDeletingBatchId] = useState<number | null>(null);

  // Distribution state
  const [distributing, setDistributing] = useState(false);
  const [manualLeadsPerAgent, setManualLeadsPerAgent] = useState(200);
  const [selectedAgents, setSelectedAgents] = useState<number[]>([]);
  const [distributionResult, setDistributionResult] = useState<DistributionResult[] | null>(null);

  // Recall state
  const [recalling, setRecalling] = useState(false);
  const [recallKeepCount, setRecallKeepCount] = useState(50);
  const [recallAgentId, setRecallAgentId] = useState<number | null>(null);
  const [recallResult, setRecallResult] = useState<{ agent: string; recalled: number; kept: number }[] | null>(null);

  // Auto-distribution settings state
  const [distSettings, setDistSettings] = useState<DistSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const token = api.getToken();
      if (!token) return;

      const [batchesRes, agentsRes, settingsRes] = await Promise.all([
        fetch('/api/hr/dialer-leads/batches', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/hr/agents', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/hr/dialer-leads/settings', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const batchesData = await batchesRes.json();
      const agentsData = await agentsRes.json();
      const settingsData = await settingsRes.json();

      if (batchesData.status === 'success') {
        setBatches(batchesData.data.batches);
        setStats(batchesData.data.stats);
      }

      if (agentsData.status === 'success') {
        setAgents(agentsData.data.filter((a: Agent) => a.is_active));
      }

      if (settingsData.status === 'success') {
        setDistSettings(settingsData.data);
        setManualLeadsPerAgent(settingsData.data.leads_per_agent || 200);
      }
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setUploadResult(null);

    try {
      const token = api.getToken();
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('state', selectedState);

      const res = await fetch('/api/hr/dialer-leads/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json();

      if (data.status === 'success') {
        setUploadResult({ type: 'success', message: data.message });
        setSelectedFile(null);
        setSelectedState('');
        // Reset file input
        const fileInput = document.getElementById('csv-file') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
        fetchData();
      } else {
        setUploadResult({ type: 'error', message: data.message });
      }
    } catch (err) {
      setUploadResult({ type: 'error', message: 'Upload failed. Please try again.' });
    } finally {
      setUploading(false);
    }
  };

  const handleDistribute = async () => {
    setDistributing(true);
    setDistributionResult(null);

    try {
      const token = api.getToken();
      const res = await fetch('/api/hr/dialer-leads/distribute', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          leads_per_agent: manualLeadsPerAgent,
          agent_ids: selectedAgents.length > 0 ? selectedAgents : undefined,
        }),
      });

      const data = await res.json();

      if (data.status === 'success') {
        setDistributionResult(data.data.breakdown || []);
        setUploadResult({ type: 'success', message: data.message });
        fetchData();
      } else {
        setUploadResult({ type: 'error', message: data.message });
      }
    } catch (err) {
      setUploadResult({ type: 'error', message: 'Distribution failed.' });
    } finally {
      setDistributing(false);
    }
  };

  const toggleAgent = (agentId: number) => {
    setSelectedAgents((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]
    );
  };

  const handleDeleteBatch = async (batchId: number, fileName: string) => {
    if (!confirm(`Delete "${fileName}" and all its leads? This cannot be undone.`)) return;
    setDeletingBatchId(batchId);
    try {
      const token = api.getToken();
      const res = await fetch('/api/hr/dialer-leads/batches/delete', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: batchId }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setUploadResult({ type: 'success', message: data.message });
        fetchData();
      } else {
        setUploadResult({ type: 'error', message: data.message });
      }
    } catch (err) {
      setUploadResult({ type: 'error', message: 'Failed to delete batch.' });
    } finally {
      setDeletingBatchId(null);
    }
  };

  const selectAllAgents = () => {
    if (selectedAgents.length === agents.length) {
      setSelectedAgents([]);
    } else {
      setSelectedAgents(agents.map((a) => a.id));
    }
  };

  const handleRecall = async () => {
    if (!confirm(`Recall leads? Each agent will keep only ${recallKeepCount} pending leads. Extra leads return to fresh pool.`)) return;
    setRecalling(true);
    setRecallResult(null);
    try {
      const token = api.getToken();
      const res = await fetch('/api/hr/dialer-leads/recall', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keep_count: recallKeepCount,
          agent_id: recallAgentId || undefined,
        }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setRecallResult(data.data.breakdown);
        setUploadResult({ type: 'success', message: data.message });
        fetchData();
      } else {
        setUploadResult({ type: 'error', message: data.message });
      }
    } catch {
      setUploadResult({ type: 'error', message: 'Failed to recall leads.' });
    } finally {
      setRecalling(false);
    }
  };

  const handleSaveSettings = async (updates: Partial<DistSettings & { regenerate_secret?: boolean }>) => {
    setSavingSettings(true);
    try {
      const token = api.getToken();
      const res = await fetch('/api/hr/dialer-leads/settings', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setDistSettings(data.data);
        setManualLeadsPerAgent(data.data.leads_per_agent);
        setUploadResult({ type: 'success', message: data.message });
      } else {
        setUploadResult({ type: 'error', message: data.message });
      }
    } catch {
      setUploadResult({ type: 'error', message: 'Failed to save settings.' });
    } finally {
      setSavingSettings(false);
    }
  };


  if (!user || user.role !== 'hr') {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Access denied. HR only.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">Upload, distribute, and manage dialer leads</p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {/* Pool Stats — compact inline */}
      {stats && (
        <div className="grid grid-cols-7 gap-2">
          {[
            { label: 'Total', value: stats.total_leads, color: 'bg-slate-50 border-slate-200', text: 'text-slate-700' },
            { label: 'Fresh', value: stats.fresh, color: 'bg-blue-50 border-blue-200', text: 'text-blue-700' },
            { label: 'Active', value: stats.active, color: 'bg-green-50 border-green-200', text: 'text-green-700' },
            { label: 'Interested', value: stats.interested, color: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
            { label: 'Recycle', value: stats.recycle, color: 'bg-amber-50 border-amber-200', text: 'text-amber-700' },
            { label: 'Callback', value: stats.callback, color: 'bg-cyan-50 border-cyan-200', text: 'text-cyan-700' },
            { label: 'Dead', value: stats.dead, color: 'bg-gray-50 border-gray-200', text: 'text-gray-500' },
          ].map((s) => (
            <div key={s.label} className={`${s.color} border rounded-lg px-3 py-2.5 text-center`}>
              <p className={`text-xl font-bold ${s.text}`}>{parseInt(s.value || '0').toLocaleString()}</p>
              <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Alert Messages */}
      {uploadResult && (
        <div
          className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm ${
            uploadResult.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {uploadResult.type === 'success' ? (
            <CheckCircle className="h-4 w-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
          )}
          <p className="flex-1">{uploadResult.message}</p>
          <button onClick={() => setUploadResult(null)} className="text-xs underline opacity-60 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      {/* Upload + Distribute — matched height */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Upload CSV — 2 cols */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5 flex flex-col">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 uppercase tracking-wide">
            <div className="p-1.5 bg-blue-100 rounded-md"><Upload className="h-4 w-4 text-blue-600" /></div>
            Upload CSV
          </h2>

          <div className="space-y-3 flex-1 flex flex-col">
            <div>
              <label htmlFor="csv-file" className="block text-xs font-medium text-gray-500 mb-1.5">CSV File</label>
              <input
                id="csv-file"
                type="file"
                accept=".csv"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
              />
              {selectedFile && (
                <p className="text-xs text-gray-400 mt-1">{selectedFile.name} ({(selectedFile.size / 1024).toFixed(0)} KB)</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">US State</label>
              <select
                value={selectedState}
                onChange={(e) => setSelectedState(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select State...</option>
                <option value="FL">Florida (FL) — Eastern</option>
                <option value="TX">Texas (TX) — Central</option>
                <option value="CA">California (CA) — Pacific</option>
              </select>
              <p className="text-[11px] text-gray-400 mt-1">Routed to agents based on optimal call times</p>
            </div>

            <div className="flex-1" />

            <button
              onClick={handleUpload}
              disabled={!selectedFile || !selectedState || uploading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm transition-colors"
            >
              {uploading ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading...</> : <><Upload className="h-4 w-4" /> Upload & Parse CSV</>}
            </button>
          </div>
        </div>

        {/* Distribute — 3 cols */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 uppercase tracking-wide">
              <div className="p-1.5 bg-purple-100 rounded-md"><Send className="h-4 w-4 text-purple-600" /></div>
              Distribute Leads
            </h2>
            <button onClick={selectAllAgents} className="text-xs text-purple-600 hover:text-purple-800 font-medium">
              {selectedAgents.length === agents.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          <div className="flex-1 flex flex-col gap-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 border border-gray-200 rounded-lg p-2 max-h-[140px] overflow-y-auto">
              {agents.length === 0 ? (
                <p className="text-xs text-gray-400 p-2 col-span-3">No active agents</p>
              ) : (
                agents.map((agent) => (
                  <label
                    key={agent.id}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer text-sm transition-colors ${
                      selectedAgents.includes(agent.id) ? 'bg-purple-50 text-purple-700' : 'hover:bg-gray-50 text-gray-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedAgents.includes(agent.id)}
                      onChange={() => toggleAgent(agent.id)}
                      className="rounded text-purple-600 focus:ring-purple-500 h-3.5 w-3.5"
                    />
                    <span className="text-xs font-medium truncate">{agent.full_name}</span>
                  </label>
                ))
              )}
            </div>
            <p className="text-[11px] text-gray-400 -mt-1">Leave empty to distribute to all active agents</p>

            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Leads Per Agent</label>
                <input
                  type="number"
                  value={manualLeadsPerAgent}
                  onChange={(e) => setManualLeadsPerAgent(parseInt(e.target.value) || 50)}
                  min={1}
                  max={5000}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
              </div>
              <button
                onClick={handleDistribute}
                disabled={distributing || !stats || (parseInt(stats.fresh || '0') + parseInt(stats.recycle || '0') + parseInt(stats.callback || '0')) === 0}
                className="flex items-center justify-center gap-2 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm whitespace-nowrap transition-colors"
              >
                {distributing ? <><Loader2 className="h-4 w-4 animate-spin" /> Distributing...</> : <><Users className="h-4 w-4" /> Distribute {manualLeadsPerAgent}/agent</>}
              </button>
            </div>

            {/* Distribution Result */}
            {distributionResult && distributionResult.length > 0 && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-purple-800 mb-2">Distribution Complete:</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                  {distributionResult.map((r, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-purple-700">{r.agent}</span>
                      <span className="font-semibold text-purple-900">{r.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recall + Auto-Distribution — side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recall Leads */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-3 uppercase tracking-wide">
            <div className="p-1.5 bg-red-100 rounded-md"><Recycle className="h-4 w-4 text-red-600" /></div>
            Recall Leads
          </h2>
          <p className="text-xs text-gray-400 mb-3">Recall excess pending leads back to fresh pool</p>

          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Agent</label>
              <select
                value={recallAgentId ?? ''}
                onChange={(e) => setRecallAgentId(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
              >
                <option value="">All Agents</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.full_name}</option>
                ))}
              </select>
            </div>

            <div className="w-24">
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Keep</label>
              <input
                type="number"
                value={recallKeepCount}
                onChange={(e) => setRecallKeepCount(parseInt(e.target.value) || 0)}
                min={0}
                max={5000}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
              />
            </div>

            <button
              onClick={handleRecall}
              disabled={recalling}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm whitespace-nowrap transition-colors"
            >
              {recalling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Recycle className="h-4 w-4" />}
              Recall
            </button>
          </div>

          {recallResult && recallResult.length > 0 && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-2.5">
              <div className="space-y-0.5">
                {recallResult.map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-red-700">{r.agent}</span>
                    <span className="font-medium text-red-900">
                      {r.recalled > 0 ? `${r.recalled} recalled, ${r.kept} kept` : `${r.kept} kept`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Auto-Distribution */}
        {distSettings && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 uppercase tracking-wide">
                <div className="p-1.5 bg-amber-100 rounded-md"><Zap className="h-4 w-4 text-amber-600" /></div>
                Auto-Distribution
              </h2>
              <button
                onClick={() => handleSaveSettings({ auto_distribute_enabled: !distSettings.auto_distribute_enabled })}
                disabled={savingSettings}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  distSettings.auto_distribute_enabled ? 'bg-green-500' : 'bg-gray-300'
                }`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  distSettings.auto_distribute_enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                }`} />
              </button>
            </div>

            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Leads Per Agent</label>
                <input
                  type="number"
                  value={distSettings.leads_per_agent}
                  onChange={(e) => setDistSettings({ ...distSettings, leads_per_agent: parseInt(e.target.value) || 200 })}
                  min={1}
                  max={1000}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
              </div>

              <div className="flex-1">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Daily Time (PKT)</label>
                <input
                  type="time"
                  value={distSettings.auto_distribute_time}
                  onChange={(e) => setDistSettings({ ...distSettings, auto_distribute_time: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
              </div>

              <button
                onClick={() => handleSaveSettings({ leads_per_agent: distSettings.leads_per_agent, auto_distribute_time: distSettings.auto_distribute_time })}
                disabled={savingSettings}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 font-medium text-sm whitespace-nowrap transition-colors"
              >
                {savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                Save
              </button>
            </div>

            {distSettings.last_auto_distributed_at && (
              <p className="text-[11px] text-gray-400 mt-2.5">
                Last run: {new Date(distSettings.last_auto_distributed_at).toLocaleString('en-US', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi'
                })} PKT
              </p>
            )}
          </div>
        )}
      </div>

      {/* Upload History */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 uppercase tracking-wide">
          <div className="p-1.5 bg-gray-100 rounded-md"><BarChart3 className="h-4 w-4 text-gray-600" /></div>
          Upload History
        </h2>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : batches.length === 0 ? (
          <div className="text-center py-10">
            <FileSpreadsheet className="h-10 w-10 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No CSV files uploaded yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left">
                  <th className="pb-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">File</th>
                  <th className="pb-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">State</th>
                  <th className="pb-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Uploaded By</th>
                  <th className="pb-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide text-right">Total</th>
                  <th className="pb-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide text-right">Assigned</th>
                  <th className="pb-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide text-right">Called</th>
                  <th className="pb-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Date</th>
                  <th className="pb-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {batches.map((batch) => (
                  <tr key={batch.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4 text-green-600 flex-shrink-0" />
                        <span className="font-medium text-gray-900 truncate max-w-[220px] text-sm">{batch.file_name}</span>
                      </div>
                    </td>
                    <td className="py-2.5">
                      {batch.state ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                          batch.state === 'FL' ? 'bg-orange-100 text-orange-700' :
                          batch.state === 'TX' ? 'bg-red-100 text-red-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {batch.state}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2.5 text-gray-500 text-xs">{batch.uploaded_by_name || 'Unknown'}</td>
                    <td className="py-2.5 text-right font-semibold text-gray-900">{parseInt(batch.actual_leads).toLocaleString()}</td>
                    <td className="py-2.5 text-right">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700">
                        {batch.assigned_leads}
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-green-50 text-green-700">
                        {batch.called_leads}
                      </span>
                    </td>
                    <td className="py-2.5 text-gray-400 text-xs">
                      {new Date(batch.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-2.5 text-center">
                      <button
                        onClick={() => handleDeleteBatch(batch.id, batch.file_name)}
                        disabled={deletingBatchId === batch.id}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
                      >
                        {deletingBatchId === batch.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

