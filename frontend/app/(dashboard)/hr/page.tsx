'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api-client';
import { StatsCard } from '@/components/dashboard/stats-card';
import { Leaderboard } from '@/components/dashboard/leaderboard';
import { PendingLeadsFeed } from '@/components/dashboard/pending-leads-feed';
import { Button } from '@/components/ui/button';
import { formatDuration, getGreeting } from '@/lib/utils';
import { Users, Phone, Clock, AlertCircle, RefreshCw } from 'lucide-react';
import Link from 'next/link';

interface HRDashboardData {
  agents: any[];
  todayStats: any[];
  pendingApprovals: any[];
}

export default function HRDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<HRDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [agentsRes, pendingRes] = await Promise.all([
        api.getAgents(),
        api.getPendingApprovals(),
      ]);

      console.log('Agents response:', agentsRes);
      console.log('Pending response:', pendingRes);

      setData({
        agents: agentsRes.data || [],
        todayStats: [],
        pendingApprovals: pendingRes.data || [],
      });
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-gray-200 rounded w-1/3 animate-pulse"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-gray-200 rounded-xl animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  const totalAgents = data?.agents.length || 0;
  const pendingCount = data?.pendingApprovals.length || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {getGreeting()}, {user?.full_name?.split(' ')[0]}! 👋
          </h1>
          <p className="text-gray-500">HR Management Dashboard</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Link href="/hr/agents">
            <Button>
              <Users className="h-4 w-4 mr-2" />
              Manage Agents
            </Button>
          </Link>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Agents"
          value={totalAgents}
          icon={Users}
          variant="primary"
        />
        <StatsCard
          title="Active Today"
          value={data?.agents.filter((a) => a.is_active).length || 0}
          icon={Phone}
          variant="success"
        />
        <StatsCard
          title="Pending Approvals"
          value={pendingCount}
          icon={AlertCircle}
          variant={pendingCount > 0 ? 'warning' : 'default'}
        />
        
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pending Lead Verifications - Real-time */}
        <div className="lg:col-span-2">
          <PendingLeadsFeed />
        </div>

        {/* Leaderboard */}
        <div>
          <Leaderboard type="daily" />
        </div>
      </div>

      {/* Pending Attendance Approvals */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl p-6 border shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                ⏳ Pending Attendance Approvals
              </h3>
              <Link href="/hr/attendance">
                <Button variant="outline" size="sm">
                  View All
                </Button>
              </Link>
            </div>

            {pendingCount === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <AlertCircle className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                <p>No pending approvals</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data?.pendingApprovals.slice(0, 5).map((item: any) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg"
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        {item.full_name}
                      </p>
                      <p className="text-sm text-gray-500">
                        {item.date} - {item.status}
                      </p>
                    </div>
                    <Button size="sm">Approve</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Agents List */}
      <div className="bg-white rounded-xl p-6 border shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          👥 Active Agents
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data?.agents.slice(0, 6).map((agent: any) => (
            <div
              key={agent.id}
              className="p-4 border rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center">
                  <span className="text-primary-600 font-bold">
                    {agent.full_name.charAt(0)}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-gray-900">{agent.full_name}</p>
                  <p className="text-sm text-gray-500">
                    Ext: {agent.extension_number}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
        {totalAgents > 6 && (
          <div className="text-center mt-4">
            <Link href="/hr/agents">
              <Button variant="outline">View All {totalAgents} Agents</Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
