import { supabaseAdmin } from './supabaseAdmin.js';

/**
 * Write a structured audit log entry from the backend.
 * Must be called with an explicit actorId from the JWT — auth.uid() returns
 * NULL for service-role connections so DB-level triggers cannot be relied on.
 * Failure is logged and swallowed: audit must not crash the primary operation.
 */
export async function logAudit(
  actorId: string,
  action: string,
  targetId: string | null,
  details: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('audit_log')
    .insert({ actor_id: actorId, action, target_id: targetId, details });

  if (error) {
    console.error('[AuditLog] Failed to write entry:', error.message, { actorId, action, targetId });
  }
}
