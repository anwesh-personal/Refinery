import { createClient } from '@supabase/supabase-js';
import { createClient as createCHClient, ClickHouseClient } from '@clickhouse/client';
import { env } from '../config/env.js';

// ═══════════════════════════════════════════════════════════════
// Server Registry — Manages multiple ClickHouse/S3/Linode connections
//
// - CRUD operations via Supabase admin client
// - Dynamic ClickHouse client factory with connection caching
// - Connection health checks
// ═══════════════════════════════════════════════════════════════

const supabaseAdmin = createClient(
  env.supabase.url,
  env.supabase.secretKey || env.supabase.publishableKey,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

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

export type CreateServerInput = Omit<ServerRecord, 'id' | 'created_at' | 'updated_at' | 'last_ping_at' | 'last_ping_ok'>;

// ── CRUD ──

export async function listServers(): Promise<ServerSafe[]> {
  const { data, error } = await supabaseAdmin
    .from('servers')
    .select('id, name, type, host, port, database_name, bucket, region, endpoint_url, is_default, is_active, last_ping_at, last_ping_ok, created_by, created_at, updated_at')
    .eq('is_active', true)
    .order('type')
    .order('name');
  if (error) throw new Error(`Failed to list servers: ${error.message}`);
  return (data || []) as ServerSafe[];
}

export async function getServer(id: string): Promise<ServerRecord> {
  const { data, error } = await supabaseAdmin
    .from('servers')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw new Error(`Server not found: ${error.message}`);
  return data as ServerRecord;
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

export async function createServer(input: Partial<CreateServerInput>): Promise<ServerRecord> {
  const { data, error } = await supabaseAdmin
    .from('servers')
    .insert(input as any)
    .select()
    .single();
  if (error) throw new Error(`Failed to create server: ${error.message}`);
  // Invalidate cache for this type
  clientCache.clear();
  return data as ServerRecord;
}

export async function updateServer(id: string, updates: Partial<ServerRecord>): Promise<ServerRecord> {
  // Don't allow updating these fields
  delete (updates as any).id;
  delete (updates as any).created_at;
  
  const { data, error } = await supabaseAdmin
    .from('servers')
    .update(updates as any)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`Failed to update server: ${error.message}`);
  // Invalidate cache for this server
  clientCache.delete(id);
  return data as ServerRecord;
}

export async function deleteServer(id: string): Promise<void> {
  // Soft delete
  const { error } = await supabaseAdmin
    .from('servers')
    .update({ is_active: false, is_default: false } as any)
    .eq('id', id);
  if (error) throw new Error(`Failed to delete server: ${error.message}`);
  clientCache.delete(id);
}

export async function setDefault(id: string): Promise<void> {
  // The trigger handles unsetting other defaults
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
  // If no serverId, try default server from DB
  if (!serverId) {
    const defaultServer = await getDefaultServer('clickhouse');
    if (defaultServer) {
      serverId = defaultServer.id;
    } else {
      // Fall back to env-configured client (orig behavior)
      return getFallbackClient();
    }
  }

  // Check cache
  const cached = clientCache.get(serverId);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.client;
  }

  // Create new client from server record
  const server = await getServer(serverId);
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
// Health Check
// ═══════════════════════════════════════════════════════════════

export async function testConnection(id: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const server = await getServer(id);
    
    if (server.type === 'clickhouse') {
      const client = createCHClient({
        url: `${server.host}:${server.port}`,
        username: server.username || 'default',
        password: server.password || '',
        database: server.database_name || 'default',
      });
      
      const result = await client.ping();
      const latencyMs = Date.now() - start;
      
      // Update ping status in DB
      await supabaseAdmin
        .from('servers')
        .update({ last_ping_at: new Date().toISOString(), last_ping_ok: result.success } as any)
        .eq('id', id);
      
      await client.close();
      return { ok: result.success, latencyMs };
    }
    
    if (server.type === 's3' || server.type === 'linode') {
      // For S3/Linode, try a HEAD request to the endpoint
      const endpoint = server.endpoint_url || `https://s3.${server.region}.amazonaws.com`;
      const resp = await fetch(endpoint, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
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
    
    await supabaseAdmin
      .from('servers')
      .update({ last_ping_at: new Date().toISOString(), last_ping_ok: false } as any)
      .eq('id', id);
    
    return { ok: false, latencyMs, error: err.message };
  }
}
