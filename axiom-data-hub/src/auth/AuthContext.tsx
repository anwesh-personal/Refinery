import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { Session, User } from '@supabase/supabase-js';

/* ═══════════════════════════════════════
   PERMISSION KEYS
   Single source of truth for every UI toggle.
   Keys match the JSONB column in public.profiles.
   ═══════════════════════════════════════ */

export const ALL_PERMISSIONS = {
  // ── Pages ──
  canViewDashboard:     { label: 'View Dashboard',           group: 'Pages' },
  canViewIngestion:     { label: 'View S3 Ingestion',        group: 'Pages' },
  canViewDatabase:      { label: 'View ClickHouse',          group: 'Pages' },
  canViewSegments:      { label: 'View Segments',            group: 'Pages' },
  canViewVerification:  { label: 'View Verification',        group: 'Pages' },
  canViewTargets:       { label: 'View Email Targets',       group: 'Pages' },
  canViewQueue:         { label: 'View Mail Queue',          group: 'Pages' },
  canViewConfig:        { label: 'View Server Config',       group: 'Pages' },
  canViewLogs:          { label: 'View Logs',                group: 'Pages' },
  canViewTeam:          { label: 'View Team Page',           group: 'Pages' },

  // ── Ingestion ──
  canStartIngestion:    { label: 'Start Ingestion Jobs',     group: 'Ingestion' },
  canEditSources:       { label: 'Edit S3 Sources',          group: 'Ingestion' },

  // ── Database ──
  canExecuteQueries:    { label: 'Execute SQL Queries',      group: 'Database' },

  // ── Segments ──
  canCreateSegments:    { label: 'Create Segments',          group: 'Segments' },
  canDeleteSegments:    { label: 'Delete Segments',          group: 'Segments' },
  canExecuteSegments:   { label: 'Execute Segments',         group: 'Segments' },

  // ── Verification ──
  canStartVerification: { label: 'Start Verify550 Batches', group: 'Verification' },
  canEditVerifyConfig:  { label: 'Edit Verify550 Config',   group: 'Verification' },

  // ── Targets ──
  canCreateTargetLists: { label: 'Create Target Lists',      group: 'Targets' },
  canExportData:        { label: 'Export / Download Data',   group: 'Targets' },

  // ── Queue ──
  canStartMailQueue:    { label: 'Start Mail Queue',         group: 'Queue' },
  canPauseMailQueue:    { label: 'Pause / Resume Queue',     group: 'Queue' },
  canFlushMailQueue:    { label: 'Flush Queue (Danger)',      group: 'Queue' },

  // ── System ──
  canEditConfig:        { label: 'Edit Server Config',       group: 'System' },
  canManageUsers:       { label: 'Manage Team Members',      group: 'System' },
  canDeleteData:        { label: 'Delete Data (Danger)',      group: 'System' },
  canViewAuditLog:      { label: 'View Audit Log',           group: 'System' },
} as const;

export type PermissionKey = keyof typeof ALL_PERMISSIONS;

/* ═══════════════════════════════════════
   ROLE DEFAULTS
   Fallback values when a permission is not
   explicitly set in the user's JSONB overrides.
   ═══════════════════════════════════════ */

export type UserRole = 'superadmin' | 'admin' | 'member';

// Fix #6: validate role at runtime instead of blind type cast
const VALID_ROLES: readonly UserRole[] = ['superadmin', 'admin', 'member'];
export function isValidRole(r: unknown): r is UserRole {
  return typeof r === 'string' && (VALID_ROLES as readonly string[]).includes(r);
}

