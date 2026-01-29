'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { formatDate, formatTime, getStatusColor, getStatusLabel } from '@/lib/utils';
import { Check, X, Calendar } from 'lucide-react';

export default function AttendancePage() {
  const [pending, setPending] = useState<any[]>([]);
  const [todayAttendance, setTodayAttendance] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0]
  );

  const fetchData = async () => {
    try {
      const [pendingRes, dateRes] = await Promise.all([
        api.getPendingApprovals(),
        api.getAttendanceByDate(selectedDate),
      ]);

      setPending(pendingRes.data || []);
      setTodayAttendance(dateRes.data || []);
    } catch (error) {
      console.error('Failed to fetch attendance:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedDate]);

  const handleApprove = async (id: number) => {
    try {
      await api.updateAttendance(id, { hr_approved: true });
      fetchData();
    } catch (error) {
      console.error('Failed to approve:', error);
    }
  };

  const handleUpdateStatus = async (id: number, status: string) => {
    try {
      await api.updateAttendance(id, { status });
      fetchData();
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">📅 Attendance Management</h1>
          <p className="text-gray-500">Review and approve attendance records</p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-gray-400" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border rounded-lg px-3 py-2"
          />
        </div>
      </div>

      {/* Pending Approvals */}
      {pending.length > 0 && (
        <div className="bg-yellow-50 rounded-xl p-6 border border-yellow-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            ⏳ Pending Approvals ({pending.length})
          </h2>
          <div className="space-y-2">
            {pending.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between bg-white p-4 rounded-lg"
              >
                <div className="flex items-center gap-4">
                  <div>
                    <p className="font-medium text-gray-900">{item.full_name}</p>
                    <p className="text-sm text-gray-500">
                      {formatDate(item.date)} • Ext: {item.extension_number}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(
                      item.status
                    )}`}
                  >
                    {getStatusLabel(item.status)}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleApprove(item.id)}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleUpdateStatus(item.id, 'absent')}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Attendance Table */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">
            Attendance for {formatDate(selectedDate)}
          </h2>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          </div>
        ) : todayAttendance.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No attendance records for this date.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Extension</TableHead>
                <TableHead>Check In</TableHead>
                <TableHead>Check Out</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {todayAttendance.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="font-medium">
                    {record.full_name}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono bg-gray-100 px-2 py-1 rounded text-sm">
                      {record.extension_number}
                    </span>
                  </TableCell>
                  <TableCell>
                    {record.check_in_time
                      ? formatTime(record.check_in_time)
                      : '-'}
                  </TableCell>
                  <TableCell>
                    {record.check_out_time
                      ? formatTime(record.check_out_time)
                      : '-'}
                  </TableCell>
                  <TableCell>
                    <select
                      value={record.status}
                      onChange={(e) =>
                        handleUpdateStatus(record.id, e.target.value)
                      }
                      className={`px-2 py-1 rounded text-sm border-0 ${getStatusColor(
                        record.status
                      )}`}
                    >
                      <option value="on_time">On Time</option>
                      <option value="late">Late</option>
                      <option value="half_day">Half Day</option>
                      <option value="absent">Absent</option>
                    </select>
                  </TableCell>
                  <TableCell>
                    {record.hr_approved ? (
                      <span className="text-green-600">✓ Yes</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleApprove(record.id)}
                      >
                        Approve
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm">
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
