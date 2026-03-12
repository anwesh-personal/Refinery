import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { initDatabase } from './db/init.js';

// Routes
import ingestionRoutes from './routes/ingestion.js';
import databaseRoutes from './routes/database.js';
import segmentsRoutes from './routes/segments.js';
import verificationRoutes from './routes/verification.js';
import targetsRoutes from './routes/targets.js';
import queueRoutes from './routes/queue.js';
import configRoutes from './routes/config.js';
import adminRoutes from './routes/admin.js';

const app = express();

// ── Middleware ──
app.use(helmet());
app.use(cors({ origin: env.frontendUrl, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('short'));

// ── API Routes ──
app.use('/api/ingestion', ingestionRoutes);
app.use('/api/database', databaseRoutes);
app.use('/api/segments', segmentsRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/targets', targetsRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/config', configRoutes);
app.use('/api/admin', adminRoutes);

// ── Health ──
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), env: env.nodeEnv });
});

// ── 404 ──
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handler ──
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Boot ──
async function start() {
  console.log('╔═══════════════════════════════════════╗');
  console.log('║     REFINERY NEXUS — BACKEND API      ║');
  console.log('╚═══════════════════════════════════════╝');
  console.log(`[Server] Environment: ${env.nodeEnv}`);
  console.log(`[Server] Port: ${env.port}`);

  // Initialize database
  try {
    await initDatabase();
    console.log('[Server] ✓ Database initialized');
  } catch (e: any) {
    console.warn(`[Server] ⚠ Database init skipped (ClickHouse unavailable): ${e.message}`);
    console.warn('[Server] ⚠ The API will start but database operations will fail until ClickHouse is available.');
  }

  app.listen(env.port, '0.0.0.0', () => {
    console.log(`[Server] ✓ API listening on http://0.0.0.0:${env.port}`);
    console.log(`[Server] ✓ CORS allowed from: ${env.frontendUrl}`);
    console.log('[Server] ─── Ready ───');
  });
}

start().catch((e) => {
  console.error('[Server] FATAL:', e);
  process.exit(1);
});
