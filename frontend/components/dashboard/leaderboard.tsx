'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import { formatDuration } from '@/lib/utils';
import { Trophy, Phone, Clock } from 'lucide-react';

interface LeaderboardEntry {
  rank: number;
  user_id: number;
  full_name: string;
  extension_number: string;
  calls_count?: number;
  talk_time_seconds?: number;
  total_calls?: number;
  total_talk_time?: number;
}

interface LeaderboardProps {
  type?: 'daily' | 'monthly';
}

export function Leaderboard({ type = 'daily' }: LeaderboardProps) {
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const response =
          type === 'daily'
            ? await api.getLeaderboard()
            : await api.getMonthlyLeaderboard();
        if (response.data) {
          setData(response.data);
        }
      } catch (error) {
        console.error('Failed to fetch leaderboard:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchLeaderboard();
  }, [type]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl p-6 border shadow-sm animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-gray-100 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  const getRankEmoji = (rank: number) => {
    switch (rank) {
      case 1:
        return '🥇';
      case 2:
        return '🥈';
      case 3:
        return '🥉';
      default:
        return `#${rank}`;
    }
  };

  return (
    <div className="bg-white rounded-xl p-6 border shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="h-5 w-5 text-yellow-500" />
        <h3 className="text-lg font-semibold text-gray-900">
          {type === 'daily' ? "Today's" : "Monthly"} Leaderboard
        </h3>
      </div>

      {data.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No data available</p>
      ) : (
        <div className="space-y-2">
          {data.slice(0, 10).map((entry) => {
            const calls = entry.calls_count ?? entry.total_calls ?? 0;
            const talkTime = entry.talk_time_seconds ?? entry.total_talk_time ?? 0;

            return (
              <div
                key={entry.user_id}
                className={`flex items-center justify-between p-3 rounded-lg ${
                  entry.rank <= 3 ? 'bg-yellow-50' : 'bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold w-8">
                    {getRankEmoji(entry.rank)}
                  </span>
                  <div>
                    <p className="font-medium text-gray-900">
                      {entry.full_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      Ext: {entry.extension_number}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1 text-gray-600">
                    <Phone className="h-4 w-4" />
                    <span>{calls}</span>
                  </div>
                  <div className="flex items-center gap-1 text-gray-600">
                    <Clock className="h-4 w-4" />
                    <span>{formatDuration(talkTime)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
