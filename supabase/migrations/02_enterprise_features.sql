-- ============================================
-- DeadlineTracker — Enterprise Features Migration
-- Run this AFTER the base schema (schema.sql)
-- ============================================

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE public.task_priority AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE public.recurrence_rule AS ENUM ('none', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly');
CREATE TYPE public.review_status AS ENUM ('none', 'pending_approval', 'approved', 'rejected');

-- ============================================
-- ALTER EXISTING TABLES
-- ============================================

-- Tasks: add priority, recurring, approval, and team assignment columns
ALTER TABLE public.tasks
  ADD COLUMN priority public.task_priority NOT NULL DEFAULT 'medium',
  ADD COLUMN recurring_rule public.recurrence_rule NOT NULL DEFAULT 'none',
  ADD COLUMN parent_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  ADD COLUMN assigned_team_id UUID,
  ADD COLUMN review_status public.review_status NOT NULL DEFAULT 'none',
  ADD COLUMN reviewer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN description TEXT DEFAULT '';

-- Alter tasks status CHECK to support the approval workflow
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('pending', 'completed', 'pending_approval', 'approved', 'rejected'));

-- ============================================
-- NEW TABLES
-- ============================================

-- Teams
CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  lead_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Team Members (junction table)
CREATE TABLE public.team_members (
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

-- Now add the FK from tasks to teams
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_assigned_team_fk
  FOREIGN KEY (assigned_team_id) REFERENCES public.teams(id) ON DELETE SET NULL;

-- Task Comments
CREATE TABLE public.task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  mentions UUID[] DEFAULT '{}',
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Task Attachments
CREATE TABLE public.task_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Task Activity Timeline (immutable audit log)
CREATE TABLE public.task_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Notifications
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  reference_id UUID,
  reference_type TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Team Templates
CREATE TABLE public.team_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  default_roles JSONB DEFAULT '[]',
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Task Templates
CREATE TABLE public.task_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  default_priority public.task_priority DEFAULT 'medium',
  checklist_items JSONB DEFAULT '[]',
  recurring_rule public.recurrence_rule DEFAULT 'none',
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_teams_org ON public.teams(organization_id);
CREATE INDEX idx_teams_lead ON public.teams(lead_id);
CREATE INDEX idx_team_members_user ON public.team_members(user_id);
CREATE INDEX idx_tasks_priority ON public.tasks(priority);
CREATE INDEX idx_tasks_recurring ON public.tasks(recurring_rule);
CREATE INDEX idx_tasks_parent ON public.tasks(parent_task_id);
CREATE INDEX idx_tasks_team ON public.tasks(assigned_team_id);
CREATE INDEX idx_tasks_reviewer ON public.tasks(reviewer_id);
CREATE INDEX idx_tasks_review_status ON public.tasks(review_status);
CREATE INDEX idx_comments_task ON public.task_comments(task_id);
CREATE INDEX idx_comments_org ON public.task_comments(organization_id);
CREATE INDEX idx_attachments_task ON public.task_attachments(task_id);
CREATE INDEX idx_attachments_org ON public.task_attachments(organization_id);
CREATE INDEX idx_activities_task ON public.task_activities(task_id);
CREATE INDEX idx_activities_org ON public.task_activities(organization_id);
CREATE INDEX idx_activities_created ON public.task_activities(created_at);
CREATE INDEX idx_notifications_user ON public.notifications(user_id);
CREATE INDEX idx_notifications_read ON public.notifications(user_id, is_read);
CREATE INDEX idx_notifications_created ON public.notifications(created_at DESC);
CREATE INDEX idx_task_templates_org ON public.task_templates(organization_id);

-- ============================================
-- RLS — Enable on all new tables
-- ============================================

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_templates ENABLE ROW LEVEL SECURITY;

-- ---- TEAMS ----
CREATE POLICY "Users can view teams in their org"
  ON public.teams FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());

CREATE POLICY "Admins can create teams"
  ON public.teams FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() = 'admin'
  );

CREATE POLICY "Admins can update teams"
  ON public.teams FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() = 'admin'
  );

CREATE POLICY "Admins can delete teams"
  ON public.teams FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() = 'admin'
  );

-- ---- TEAM MEMBERS ----
CREATE POLICY "Users can view team members in their org"
  ON public.team_members FOR SELECT TO authenticated
  USING (
    team_id IN (
      SELECT id FROM public.teams WHERE organization_id = public.get_user_org_id()
    )
  );

