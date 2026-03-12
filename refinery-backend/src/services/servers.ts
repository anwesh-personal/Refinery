import { createClient as createCHClient, ClickHouseClient } from '@clickhouse/client';
import { env } from '../config/env.js';
import { supabaseAdmin } from './supabaseAdmin.js';

// ═══════════════════════════════════════════════════════════════
// Server Registry — Manages multiple ClickHouse/S3/Linode connections
//
// - CRUD operations via shared Supabase admin client
// - Dynamic ClickHouse client factory with connection caching
// - Connection health checks with timeout
// ═══════════════════════════════════════════════════════════════

// ── Types ──

export interface ServerRecord {
  id: string;
  name: string;
  type: 'clickhouse' | 's3' | 'linode';
  host: string;
  port: number;
  username: string;
  password: string;
  database_name: string;
  bucket: string | null;
  region: string;
  access_key: string;
  secret_key: string;
  endpoint_url: string | null;
  is_default: boolean;
  is_active: boolean;
  last_ping_at: string | null;
  last_ping_ok: boolean | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Safe version — no credentials. This is what the API returns to clients. */
export interface ServerSafe {
  id: string;
  name: string;
  type: 'clickhouse' | 's3' | 'linode';
  host: string;
  port: number;
  database_name: string;
  bucket: string | null;
  region: string;
  endpoint_url: string | null;
  is_default: boolean;
  is_active: boolean;
  last_ping_at: string | null;
  last_ping_ok: boolean | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}


/** Allowlisted fields for CREATE */
const CREATE_FIELDS = [
  'name', 'type', 'host', 'port', 'username', 'password', 'database_name',
  'bucket', 'region', 'access_key', 'secret_key', 'endpoint_url',
  'is_default', 'is_active', 'created_by',
] as const;

/** Allowlisted fields for UPDATE */
const UPDATE_FIELDS = [
  'name', 'host', 'port', 'username', 'password', 'database_name',
  'bucket', 'region', 'access_key', 'secret_key', 'endpoint_url',
  'is_default',
] as const;

function pickFields<T extends Record<string, any>>(source: T, fields: readonly string[]): Partial<T> {
  const result: any = {};
  for (const key of fields) {
    if (key in source && source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// CRUD
// ═══════════════════════════════════════════════════════════════

// Columns for safe SELECT (no credentials)
const SAFE_COLUMNS = 'id, name, type, host, port, database_name, bucket, region, endpoint_url, is_default, is_active, last_ping_at, last_ping_ok, created_by, created_at, updated_at';

export async function listServers(): Promise<ServerSafe[]> {
  const { data, error } = await supabaseAdmin
    .from('servers')
    .select(SAFE_COLUMNS)
    .eq('is_active', true)
    .order('type')
    .order('name');
  if (error) throw new Error(`Failed to list servers: ${error.message}`);
  return (data || []) as ServerSafe[];
}

/** Internal only — returns full record with credentials. NEVER return to client. */
async function getServerInternal(id: string): Promise<ServerRecord> {
  const { data, error } = await supabaseAdmin
    .from('servers')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw new Error(`Server not found: ${error.message}`);
  return data as ServerRecord;
}

/** Public — returns safe record without credentials */
export async function getServer(id: string): Promise<ServerSafe> {
  const { data, error } = await supabaseAdmin
    .from('servers')
    .select(SAFE_COLUMNS)
    .eq('id', id)
    .single();
  if (error) throw new Error(`Server not found: ${error.message}`);
  return data as ServerSafe;
}

export async function getDefaultServer(type: string): Promise<ServerRecord | null> {
  const { data, error } = await supabaseAdmin
    .from('servers')
    .select('*')
    .eq('type', type)
    .eq('is_default', true)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw new Error(`Failed to get default server: ${error.message}`);
  return data as ServerRecord | null;
}

export async function createServer(input: Record<string, any>): Promise<ServerSafe> {
  const sanitized = pickFields(input, CREATE_FIELDS);

  const { data, error } = await supabaseAdmin
    .from('servers')
    .insert(sanitized as any)
    .select(SAFE_COLUMNS)
    .single();
  if (error) throw new Error(`Failed to create server: ${error.message}`);
  clientCache.clear();
  return data as ServerSafe;
}

export async function updateServer(id: string, updates: Record<string, any>): Promise<ServerSafe> {
  // Only allow updating allowlisted fields — prevent overwriting created_by, is_active, etc.
  const sanitized = pickFields(updates, UPDATE_FIELDS);

  // If password/secret_key is empty string, don't update it (keep existing)
  if (sanitized.password === '') delete sanitized.password;
  if (sanitized.secret_key === '') delete sanitized.secret_key;
  if (sanitized.access_key === '')  delete sanitized.access_key;

  if (Object.keys(sanitized).length === 0) {
    return getServer(id); // Nothing to update
  }

  const { data, error } = await supabaseAdmin
    .from('servers')
    .update(sanitized as any)
    .eq('id', id)
    .select(SAFE_COLUMNS)
    .single();
  if (error) throw new Error(`Failed to update server: ${error.message}`);
  
  // Invalidate cached client
  const cached = clientCache.get(id);
  if (cached) {
    cached.client.close().catch(() => {}); // Close old connection
    clientCache.delete(id);
  }
  
  return data as ServerSafe;
}

export async function deleteServer(id: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('servers')
    .update({ is_active: false, is_default: false } as any)
    .eq('id', id);
  if (error) throw new Error(`Failed to delete server: ${error.message}`);
  
  // Close and remove cached client
  const cached = clientCache.get(id);
  if (cached) {
    cached.client.close().catch(() => {});
    clientCache.delete(id);
  }
}

export async function setDefault(id: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('servers')
    .update({ is_default: true } as any)
    .eq('id', id);
  if (error) throw new Error(`Failed to set default: ${error.message}`);
}

// ═══════════════════════════════════════════════════════════════
// Dynamic ClickHouse Client Factory
// ═══════════════════════════════════════════════════════════════

const clientCache = new Map<string, { client: ClickHouseClient; createdAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get a ClickHouse client for a specific server ID.
 * If no serverId, uses the default ClickHouse server.
 * Falls back to env vars if no servers are configured.
 */
export async function getClickHouseClient(serverId?: string): Promise<ClickHouseClient> {
  if (!serverId) {
    const defaultServer = await getDefaultServer('clickhouse');
    if (defaultServer) {
      serverId = defaultServer.id;
    } else {
      return getFallbackClient();
    }
  }

  // Check cache — close expired clients
  const cached = clientCache.get(serverId);
  if (cached) {
    if (Date.now() - cached.createdAt < CACHE_TTL_MS) {
      return cached.client;
    }
    // Expired — close old connection before creating new one
    cached.client.close().catch(() => {});
    clientCache.delete(serverId);
  }

  // Fetch full record (internal, with credentials)
  const server = await getServerInternal(serverId);
  if (server.type !== 'clickhouse') {
    throw new Error(`Server ${server.name} is not a ClickHouse server`);
  }

  const client = createCHClient({
    url: `${server.host}:${server.port}`,
    username: server.username || 'default',
    password: server.password || '',
    database: server.database_name || 'default',
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 1,
    },
  });

  clientCache.set(serverId, { client, createdAt: Date.now() });
  return client;
}

// Fallback: use env vars (original singleton behavior)
let fallbackClient: ClickHouseClient | null = null;
function getFallbackClient(): ClickHouseClient {
  if (!fallbackClient) {
    fallbackClient = createCHClient({
      url: env.clickhouse.host,
      username: env.clickhouse.user,
      password: env.clickhouse.password,
      database: env.clickhouse.database,
      clickhouse_settings: {
        async_insert: 1,
        wait_for_async_insert: 1,
      },
    });
  }
  return fallbackClient;
}

// ═══════════════════════════════════════════════════════════════
// Health Check (with 5-second timeout)
// ═══════════════════════════════════════════════════════════════

const PING_TIMEOUT_MS = 5000;

export async function testConnection(id: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const server = await getServerInternal(id);

    if (server.type === 'clickhouse') {
      const client = createCHClient({
        url: `${server.host}:${server.port}`,
        username: server.username || 'default',
        password: server.password || '',
        database: server.database_name || 'default',
        request_timeout: PING_TIMEOUT_MS,
      });

      // Race against timeout
      const pingPromise = client.ping();
      const timeoutPromise = new Promise<{ success: false }>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timed out after 5s')), PING_TIMEOUT_MS)
      );

      let result: { success: boolean };
      try {
        result = await Promise.race([pingPromise, timeoutPromise]);
      } catch (err: any) {
        await client.close().catch(() => {});
        throw err;
      }

      const latencyMs = Date.now() - start;

      await supabaseAdmin
        .from('servers')
        .update({ last_ping_at: new Date().toISOString(), last_ping_ok: result.success } as any)
        .eq('id', id);

      await client.close().catch(() => {});
      return { ok: result.success, latencyMs };
    }

    if (server.type === 's3' || server.type === 'linode') {
      const endpoint = server.endpoint_url || `https://s3.${server.region}.amazonaws.com`;
      const resp = await fetch(endpoint, { method: 'HEAD', signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
      const latencyMs = Date.now() - start;
      const ok = resp.status < 500;

      await supabaseAdmin
        .from('servers')
        .update({ last_ping_at: new Date().toISOString(), last_ping_ok: ok } as any)
        .eq('id', id);

      return { ok, latencyMs };
    }

    return { ok: false, latencyMs: 0, error: `Unknown server type: ${server.type}` };
  } catch (err: any) {
    const latencyMs = Date.now() - start;

    try {
      await supabaseAdmin
        .from('servers')
        .update({ last_ping_at: new Date().toISOString(), last_ping_ok: false } as any)
        .eq('id', id);
    } catch { /* Don't fail if DB update fails during error handling */ }

    return { ok: false, latencyMs, error: err.message };
  }
}
