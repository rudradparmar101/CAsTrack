import React from 'react';
import Link from 'next/link';
import {
  Clock,
  CheckCircle2,
  Users,
  Shield,
  ArrowRight,
  BarChart3,
  Zap,
} from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-[var(--color-surface)]/80 backdrop-blur-lg border-b border-[var(--color-border)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-[var(--color-accent)] flex items-center justify-center">
                <Clock className="h-4.5 w-4.5 text-[var(--color-accent-foreground)]" />
              </div>
              <span className="text-lg font-bold text-[var(--color-text)]">
                Praxida
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/login"
                className="px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="px-4 py-2 text-sm font-medium text-[var(--color-accent-foreground)] bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-lg transition-colors shadow-sm"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-accent-muted)] via-[var(--color-background)] to-[var(--color-success-bg)]" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24 sm:pt-28 sm:pb-32">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--color-accent-muted)] text-[var(--color-accent)] text-sm font-medium mb-6">
              <Zap className="h-3.5 w-3.5" />
              Built for accounting firms
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[var(--color-text)] leading-tight tracking-tight">
              Never miss a client{' '}
              <span className="text-[var(--color-accent)]">deadline</span>{' '}
              again.
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-[var(--color-text-secondary)] max-w-2xl mx-auto leading-relaxed">
              The simple, fast tool for small accounting firms to track client
              deadlines, assign tasks to your team, and stay organized — effortlessly.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 px-6 py-3 text-base font-medium text-[var(--color-accent-foreground)] bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-xl transition-all shadow-lg"
              >
                Start Free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 px-6 py-3 text-base font-medium text-[var(--color-text)] bg-[var(--color-surface)] hover:bg-[var(--color-muted)] rounded-xl transition-colors border border-[var(--color-border)] shadow-sm"
              >
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 sm:py-24 bg-[var(--color-surface)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--color-text)]">
              Everything your firm needs
            </h2>
            <p className="mt-4 text-lg text-[var(--color-text-secondary)] max-w-2xl mx-auto">
              Focus on your clients, not on chasing deadlines. Praxida
              keeps your entire team aligned.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            <FeatureCard
              icon={<CheckCircle2 className="h-6 w-6" />}
              title="Task Management"
              description="Create tasks, set due dates, and assign them to team members. Track tax filings, VAT returns, and every client deadline."
              color="text-[var(--color-success)]"
              bg="bg-[var(--color-success-bg)]"
            />
            <FeatureCard
              icon={<Users className="h-6 w-6" />}
              title="Team Collaboration"
              description="Invite your team with a simple code. Admins manage everything; members focus on their assigned work."
              color="text-[var(--color-accent)]"
              bg="bg-[var(--color-accent-muted)]"
            />
            <FeatureCard
              icon={<BarChart3 className="h-6 w-6" />}
              title="Dashboard Views"
              description="See overdue tasks at a glance. Color-coded urgency indicators keep your team focused on what matters most."
              color="text-[var(--color-warning)]"
              bg="bg-[var(--color-warning-bg)]"
            />
            <FeatureCard
              icon={<Shield className="h-6 w-6" />}
              title="Secure & Isolated"
              description="Multi-tenant architecture ensures your data is completely isolated. Bank-grade security with row-level policies."
              color="text-[var(--color-danger)]"
              bg="bg-[var(--color-danger-bg)]"
            />
            <FeatureCard
              icon={<Clock className="h-6 w-6" />}
              title="Email Reminders"
              description="Automatic email notifications before deadlines. Never be caught off guard by an approaching due date."
              color="text-[var(--color-accent)]"
              bg="bg-[var(--color-accent-muted)]"
            />
            <FeatureCard
              icon={<Zap className="h-6 w-6" />}
              title="Lightning Fast"
              description="Built with modern technology for instant page loads. No lag, no waiting — just speed."
              color="text-[var(--color-warning)]"
              bg="bg-[var(--color-warning-bg)]"
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 sm:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative rounded-2xl overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-[var(--color-sidebar)] to-[#115e59]" />
            <div className="relative px-8 py-16 sm:px-16 sm:py-20 text-center">
              <h2 className="text-3xl sm:text-4xl font-bold text-white">
                Ready to stop missing deadlines?
              </h2>
              <p className="mt-4 text-lg text-[var(--color-sidebar-text)] max-w-xl mx-auto">
                Join firms already using Praxida to keep their teams organized and clients happy.
              </p>
              <div className="mt-8">
                <Link
                  href="/signup"
                  className="inline-flex items-center gap-2 px-8 py-3.5 text-base font-semibold text-[var(--color-accent)] bg-white hover:bg-[var(--color-accent-muted)] rounded-xl transition-colors shadow-lg"
                >
                  Get Started Free
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--color-border)] py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-[var(--color-accent)] flex items-center justify-center">
                <Clock className="h-3.5 w-3.5 text-[var(--color-accent-foreground)]" />
              </div>
              <span className="text-sm font-semibold text-[var(--color-text)]">
                Praxida
              </span>
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">
              © {new Date().getFullYear()} Praxida. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  color,
  bg,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
  bg: string;
}) {
  return (
    <div className="group p-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5">
      <div
        className={`h-12 w-12 rounded-xl ${bg} ${color} flex items-center justify-center mb-4`}
      >
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-[var(--color-text)] mb-2">
        {title}
      </h3>
      <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
        {description}
      </p>
    </div>
  );
}