CREATE POLICY "Admins can manage team members"
  ON public.team_members FOR INSERT TO authenticated
  WITH CHECK (
    team_id IN (
      SELECT id FROM public.teams WHERE organization_id = public.get_user_org_id()
    )
    AND public.get_user_role() = 'admin'
  );

CREATE POLICY "Admins can remove team members"
  ON public.team_members FOR DELETE TO authenticated
  USING (
    team_id IN (
      SELECT id FROM public.teams WHERE organization_id = public.get_user_org_id()
    )
    AND public.get_user_role() = 'admin'
  );

-- ---- TASK COMMENTS ----
CREATE POLICY "Users can view comments in their org"
  ON public.task_comments FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());

CREATE POLICY "Users can create comments in their org"
  ON public.task_comments FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND created_by = auth.uid()
  );

CREATE POLICY "Users can update their own comments"
  ON public.task_comments FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND created_by = auth.uid()
  );

CREATE POLICY "Users can delete their own comments"
  ON public.task_comments FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND created_by = auth.uid()
  );

-- ---- TASK ATTACHMENTS ----
CREATE POLICY "Users can view attachments in their org"
  ON public.task_attachments FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());

CREATE POLICY "Users can upload attachments in their org"
  ON public.task_attachments FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND uploaded_by = auth.uid()
  );

CREATE POLICY "Users can delete their own attachments"
  ON public.task_attachments FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND uploaded_by = auth.uid()
  );

-- ---- TASK ACTIVITIES (Immutable — no update or delete) ----
CREATE POLICY "Users can view activities in their org"
  ON public.task_activities FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());

CREATE POLICY "Users can create activities in their org"
  ON public.task_activities FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND actor_id = auth.uid()
  );

-- ---- NOTIFICATIONS ----
CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "System can create notifications"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id());

CREATE POLICY "Users can mark their own notifications as read"
  ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- ---- TEAM TEMPLATES (readable by all, writable only by system/admin) ----
CREATE POLICY "Anyone can view team templates"
  ON public.team_templates FOR SELECT TO authenticated
  USING (true);

-- ---- TASK TEMPLATES ----
CREATE POLICY "Users can view task templates in their org"
  ON public.task_templates FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());

CREATE POLICY "Admins can create task templates"
  ON public.task_templates FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() = 'admin'
  );

CREATE POLICY "Admins can update task templates"
  ON public.task_templates FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() = 'admin'
  );

CREATE POLICY "Admins can delete task templates"
  ON public.task_templates FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() = 'admin'
  );

-- ============================================
-- TRIGGERS — auto-update updated_at
-- ============================================

CREATE TRIGGER on_team_updated
  BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER on_comment_updated
  BEFORE UPDATE ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER on_task_template_updated
  BEFORE UPDATE ON public.task_templates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================
-- SEED: Default Team Templates
-- ============================================

INSERT INTO public.team_templates (name, description, default_roles, is_system) VALUES
  ('Engineering Team', 'Software development and technical operations', '["Lead Engineer", "Senior Developer", "Developer", "QA Engineer"]', true),
  ('Design Team', 'UI/UX design and creative assets', '["Design Lead", "Senior Designer", "Designer", "Design Intern"]', true),
  ('Marketing Team', 'Marketing strategy and content creation', '["Marketing Lead", "Content Manager", "SEO Specialist", "Social Media Manager"]', true),
  ('Operations Team', 'Business operations and process management', '["Operations Lead", "Project Manager", "Coordinator", "Analyst"]', true);

-- ============================================
-- HELPER: Generate next recurrence date
-- ============================================

CREATE OR REPLACE FUNCTION public.next_recurrence_date(
  current_date_val DATE,
  rule public.recurrence_rule
)
RETURNS DATE AS $$
BEGIN
  CASE rule
    WHEN 'daily' THEN RETURN current_date_val + INTERVAL '1 day';
    WHEN 'weekly' THEN RETURN current_date_val + INTERVAL '1 week';
    WHEN 'monthly' THEN RETURN current_date_val + INTERVAL '1 month';
    WHEN 'quarterly' THEN RETURN current_date_val + INTERVAL '3 months';
    WHEN 'yearly' THEN RETURN current_date_val + INTERVAL '1 year';
    ELSE RETURN NULL;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- RLS: Allow members to view team-assigned tasks
-- ============================================

CREATE POLICY "Members can view team-assigned tasks"
  ON public.tasks FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND assigned_team_id IN (
      SELECT team_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );
