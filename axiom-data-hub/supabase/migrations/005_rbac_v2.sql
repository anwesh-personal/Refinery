-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Custom Roles & Impersonation Support
-- Run this in the Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. Create Custom Roles Table
CREATE TABLE public.custom_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Note: We are keeping the existing 'role' TEXT column on public.profiles (enum-like) 
-- to avoid breaking existing queries and RLS, but adding role_id for the relational link.
-- When a custom role is assigned, `profiles.role` stays 'member', but `profiles.role_id` points to the custom role.
-- Superadmins stay `profiles.role = 'superadmin'`.
ALTER TABLE public.profiles ADD COLUMN custom_role_id UUID REFERENCES public.custom_roles(id);

-- Enable RLS on custom_roles
ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;

-- Everyone can read roles
CREATE POLICY "Anyone can view custom_roles" 
ON public.custom_roles FOR SELECT 
USING (auth.role() = 'authenticated');

-- Only superadmins can manage custom roles (enforced by the profiles.role = 'superadmin')
CREATE POLICY "Superadmins can insert custom_roles" 
ON public.custom_roles FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'superadmin')
);

CREATE POLICY "Superadmins can update custom_roles" 
ON public.custom_roles FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'superadmin')
);

CREATE POLICY "Superadmins can delete non-system custom_roles" 
ON public.custom_roles FOR DELETE
USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'superadmin')
  AND is_system = false
);

-- 2. Audit triggers for Custom Roles
CREATE OR REPLACE FUNCTION audit_custom_role_insert() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.audit_log (actor_id, action, target_id, details)
  VALUES (auth.uid(), 'role_created', NEW.id, jsonb_build_object('name', NEW.name, 'permissions', NEW.permissions));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_custom_role_created
  AFTER INSERT ON public.custom_roles
  FOR EACH ROW EXECUTE FUNCTION audit_custom_role_insert();

CREATE OR REPLACE FUNCTION audit_custom_role_update() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.audit_log (actor_id, action, target_id, details)
  VALUES (auth.uid(), 'role_updated', NEW.id, jsonb_build_object('name', NEW.name, 'old_permissions', OLD.permissions, 'new_permissions', NEW.permissions));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_custom_role_updated
  AFTER UPDATE ON public.custom_roles
  FOR EACH ROW
  WHEN (OLD.permissions IS DISTINCT FROM NEW.permissions OR OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION audit_custom_role_update();

CREATE OR REPLACE FUNCTION audit_custom_role_delete() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.audit_log (actor_id, action, target_id, details)
  VALUES (auth.uid(), 'role_deleted', OLD.id, jsonb_build_object('name', OLD.name));
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_custom_role_deleted
  AFTER DELETE ON public.custom_roles
  FOR EACH ROW EXECUTE FUNCTION audit_custom_role_delete();

-- 3. Teams Table
CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.team_memberships (
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_id UUID REFERENCES public.custom_roles(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, profile_id)
);

-- Enable RLS on teams
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_memberships ENABLE ROW LEVEL SECURITY;

-- Only superadmins can manage teams currently
CREATE POLICY "Superadmins can manage teams" 
ON public.teams FOR ALL 
USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'superadmin'));

-- Anyone authenticated can view teams
CREATE POLICY "Anyone can view teams" 
ON public.teams FOR SELECT 
USING (auth.role() = 'authenticated');

-- Same for memberships
CREATE POLICY "Superadmins can manage memberships" 
ON public.team_memberships FOR ALL 
USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'superadmin'));

CREATE POLICY "Anyone can view memberships" 
ON public.team_memberships FOR SELECT 
USING (auth.role() = 'authenticated');
