'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils';
import { Plus, Search, Edit, Trash2, X, Clock, DollarSign, Target, UserCheck, UserX } from 'lucide-react';

interface AgentForm {
  username: string;
  password: string;
  full_name: string;
  extension_number: string;
  base_salary: string;
  sales_target: string;
  shift_start: string;
  shift_end: string;
  employment_type: 'full_time' | 'part_time';
}

interface Agent {
  id: number;
  username: string;
  full_name: string;
  extension_number: string;
  base_salary: number;
  sales_target: number;
  shift_start: string;
  shift_end: string;
  employment_type: string;
  is_active: boolean;
  created_at: string;
  todayAttendance: { status: string; checkInTime: string } | null;
}

const initialFormState: AgentForm = {
  username: '',
  password: '',
  full_name: '',
  extension_number: '',
  base_salary: '',
  sales_target: '0',
  shift_start: '21:00',
  shift_end: '05:00',
  employment_type: 'full_time',
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [form, setForm] = useState<AgentForm>(initialFormState);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingAgent, setDeletingAgent] = useState<Agent | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchAgents = async () => {
    try {
      const response = await api.getAgents();
      if (response.data) {
        setAgents(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch agents:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  // Open Create Modal
  const openCreateModal = () => {
    setModalMode('create');
    setForm(initialFormState);
    setEditingAgent(null);
    setError('');
    setShowModal(true);
  };

  // Open Edit Modal
  const openEditModal = (agent: Agent) => {
    setModalMode('edit');
    setEditingAgent(agent);
    setForm({
      username: agent.username,
      password: '', // Don't pre-fill password
      full_name: agent.full_name,
      extension_number: agent.extension_number,
      base_salary: String(agent.base_salary),
      sales_target: String(agent.sales_target || 0),
      shift_start: agent.shift_start?.slice(0, 5) || '21:00',
      shift_end: agent.shift_end?.slice(0, 5) || '05:00',
      employment_type: agent.employment_type as 'full_time' | 'part_time',
    });
    setError('');
    setShowModal(true);
  };

  // Close Modal
  const closeModal = () => {
    setShowModal(false);
    setForm(initialFormState);
    setEditingAgent(null);
    setError('');
  };

  // Handle Create/Update
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      if (modalMode === 'create') {
        // Validate required fields for create
        if (!form.username || !form.password || !form.full_name || !form.extension_number || !form.base_salary) {
          setError('Please fill in all required fields');
          setSubmitting(false);
          return;
        }

        const response = await api.createAgent({
          username: form.username,
          password: form.password,
          full_name: form.full_name,
          extension_number: form.extension_number,
          base_salary: parseFloat(form.base_salary),
          sales_target: parseFloat(form.sales_target) || 0,
          shift_start: form.shift_start + ':00',
          shift_end: form.shift_end + ':00',
          employment_type: form.employment_type,
        });

        if (response.status === 'success') {
          closeModal();
          fetchAgents();
        } else {
          setError(response.message || 'Failed to create agent');
        }
      } else if (modalMode === 'edit' && editingAgent) {
        // Build update payload (only include changed fields)
        const updateData: any = {};
        
        if (form.full_name !== editingAgent.full_name) updateData.full_name = form.full_name;
        if (form.username !== editingAgent.username) updateData.username = form.username;
        if (form.password) updateData.password = form.password; // Only if new password provided
        if (form.extension_number !== editingAgent.extension_number) updateData.extension_number = form.extension_number;
        if (parseFloat(form.base_salary) !== editingAgent.base_salary) updateData.base_salary = parseFloat(form.base_salary);
        if (parseFloat(form.sales_target) !== (editingAgent.sales_target || 0)) updateData.sales_target = parseFloat(form.sales_target) || 0;
        if (form.shift_start + ':00' !== editingAgent.shift_start) updateData.shift_start = form.shift_start + ':00';
        if (form.shift_end + ':00' !== editingAgent.shift_end) updateData.shift_end = form.shift_end + ':00';
        if (form.employment_type !== editingAgent.employment_type) updateData.employment_type = form.employment_type;

        const response = await api.updateAgent(editingAgent.id, updateData);

        if (response.status === 'success') {
          closeModal();
          fetchAgents();
        } else {
          setError(response.message || 'Failed to update agent');
        }
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Delete (Soft Delete)
  const handleDelete = async () => {
    if (!deletingAgent) return;
    
    setDeleting(true);
    try {
      const response = await api.deleteAgent(deletingAgent.id);
      if (response.status === 'success') {
        setShowDeleteConfirm(false);
        setDeletingAgent(null);
        fetchAgents();
      } else {
        alert(response.message || 'Failed to deactivate agent');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to deactivate agent');
    } finally {
      setDeleting(false);
    }
  };

  // Toggle agent active status
  const toggleAgentStatus = async (agent: Agent) => {
    try {
      const response = await api.updateAgent(agent.id, { is_active: !agent.is_active });
      if (response.status === 'success') {
        fetchAgents();
      }
    } catch (err) {
      console.error('Failed to toggle agent status:', err);
    }
  };

  const filteredAgents = agents.filter(
    (agent) =>
      agent.full_name.toLowerCase().includes(search.toLowerCase()) ||
      agent.extension_number.includes(search) ||
      agent.username.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">👥 Manage Agents</h1>
          <p className="text-gray-500">View and manage sales team members</p>
        </div>
        <Button onClick={openCreateModal} className="bg-indigo-600 hover:bg-indigo-700">
          <Plus className="h-4 w-4 mr-2" />
          Add Agent
        </Button>
      </div>

      {/* Search & Filters */}
      <div className="flex gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search by name, username, or extension..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="text-sm text-gray-500 flex items-center gap-2">
          <span className="bg-green-100 text-green-700 px-2 py-1 rounded-full text-xs">
            {agents.filter(a => a.is_active).length} Active
          </span>
          <span className="bg-red-100 text-red-700 px-2 py-1 rounded-full text-xs">
            {agents.filter(a => !a.is_active).length} Inactive
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead>Agent</TableHead>
                <TableHead>Extension</TableHead>
                <TableHead>Shift Timing</TableHead>
                <TableHead>Base Salary</TableHead>
                <TableHead>
                  <div className="flex items-center gap-1">
                    <Target className="h-3.5 w-3.5 text-amber-500" />
                    Sales Target
                  </div>
                </TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAgents.map((agent) => (
                <TableRow 
                  key={agent.id} 
                  className={!agent.is_active ? 'bg-gray-50 opacity-60' : ''}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                        agent.is_active 
                          ? 'bg-indigo-100 text-indigo-600' 
                          : 'bg-gray-200 text-gray-500'
                      }`}>
                        <span className="font-bold text-sm">
                          {agent.full_name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{agent.full_name}</p>
                        <p className="text-xs text-gray-500">@{agent.username}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono bg-gray-100 px-2.5 py-1 rounded text-sm">
                      {agent.extension_number}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm text-gray-600">
                      <Clock className="h-3.5 w-3.5 text-gray-400" />
                      <span>
                        {agent.shift_start?.slice(0, 5)} - {agent.shift_end?.slice(0, 5)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{formatCurrency(agent.base_salary)}</span>
                  </TableCell>
                  <TableCell>
                    {agent.sales_target > 0 ? (
                      <div className="flex items-center gap-1">
                        <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded-full text-xs font-medium">
                          ${agent.sales_target.toLocaleString()}
                        </span>
                        <span className="text-xs text-gray-400">🎫</span>
                      </div>
                    ) : (
                      <span className="text-gray-400 text-sm">Not set</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => toggleAgentStatus(agent)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                        agent.is_active
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-red-100 text-red-700 hover:bg-red-200'
                      }`}
                    >
                      {agent.is_active ? (
                        <>
                          <UserCheck className="h-3 w-3" />
                          Active
                        </>
                      ) : (
                        <>
                          <UserX className="h-3 w-3" />
                          Inactive
                        </>
                      )}
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => openEditModal(agent)}
                        className="h-8 w-8 p-0"
                      >
                        <Edit className="h-4 w-4 text-gray-500" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => {
                          setDeletingAgent(agent);
                          setShowDeleteConfirm(true);
                        }}
                        className="h-8 w-8 p-0"
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {!loading && filteredAgents.length === 0 && (
          <div className="p-8 text-center text-gray-500">
            No agents found matching your search.
          </div>
        )}
      </div>

      {/* Create/Edit Agent Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white rounded-t-2xl">
              <h2 className="text-xl font-semibold text-gray-900">
                {modalMode === 'create' ? '➕ Add New Agent' : '✏️ Edit Agent'}
              </h2>
              <button
                onClick={closeModal}
                className="p-2 hover:bg-gray-100 rounded-lg transition"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmit} className="p-5 space-y-5">
              {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-100">
                  {error}
                </div>
              )}

              {/* Personal Information */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                  Personal Information
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Full Name <span className="text-red-500">*</span>
                    </label>
                    <Input
                      value={form.full_name}
                      onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                      placeholder="Ahmed Khan"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Username <span className="text-red-500">*</span>
                    </label>
                    <Input
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      placeholder="ahmed.khan"
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Password {modalMode === 'create' ? <span className="text-red-500">*</span> : <span className="text-gray-400">(leave blank to keep)</span>}
                    </label>
                    <Input
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="••••••••"
                      required={modalMode === 'create'}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Extension (3CX) <span className="text-red-500">*</span>
                    </label>
                    <Input
                      value={form.extension_number}
                      onChange={(e) => setForm({ ...form, extension_number: e.target.value })}
                      placeholder="102"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Shift Timing */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Shift Timing
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Shift Start (PKT) <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="time"
                      value={form.shift_start}
                      onChange={(e) => setForm({ ...form, shift_start: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Shift End (PKT) <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="time"
                      value={form.shift_end}
                      onChange={(e) => setForm({ ...form, shift_end: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  💡 For overnight shifts (e.g., 9 PM - 5 AM), enter start as 21:00 and end as 05:00
                </p>
              </div>

              {/* Financial */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Financial
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Base Salary (PKR) <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="number"
                      value={form.base_salary}
                      onChange={(e) => setForm({ ...form, base_salary: e.target.value })}
                      placeholder="50000"
                      min="0"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Employment Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={form.employment_type}
                      onChange={(e) => setForm({ ...form, employment_type: e.target.value as 'full_time' | 'part_time' })}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      required
                    >
                      <option value="full_time">Full Time</option>
                      <option value="part_time">Part Time</option>
                    </select>
                  </div>
                </div>

                {/* Golden Ticket - Sales Target */}
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <label className="flex items-center gap-2 text-sm font-medium text-amber-800 mb-2">
                    <Target className="h-4 w-4" />
                    🎫 Golden Ticket - Sales Target (USD)
                  </label>
                  <Input
                    type="number"
                    value={form.sales_target}
                    onChange={(e) => setForm({ ...form, sales_target: e.target.value })}
                    placeholder="2000"
                    min="0"
                    className="bg-white"
                  />
                  <p className="text-xs text-amber-700 mt-2">
                    💡 If agent achieves this sales target, they get 100% base salary regardless of calls, talk time, or attendance.
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={closeModal}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700" 
                  disabled={submitting}
                >
                  {submitting ? 'Saving...' : modalMode === 'create' ? 'Create Agent' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && deletingAgent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <div className="text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
                <Trash2 className="h-6 w-6 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Deactivate Agent?
              </h3>
              <p className="text-gray-500 mb-6">
                Are you sure you want to deactivate <strong>{deletingAgent.full_name}</strong>? 
                They will no longer be able to log in, but their historical data will be preserved.
              </p>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeletingAgent(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-red-600 hover:bg-red-700"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? 'Deactivating...' : 'Deactivate'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
