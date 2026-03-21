import { Request } from 'express';

// ═══════════════════════════════════════════════════════════════
// Type-safe user identity attached by requireAuth middleware
// ═══════════════════════════════════════════════════════════════

export interface AuthUser {
    /** Supabase auth user UUID */
    id: string;
    /** Display name from profiles.full_name */
    fullName: string;
    /** Email from profiles.email */
    email: string;
    /** Role from profiles.role */
    role: string;
}

/**
 * Extended Express Request with typed user identity.
 * After requireAuth runs, req.authUser is guaranteed to be populated.
 */
export interface AuthenticatedRequest extends Request {
    authUser: AuthUser;
}

/**
 * Helper to extract user identity from a request.
 * Falls back gracefully if middleware hasn't run (returns 'system').
 */
export function getRequestUser(req: Request): { id: string; name: string; email: string } {
    const authReq = req as AuthenticatedRequest;
    if (authReq.authUser) {
        return {
            id: authReq.authUser.id,
            name: authReq.authUser.fullName,
            email: authReq.authUser.email,
        };
    }
    // Fallback for unauthenticated or system-initiated requests
    return { id: 'system', name: 'System', email: '' };
}
