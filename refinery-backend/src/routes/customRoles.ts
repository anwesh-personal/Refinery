import { Router } from 'express';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';
import * as roleService from '../services/customRoles.js';
import { logAudit } from '../services/auditLog.js';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Only store explicit `true` grants — false should be absent (defer to base role) */
function sanitizePerms(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === true) out[k] = true;
  }
  return out;
}

// ── Routes ────────────────────────────────────────────────────────────────────

/** GET /api/custom-roles — all authenticated users can list (needed for dropdowns) */
router.get('/', requireAuth, async (_req, res) => {
  try {
    const roles = await roleService.listRoles();
    res.json({ roles });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/custom-roles — superadmin only */
router.post('/', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const { name, label, permissions } = req.body;
    const actorId = (req as any).userId as string;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!label || typeof label !== 'string' || !label.trim()) {
      return res.status(400).json({ error: 'label is required' });
    }

    const role = await roleService.createRole(
      name.trim(),
      label.trim(),
      sanitizePerms(permissions),
      actorId,
    );
    await logAudit(actorId, 'custom_role_created', role.id, {
      name: role.name, label: role.label, permissions: role.permissions,
    });
    res.status(201).json({ role });
  } catch (err: any) {
    if (err.message.includes('unique') || err.message.includes('duplicate')) {
      return res.status(409).json({ error: 'A role with this name already exists.' });
    }
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/custom-roles/:id — superadmin only */
router.put('/:id', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const { name, label, permissions } = req.body;
    const actorId = (req as any).userId as string;
    const roleId = String(req.params.id);

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!label || typeof label !== 'string' || !label.trim()) {
      return res.status(400).json({ error: 'label is required' });
    }

    const role = await roleService.updateRole(roleId, name.trim(), label.trim(), sanitizePerms(permissions));
    await logAudit(actorId, 'custom_role_updated', role.id, {
      name: role.name, label: role.label, permissions: role.permissions,
    });
    res.json({ role });
  } catch (err: any) {
    if (err.message.includes('system-reserved')) {
      return res.status(403).json({ error: err.message });
    }
    if (err.message.includes('unique') || err.message.includes('duplicate')) {
      return res.status(409).json({ error: 'A role with this name already exists.' });
    }
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/custom-roles/:id — superadmin only */
router.delete('/:id', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const roleId = String(req.params.id);
    const actorId = (req as any).userId as string;

    await roleService.deleteRole(roleId);
    await logAudit(actorId, 'custom_role_deleted', roleId, {});
    res.json({ success: true });
  } catch (err: any) {
    if (err.message.includes('system-reserved')) {
      return res.status(403).json({ error: err.message });
    }
    if (err.message.includes('assigned to users')) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

export default router;
