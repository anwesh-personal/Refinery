import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// ═══════════════════════════════════════════════════════════════
// Shared Supabase Admin Client — single instance for all backend
//
// Uses the service role key (bypasses RLS).
// NEVER import this in frontend code.
// ═══════════════════════════════════════════════════════════════

if (!env.supabase.secretKey) {
  console.error('[FATAL] SUPABASE_SECRET_KEY is not set. Admin operations will fail.');
}

export const supabaseAdmin = createClient(
  env.supabase.url,
  env.supabase.secretKey || env.supabase.publishableKey,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
