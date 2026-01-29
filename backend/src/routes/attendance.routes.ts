import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/auth.middleware';
import {
  getAttendanceByUserAndDate,
  getAttendanceByDate,
  getAttendanceByUser,
  getMonthlyAttendance,
  getAttendanceSummary,
  checkIn,
  checkOut,
  updateAttendance,
  getPendingApprovals,
} from '../services/attendance.service';
import { findUserById } from '../services/users.service';

const router = Router();

// GET /api/attendance/today - Get today's attendance for current user
router.get('/today', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const attendance = await getAttendanceByUserAndDate(req.user!.userId, today);

    res.json({
      status: 'success',
      data: attendance,
    });
  } catch (error) {
    console.error('Get today attendance error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// GET /api/attendance/pending - Get pending approvals (HR only)
router.get('/pending', authMiddleware, roleMiddleware('hr'), async (req: AuthRequest, res: Response) => {
  try {
    const pending = await getPendingApprovals();

    res.json({
      status: 'success',
      data: pending,
    });
  } catch (error) {
    console.error('Get pending approvals error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// GET /api/attendance/date/:date - Get all attendance for a date (HR only)
router.get('/date/:date', authMiddleware, roleMiddleware('hr'), async (req: AuthRequest, res: Response) => {
  try {
    const { date } = req.params;
    const attendance = await getAttendanceByDate(date);

    res.json({
      status: 'success',
      data: attendance,
    });
  } catch (error) {
    console.error('Get attendance by date error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// GET /api/attendance/user/:userId - Get attendance history for a user
router.get('/user/:userId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = parseInt(req.params.userId, 10);

    // Agents can only view their own attendance
    if (req.user?.role === 'agent' && req.user.userId !== userId) {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied',
      });
    }

    const { start_date, end_date } = req.query;
    const attendance = await getAttendanceByUser(
      userId,
      start_date as string,
      end_date as string
    );

    res.json({
      status: 'success',
      data: attendance,
    });
  } catch (error) {
    console.error('Get user attendance error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// GET /api/attendance/summary/:userId/:year/:month - Get monthly summary
router.get('/summary/:userId/:year/:month', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const year = parseInt(req.params.year, 10);
    const month = parseInt(req.params.month, 10);

    // Agents can only view their own summary
    if (req.user?.role === 'agent' && req.user.userId !== userId) {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied',
      });
    }

    const summary = await getAttendanceSummary(userId, year, month);

    res.json({
      status: 'success',
      data: summary,
    });
  } catch (error) {
    console.error('Get attendance summary error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// POST /api/attendance/check-in - Check in
router.post('/check-in', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status = 'on_time' } = req.body;

    // Validate status
    if (!['on_time', 'late'].includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid status. Must be on_time or late',
      });
    }

    // Get user to check shift time
    const user = await findUserById(req.user!.userId);
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    // Auto-determine if late based on shift start (optional enhancement)
    const attendance = await checkIn(req.user!.userId, status);

    res.json({
      status: 'success',
      data: attendance,
    });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// POST /api/attendance/check-out - Check out
router.post('/check-out', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const attendance = await checkOut(req.user!.userId);

    if (!attendance) {
      return res.status(404).json({
        status: 'error',
        message: 'No check-in found for today',
      });
    }

    res.json({
      status: 'success',
      data: attendance,
    });
  } catch (error) {
    console.error('Check-out error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// PUT /api/attendance/:id - Update attendance (HR only)
router.put('/:id', authMiddleware, roleMiddleware('hr'), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status, hr_approved, notes } = req.body;

    const attendance = await updateAttendance(id, { status, hr_approved, notes });

    if (!attendance) {
      return res.status(404).json({
        status: 'error',
        message: 'Attendance record not found',
      });
    }

    res.json({
      status: 'success',
      data: attendance,
    });
  } catch (error) {
    console.error('Update attendance error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

export default router;
