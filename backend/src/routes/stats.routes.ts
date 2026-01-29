import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/auth.middleware';
import {
  getStatsByUserAndDate,
  getStatsByDate,
  getMonthlyStats,
  getMonthlyStatsSummary,
  upsertStats,
  syncFromCallLogs,
  getLeaderboard,
  getMonthlyLeaderboard,
} from '../services/stats.service';
import { findUserById } from '../services/users.service';
import { getAttendanceSummary } from '../services/attendance.service';
import { calculateSalary, getDailyPotential } from '../lib/salary-calc';
import { queryOne } from '../config/database';

const router = Router();

// GET /api/stats/today - Get today's stats for current user
router.get('/today', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const stats = await getStatsByUserAndDate(req.user!.userId, today);

    res.json({
      status: 'success',
      data: stats || { calls_count: 0, talk_time_seconds: 0, leads_count: 0 },
    });
  } catch (error) {
    console.error('Get today stats error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// GET /api/stats/dashboard - Get full dashboard data for agent
router.get('/dashboard', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    // Get user info
    const user = await findUserById(userId);
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Get system launch date
    const systemSetting = await queryOne<{ value: string }>(
      "SELECT value FROM system_settings WHERE key = 'system_launch_date'"
    );
    const systemLaunchDate = systemSetting ? new Date(systemSetting.value) : new Date('2024-02-04');

    // Get today's stats
    const todayStats = await getStatsByUserAndDate(userId, today);

    // Get monthly summary
    const monthlySummary = await getMonthlyStatsSummary(userId, year, month);

    // Get attendance summary
    const attendanceSummary = await getAttendanceSummary(userId, year, month);

    // Calculate salary
    const salaryData = calculateSalary({
      baseSalary: user.base_salary,
      userCreatedAt: new Date(user.created_at),
      systemLaunchDate,
      attendanceData: {
        onTime: attendanceSummary.on_time,
        late: attendanceSummary.late,
        halfDay: attendanceSummary.half_day,
        absent: attendanceSummary.absent,
      },
    });

    res.json({
      status: 'success',
      data: {
        user: {
          ...user,
          daily_potential: salaryData.dailyPotential,
        },
        today: {
          calls_count: todayStats?.calls_count || 0,
          talk_time_seconds: todayStats?.talk_time_seconds || 0,
          leads_count: todayStats?.leads_count || 0,
        },
        month: {
          ...monthlySummary,
          working_days_in_month: salaryData.workingDaysInMonth,
          working_days_elapsed: salaryData.workingDaysElapsed,
        },
        attendance: attendanceSummary,
        salary: salaryData,
      },
    });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// GET /api/stats/leaderboard - Get today's leaderboard
router.get('/leaderboard', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const leaderboard = await getLeaderboard(today);

    res.json({
      status: 'success',
      data: leaderboard.map((entry, index) => ({
        rank: index + 1,
        ...entry,
      })),
    });
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// GET /api/stats/leaderboard/monthly - Get monthly leaderboard
router.get('/leaderboard/monthly', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year as string) || now.getFullYear();
    const month = parseInt(req.query.month as string) || now.getMonth() + 1;

    const leaderboard = await getMonthlyLeaderboard(year, month);

    res.json({
      status: 'success',
      data: leaderboard.map((entry, index) => ({
        rank: index + 1,
        ...entry,
      })),
    });
  } catch (error) {
    console.error('Get monthly leaderboard error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// GET /api/stats/date/:date - Get all stats for a date (HR only)
router.get('/date/:date', authMiddleware, roleMiddleware('hr'), async (req: AuthRequest, res: Response) => {
  try {
    const { date } = req.params;
    const stats = await getStatsByDate(date);

    res.json({
      status: 'success',
      data: stats,
    });
  } catch (error) {
    console.error('Get stats by date error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// GET /api/stats/user/:userId/monthly/:year/:month - Get monthly stats for a user
router.get('/user/:userId/monthly/:year/:month', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const year = parseInt(req.params.year, 10);
    const month = parseInt(req.params.month, 10);

    // Agents can only view their own stats
    if (req.user?.role === 'agent' && req.user.userId !== userId) {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied',
      });
    }

    const stats = await getMonthlyStats(userId, year, month);
    const summary = await getMonthlyStatsSummary(userId, year, month);

    res.json({
      status: 'success',
      data: {
        daily: stats,
        summary,
      },
    });
  } catch (error) {
    console.error('Get monthly stats error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// POST /api/stats/sync - Sync stats from call_logs (for current user)
router.post('/sync', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await findUserById(req.user!.userId);
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const today = new Date().toISOString().split('T')[0];
    const stats = await syncFromCallLogs(user.id, user.extension_number, today);

    res.json({
      status: 'success',
      data: stats,
    });
  } catch (error) {
    console.error('Sync stats error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// PUT /api/stats/:userId/:date - Update leads count (manual input)
router.put('/:userId/:date', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const { date } = req.params;
    const { leads_count, notes } = req.body;

    // Agents can only update their own leads
    if (req.user?.role === 'agent' && req.user.userId !== userId) {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied',
      });
    }

    const stats = await upsertStats(userId, date, { leads_count, notes });

    res.json({
      status: 'success',
      data: stats,
    });
  } catch (error) {
    console.error('Update stats error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

export default router;
