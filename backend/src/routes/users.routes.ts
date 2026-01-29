import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { roleMiddleware } from '../middleware/auth.middleware';
import {
  getAllUsers,
  getAllAgents,
  findUserById,
  createUser,
  updateUser,
} from '../services/users.service';
import { getDailyPotential } from '../lib/salary-calc';

const router = Router();

// GET /api/users - Get all users (HR only)
router.get('/', authMiddleware, roleMiddleware('hr'), async (req: AuthRequest, res: Response) => {
  try {
    const users = await getAllUsers();
    res.json({
      status: 'success',
      data: users,
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// GET /api/users/agents - Get all agents
router.get('/agents', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const agents = await getAllAgents();
    
    // Add daily potential to each agent
    const agentsWithPotential = agents.map((agent) => ({
      ...agent,
      daily_potential: getDailyPotential(agent.base_salary),
    }));

    res.json({
      status: 'success',
      data: agentsWithPotential,
    });
  } catch (error) {
    console.error('Get agents error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// GET /api/users/:id - Get user by ID
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);

    // Agents can only view their own profile
    if (req.user?.role === 'agent' && req.user.userId !== userId) {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied',
      });
    }

    const user = await findUserById(userId);

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    res.json({
      status: 'success',
      data: {
        ...user,
        daily_potential: getDailyPotential(user.base_salary),
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// POST /api/users - Create user (HR only)
router.post('/', authMiddleware, roleMiddleware('hr'), async (req: AuthRequest, res: Response) => {
  try {
    const {
      username,
      password,
      full_name,
      extension_number,
      role,
      base_salary,
      shift_start,
      shift_end,
      employment_type,
    } = req.body;

    if (!username || !password || !full_name || !extension_number || !role || !base_salary) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields',
      });
    }

    const user = await createUser({
      username,
      password,
      full_name,
      extension_number,
      role,
      base_salary,
      shift_start,
      shift_end,
      employment_type,
    });

    res.status(201).json({
      status: 'success',
      data: user,
    });
  } catch (error: any) {
    console.error('Create user error:', error);

    if (error.code === '23505') {
      return res.status(409).json({
        status: 'error',
        message: 'Username or extension number already exists',
      });
    }

    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// PUT /api/users/:id - Update user (HR only)
router.put('/:id', authMiddleware, roleMiddleware('hr'), async (req: AuthRequest, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const updates = req.body;

    const user = await updateUser(userId, updates);

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    res.json({
      status: 'success',
      data: user,
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

export default router;