const ROLE_DEFAULTS: Record<UserRole, Record<PermissionKey, boolean>> = {
  superadmin: Object.fromEntries(
    Object.keys(ALL_PERMISSIONS).map((k) => [k, true]),
  ) as Record<PermissionKey, boolean>,

  admin: {
    canViewDashboard: true,     canViewIngestion: true,    canViewDatabase: true,
    canViewSegments: true,      canViewVerification: true, canViewTargets: true,
    canViewQueue: true,         canViewConfig: true,       canViewLogs: true,
    canViewTeam: true,          canStartIngestion: true,   canEditSources: true,
    canExecuteQueries: true,    canCreateSegments: true,   canDeleteSegments: false,
    canExecuteSegments: true,   canStartVerification: true, canEditVerifyConfig: true,
    canCreateTargetLists: true, canExportData: true,       canStartMailQueue: true,
    canPauseMailQueue: true,    canFlushMailQueue: false,  canEditConfig: true,
    canManageUsers: false,      canDeleteData: false,      canViewAuditLog: true,
  },

  member: {
    canViewDashboard: true,     canViewIngestion: true,    canViewDatabase: false,
    canViewSegments: true,      canViewVerification: true, canViewTargets: true,
    canViewQueue: true,         canViewConfig: false,      canViewLogs: true,
    canViewTeam: false,         canStartIngestion: false,  canEditSources: false,
    canExecuteQueries: false,   canCreateSegments: false,  canDeleteSegments: false,
    canExecuteSegments: false,  canStartVerification: false, canEditVerifyConfig: false,
    canCreateTargetLists: false, canExportData: false,     canStartMailQueue: false,
    canPauseMailQueue: false,   canFlushMailQueue: false,  canEditConfig: false,
    canManageUsers: false,      canDeleteData: false,      canViewAuditLog: false,
  },
};

/** Resolve effective permissions: explicit DB overrides > role defaults */
export function resolvePermissions(
  role: UserRole,
  overrides: Partial<Record<PermissionKey, boolean>> = {},
): Record<PermissionKey, boolean> {
  const defaults = ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.member;
  const resolved = { ...defaults };
  for (const [key, value] of Object.entries(overrides)) {
    if (key in resolved && typeof value === 'boolean') {
      (resolved as Record<string, boolean>)[key] = value;
    }
  }
  return resolved;
}

/* ═══════════════════════════════════════
   ROLE DISPLAY
   ═══════════════════════════════════════ */

export const ROLE_LABELS: Record<UserRole, string> = {
  superadmin: 'Superadmin',
  admin:      'Admin',
  member:     'Member',
};

export const ROLE_COLORS: Record<UserRole, { color: string; bg: string }> = {
  superadmin: { color: 'var(--accent)',        bg: 'var(--accent-muted)' },
  admin:      { color: 'var(--purple)',        bg: 'var(--purple-muted)' },
  member:     { color: 'var(--text-tertiary)', bg: 'var(--bg-card-hover)' },
};

/* ═══════════════════════════════════════
   PROFILE ROW TYPE
   Matches public.profiles columns.
   ═══════════════════════════════════════ */

export interface ProfileRow {
  id:             string;
  email:          string;
  full_name:      string;
  avatar_url:     string | null;
  role:           UserRole;
  is_active:      boolean;
  permissions:    Partial<Record<PermissionKey, boolean>>;
  invited_by:     string | null;
  last_active_at: string | null;
  created_at:     string;
  updated_at:     string;
}

/* ═══════════════════════════════════════
   AUTH USER
   ═══════════════════════════════════════ */

export interface AuthUser {
  id:                  string;
  email:               string;
  fullName:            string;
  initials:            string;
  role:                UserRole;
  /** Explicit per-user overrides fetched from public.profiles */
  permissionOverrides: Partial<Record<PermissionKey, boolean>>;
  /** Resolved: overrides merged on top of role defaults */
  permissions:         Record<PermissionKey, boolean>;
  avatarUrl?:          string;
}

function profileRowToAuthUser(row: ProfileRow): AuthUser | null {
  // Reject deactivated users (no invite or explicitly deactivated by superadmin)
  if (!row.is_active) return null;

  const fullName = row.full_name || row.email.split('@')[0] || 'User';
  return {
    id:                  row.id,
    email:               row.email,
    fullName,
    initials:            fullName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2),
    role:                row.role,
    permissionOverrides: row.permissions,
    permissions:         resolvePermissions(row.role, row.permissions),
    avatarUrl:           row.avatar_url ?? undefined,
  };
}

