import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { pool } from './config/database';
import routes from './routes';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.middleware';

const app = express();

// Middleware
app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
}));
app.use(express.json());

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

// API Routes
app.use('/api', routes);

// Error handling
app.use(notFoundMiddleware);
app.use(errorMiddleware);

// Start server
const PORT = env.PORT;

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║     🚀 Salary Gamification Backend API                ║
║                                                       ║
║     Server:    http://localhost:${PORT}                  ║
║     Health:    http://localhost:${PORT}/health            ║
║     API:       http://localhost:${PORT}/api               ║
║     Mode:      ${env.NODE_ENV.padEnd(11)}                       ║
╚═══════════════════════════════════════════════════════╝
  `);
});

export default app;
