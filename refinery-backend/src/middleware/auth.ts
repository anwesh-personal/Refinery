import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../services/supabaseAdmin.js';
import type { AuthUser, AuthenticatedRequest } from '../types/auth.js';

// ═══════════════════════════════════════════════════════════════
// Auth Middleware — shared by all route files
// ═══════════════════════════════════════════════════════════════

// Profile cache — avoids hitting Supabase on every single request
// TTL: 5 minutes, auto-evicts stale entries
const PROFILE_CACHE_TTL = 5 * 60 * 1000;
const profileCache = new Map<string, { user: AuthUser; cachedAt: number }>();

/** Periodically clean expired cache entries (every 10 minutes) */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of profileCache) {
    if (now - entry.cachedAt > PROFILE_CACHE_TTL) profileCache.delete(key);
  }
}, 10 * 60 * 1000);

/**
 * Fetch user profile from Supabase (with cache).
 * Returns AuthUser with id, fullName, email, role.
 */
async function resolveUserProfile(userId: string): Promise<AuthUser> {
  const cached = profileCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < PROFILE_CACHE_TTL) {
    return cached.user;
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email, role')
    .eq('id', userId)
    .single();

  const user: AuthUser = {
    id: userId,
    fullName: profile?.full_name || 'Unknown',
    email: profile?.email || '',
    role: profile?.role || 'member',
  };

  profileCache.set(userId, { user, cachedAt: Date.now() });
  return user;
}

/**
 * Validates JWT and attaches typed AuthUser to req.
 * After this middleware, use (req as AuthenticatedRequest).authUser
 */
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization' });
    }
    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid token' });

    // Resolve full profile (cached) and attach to request
    const authUser = await resolveUserProfile(user.id);
    (req as AuthenticatedRequest).authUser = authUser;

    next();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/** Checks that the authenticated user has superadmin role. Must run AFTER requireAuth. */
export const requireSuperadmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.authUser) return res.status(401).json({ error: 'Not authenticated' });

    if (authReq.authUser.role !== 'superadmin') {
      return res.status(403).json({ error: 'Superadmin required' });
    }
    next();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Invalidate a specific user's cached profile.
 * Call this when a profile is updated (role change, name change, etc.)
 */
export function invalidateProfileCache(userId: string): void {
  profileCache.delete(userId);
}
