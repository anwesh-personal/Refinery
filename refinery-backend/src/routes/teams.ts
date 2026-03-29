import { Router } from 'express';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';
import * as teamService from '../services/teams.js';
import { logAudit } from '../services/auditLog.js';
import { getRequestUser } from '../types/auth.js';

const router = Router();

// ── Team CRUD ─────────────────────────────────────────────────────────────────

/** GET /api/teams — all authenticated users can list teams (needed for UI) */
router.get('/', requireAuth, async (_req, res) => {
  try {
    const teams = await teamService.listTeamsWithMemberCount();
    res.json({ teams });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/teams/:id — get team with members */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const teamId = String(req.params.id);
    const [team, members] = await Promise.all([
      teamService.getTeam(teamId),
      teamService.getTeamMembers(teamId),
    ]);
    res.json({ team, members });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/teams — superadmin only */
router.post('/', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const { name, description } = req.body;
    const actorId = getRequestUser(req).id;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    const team = await teamService.createTeam(
      name.trim(),
      description?.trim() || null,
      actorId,
    );
    await logAudit(actorId, 'team_created', team.id, { name: team.name });
    res.status(201).json({ team });
  } catch (err: any) {
    if (err.message.includes('already exists')) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/teams/:id — superadmin only */
router.put('/:id', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const { name, description } = req.body;
    const actorId = getRequestUser(req).id;
    const teamId = String(req.params.id);

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    const team = await teamService.updateTeam(teamId, name.trim(), description?.trim() || null);
    await logAudit(actorId, 'team_updated', team.id, { name: team.name });
    res.json({ team });
  } catch (err: any) {
    if (err.message.includes('already exists')) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/teams/:id — superadmin only */
router.delete('/:id', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const teamId = String(req.params.id);
    const actorId = getRequestUser(req).id;

    await teamService.deleteTeam(teamId);
    await logAudit(actorId, 'team_deleted', teamId, {});
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Membership Management ─────────────────────────────────────────────────────

/** Verify team exists or return 404 */
async function assertTeamExists(teamId: string, res: any): Promise<boolean> {
  try {
    await teamService.getTeam(teamId);
    return true;
  } catch {
    res.status(404).json({ error: 'Team not found' });
    return false;
  }
}

/** GET /api/teams/:id/members — get members with profile + role data */
router.get('/:id/members', requireAuth, async (req, res) => {
  try {
    const teamId = String(req.params.id);
    if (!(await assertTeamExists(teamId, res))) return;
    const members = await teamService.getTeamMembers(teamId);
    res.json({ members });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/teams/:id/members — add a member to a team */
router.post('/:id/members', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const teamId = String(req.params.id);
    if (!(await assertTeamExists(teamId, res))) return;
    const actorId = getRequestUser(req).id;
    const { profile_id, role_id } = req.body;

    if (!profile_id || typeof profile_id !== 'string') {
      return res.status(400).json({ error: 'profile_id is required' });
    }

    const membership = await teamService.addMember(teamId, profile_id, role_id || null);
    await logAudit(actorId, 'team_member_added', teamId, { profile_id, role_id: role_id || null });
    res.status(201).json({ membership });
  } catch (err: any) {
    if (err.message.includes('already a member')) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/teams/:id/members/:profileId — update member's team-scoped role */
router.put('/:id/members/:profileId', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const teamId = String(req.params.id);
    if (!(await assertTeamExists(teamId, res))) return;
    const profileId = String(req.params.profileId);
    const actorId = getRequestUser(req).id;
    const { role_id } = req.body;

    const membership = await teamService.updateMemberRole(teamId, profileId, role_id || null);
    await logAudit(actorId, 'team_member_role_updated', teamId, { profile_id: profileId, role_id: role_id || null });
    res.json({ membership });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/teams/:id/members/:profileId — remove member from team */
router.delete('/:id/members/:profileId', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const teamId = String(req.params.id);
    if (!(await assertTeamExists(teamId, res))) return;
    const profileId = String(req.params.profileId);
    const actorId = getRequestUser(req).id;

    await teamService.removeMember(teamId, profileId);
    await logAudit(actorId, 'team_member_removed', teamId, { profile_id: profileId });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
