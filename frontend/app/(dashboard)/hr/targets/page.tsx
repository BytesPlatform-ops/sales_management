'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Crosshair,
  Phone,
  Clock,
  Users,
  Loader2,
  Check,
  AlertCircle,
  Briefcase,
  Timer,
} from 'lucide-react';

interface TargetSetting {
  employmentType: 'full_time' | 'part_time';
  calls: number;
  talkTimeSeconds: number;
  leads: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface FormState {
  calls: string;
  talkTimeMinutes: string;
  leads: string;
}

const TYPE_META = {
  full_time: {
    label: 'Full Time',
    description: 'Targets applied to all full-time agents',
    icon: Briefcase,
    accent: 'text-blue-600',
    badge: 'bg-blue-100 text-blue-700',
  },
  part_time: {
    label: 'Part Time',
    description: 'Targets applied to all part-time agents',
    icon: Timer,
    accent: 'text-purple-600',
    badge: 'bg-purple-100 text-purple-700',
  },
} as const;

export default function HRTargetsPage() {
  const [targets, setTargets] = useState<Record<string, TargetSetting>>({});
  const [forms, setForms] = useState<Record<string, FormState>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; employmentType: string; message: string } | null>(null);

  const fetchTargets = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.getTargets();
      const rows = (response.data || []) as TargetSetting[];

      const targetsMap: Record<string, TargetSetting> = {};
      const formsMap: Record<string, FormState> = {};
      for (const row of rows) {
        targetsMap[row.employmentType] = row;
        formsMap[row.employmentType] = {
          calls: String(row.calls),
          talkTimeMinutes: String(Math.round(row.talkTimeSeconds / 60)),
          leads: String(row.leads),
        };
      }
      setTargets(targetsMap);
      setForms(formsMap);
    } catch (error) {
      console.error('Failed to fetch targets:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTargets();
  }, [fetchTargets]);

  const updateForm = (employmentType: string, field: keyof FormState, value: string) => {
    setForms(prev => ({
      ...prev,
      [employmentType]: { ...prev[employmentType], [field]: value },
    }));
    setFeedback(null);
  };

  const hasChanges = (employmentType: 'full_time' | 'part_time'): boolean => {
    const form = forms[employmentType];
    const current = targets[employmentType];
    if (!form || !current) return false;
    return (
      Number(form.calls) !== current.calls ||
      Number(form.talkTimeMinutes) * 60 !== current.talkTimeSeconds ||
      Number(form.leads) !== current.leads
    );
  };

  const validateForm = (form: FormState): string | null => {
    const calls = Number(form.calls);
    const minutes = Number(form.talkTimeMinutes);
    const leads = Number(form.leads);

    if (!Number.isInteger(calls) || calls < 1) return 'Calls target must be a whole number of at least 1';
    if (!Number.isInteger(minutes) || minutes < 1) return 'Talk time must be at least 1 minute';
    if (minutes > 1440) return 'Talk time cannot exceed 24 hours (1440 minutes)';
    if (!Number.isInteger(leads) || leads < 1) return 'Leads target must be a whole number of at least 1';
    return null;
  };

  const handleSave = async (employmentType: 'full_time' | 'part_time') => {
    const form = forms[employmentType];
    if (!form) return;

    const validationError = validateForm(form);
    if (validationError) {
      setFeedback({ type: 'error', employmentType, message: validationError });
      return;
    }

    try {
      setSaving(employmentType);
      setFeedback(null);
      await api.updateTargets(
        employmentType,
        Number(form.calls),
        Number(form.talkTimeMinutes) * 60,
        Number(form.leads)
      );
      setFeedback({
        type: 'success',
        employmentType,
        message: `${TYPE_META[employmentType].label} targets saved`,
      });
      await fetchTargets();
    } catch (error: any) {
      setFeedback({
        type: 'error',
        employmentType,
        message: error?.message || 'Failed to save targets',
      });
    } finally {
      setSaving(null);
    }
  };

  const formatTalkTimePreview = (minutesStr: string): string => {
    const minutes = Number(minutesStr) || 0;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-600 mx-auto mb-4" />
          <p className="text-gray-500">Loading targets...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Crosshair className="h-6 w-6 text-indigo-600" />
          Performance Targets
        </h1>
        <p className="text-gray-500">
          Set the daily targets agents must hit. Changes apply immediately to agent dashboards, daily stats, and salary calculations.
        </p>
      </div>

      {/* Target cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {(['full_time', 'part_time'] as const).map((employmentType) => {
          const meta = TYPE_META[employmentType];
          const form = forms[employmentType];
          const current = targets[employmentType];
          const Icon = meta.icon;

          if (!form) return null;

          return (
            <Card key={employmentType}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Icon className={`h-5 w-5 ${meta.accent}`} />
                    {meta.label}
                  </CardTitle>
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${meta.badge}`}>
                    {employmentType === 'full_time' ? 'FT' : 'PT'}
                  </span>
                </div>
                <CardDescription>{meta.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Calls */}
                <div className="space-y-1.5">
                  <Label htmlFor={`${employmentType}-calls`} className="flex items-center gap-1.5">
                    <Phone className="h-4 w-4 text-gray-400" />
                    Calls Target
                  </Label>
                  <Input
                    id={`${employmentType}-calls`}
                    type="number"
                    min={1}
                    value={form.calls}
                    onChange={(e) => updateForm(employmentType, 'calls', e.target.value)}
                  />
                  <p className="text-xs text-gray-400">Number of calls per day</p>
                </div>

                {/* Talk Time */}
                <div className="space-y-1.5">
                  <Label htmlFor={`${employmentType}-talktime`} className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-gray-400" />
                    Talk Time Target (minutes)
                  </Label>
                  <Input
                    id={`${employmentType}-talktime`}
                    type="number"
                    min={1}
                    max={1440}
                    value={form.talkTimeMinutes}
                    onChange={(e) => updateForm(employmentType, 'talkTimeMinutes', e.target.value)}
                  />
                  <p className="text-xs text-gray-400">
                    Displayed as: <span className="font-medium text-gray-600">{formatTalkTimePreview(form.talkTimeMinutes)}</span>
                  </p>
                </div>

                {/* Leads */}
                <div className="space-y-1.5">
                  <Label htmlFor={`${employmentType}-leads`} className="flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-gray-400" />
                    Leads Target
                  </Label>
                  <Input
                    id={`${employmentType}-leads`}
                    type="number"
                    min={1}
                    value={form.leads}
                    onChange={(e) => updateForm(employmentType, 'leads', e.target.value)}
                  />
                  <p className="text-xs text-gray-400">Leads per day</p>
                </div>

                {/* Feedback */}
                {feedback && feedback.employmentType === employmentType && (
                  <div
                    className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${
                      feedback.type === 'success'
                        ? 'bg-green-50 text-green-700'
                        : 'bg-red-50 text-red-700'
                    }`}
                  >
                    {feedback.type === 'success' ? (
                      <Check className="h-4 w-4 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    )}
                    {feedback.message}
                  </div>
                )}

                {/* Save */}
                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-gray-400">
                    {current?.updatedBy
                      ? `Last updated by ${current.updatedBy}`
                      : 'Using default values'}
                  </p>
                  <Button
                    onClick={() => handleSave(employmentType)}
                    disabled={saving === employmentType || !hasChanges(employmentType)}
                  >
                    {saving === employmentType ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Changes'
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
