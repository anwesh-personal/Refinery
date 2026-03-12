import { supabaseAdmin } from './supabaseAdmin.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Team {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamWithMembers extends Team {
  members: NormalizedMembership[];
}

export interface TeamMembership {
  team_id: string;
  profile_id: string;
  role_id: string | null;
  joined_at: string;
  /** Joined from profiles — Supabase returns as array for FK joins */
  profiles?: { full_name: string; email: string; avatar_url: string | null; role: string }[] | null;
  /** Joined from custom_roles — Supabase returns as array for FK joins */
  custom_roles?: { name: string; label: string }[] | null;
}

/** Normalized membership for API consumers — flattens Supabase array joins into single objects */
export interface NormalizedMembership {
  team_id: string;
  profile_id: string;
  role_id: string | null;
  joined_at: string;
  profile: { full_name: string; email: string; avatar_url: string | null; role: string } | null;
  team_role: { name: string; label: string } | null;
}

function normalizeMembership(m: TeamMembership): NormalizedMembership {
  return {
    team_id: m.team_id,
    profile_id: m.profile_id,
    role_id: m.role_id,
    joined_at: m.joined_at,
    profile: m.profiles?.[0] ?? null,
    team_role: m.custom_roles?.[0] ?? null,
  };
}

const TEAM_COLUMNS = 'id, name, description, created_by, created_at, updated_at';
const MEMBERSHIP_COLUMNS = 'team_id, profile_id, role_id, joined_at, profiles(full_name, email, avatar_url, role), custom_roles(name, label)';

// ─── Team CRUD ────────────────────────────────────────────────────────────────

export async function listTeams(): Promise<Team[]> {
  const { data, error } = await supabaseAdmin
    .from('teams')
    .select(TEAM_COLUMNS)
    .order('name');

  if (error) throw new Error(`Failed to list teams: ${error.message}`);
  return data as Team[];
}

export async function getTeam(id: string): Promise<Team> {
  const { data, error } = await supabaseAdmin
    .from('teams')
    .select(TEAM_COLUMNS)
    .eq('id', id)
    .single();

  if (error) throw new Error(`Failed to get team: ${error.message}`);
  return data as Team;
}

export async function createTeam(
  name: string,
  description: string | null,
  createdBy: string,
): Promise<Team> {
  // Guard: duplicate name
  const { data: existing } = await supabaseAdmin
    .from('teams').select('id').ilike('name', name.trim()).limit(1);
  if (existing && existing.length > 0) {
    throw new Error('A team with this name already exists.');
  }

  const { data, error } = await supabaseAdmin
    .from('teams')
    .insert({ name, description, created_by: createdBy })
    .select(TEAM_COLUMNS)
    .single();

  if (error) throw new Error(`Failed to create team: ${error.message}`);
  return data as Team;
}

export async function updateTeam(
  id: string,
  name: string,
  description: string | null,
): Promise<Team> {
  // Guard: duplicate name (exclude self)
  const { data: existing } = await supabaseAdmin
    .from('teams').select('id').ilike('name', name.trim()).neq('id', id).limit(1);
  if (existing && existing.length > 0) {
    throw new Error('A team with this name already exists.');
  }

  const { data, error } = await supabaseAdmin
    .from('teams')
    .update({ name, description, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(TEAM_COLUMNS)
    .single();

  if (error) throw new Error(`Failed to update team: ${error.message}`);
  return data as Team;
}

export async function deleteTeam(id: string): Promise<void> {
  // team_memberships CASCADE on delete, so no orphan check needed
  const { error } = await supabaseAdmin
    .from('teams')
    .delete()
    .eq('id', id);

  if (error) throw new Error(`Failed to delete team: ${error.message}`);
}

// ─── Membership CRUD ──────────────────────────────────────────────────────────

export async function getTeamMembers(teamId: string): Promise<NormalizedMembership[]> {
  const { data, error } = await supabaseAdmin
    .from('team_memberships')
    .select(MEMBERSHIP_COLUMNS)
    .eq('team_id', teamId)
    .order('joined_at', { ascending: true });

  if (error) throw new Error(`Failed to get team members: ${error.message}`);
  return (data as TeamMembership[]).map(normalizeMembership);
}

export async function addMember(
  teamId: string,
  profileId: string,
  roleId: string | null,
): Promise<NormalizedMembership> {
  const { data, error } = await supabaseAdmin
    .from('team_memberships')
    .insert({ team_id: teamId, profile_id: profileId, role_id: roleId })
    .select(MEMBERSHIP_COLUMNS)
    .single();

  if (error) {
    if (error.message.includes('duplicate') || error.code === '23505') {
      throw new Error('This user is already a member of this team.');
    }
    throw new Error(`Failed to add member: ${error.message}`);
  }
  return normalizeMembership(data as TeamMembership);
}

export async function updateMemberRole(
  teamId: string,
  profileId: string,
  roleId: string | null,
): Promise<NormalizedMembership> {
  const { data, error } = await supabaseAdmin
    .from('team_memberships')
    .update({ role_id: roleId })
    .eq('team_id', teamId)
    .eq('profile_id', profileId)
    .select(MEMBERSHIP_COLUMNS)
    .single();

  if (error) throw new Error(`Failed to update member role: ${error.message}`);
  return normalizeMembership(data as TeamMembership);
}

export async function removeMember(teamId: string, profileId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('team_memberships')
    .delete()
    .eq('team_id', teamId)
    .eq('profile_id', profileId);

  if (error) throw new Error(`Failed to remove member: ${error.message}`);
}

// ─── Convenience ──────────────────────────────────────────────────────────────

export async function listTeamsWithMemberCount(): Promise<(Team & { member_count: number })[]> {
  // Single query: fetch teams with an embedded count of related memberships.
  // Supabase PostgREST supports `table(count)` syntax for aggregated joins.
  const { data, error } = await supabaseAdmin
    .from('teams')
    .select(`${TEAM_COLUMNS}, team_memberships(count)`)
    .order('name');

  if (error) throw new Error(`Failed to list teams: ${error.message}`);

  return (data || []).map((t: any) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    created_by: t.created_by,
    created_at: t.created_at,
    updated_at: t.updated_at,
    member_count: t.team_memberships?.[0]?.count ?? 0,
  }));
}
