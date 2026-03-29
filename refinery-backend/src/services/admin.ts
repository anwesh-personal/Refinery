import { env } from '../config/env.js';
import { supabaseAdmin } from './supabaseAdmin.js';

// ═══════════════════════════════════════════════════════════════
// Admin Services
// ═══════════════════════════════════════════════════════════════

export async function resetPassword(userId: string, newPassword: string) {
  if (!env.supabase.secretKey) throw new Error('Backend is missing SUPABASE_SECRET_KEY');

  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) throw new Error(`Supabase Admin Error: ${error.message}`);
  return true;
}

export async function sendResetLink(email: string) {
  if (!env.supabase.secretKey) throw new Error('Backend is missing SUPABASE_SECRET_KEY');

  const { error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: {
      redirectTo: env.frontendOrigin,
    },
  });
  if (error) throw new Error(`Supabase Admin Error: ${error.message}`);
  return true;
}

export interface ImpersonationSession {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string; role: string; fullName: string };
  readOnly: boolean;
}

export async function generateImpersonationSession(userId: string): Promise<ImpersonationSession> {
  if (!env.supabase.secretKey) throw new Error('Backend is missing SUPABASE_SECRET_KEY');

  // 1. Fetch target user from Supabase Auth
  const { data: authUser, error: userErr } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (userErr || !authUser.user) throw new Error(`User lookup failed: ${userErr?.message || 'Not found'}`);
  if (!authUser.user.email) throw new Error('User has no email associated');

  const targetEmail = authUser.user.email;

  // 2. Fetch their profile to determine role + readOnly flag
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, full_name')
    .eq('id', userId)
    .single();

  const targetRole = profile?.role || 'member';
  const targetName = profile?.full_name || targetEmail.split('@')[0];
  const readOnly = targetRole === 'superadmin';

  // 3. Generate a magic link server-side to extract the OTP token
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: targetEmail,
  });

  if (linkErr) throw new Error(`Link generation failed: ${linkErr.message}`);
  if (!linkData.properties?.hashed_token) throw new Error('No hashed_token in generated link');

  // 4. Verify the OTP server-side to create a real session
  const { data: sessionData, error: sessionErr } = await supabaseAdmin.auth.verifyOtp({
    type: 'magiclink',
    token_hash: linkData.properties.hashed_token,
  });

  if (sessionErr) throw new Error(`Session creation failed: ${sessionErr.message}`);
  if (!sessionData.session) throw new Error('No session returned from OTP verification');

  return {
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
    user: {
      id: userId,
      email: targetEmail,
      role: targetRole,
      fullName: targetName,
    },
    readOnly,
  };
}

export async function updateUserAuth(userId: string, updates: { email?: string; user_metadata?: any }) {
  if (!env.supabase.secretKey) throw new Error('Backend is missing SUPABASE_SECRET_KEY');

  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, updates);
  if (error) throw new Error(`Supabase Admin Error: ${error.message}`);
  return true;
}

export async function deleteAuthUser(userId: string) {
  if (!env.supabase.secretKey) throw new Error('Backend is missing SUPABASE_SECRET_KEY');

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`Supabase Admin Error: ${error.message}`);
  return true;
}

/**
 * Create a new user directly (bypasses invite flow).
 * Creates the Supabase Auth user with email_confirm: true so they can login immediately.
 * The profiles table trigger will auto-create their profile row.
 */
export async function createUser(opts: {
  email: string;
  password: string;
  fullName?: string;
  role?: string;
}): Promise<{ userId: string }> {
  if (!env.supabase.secretKey) throw new Error('Backend is missing SUPABASE_SECRET_KEY');

  // 1. Create the auth user
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: opts.email,
    password: opts.password,
    email_confirm: true, // Skip email verification
    user_metadata: {
      full_name: opts.fullName || opts.email.split('@')[0],
    },
  });

  if (error) throw new Error(`Create user failed: ${error.message}`);
  if (!data.user) throw new Error('User creation returned no user object');

  const userId = data.user.id;

  // 2. Update their profile with role and name (the trigger creates a default row)
  //    Small delay to let the trigger fire
  await new Promise(r => setTimeout(r, 500));

  const updates: Record<string, unknown> = {};
  if (opts.fullName) updates.full_name = opts.fullName;
  if (opts.role) updates.role = opts.role;
  updates.is_active = true;

  // Generate a deterministic avatar so the user has a profile image from day one.
  // DiceBear notionists-neutral style — clean, professional, gender-neutral.
  // If the user later uploads their own avatar via Settings, it overwrites this.
  const DICEBEAR_BASE = 'https://api.dicebear.com/9.x/notionists-neutral';
  const BG_PALETTE = 'b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf';
  updates.avatar_url = `${DICEBEAR_BASE}/svg?seed=${encodeURIComponent(opts.email)}&size=256&backgroundColor=${BG_PALETTE}`;

  if (Object.keys(updates).length > 0) {
    const { error: profileErr } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', userId);

    if (profileErr) {
      console.warn(`[Admin] Profile update after create failed: ${profileErr.message}`);
      // Don't throw — the auth user was created, profile will just have defaults
    }
  }

  return { userId };
}
