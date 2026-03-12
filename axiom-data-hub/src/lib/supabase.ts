import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY — auth will not work. ' +
    'Create a .env file with these values.',
  );
}

// Singleton: prevent Vite HMR from recreating the client on every hot reload.
// Each createClient() acquires a navigator lock for auth token management.
// If the old client's lock isn't released before a new client grabs it,
// GoTrue throws "Lock broken by another request with the steal option".
const globalRef = globalThis as unknown as { __supabase?: ReturnType<typeof createClient> };

if (!globalRef.__supabase) {
  globalRef.__supabase = createClient(supabaseUrl, supabaseKey);
}

export const supabase = globalRef.__supabase;
