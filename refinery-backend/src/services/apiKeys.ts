import { createHash, randomBytes } from 'crypto';
import { query, insertRows } from '../db/clickhouse.js';
import { genId } from '../utils/helpers.js';

// ═══════════════════════════════════════════════════════════════
// API Key Service — generate, validate, manage machine-to-machine keys
// Format: rnx_{environment}_{32 random hex chars}
// Storage: SHA-256 hash in ClickHouse, plain key shown once at creation
// ═══════════════════════════════════════════════════════════════

export const ALL_SCOPES = [
  'contacts:read',
  'contacts:write',
  'segments:read',
  'segments:write',
  'verify:read',
  'verify:write',
  'webhooks:write',
  'stats:read',
] as const;

export type ApiKeyScope = (typeof ALL_SCOPES)[number];

export interface ApiKeyRecord {
  id: string;
  key_hash: string;
  key_prefix: string;
  name: string;
  owner_id: string;
  scopes: ApiKeyScope[];
  environment: string;
  rate_limit_rpm: number;
  is_active: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

export interface CreateKeyInput {
  name: string;
  ownerId: string;
  scopes: ApiKeyScope[];
  environment?: 'live' | 'test';
  rateLimitRpm?: number;
  expiresAt?: string;
}

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function generateRawKey(env: 'live' | 'test'): string {
  const random = randomBytes(24).toString('hex');
  return `rnx_${env}_${random}`;
}

/** Create a new API key. Returns the raw key (shown once) + record metadata. */
export async function createApiKey(input: CreateKeyInput) {
  const id = genId();
  const environment = input.environment || 'live';
  const rawKey = generateRawKey(environment);
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 16);

  const row = {
    id,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    name: input.name,
    owner_id: input.ownerId,
    scopes: input.scopes,
    environment,
    rate_limit_rpm: input.rateLimitRpm ?? 60,
    is_active: 1,
    last_used_at: null,
    expires_at: input.expiresAt ?? null,
  };

  await insertRows('api_keys', [row]);

  return {
    id,
    key: rawKey,
    keyPrefix,
    name: input.name,
    scopes: input.scopes,
    environment,
    rateLimitRpm: row.rate_limit_rpm,
    expiresAt: row.expires_at,
  };
}

/** Validate a raw API key. Returns the key record if valid, null if not. */
export async function validateApiKey(rawKey: string): Promise<ApiKeyRecord | null> {
  if (!rawKey.startsWith('rnx_live_') && !rawKey.startsWith('rnx_test_')) {
    return null;
  }

  const keyHash = hashKey(rawKey);

  const rows = await query<ApiKeyRecord>(
    `SELECT * FROM api_keys FINAL WHERE key_hash = '${keyHash}' AND is_active = 1 LIMIT 1`,
  );

  if (rows.length === 0) return null;

  const record = rows[0];

  if (record.expires_at) {
    const expiry = new Date(record.expires_at);
    if (expiry < new Date()) return null;
  }

  touchLastUsed(record.id, record).catch(() => {});

  return record;
}

/** Update last_used_at (fire-and-forget, non-blocking) */
async function touchLastUsed(id: string, existing: ApiKeyRecord): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await insertRows('api_keys', [{
    ...existing,
    last_used_at: now,
    updated_at: now,
  }]);
}

/** List all keys for an owner (masks the hash, returns metadata only) */
export async function listApiKeys(ownerId: string): Promise<Omit<ApiKeyRecord, 'key_hash'>[]> {
  const rows = await query<ApiKeyRecord>(
    `SELECT * FROM api_keys FINAL WHERE owner_id = '${ownerId}' ORDER BY created_at DESC`,
  );

  return rows.map(({ key_hash: _, ...rest }) => rest);
}

/** List ALL keys (superadmin) */
export async function listAllApiKeys(): Promise<Omit<ApiKeyRecord, 'key_hash'>[]> {
  const rows = await query<ApiKeyRecord>(
    `SELECT * FROM api_keys FINAL ORDER BY created_at DESC`,
  );

  return rows.map(({ key_hash: _, ...rest }) => rest);
}

/** Revoke (soft-delete) an API key */
export async function revokeApiKey(id: string, ownerId?: string): Promise<boolean> {
  let filter = `id = '${id}'`;
  if (ownerId) filter += ` AND owner_id = '${ownerId}'`;

  const rows = await query<ApiKeyRecord>(
    `SELECT * FROM api_keys FINAL WHERE ${filter} LIMIT 1`,
  );

  if (rows.length === 0) return false;

  const existing = rows[0];
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  await insertRows('api_keys', [{
    ...existing,
    is_active: 0,
    updated_at: now,
  }]);

  return true;
}

/** Check if a key record has a specific scope */
export function hasScope(record: ApiKeyRecord, scope: ApiKeyScope): boolean {
  return record.scopes.includes(scope);
}
