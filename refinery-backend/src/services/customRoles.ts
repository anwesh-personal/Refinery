import { supabaseAdmin } from './supabaseAdmin.js';

// ═══════════════════════════════════════════════════════════════
// Custom Roles Service
// ═══════════════════════════════════════════════════════════════

export interface CustomRole {
  id: string;
  name: string;
  description: string | null;
  permissions: Record<string, boolean>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function listRoles(): Promise<CustomRole[]> {
  const { data, error } = await supabaseAdmin
    .from('custom_roles')
    .select('*')
    .order('name');
  
  if (error) throw new Error(`Failed to list roles: ${error.message}`);
  return data as CustomRole[];
}

export async function getRole(id: string): Promise<CustomRole> {
  const { data, error } = await supabaseAdmin
    .from('custom_roles')
    .select('*')
    .eq('id', id)
    .single();
    
  if (error) throw new Error(`Failed to get role: ${error.message}`);
  return data as CustomRole;
}

export async function createRole(
  name: string,
  description: string | null,
  permissions: Record<string, boolean>,
  createdBy: string
): Promise<CustomRole> {
  const { data, error } = await supabaseAdmin
    .from('custom_roles')
    .insert({
      name,
      description,
      permissions,
      created_by: createdBy,
    })
    .select('*')
    .single();
    
  if (error) throw new Error(`Failed to create role: ${error.message}`);
  return data as CustomRole;
}

export async function updateRole(
  id: string,
  name: string,
  description: string | null,
  permissions: Record<string, boolean>
): Promise<CustomRole> {
  const { data, error } = await supabaseAdmin
    .from('custom_roles')
    .update({
      name,
      description,
      permissions,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();
    
  if (error) throw new Error(`Failed to update role: ${error.message}`);
  return data as CustomRole;
}

export async function deleteRole(id: string): Promise<void> {
  // First check if any profiles are using this role
  const { data: usage, error: checkError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('custom_role_id', id)
    .limit(1);
    
  if (checkError) throw new Error(`Failed to check role usage: ${checkError.message}`);
  if (usage && usage.length > 0) {
    throw new Error('Cannot delete role that is currently assigned to users. Please reassign those users first.');
  }

  const { error } = await supabaseAdmin
    .from('custom_roles')
    .delete()
    .eq('id', id);
    
  if (error) throw new Error(`Failed to delete role: ${error.message}`);
}
