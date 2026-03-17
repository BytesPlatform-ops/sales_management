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
  Phone,
  BarChart3,
  RefreshCw,
  Recycle,
  Flame,
  Skull,
  Clock,
  Trash2,
  Zap,
} from 'lucide-react';

interface Batch {
  id: number;
  file_name: string;
  total_leads: number;
  leads_per_agent: number;
  distributed: boolean;
  created_at: string;
  uploaded_by_name: string;
  actual_leads: string;
  assigned_leads: string;
  called_leads: string;
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

  // Delete state
  const [deletingBatchId, setDeletingBatchId] = useState<number | null>(null);

  // Distribution state
  const [distributing, setDistributing] = useState(false);
  const [leadsPerAgent, setLeadsPerAgent] = useState(200);
  const [selectedAgents, setSelectedAgents] = useState<number[]>([]);
  const [distributionResult, setDistributionResult] = useState<DistributionResult[] | null>(null);

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
        setLeadsPerAgent(settingsData.data.leads_per_agent || 200);
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
      formData.append('leads_per_agent', leadsPerAgent.toString());

      const res = await fetch('/api/hr/dialer-leads/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json();

      if (data.status === 'success') {
        setUploadResult({ type: 'success', message: data.message });
        setSelectedFile(null);
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
          leads_per_agent: leadsPerAgent,
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
        setLeadsPerAgent(data.data.leads_per_agent);
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads Management</h1>
          <p className="text-gray-500 mt-1">Upload CSV files and distribute leads to agents</p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-white border rounded-lg hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Pool Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <StatCard label="Total" value={parseInt(stats.total_leads || '0')} icon={FileSpreadsheet} color="blue" />
          <StatCard label="Fresh" value={parseInt(stats.fresh || '0')} icon={Upload} color="blue" />
          <StatCard label="Active" value={parseInt(stats.active || '0')} icon={Phone} color="green" />
          <StatCard label="Interested" value={parseInt(stats.interested || '0')} icon={Flame} color="emerald" />
          <StatCard label="Recycle" value={parseInt(stats.recycle || '0')} icon={Recycle} color="yellow" />
          <StatCard label="Callback" value={parseInt(stats.callback || '0')} icon={Clock} color="cyan" />
          <StatCard label="Dead" value={parseInt(stats.dead || '0')} icon={Skull} color="gray" />
        </div>
      )}

