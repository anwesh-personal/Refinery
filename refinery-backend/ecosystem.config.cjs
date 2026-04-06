// ═══════════════════════════════════════════════════════════════
// PM2 Ecosystem Config — Refinery Nexus Backend
//
// Server: RackNerd Dedicated — 32GB RAM
//   ClickHouse: 24GB, OS/MinIO: ~4GB, Node.js: ~4GB
//
// Memory is configurable from:
//   Server Config → System Settings → node.heap_size_mb
//
// When the UI saves a new heap size, the backend writes
// pm2-runtime.json and triggers a clean PM2 restart.
// This file reads that JSON so PM2 picks up the new limits.
//
// Usage:
//   pm2 start ecosystem.config.cjs
//   pm2 reload ecosystem.config.cjs   (zero-downtime restart)
//   pm2 delete refinery-api && pm2 start ecosystem.config.cjs
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

// ── Read runtime config from sidecar (written by backend on config save) ──
const DEFAULTS = { heapSizeMb: 12288 };
let runtime = { ...DEFAULTS };

try {
  const sidecar = path.join(__dirname, 'pm2-runtime.json');
  if (fs.existsSync(sidecar)) {
    const raw = JSON.parse(fs.readFileSync(sidecar, 'utf-8'));
    if (raw.heapSizeMb && Number(raw.heapSizeMb) > 0) {
      runtime.heapSizeMb = Number(raw.heapSizeMb);
    }
  }
} catch {
  // Sidecar missing or corrupt — use defaults
}

// PM2's max_memory_restart must be ABOVE the Node heap to avoid
// PM2 killing the process before V8's GC can reclaim memory.
// Headroom: heap + 1GB for native buffers, S3 streams, etc.
const pm2MemoryLimitMb = runtime.heapSizeMb + 1024;

module.exports = {
  apps: [
    {
      name: 'refinery-api',
      script: './dist/index.js',

      // ── Memory ──
      // Node V8 heap ceiling (configurable via Server Config UI)
      node_args: `--max-old-space-size=${runtime.heapSizeMb}`,

      // PM2 external kill switch — set above the heap so PM2 only
      // intervenes as a last resort, not during normal GC pressure.
      max_memory_restart: `${pm2MemoryLimitMb}M`,

      // ── Restart Policy ──
      // Auto-restart on crash, but with exponential backoff to prevent
      // rapid restart loops from hammering ClickHouse.
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,

      // ── Logs ──
      error_file: '/root/refinery/logs/pm2-error.log',
      out_file: '/root/refinery/logs/pm2-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // ── Graceful Shutdown ──
      // Give in-flight ingestion jobs time to finish before hard kill.
      // The backend's startGracefulShutdown() drains the queue (max 120s).
      kill_timeout: 130000, // 130s — slightly longer than the drain timeout

      // ── Environment ──
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
