// ═══════════════════════════════════════════════════════════════
// PM2 Ecosystem Config — Refinery Nexus Backend
//
// Server: RackNerd Dedicated — 32GB RAM
//   ClickHouse: 24GB, OS/MinIO: ~4GB, Node.js: ~4GB
//
// Usage:
//   pm2 start ecosystem.config.cjs
//   pm2 reload ecosystem.config.cjs   (zero-downtime restart)
//   pm2 delete refinery-api && pm2 start ecosystem.config.cjs
// ═══════════════════════════════════════════════════════════════

module.exports = {
  apps: [
    {
      name: 'refinery-api',
      script: './dist/index.js',

      // ── Memory ──
      // 32GB server: 24GB ClickHouse, ~4GB OS/MinIO, 4GB for Node.js
      // Default V8 heap is 1.7GB — far too low for Parquet ingestion.
      node_args: '--max-old-space-size=4096',

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