      {/* Alert Messages */}
      {uploadResult && (
        <div
          className={`flex items-center gap-3 p-4 rounded-lg border ${
            uploadResult.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {uploadResult.type === 'success' ? (
            <CheckCircle className="h-5 w-5 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
          )}
          <p>{uploadResult.message}</p>
          <button
            onClick={() => setUploadResult(null)}
            className="ml-auto text-sm underline opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload CSV Section */}
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Upload className="h-5 w-5 text-blue-600" />
            Upload CSV
          </h2>

          <div className="space-y-4">
            <div>
              <label htmlFor="csv-file" className="block text-sm font-medium text-gray-700 mb-2">
                Select CSV File
              </label>
              <input
                id="csv-file"
                type="file"
                accept=".csv"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
              />
              {selectedFile && (
                <p className="text-sm text-gray-500 mt-1">
                  Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Leads Per Agent (daily limit)
              </label>
              <input
                type="number"
                value={leadsPerAgent}
                onChange={(e) => setLeadsPerAgent(parseInt(e.target.value) || 200)}
                min={1}
                max={1000}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <button
              onClick={handleUpload}
              disabled={!selectedFile || uploading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Upload & Parse CSV
                </>
              )}
            </button>
          </div>
        </div>

        {/* Distribute Section */}
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <Send className="h-5 w-5 text-purple-600" />
            Distribute Leads
          </h2>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Select Agents ({selectedAgents.length}/{agents.length})
                </label>
                <button
                  onClick={selectAllAgents}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  {selectedAgents.length === agents.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              <div className="max-h-48 overflow-y-auto border rounded-lg p-2 space-y-1">
                {agents.length === 0 ? (
                  <p className="text-sm text-gray-400 p-2">No active agents found</p>
                ) : (
                  agents.map((agent) => (
                    <label
                      key={agent.id}
                      className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedAgents.includes(agent.id)}
                        onChange={() => toggleAgent(agent.id)}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">{agent.full_name}</span>
                    </label>
                  ))
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Leave empty to distribute to all active agents
              </p>
            </div>

            <button
              onClick={handleDistribute}
              disabled={distributing || !stats || (parseInt(stats.fresh || '0') + parseInt(stats.recycle || '0') + parseInt(stats.callback || '0')) === 0}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {distributing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Distributing...
                </>
              ) : (
                <>
                  <Users className="h-4 w-4" />
                  Distribute {leadsPerAgent}/agent
                </>
              )}
            </button>

            {/* Distribution Result */}
            {distributionResult && distributionResult.length > 0 && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                <p className="text-sm font-medium text-purple-800 mb-2">Distribution Complete:</p>
                <div className="space-y-1">
                  {distributionResult.map((r, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-purple-700">{r.agent}</span>
                      <span className="font-medium text-purple-900">{r.count} leads</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Auto-Distribution Settings */}
      {distSettings && (
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Zap className="h-5 w-5 text-orange-600" />
              Auto-Distribution
            </h2>
            <button
              onClick={() => handleSaveSettings({ auto_distribute_enabled: !distSettings.auto_distribute_enabled })}
              disabled={savingSettings}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                distSettings.auto_distribute_enabled ? 'bg-green-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  distSettings.auto_distribute_enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <p className="text-sm text-gray-500 mb-4">
            {distSettings.auto_distribute_enabled
              ? 'Leads will be auto-distributed to all active agents daily at the configured time.'
              : 'Enable to automatically distribute leads daily. You can still distribute manually anytime.'}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Leads Per Agent</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={distSettings.leads_per_agent}
                  onChange={(e) => setDistSettings({ ...distSettings, leads_per_agent: parseInt(e.target.value) || 200 })}
                  min={1}
                  max={1000}
                  className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                />
                <button
                  onClick={() => handleSaveSettings({ leads_per_agent: distSettings.leads_per_agent })}
                  disabled={savingSettings}
                  className="px-3 py-2 bg-orange-600 text-white text-sm rounded-lg hover:bg-orange-700 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Change anytime — next auto-distribute uses this number</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Daily Time (PKT)</label>
              <div className="flex gap-2">
                <input
                  type="time"
                  value={distSettings.auto_distribute_time}
                  onChange={(e) => setDistSettings({ ...distSettings, auto_distribute_time: e.target.value })}
                  className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                />
                <button
                  onClick={() => handleSaveSettings({ auto_distribute_time: distSettings.auto_distribute_time })}
                  disabled={savingSettings}
                  className="px-3 py-2 bg-orange-600 text-white text-sm rounded-lg hover:bg-orange-700 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">System checks every minute and distributes at this time</p>
            </div>
          </div>

          {distSettings.last_auto_distributed_at && (
            <p className="text-xs text-gray-400 mt-3">
              Last auto-distributed: {new Date(distSettings.last_auto_distributed_at).toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi'
              })} PKT
            </p>
          )}
        </div>
      )}

      {/* Upload History */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
          <BarChart3 className="h-5 w-5 text-gray-600" />
          Upload History
        </h2>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : batches.length === 0 ? (
          <div className="text-center py-12">
            <FileSpreadsheet className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No CSV files uploaded yet</p>
            <p className="text-sm text-gray-400">Upload your first CSV above to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-3 font-medium">File</th>
                  <th className="pb-3 font-medium">Uploaded By</th>
                  <th className="pb-3 font-medium text-center">Total</th>
                  <th className="pb-3 font-medium text-center">Assigned</th>
                  <th className="pb-3 font-medium text-center">Called</th>
                  <th className="pb-3 font-medium text-center">Per Agent</th>
                  <th className="pb-3 font-medium">Date</th>
                  <th className="pb-3 font-medium text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {batches.map((batch) => (
                  <tr key={batch.id} className="hover:bg-gray-50">
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4 text-green-600" />
                        <span className="font-medium text-gray-900 truncate max-w-[200px]">
                          {batch.file_name}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 text-gray-600">{batch.uploaded_by_name || 'Unknown'}</td>
                    <td className="py-3 text-center font-medium">{batch.actual_leads}</td>
                    <td className="py-3 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {batch.assigned_leads}
                      </span>
                    </td>
                    <td className="py-3 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        {batch.called_leads}
                      </span>
                    </td>
                    <td className="py-3 text-center text-gray-600">{batch.leads_per_agent}</td>
                    <td className="py-3 text-gray-500">
                      {new Date(batch.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-3 text-center">
                      <button
                        onClick={() => handleDeleteBatch(batch.id, batch.file_name)}
                        disabled={deletingBatchId === batch.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {deletingBatchId === batch.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
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

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    green: 'bg-green-50 text-green-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    cyan: 'bg-cyan-50 text-cyan-600',
    gray: 'bg-gray-100 text-gray-500',
  };

  return (
    <div className="bg-white rounded-xl border p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colorMap[color] || colorMap.blue}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</p>
          <p className="text-sm text-gray-500">{label}</p>
        </div>
      </div>
    </div>
  );
}
