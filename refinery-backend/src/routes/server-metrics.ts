import { Router, Request, Response } from 'express';
import os from 'os';
import { execSync } from 'child_process';
import { getClickHouseClient } from '../services/servers.js';

const router = Router();

/* ─── Helper: run a shell command safely ─── */
function exec(cmd: string): string {
  try { return execSync(cmd, { timeout: 5000 }).toString().trim(); }
  catch { return ''; }
}

/* ─── Helper: network stats from vnstat ─── */
function getNetworkStats(): { totalGB: number } {
  try {
    const raw = exec("vnstat --json m 1 2>/dev/null");
    if (!raw) return { totalGB: 0 };
    const data = JSON.parse(raw);
    let rx = 0; let tx = 0;
    for (const iface of data.interfaces || []) {
      if (iface.name.startsWith('lo') || iface.name.startsWith('docker')) continue;
      const traffic = iface.traffic?.month?.[0];
      if (traffic) {
        rx += traffic.rx;
        tx += traffic.tx;
      }
    }
    return { totalGB: Math.round((rx + tx) / 1024 / 1024 / 1024) };
  } catch {
    return { totalGB: 0 };
  }
}

/* ─── In-memory cache (avoids hammering shell + CH every 10s) ─── */
interface CachedMetrics { data: any; ts: number; }
let metricsCache: CachedMetrics | null = null;
const CACHE_TTL_MS = 5000; // 5s — matches frontend poll interval / 2

/* ─── Helper: parse disk info (with SSD/HDD detection cached per boot) ─── */
interface DiskInfo {
  device: string;
  mountpoint: string;
  totalGB: number;
  usedGB: number;
  availGB: number;
  usePct: number;
  type: 'SSD' | 'SATA/HDD' | 'Unknown';
}

// Cache SSD/HDD detection — rotational flag doesn't change at runtime
const diskTypeCache = new Map<string, 'SSD' | 'SATA/HDD' | 'Unknown'>();

function detectDiskType(device: string): 'SSD' | 'SATA/HDD' | 'Unknown' {
  const devName = device.replace('/dev/', '').replace(/[0-9]+$/, '').replace(/p[0-9]+$/, '');
  if (diskTypeCache.has(devName)) return diskTypeCache.get(devName)!;
  const rotationalRaw = exec(`cat /sys/block/${devName}/queue/rotational 2>/dev/null`);
  let diskType: 'SSD' | 'SATA/HDD' | 'Unknown' = 'Unknown';
  if (rotationalRaw === '0') diskType = 'SSD';
  else if (rotationalRaw === '1') diskType = 'SATA/HDD';
  diskTypeCache.set(devName, diskType);
  return diskType;
}

function getDiskInfo(): DiskInfo[] {
  const raw = exec("df -BG --output=source,target,size,used,avail,pcent -x tmpfs -x devtmpfs -x overlay -x squashfs 2>/dev/null");
  if (!raw) return [];
  const lines = raw.split('\n').slice(1);
  const disks: DiskInfo[] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const [device, mountpoint, sizeStr, usedStr, availStr, pctStr] = parts;
    if (!device.startsWith('/dev/')) continue;
    disks.push({
      device,
      mountpoint,
      totalGB: parseFloat(sizeStr.replace('G', '')) || 0,
      usedGB: parseFloat(usedStr.replace('G', '')) || 0,
      availGB: parseFloat(availStr.replace('G', '')) || 0,
      usePct: parseFloat(pctStr.replace('%', '')) || 0,
      type: detectDiskType(device),
    });
  }
  return disks;
}

/* ─── Helper: accurate CPU usage from /proc/stat (Linux only) ─── */
let prevCpuIdle = 0;
let prevCpuTotal = 0;

function getCpuUsagePct(): number {
  const raw = exec("head -1 /proc/stat 2>/dev/null");
  if (!raw) {
    // Fallback to load average for non-Linux
    const loadAvg = os.loadavg();
    return Math.min(100, Math.round((loadAvg[0] / os.cpus().length) * 100));
  }
  const cols = raw.split(/\s+/).slice(1).map(Number);
  const idle = cols[3] + (cols[4] || 0); // idle + iowait
  const total = cols.reduce((a, b) => a + b, 0);
  const diffIdle = idle - prevCpuIdle;
  const diffTotal = total - prevCpuTotal;
  prevCpuIdle = idle;
  prevCpuTotal = total;
  if (diffTotal === 0) return 0;
  return Math.round(((diffTotal - diffIdle) / diffTotal) * 100);
}

/* ─── Helper: PM2 process info ─── */
interface PM2Process {
  name: string;
  pid: number;
  status: string;
  cpu: number;
  memMB: number;
  uptime: string;
  restarts: number;
}

function formatUptime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

function getPM2Processes(): PM2Process[] {
  const raw = exec("pm2 jlist 2>/dev/null");
  if (!raw) return [];
  try {
    const procs = JSON.parse(raw);
    return procs.map((p: any) => ({
      name: p.name,
      pid: p.pid,
      status: p.pm2_env?.status || 'unknown',
      cpu: p.monit?.cpu || 0,
      memMB: Math.round((p.monit?.memory || 0) / 1024 / 1024),
      uptime: p.pm2_env?.pm_uptime ? formatUptime(Date.now() - p.pm2_env.pm_uptime) : '—',
      restarts: p.pm2_env?.restart_time || 0,
    }));
  } catch { return []; }
}

