import { Router } from 'express';
import authRoutes from './auth.routes';
import usersRoutes from './users.routes';
import attendanceRoutes from './attendance.routes';
import statsRoutes from './stats.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/stats', statsRoutes);

export default router;
