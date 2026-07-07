-- Migration: Add admin role management policy
-- Allows admins to update profiles in their organization (for role changes)

CREATE POLICY "Admins can update profiles in their org"
  ON public.profiles FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() = 'admin'
  );