// Fallback parse from JWT metadata (used for initial render before DB fetch)
function parseUserFromMeta(user: User): AuthUser {
  const meta     = user.user_metadata || {};
  const fullName = meta.full_name || meta.name || user.email?.split('@')[0] || 'User';
  // Fix #6: validate role instead of blind cast
  const role: UserRole = isValidRole(meta.role) ? meta.role : 'member';
  const overrides: Partial<Record<PermissionKey, boolean>> =
    meta.permissions && typeof meta.permissions === 'object' ? meta.permissions : {};
  return {
    id:                  user.id,
    email:               user.email || '',
    fullName,
    initials:            fullName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2),
    role,
    permissionOverrides: overrides,
    permissions:         resolvePermissions(role, overrides),
    avatarUrl:           meta.avatar_url,
  };
}

/* ═══════════════════════════════════════
   AUTH CONTEXT
   ═══════════════════════════════════════ */

interface AuthContextType {
  user:    AuthUser | null;
  session: Session | null;
  loading: boolean;
  signIn:  (email: string, password: string) => Promise<{ error?: string }>;
  signUp:  (email: string, password: string, fullName: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  /**
   * Fix #3: Fetches the user's full profile row from public.profiles.
   * Call this after a superadmin updates another user's permissions
   * so the superadmin's own session reflects any self-changes,
   * and so the Team page always shows fresh DB state.
   */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Fetch profile from DB and build AuthUser. Falls back to metadata parse on error. Returns null for deactivated users. */
async function fetchProfileFromDB(userId: string, accessToken: string, fallbackUser: User): Promise<AuthUser | null> {
  try {
    // Use the access token directly in the Authorization header to avoid
    // race conditions where the shared supabase client hasn't set the session yet
    // (happens during lock contention on cold start / HMR).
    const resp = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/profiles?select=*&id=eq.${userId}`,
      {
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      },
    );

    if (!resp.ok) {
      console.warn('[AuthContext] Profile fetch HTTP error:', resp.status);
      return parseUserFromMeta(fallbackUser);
    }

    const rows = await resp.json() as ProfileRow[];
    if (!rows || rows.length === 0) {
      console.warn('[AuthContext] No profile row found for user', userId);
      return parseUserFromMeta(fallbackUser);
    }

    const data = rows[0];
    console.log('[AuthContext] Profile loaded from DB:', { role: data.role, is_active: data.is_active });
    return profileRowToAuthUser(data);
  } catch (err: any) {
    console.error('[AuthContext] Unexpected error fetching profile:', err);
    return parseUserFromMeta(fallbackUser);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Keep a ref to the raw Supabase user for refreshProfile fallback
  const [rawUser, setRawUser] = useState<User | null>(null);

  useEffect(() => {
    // Hydrate on mount
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      setSession(s);
      if (s?.user && s.access_token) {
        setRawUser(s.user);
        // Parse from metadata immediately for instant render
        setUser(parseUserFromMeta(s.user));
        // Then fetch DB row for accurate permissions (using access token directly)
        const profileUser = await fetchProfileFromDB(s.user.id, s.access_token, s.user);
        if (profileUser) {
          setUser(profileUser);
        } else {
          // Deactivated user — sign them out
          await supabase.auth.signOut();
          setUser(null);
          setSession(null);
          setRawUser(null);
        }
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s);
      if (s?.user && s.access_token) {
        setRawUser(s.user);
        setUser(parseUserFromMeta(s.user));
        const profileUser = await fetchProfileFromDB(s.user.id, s.access_token, s.user);
        if (profileUser) {
          setUser(profileUser);
        } else {
          // Deactivated user — sign them out
          await supabase.auth.signOut();
          setUser(null);
          setSession(null);
          setRawUser(null);
        }
      } else {
        setRawUser(null);
        setUser(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return {};
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) return { error: error.message };
    return {};
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setRawUser(null);
    setSession(null);
  };

  // Fix #3: fetch directly from public.profiles, not from JWT metadata
  const refreshProfile = async () => {
    if (!rawUser || !session?.access_token) return;
    const profileUser = await fetchProfileFromDB(rawUser.id, session.access_token, rawUser);
    setUser(profileUser);
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
