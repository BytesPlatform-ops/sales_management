'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

interface DashboardData {
  user: any;
  today: {
    calls: number;
    talkTime: number;
    talkTimeFormatted: string;
    leads: number;
    performanceScore: number;
    attendanceStatus: string;
    earnings: number;
  } | null;
  salary: {
    baseSalary: number;
    dailyPotential: number;
    ghostDays: number;
    ghostEarnings: number;
    activeDays: number;
    activeEarnings: number;
    todayEarnings: number;
    totalEarned: number;
    projectedSalary: number;
    percentageEarned: number;
  };
  attendance: {
    breakdown: {
      onTime: { days: number; earnings: number };
      late: { days: number; earnings: number };
      halfDay: { days: number; earnings: number };
      absent: { days: number; earnings: number };
    };
    todayStatus: string | null;
  };
  performance: {
    totalCalls: number;
    totalTalkTime: number;
    totalTalkTimeFormatted: string;
    totalLeads: number;
    avgPerformanceScore: number;
  };
  month: {
    workingDays: number;
    workingDaysElapsed: number;
    workingDaysRemaining: number;
    systemLaunchDate: string;
    currentDate: string;
  };
}

export function useStats() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.getAgentStats();
      if (response.data) {
        setData(response.data);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const syncStats = useCallback(async () => {
    try {
      await api.syncStats();
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  }, [fetchData]);

  useEffect(() => {
    fetchData();
    
    // Auto refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { data, loading, error, refresh: fetchData, syncStats };
}
