'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LogIn, Clock, AlertCircle, CheckCircle } from 'lucide-react';

interface AttendanceInfo {
  isNewRecord: boolean;
  status: 'on_time' | 'late' | 'half_day';
  message: string;
  minutesLate?: number;
}

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attendance, setAttendance] = useState<AttendanceInfo | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setAttendance(null);
    setLoading(true);

    try {
      const result = await login(username, password);
      
      // Show attendance notification if new record was created
      if (result?.attendance?.isNewRecord) {
        setAttendance(result.attendance);
        // Wait 3 seconds to show the message before redirect
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const getAttendanceStyles = (status: string) => {
    switch (status) {
      case 'on_time':
        return 'bg-green-50 border-green-200 text-green-800';
      case 'late':
        return 'bg-yellow-50 border-yellow-200 text-yellow-800';
      case 'half_day':
        return 'bg-orange-50 border-orange-200 text-orange-800';
      default:
        return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  const getAttendanceIcon = (status: string) => {
    switch (status) {
      case 'on_time':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'late':
        return <Clock className="h-5 w-5 text-yellow-600" />;
      case 'half_day':
        return <AlertCircle className="h-5 w-5 text-orange-600" />;
      default:
        return <Clock className="h-5 w-5" />;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-100 mb-4">
              <span className="text-3xl">💰</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">
              Salary Gamification
            </h1>
            <p className="text-gray-500 mt-1">Sign in to your account</p>
          </div>

          {/* Attendance Notification */}
          {attendance && (
            <div className={`p-4 rounded-lg border mb-4 ${getAttendanceStyles(attendance.status)}`}>
              <div className="flex items-start gap-3">
                {getAttendanceIcon(attendance.status)}
                <div>
                  <p className="font-medium capitalize">
                    Attendance: {attendance.status.replace('_', ' ')}
                  </p>
                  <p className="text-sm mt-1">{attendance.message}</p>
                </div>
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                {error}
              </div>
            )}

            <Input
              label="Username"
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />

            <Input
              label="Password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <Button
              type="submit"
              disabled={loading}
              className="w-full"
              size="lg"
            >
              {loading ? (
                'Signing in...'
              ) : (
                <>
                  <LogIn className="h-4 w-4 mr-2" />
                  Sign In
                </>
              )}
            </Button>
          </form>

          {/* Demo Credentials */}
          <div className="mt-6 pt-6 border-t">
            <p className="text-xs text-gray-500 text-center">
              Demo: Use <code className="bg-gray-100 px-1 rounded">hr_admin</code> or{' '}
              <code className="bg-gray-100 px-1 rounded">ali</code> with password
            </p>
          </div>

          {/* Current Time Display */}
          <div className="mt-4 text-center text-xs text-gray-400">
            <Clock className="inline h-3 w-3 mr-1" />
            Timezone: Asia/Karachi
          </div>
        </div>
      </div>
    </div>
  );
}
