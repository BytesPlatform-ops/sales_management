'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCurrency, formatDateOnly } from '@/lib/utils';
import {
  ArrowLeft,
  Edit,
  X,
  Save,
  CalendarDays,
  Clock,
  Phone,
  Mail,
  CreditCard,
  MapPin,
  HeartPulse,
  Landmark,
  Briefcase,
  UserCheck,
  UserX,
} from 'lucide-react';

interface ActivityStats {
  calls: number;
  talk_time_seconds: number;
  leads: number;
  days_worked: number;
  sales_count: number;
  sales_collected: number;
}

interface AgentProfile {
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
  date_of_joining: string | null;
  date_of_birth: string | null;
  phone: string | null;
  personal_email: string | null;
  cnic: string | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  bank_name: string | null;
  bank_account_title: string | null;
  bank_account_number: string | null;
  summary: {
    attendance_this_month: { on_time: number; late: number; half_day: number; absent: number };
    this_month: ActivityStats;
    lifetime: ActivityStats;
  };
}

const PROFILE_FIELDS = [
  'date_of_joining',
  'date_of_birth',
  'phone',
  'personal_email',
  'cnic',
  'address',
  'emergency_contact_name',
  'emergency_contact_phone',
  'bank_name',
  'bank_account_title',
  'bank_account_number',
] as const;

type ProfileField = (typeof PROFILE_FIELDS)[number];
type ProfileForm = Record<ProfileField, string>;

const toForm = (agent: AgentProfile): ProfileForm =>
  Object.fromEntries(PROFILE_FIELDS.map((f) => [f, agent[f] || ''])) as ProfileForm;

// "1 year, 3 months" style tenure from a YYYY-MM-DD join date
function tenure(joinDate: string): string {
  const start = new Date(`${joinDate}T00:00:00`);
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months--;
  if (months < 0) return 'Starts soon';
  if (months === 0) {
    const days = Math.floor((now.getTime() - start.getTime()) / 86400000);
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  const years = Math.floor(months / 12);
  const rem = months % 12;
  const parts = [];
  if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (rem) parts.push(`${rem} month${rem === 1 ? '' : 's'}`);
  return parts.join(', ');
}

const formatHours = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
};

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <div className="text-sm font-medium text-gray-900 break-words">
          {value || <span className="text-gray-400 font-normal">Not set</span>}
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

