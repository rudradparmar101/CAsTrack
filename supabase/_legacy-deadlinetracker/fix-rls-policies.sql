-- ============================================
-- DeadlineTracker — RLS Policy Fix Migration
-- Run this in the Supabase SQL Editor
-- ============================================
-- 
-- This script drops and recreates the RLS policies
-- to fix the signup flow and ensure multi-tenancy.
-- It is IDEMPOTENT — safe to run multiple times.
-- ============================================

-- ============================================
-- HELPER FUNCTIONS (recreate to ensure they exist)
-- ============================================

CREATE OR REPLACE FUNCTION public.get_user_org_id()
RETURNS UUID AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================
-- ORGANIZATIONS — Drop existing, recreate
-- ============================================

DROP POLICY IF EXISTS "Users can view their own organization" ON public.organizations;
DROP POLICY IF EXISTS "Admins can update their organization" ON public.organizations;
DROP POLICY IF EXISTS "Authenticated users can create an organization" ON public.organizations;
DROP POLICY IF EXISTS "Anyone can read org by invite code" ON public.organizations;

-- Allow authenticated users to see their own organization
CREATE POLICY "Users can view their own organization"
  ON public.organizations FOR SELECT TO authenticated
  USING (id = public.get_user_org_id());

-- Also allow reading any org (needed for invite code lookup during signup)
CREATE POLICY "Anyone can read org by invite code"
  ON public.organizations FOR SELECT TO authenticated
  USING (true);

-- Allow insert during signup (the admin client bypasses RLS anyway,
-- but keep this for completeness in case of direct client usage)
CREATE POLICY "Authenticated users can create an organization"
  ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (true);

-- Only admins can update their own organization
CREATE POLICY "Admins can update their organization"
  ON public.organizations FOR UPDATE TO authenticated
  USING (id = public.get_user_org_id() AND public.get_user_role() = 'admin');

-- ============================================
-- PROFILES — Drop existing, recreate
-- ============================================

DROP POLICY IF EXISTS "Users can view profiles in their organization" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;

-- Users can view profiles in their organization
CREATE POLICY "Users can view profiles in their organization"
  ON public.profiles FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());

-- Users can also view their own profile (even if org lookup fails during setup)
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

-- Users can update their own profile
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());

-- Users can insert their own profile (signup flow)
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- ============================================
-- CLIENTS — Drop existing, recreate
-- ============================================

DROP POLICY IF EXISTS "Users can view clients in their organization" ON public.clients;
DROP POLICY IF EXISTS "Admins can create clients" ON public.clients;
DROP POLICY IF EXISTS "Admins can update clients" ON public.clients;
DROP POLICY IF EXISTS "Admins can delete clients" ON public.clients;

-- Users can view clients in their organization
CREATE POLICY "Users can view clients in their organization"
  ON public.clients FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());

-- Only admins can create clients in their organization
CREATE POLICY "Admins can create clients"
  ON public.clients FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() = 'admin'
  );

-- Only admins can update clients in their organization
CREATE POLICY "Admins can update clients"
  ON public.clients FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() = 'admin'
  );

-- Only admins can delete clients in their organization
CREATE POLICY "Admins can delete clients"
  ON public.clients FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() = 'admin'
  );

-- ============================================
-- TASKS — Drop existing, recreate
-- ============================================

DROP POLICY IF EXISTS "Admins can view all org tasks" ON public.tasks;
DROP POLICY IF EXISTS "Members can view their assigned tasks" ON public.tasks;
DROP POLICY IF EXISTS "Admins can create tasks" ON public.tasks;
DROP POLICY IF EXISTS "Admins can update any org task" ON public.tasks;
DROP POLICY IF EXISTS "Members can update their assigned tasks" ON public.tasks;
DROP POLICY IF EXISTS "Admins can delete tasks" ON public.tasks;

-- Admins can view ALL tasks in their organization
CREATE POLICY "Admins can view all org tasks"
  ON public.tasks FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() = 'admin'
  );

-- Members can ONLY view tasks assigned to them
CREATE POLICY "Members can view their assigned tasks"
  ON public.tasks FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND assigned_to = auth.uid()
  );

-- Admins can create tasks in their organization
CREATE POLICY "Admins can create tasks"
  ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() = 'admin'
  );

-- Admins can update any task in their organization
CREATE POLICY "Admins can update any org task"
  ON public.tasks FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() = 'admin'
  );

-- Members can update tasks assigned to them
CREATE POLICY "Members can update their assigned tasks"
  ON public.tasks FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND assigned_to = auth.uid()
  );

-- Admins can delete tasks in their organization
CREATE POLICY "Admins can delete tasks"
  ON public.tasks FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() = 'admin'
  );
