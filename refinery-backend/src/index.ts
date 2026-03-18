import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { initDatabase } from './db/init.js';
import { recoverOrphanedBatches } from './services/verification.js';

// Routes
import ingestionRoutes from './routes/ingestion.js';
import databaseRoutes from './routes/database.js';
import segmentsRoutes from './routes/segments.js';
import verificationRoutes from './routes/verification.js';
import targetsRoutes from './routes/targets.js';
import queueRoutes from './routes/queue.js';
import configRoutes from './routes/config.js';
import adminRoutes from './routes/admin.js';
import serverRoutes from './routes/servers.js';
import customRolesRoutes from './routes/customRoles.js';
import teamsRoutes from './routes/teams.js';
import verifyRoutes from './routes/verify.js';
import s3sourcesRoutes from './routes/s3sources.js';
import ingestionRulesRoutes from './routes/ingestion-rules.js';
import janitorRoutes from './routes/janitor.js';
import verify550Routes from './routes/verify550.js';
import { setupScheduler } from './services/ingestion-rules.js';
import { ensureEnvServersRegistered } from './services/servers.js';

// v1 API routes (machine-to-machine, API key auth)
import v1KeysRoutes from './routes/v1/keys.js';
import v1ContactsRoutes from './routes/v1/contacts.js';
import v1SegmentsRoutes from './routes/v1/segments.js';
import v1VerifyRoutes from './routes/v1/verify.js';
import v1WebhooksRoutes from './routes/v1/webhooks.js';
import v1StatsRoutes from './routes/v1/stats.js';
import v1MtaRoutes from './routes/v1/mta.js';
import { requireApiKey } from './middleware/apiKeyAuth.js';
import { apiKeyRateLimiter } from './middleware/rateLimiter.js';

const app = express();

// ── Middleware ──
app.use(helmet());

// Dynamic CORS — supports multiple origins (comma-separated in FRONTEND_URL)
const allowedOrigins = env.frontendUrl
  .split(',')
  .map((o: string) => o.trim())
  .filter(Boolean);
// Always allow localhost in development
if (env.nodeEnv === 'development') {
  allowedOrigins.push('http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173');
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server, health checks)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked request from origin: ${origin}`);
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
}));
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
app.use('/api/servers', serverRoutes);
app.use('/api/custom-roles', customRolesRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/verify', verifyRoutes);
app.use('/api/s3-sources', s3sourcesRoutes);
app.use('/api/ingestion-rules', ingestionRulesRoutes);
app.use('/api/janitor', janitorRoutes);
app.use('/api/v550', verify550Routes);

// ── v1 API (machine-to-machine, API key authenticated) ──
app.use('/api/v1/keys', v1KeysRoutes);
app.use('/api/v1/contacts', requireApiKey, apiKeyRateLimiter, v1ContactsRoutes);
app.use('/api/v1/segments', requireApiKey, apiKeyRateLimiter, v1SegmentsRoutes);
app.use('/api/v1/verify', requireApiKey, apiKeyRateLimiter, v1VerifyRoutes);
app.use('/api/v1/webhooks', requireApiKey, apiKeyRateLimiter, v1WebhooksRoutes);
app.use('/api/v1/stats', requireApiKey, apiKeyRateLimiter, v1StatsRoutes);
app.use('/api/v1/mta', requireApiKey, apiKeyRateLimiter, v1MtaRoutes);

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

    // Recover any batches orphaned by a prior crash/restart
    const recovered = await recoverOrphanedBatches();
    if (recovered > 0) {
      console.log(`[Server] ✓ Recovered ${recovered} orphaned batch(es)`);
    }

    // Initialize auto-ingestion scheduler
    await setupScheduler();
    console.log('[Server] ✓ Auto-ingestion scheduler initialized');

    // Register env-configured servers into Supabase
    await ensureEnvServersRegistered();
    console.log('[Server] ✓ Server registry synchronized');
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
