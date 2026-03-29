// ═══════════════════════════════════════════════════════════
// Internal API Helper — shared by all tool handlers
//
// Calls our own Express routes with proper auth headers.
// Used instead of duplicating business logic in handlers.
// ═══════════════════════════════════════════════════════════

import type { ToolContext } from '../types.js';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001';

/**
 * Make an authenticated request to our own API routes.
 * Tool handlers call this to reuse existing route logic.
 */
export async function internalApi<T = any>(
  path: string,
  ctx: ToolContext,
  options: {
    method?: string;
    body?: any;
    timeout?: number;
  } = {}
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 30_000);

  try {
    const resp = await fetch(`${API_BASE}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.accessToken}`,
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new Error(`API ${options.method || 'GET'} ${path} failed (${resp.status}): ${errBody.slice(0, 200)}`);
    }

    return (await resp.json()) as T;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`API ${path} timed out after ${(options.timeout || 30_000) / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