/* ─── Helper: ClickHouse stats ─── */
async function getClickHouseStats() {
  try {
    const client = await getClickHouseClient();
    // Query system tables — uses whatever database the default CH server is configured for
    const [partsRes, dbSizeRes, uptimeRes, mergesRes, memRes] = await Promise.all([
      client.query({ query: `SELECT database, table, count() as parts, sum(rows) as total_rows, sum(bytes_on_disk) as bytes FROM system.parts WHERE active AND database='refinery' GROUP BY database, table ORDER BY parts DESC LIMIT 50` }),
      client.query({ query: `SELECT formatReadableSize(sum(bytes_on_disk)) as total_size, sum(rows) as total_rows FROM system.parts WHERE active AND database='refinery'` }),
      client.query({ query: `SELECT uptime() as uptime_sec, version() as version` }),
      client.query({ query: `SELECT count() as active_merges, sum(num_parts) as parts_merging FROM system.merges` }),
      client.query({ query: `SELECT metric, value FROM system.metrics WHERE metric IN ('MemoryTracking', 'Query', 'Merge')` }),
    ]);
    const parts = await partsRes.json<any>();
    const dbSize = await dbSizeRes.json<any>();
    const uptime = await uptimeRes.json<any>();
    const merges = await mergesRes.json<any>();
    const mem = await memRes.json<any>();

    // Parse system.metrics
    const metricsMap: Record<string, number> = {};
    for (const row of (mem.data || [])) {
      metricsMap[row.metric] = Number(row.value);
    }

    return {
      ok: true,
      tables: (parts.data || []).map((t: any) => ({
        database: t.database,
        table: t.table,
        parts: Number(t.parts),
        rows: Number(t.total_rows),
        bytes: Number(t.bytes),
      })),
      totalSize: dbSize.data?.[0]?.total_size || '0 B',
      totalRows: Number(dbSize.data?.[0]?.total_rows || 0),
      uptimeSec: Number(uptime.data?.[0]?.uptime_sec || 0),
      version: uptime.data?.[0]?.version || 'unknown',
      activeMerges: Number(merges.data?.[0]?.active_merges || 0),
      partsMerging: Number(merges.data?.[0]?.parts_merging || 0),
      memoryTrackingBytes: metricsMap['MemoryTracking'] || 0,
      activeQueries: metricsMap['Query'] || 0,
    };
  } catch (e: any) {
    return { ok: false, error: e.message, tables: [], totalSize: '0 B', totalRows: 0, uptimeSec: 0, version: 'unknown', activeMerges: 0, partsMerging: 0, memoryTrackingBytes: 0, activeQueries: 0 };
  }
}

/* ─── S3 / MinIO stats ─── */
async function getS3Stats() {
  try {
    const client = await getClickHouseClient();
    const res = await client.query({
      query: `SELECT id, label, bucket, region, is_active, last_test_ok, last_tested_at FROM refinery.s3_sources WHERE is_active = 1 ORDER BY label`
    });
    const data = await res.json<any>();
    return (data.data || []).map((s: any) => ({
      id: s.id, name: s.label, bucket: s.bucket, region: s.region,
      isActive: s.is_active === 1,
      lastTestOk: s.last_test_ok === 1,
      lastTestedAt: s.last_tested_at,
    }));
  } catch {
    return [];
  }
}

/* ─── Main endpoint ─── */
router.get('/metrics', async (_req: Request, res: Response) => {
  try {
    // Return cached if fresh
    if (metricsCache && Date.now() - metricsCache.ts < CACHE_TTL_MS) {
      return res.json(metricsCache.data);
    }

    // System info
    const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);
    const freeMemMB  = Math.round(os.freemem() / 1024 / 1024);
    const usedMemMB  = totalMemMB - freeMemMB;
    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model || 'Unknown';
    const cpuCores = cpus.length;
    const loadAvg = os.loadavg();
    const cpuUsagePct = getCpuUsagePct();

    // Disk, PM2, ClickHouse, S3 — parallelize async parts
    const disks = getDiskInfo();
    const pm2Processes = getPM2Processes();
    const [clickhouse, s3Sources] = await Promise.all([
      getClickHouseStats(),
      getS3Stats(),
    ]);

    // Network IPs
    const networkInterfaces = os.networkInterfaces();
    const ips: string[] = [];
    for (const iface of Object.values(networkInterfaces)) {
      if (!iface) continue;
      for (const info of iface) {
        if (!info.internal && info.family === 'IPv4') {
          ips.push(info.address);
        }
      }
    }

    const hostname = os.hostname();
    const platform = `${os.type()} ${os.release()}`;
    const uptimeSec = os.uptime();
    const dockerCount = exec("docker ps -q 2>/dev/null | wc -l");

    const payload = {
      system: {
        hostname,
        platform,
        uptimeSec,
        ips,
        cpuModel,
        cpuCores,
        cpuUsagePct,
        loadAvg: loadAvg.map(l => Math.round(l * 100) / 100),
        ram: { totalMB: totalMemMB, usedMB: usedMemMB, freeMB: freeMemMB, usePct: Math.round((usedMemMB / totalMemMB) * 100) },
        dockerContainers: parseInt(dockerCount) || 0,
      },
      disks,
      network: getNetworkStats(),
      pm2: pm2Processes,
      clickhouse,
      s3: s3Sources,
      collectedAt: new Date().toISOString(),
    };

    metricsCache = { data: payload, ts: Date.now() };
    res.json(payload);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
