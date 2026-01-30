'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { formatTime } from '@/lib/utils';
import { Clock, LogIn, LogOut, CheckCircle, AlertTriangle, PartyPopper } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CheckInButtonProps {
  attendance: {
    check_in_time: string | null;
    check_out_time: string | null;
    status: string;
  } | null;
  onUpdate: () => void;
  isWeekend?: boolean;
}

// Dynamic styles based on attendance status
const getStatusStyles = (status: string) => {
  switch (status) {
    case 'on_time':
      return {
        bg: 'bg-emerald-50',
        border: 'border-emerald-200',
        text: 'text-emerald-700',
        textLight: 'text-emerald-600',
        icon: CheckCircle,
        iconColor: 'text-emerald-600',
        label: 'On Time',
      };
    case 'late':
      return {
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        text: 'text-amber-700',
        textLight: 'text-amber-600',
        icon: Clock,
        iconColor: 'text-amber-600',
        label: 'Late',
      };
    case 'half_day':
      return {
        bg: 'bg-rose-50',
        border: 'border-rose-200',
        text: 'text-rose-700',
        textLight: 'text-rose-600',
        icon: AlertTriangle,
        iconColor: 'text-rose-600',
        label: 'Half Day',
      };
    default:
      return {
        bg: 'bg-gray-50',
        border: 'border-gray-200',
        text: 'text-gray-700',
        textLight: 'text-gray-600',
        icon: Clock,
        iconColor: 'text-gray-500',
        label: status.replace('_', ' '),
      };
  }
};

export function CheckInButton({ attendance, onUpdate, isWeekend = false }: CheckInButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleCheckIn = async (status: 'on_time' | 'late') => {
    try {
      setLoading(true);
      await api.checkIn(status);
      onUpdate();
    } catch (error) {
      console.error('Check-in failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckOut = async () => {
    try {
      setLoading(true);
      await api.checkOut();
      onUpdate();
    } catch (error) {
      console.error('Check-out failed:', error);
    } finally {
      setLoading(false);
    }
  };

  // Weekend - System Paused
  if (isWeekend) {
    return (
      <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl p-6 border border-purple-200 shadow-sm h-full flex flex-col justify-center items-center text-center">
        <PartyPopper className="h-12 w-12 text-purple-500 mb-3" />
        <h3 className="text-xl font-bold text-purple-700 mb-2">Happy Weekend! 🎉</h3>
        <p className="text-purple-600 text-sm">
          System paused for the weekend.
        </p>
        <p className="text-purple-500 text-xs mt-2">
          Attendance is not tracked on Saturday & Sunday shifts.
        </p>
      </div>
    );
  }

  // Not checked in yet
  if (!attendance?.check_in_time) {
    return (
      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm h-full flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-5 w-5 text-gray-500" />
            <h3 className="text-lg font-semibold text-gray-900">Attendance</h3>
          </div>
          <p className="text-gray-500 mb-4">You haven't checked in today</p>
        </div>
        <div className="flex flex-col gap-2">
          <Button
            onClick={() => handleCheckIn('on_time')}
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-700"
          >
            <LogIn className="h-4 w-4 mr-2" />
            Check In (On Time)
          </Button>
          <Button
            variant="outline"
            onClick={() => handleCheckIn('late')}
            disabled={loading}
            className="w-full border-amber-300 text-amber-700 hover:bg-amber-50"
          >
            Check In (Late)
          </Button>
        </div>
      </div>
    );
  }

  // Get dynamic styles based on status
  const styles = getStatusStyles(attendance.status);
  const StatusIcon = styles.icon;

  // Checked in but not checked out
  if (!attendance.check_out_time) {
    return (
      <div className={cn(
        'rounded-xl p-6 border shadow-sm h-full flex flex-col justify-between',
        styles.bg,
        styles.border
      )}>
        <div>
          <div className="flex items-center gap-2 mb-4">
            <StatusIcon className={cn('h-5 w-5', styles.iconColor)} />
            <h3 className="text-lg font-semibold text-gray-900">Attendance</h3>
          </div>
          <div className={cn('flex items-center gap-2 mb-1', styles.text)}>
            <span className="font-semibold">{styles.label}</span>
          </div>
          <p className={cn('font-medium mb-1', styles.textLight)}>
            ✓ Checked in at {formatTime(attendance.check_in_time)}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleCheckOut}
          disabled={loading}
          className="w-full mt-4"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Check Out
        </Button>
      </div>
    );
  }

  // Fully checked out - also use dynamic styles
  return (
    <div className={cn(
      'rounded-xl p-6 border shadow-sm h-full',
      styles.bg,
      styles.border
    )}>
      <div className="flex items-center gap-2 mb-4">
        <StatusIcon className={cn('h-5 w-5', styles.iconColor)} />
        <h3 className="text-lg font-semibold text-gray-900">Attendance</h3>
      </div>
      <div className={cn('flex items-center gap-2 mb-3', styles.text)}>
        <span className="font-semibold">{styles.label}</span>
      </div>
      <div className="space-y-1">
        <p className={styles.textLight}>
          Check In: <span className="font-medium">{formatTime(attendance.check_in_time)}</span>
        </p>
        <p className={styles.textLight}>
          Check Out: <span className="font-medium">{formatTime(attendance.check_out_time)}</span>
        </p>
      </div>
    </div>
  );
}
