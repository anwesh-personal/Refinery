import { Router } from 'express';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';
import * as roleService from '../services/customRoles.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// Custom Roles API
// ═══════════════════════════════════════════════════════════════

// All authenticated users can list roles (needed to display in Team tab or assign dropdown)
router.get('/', requireAuth, async (_req, res) => {
  try {
    const roles = await roleService.listRoles();
    res.json({ roles });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// All mutating operations require superadmin
router.post('/', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const { name, description, permissions } = req.body;
    const userId = (req as any).userId;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Default to empty object if none provided
    const perms = permissions && typeof permissions === 'object' ? permissions : {};

    const role = await roleService.createRole(
      name,
      description || null,
      perms,
      userId
    );
    res.status(201).json({ role });
  } catch (err: any) {
    // Check for unique name violation
    if (err.message.includes('unique_violation')) {
      return res.status(409).json({ error: 'A role with this name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const { name, description, permissions } = req.body;
    const roleId = String(req.params.id);

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Name is required' });
    }

    const perms = permissions && typeof permissions === 'object' ? permissions : {};

    const role = await roleService.updateRole(
      roleId,
      name,
      description || null,
      perms
    );
    res.json({ role });
  } catch (err: any) {
    if (err.message.includes('unique_violation')) {
      return res.status(409).json({ error: 'A role with this name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const roleId = String(req.params.id);
    await roleService.deleteRole(roleId);
    res.json({ success: true });
  } catch (err: any) {
    if (err.message.includes('assigned to users')) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

export default router;