export default function AgentProfilePage() {
  const params = useParams<{ id: string }>();
  const agentId = Number(params.id);

  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchAgent = useCallback(async () => {
    try {
      const response = await api.getAgent(agentId);
      if (response.data) setAgent(response.data);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load agent');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchAgent();
  }, [fetchAgent]);

  const startEdit = () => {
    if (!agent) return;
    setForm(toForm(agent));
    setError('');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setForm(null);
    setError('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent || !form) return;
    setSaving(true);
    setError('');

    // Only send changed fields
    const original = toForm(agent);
    const updateData: Partial<ProfileForm> = {};
    for (const f of PROFILE_FIELDS) {
      if (form[f] !== original[f]) updateData[f] = form[f];
    }
    if (Object.keys(updateData).length === 0) {
      cancelEdit();
      setSaving(false);
      return;
    }

    try {
      const response = await api.updateAgent(agent.id, updateData);
      if (response.status === 'success') {
        cancelEdit();
        fetchAgent();
      } else {
        setError(response.message || 'Failed to save');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const input = (field: ProfileField, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Input
      value={form?.[field] ?? ''}
      onChange={(e) => setForm((prev) => (prev ? { ...prev, [field]: e.target.value } : prev))}
      {...props}
    />
  );

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="space-y-4">
        <Link href="/hr/agents" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> Back to agents
        </Link>
        <div className="bg-white rounded-xl border p-8 text-center text-gray-500">
          {loadError || 'Agent not found.'}
        </div>
      </div>
    );
  }

  const { attendance_this_month: att, this_month: month, lifetime } = agent.summary;

  return (
    <div className="space-y-6">
      <Link href="/hr/agents" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Back to agents
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl border shadow-sm p-6 flex flex-col md:flex-row md:items-center gap-5">
        <div
          className={`h-16 w-16 rounded-full flex items-center justify-center shrink-0 ${
            agent.is_active ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-200 text-gray-500'
          }`}
        >
          <span className="font-bold text-2xl">{agent.full_name.charAt(0).toUpperCase()}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{agent.full_name}</h1>
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                agent.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}
            >
              {agent.is_active ? <UserCheck className="h-3 w-3" /> : <UserX className="h-3 w-3" />}
              {agent.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
          <p className="text-gray-500 text-sm">
            @{agent.username} · Ext{' '}
            <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">{agent.extension_number}</span>
          </p>
        </div>
        <div className="md:text-right">
          <p className="text-xs text-gray-500 flex md:justify-end items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" /> Date of Joining
          </p>
          {agent.date_of_joining ? (
            <>
              <p className="text-lg font-semibold text-gray-900">{formatDateOnly(agent.date_of_joining)}</p>
              <p className="text-xs text-gray-500">{tenure(agent.date_of_joining)} with the team</p>
            </>
          ) : (
            <p className="text-sm text-gray-400">Not set</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Personal & account info */}
        <div className="lg:col-span-2 bg-white rounded-xl border shadow-sm">
          <div className="flex items-center justify-between p-5 border-b">
            <h2 className="text-lg font-semibold text-gray-900">Personal & Account Info</h2>
            {!editing && (
              <Button variant="outline" size="sm" onClick={startEdit}>
                <Edit className="h-4 w-4 mr-1.5" /> Edit
              </Button>
            )}
          </div>

          {editing && form ? (
            <form onSubmit={handleSave} className="p-5 space-y-5">
              {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-100">{error}</div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Date of Joining">{input('date_of_joining', { type: 'date' })}</Field>
                <Field label="Date of Birth">{input('date_of_birth', { type: 'date' })}</Field>
                <Field label="Phone">{input('phone', { placeholder: '0300-1234567' })}</Field>
                <Field label="Personal Email">{input('personal_email', { type: 'email', placeholder: 'name@gmail.com' })}</Field>
                <Field label="CNIC">{input('cnic', { placeholder: '35202-1234567-1' })}</Field>
                <Field label="Address" className="sm:col-span-2">{input('address')}</Field>
              </div>

              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Emergency Contact</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Name">{input('emergency_contact_name')}</Field>
                <Field label="Phone">{input('emergency_contact_phone')}</Field>
              </div>

              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Bank Account</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Bank Name">{input('bank_name', { placeholder: 'Meezan Bank' })}</Field>
                <Field label="Account Title">{input('bank_account_title')}</Field>
                <Field label="Account Number / IBAN" className="sm:col-span-2">
                  {input('bank_account_number', { placeholder: 'PK36MEZN0000000000000000' })}
                </Field>
              </div>

              <div className="flex gap-3 pt-4 border-t">
                <Button type="button" variant="outline" className="flex-1" onClick={cancelEdit}>
                  <X className="h-4 w-4 mr-1.5" /> Cancel
                </Button>
                <Button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-700" disabled={saving}>
                  <Save className="h-4 w-4 mr-1.5" /> {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 divide-y sm:divide-y-0">
              <div className="divide-y">
                <InfoRow
                  icon={CalendarDays}
                  label="Date of Joining"
                  value={agent.date_of_joining && formatDateOnly(agent.date_of_joining)}
                />
                <InfoRow
                  icon={CalendarDays}
                  label="Date of Birth"
                  value={agent.date_of_birth && formatDateOnly(agent.date_of_birth)}
                />
                <InfoRow icon={Phone} label="Phone" value={agent.phone} />
                <InfoRow icon={Mail} label="Personal Email" value={agent.personal_email} />
                <InfoRow icon={CreditCard} label="CNIC" value={agent.cnic} />
                <InfoRow icon={MapPin} label="Address" value={agent.address} />
              </div>
              <div className="divide-y">
                <InfoRow
                  icon={HeartPulse}
                  label="Emergency Contact"
                  value={
                    (agent.emergency_contact_name || agent.emergency_contact_phone) &&
                    [agent.emergency_contact_name, agent.emergency_contact_phone].filter(Boolean).join(' · ')
                  }
                />
                <InfoRow icon={Landmark} label="Bank" value={agent.bank_name} />
                <InfoRow icon={Landmark} label="Account Title" value={agent.bank_account_title} />
                <InfoRow
                  icon={Landmark}
                  label="Account Number / IBAN"
                  value={agent.bank_account_number && <span className="font-mono">{agent.bank_account_number}</span>}
                />
              </div>
            </div>
          )}
        </div>

        {/* Employment */}
        <div className="bg-white rounded-xl border shadow-sm">
          <div className="p-5 border-b">
            <h2 className="text-lg font-semibold text-gray-900">Employment</h2>
          </div>
          <div className="p-5 divide-y">
            <InfoRow
              icon={Briefcase}
              label="Employment Type"
              value={agent.employment_type === 'part_time' ? 'Part Time' : 'Full Time'}
            />
            <InfoRow
              icon={Clock}
              label="Shift (PKT)"
              value={`${agent.shift_start?.slice(0, 5)} - ${agent.shift_end?.slice(0, 5)}`}
            />
            <InfoRow icon={Landmark} label="Base Salary" value={formatCurrency(agent.base_salary)} />
            <InfoRow
              icon={Briefcase}
              label="Sales Target"
              value={agent.sales_target > 0 ? `$${agent.sales_target.toLocaleString()}` : null}
            />
            <InfoRow
              icon={CalendarDays}
              label="Account Created"
              value={new Date(agent.created_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            />
          </div>
          <p className="px-5 pb-5 text-xs text-gray-400">
            Edit salary, shift and login details from the{' '}
            <Link href="/hr/agents" className="text-indigo-600 hover:underline">
              agents list
            </Link>
            .
          </p>
        </div>
      </div>

      {/* Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">This Month</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <StatTile label="On Time" value={att.on_time} />
            <StatTile label="Late" value={att.late} />
            <StatTile label="Half Day" value={att.half_day} />
            <StatTile label="Absent" value={att.absent} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile label="Calls" value={month.calls.toLocaleString()} />
            <StatTile label="Talk Time" value={formatHours(month.talk_time_seconds)} />
            <StatTile label="Leads" value={month.leads.toLocaleString()} />
            <StatTile
              label="Sales"
              value={`$${month.sales_collected.toLocaleString()}`}
              sub={`${month.sales_count} approved`}
            />
          </div>
        </div>

        <div className="bg-white rounded-xl border shadow-sm p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Lifetime</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatTile label="Days Worked" value={lifetime.days_worked.toLocaleString()} />
            <StatTile label="Calls" value={lifetime.calls.toLocaleString()} />
            <StatTile label="Talk Time" value={formatHours(lifetime.talk_time_seconds)} />
            <StatTile label="Leads" value={lifetime.leads.toLocaleString()} />
            <StatTile label="Approved Sales" value={lifetime.sales_count.toLocaleString()} />
            <StatTile label="Collected" value={`$${lifetime.sales_collected.toLocaleString()}`} />
          </div>
        </div>
      </div>
    </div>
  );
}
