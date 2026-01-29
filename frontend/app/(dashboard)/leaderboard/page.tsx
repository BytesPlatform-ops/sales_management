'use client';

import { Leaderboard } from '@/components/dashboard/leaderboard';

export default function LeaderboardPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">🏆 Leaderboard</h1>
        <p className="text-gray-500">See how the team is performing</p>
      </div>

      {/* Leaderboards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Leaderboard type="daily" />
        <Leaderboard type="monthly" />
      </div>
    </div>
  );
}
