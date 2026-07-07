// DeadlineTracker — Email Reminder Edge Function
// Deploy to Supabase: supabase functions deploy send-reminders
//
// This function queries tasks due within 24 hours and sends
// email reminders to the assigned team members via Resend.
//
// Required secrets:
//   RESEND_API_KEY — your Resend API key
//   SUPABASE_URL — auto-set by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-set by Supabase

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Configure via the REMINDER_FROM_EMAIL secret once a domain is verified with Resend.
// Falls back to Resend's shared sandbox sender, which works without domain verification.
const REMINDER_FROM_EMAIL = Deno.env.get('REMINDER_FROM_EMAIL') || 'DeadlineTracker <onboarding@resend.dev>';

interface TaskReminder {
  id: string;
  title: string;
  due_date: string;
  clients: { name: string };
  assigned_profile: { name: string; email: string };
}

Deno.serve(async (req: Request) => {
  try {
    // Use service role to bypass RLS (this is a server-side function)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get tasks due tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const { data: tasks, error } = await supabase
      .from('tasks')
      .select(`
        id,
        title,
        due_date,
        clients:client_id(name),
        assigned_profile:assigned_to(name, email)
      `)
      .eq('status', 'pending')
      .eq('due_date', tomorrowStr)
      .not('assigned_to', 'is', null);

    if (error) {
      console.error('Query error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!tasks || tasks.length === 0) {
      return new Response(JSON.stringify({ message: 'No reminders to send' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Send emails
    const results = [];
    for (const task of tasks as unknown as TaskReminder[]) {
      if (!task.assigned_profile?.email) continue;

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: REMINDER_FROM_EMAIL,
          to: task.assigned_profile.email,
          subject: `Reminder: "${task.title}" is due tomorrow`,
          html: `
            <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: #6366f1; padding: 24px; border-radius: 12px 12px 0 0;">
                <h1 style="color: white; font-size: 20px; margin: 0;">⏰ Deadline Reminder</h1>
              </div>
              <div style="background: white; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
                <p style="color: #334155; font-size: 16px; margin: 0 0 16px;">
                  Hi ${task.assigned_profile.name},
                </p>
                <p style="color: #334155; font-size: 16px; margin: 0 0 16px;">
                  This is a reminder that the following task is due <strong>tomorrow</strong>:
                </p>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 0 0 16px;">
                  <p style="font-size: 18px; font-weight: 600; color: #0f172a; margin: 0 0 8px;">
                    ${task.title}
                  </p>
                  <p style="font-size: 14px; color: #64748b; margin: 0;">
                    Client: ${task.clients?.name || 'N/A'} · Due: ${task.due_date}
                  </p>
                </div>
                <p style="color: #64748b; font-size: 14px; margin: 0;">
                  — DeadlineTracker
                </p>
              </div>
            </div>
          `,
        }),
      });

      results.push({
        task_id: task.id,
        email: task.assigned_profile.email,
        status: res.ok ? 'sent' : 'failed',
      });
    }

    return new Response(
      JSON.stringify({ sent: results.length, results }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    console.error('Error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
