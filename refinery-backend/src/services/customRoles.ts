import { supabaseAdmin } from './supabaseAdmin.js';

export interface CustomRole {
  id: string;
  name: string;
  label: string;
  permissions: Record<string, boolean>;
  is_system: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'id, name, label, permissions, is_system, created_by, created_at, updated_at';

export async function listRoles(): Promise<CustomRole[]> {
  const { data, error } = await supabaseAdmin
    .from('custom_roles')
    .select(COLUMNS)
    .order('name');

  if (error) throw new Error(`Failed to list roles: ${error.message}`);
  return data as CustomRole[];
}

export async function getRole(id: string): Promise<CustomRole> {
  const { data, error } = await supabaseAdmin
    .from('custom_roles')
    .select(COLUMNS)
    .eq('id', id)
    .single();

  if (error) throw new Error(`Failed to get role: ${error.message}`);
  return data as CustomRole;
}

export async function createRole(
  name: string,
  label: string,
  permissions: Record<string, boolean>,
  createdBy: string,
): Promise<CustomRole> {
  const { data, error } = await supabaseAdmin
    .from('custom_roles')
    .insert({ name, label, permissions, is_system: false, created_by: createdBy })
    .select(COLUMNS)
    .single();

  if (error) throw new Error(`Failed to create role: ${error.message}`);
  return data as CustomRole;
}

export async function updateRole(
  id: string,
  name: string,
  label: string,
  permissions: Record<string, boolean>,
): Promise<CustomRole> {
  // Fetch before update to enforce system-role guard
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('custom_roles')
    .select('is_system')
    .eq('id', id)
    .single();

  if (fetchErr) throw new Error(`Failed to fetch role: ${fetchErr.message}`);
  if ((existing as any)?.is_system) throw new Error('Cannot modify a system-reserved role.');

  const { data, error } = await supabaseAdmin
    .from('custom_roles')
    .update({ name, label, permissions })
    .eq('id', id)
    .select(COLUMNS)
    .single();

  if (error) throw new Error(`Failed to update role: ${error.message}`);
  return data as CustomRole;
}

export async function deleteRole(id: string): Promise<void> {
  // Guard 1: system roles are immutable
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('custom_roles')
    .select('is_system')
    .eq('id', id)
    .single();

  if (fetchErr) throw new Error(`Failed to fetch role: ${fetchErr.message}`);
  if ((existing as any)?.is_system) throw new Error('Cannot delete a system-reserved role.');

  // Guard 2: role must not be in use
  const { data: usage, error: usageErr } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('custom_role_id', id)
    .limit(1);

  if (usageErr) throw new Error(`Failed to check role usage: ${usageErr.message}`);
  if (usage && usage.length > 0) {
    throw new Error('Cannot delete a role that is currently assigned to users. Reassign those users first.');
  }

  const { error } = await supabaseAdmin
    .from('custom_roles')
    .delete()
    .eq('id', id);

  if (error) throw new Error(`Failed to delete role: ${error.message}`);
}
