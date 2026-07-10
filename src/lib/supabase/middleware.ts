import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// URL prefixes of the staff-only surface (the (dashboard) route group renders
// at these paths — there is no literal /dashboard/* nesting).
const STAFF_ROUTE_PREFIXES = [
  '/dashboard',
  '/tasks',
  '/clients',
  '/team',
  '/templates',
  '/settings',
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: Do not remove this. It refreshes the auth token.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  const isAuthPage =
    pathname.startsWith('/login') || pathname.startsWith('/signup');
  const isOnboardingPage = pathname.startsWith('/onboarding');
  const isAcceptInvitePage = pathname.startsWith('/portal/accept-invite');
  const isPortalRoute = pathname.startsWith('/portal') && !isAcceptInvitePage;
  const isStaffRoute = STAFF_ROUTE_PREFIXES.some((p) =>
    matchesPrefix(pathname, p)
  );
  // /portal/accept-invite is public: it's where invited clients land BEFORE
  // they have an account. /api/* routes (Phase 10: the statutory-generation
  // cron endpoint) authenticate themselves (e.g. a bearer secret checked
  // against CRON_SECRET) — they must never be swept into the cookie-session
  // redirect below, which would otherwise send every unauthenticated request
  // (including Vercel Cron's) to /login before the route handler runs.
  const isApiRoute = pathname.startsWith('/api/');
  const isPublicPage =
    pathname === '/' || pathname.startsWith('/auth') || isAcceptInvitePage || isApiRoute;

  // Auth guard: redirect unauthenticated users to login
  if (!user && !isAuthPage && !isPublicPage && !isOnboardingPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Role-aware routing — defense-in-depth on top of RLS: a client_user must
  // never even render the staff surface, and staff never the portal. Only
  // costs a profile query on the routes where roles matter.
  if (user && (isAuthPage || isStaffRoute || isPortalRoute)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    const url = request.nextUrl.clone();

    if (!profile) {
      // Authenticated but not provisioned — the onboarding safety net decides.
      url.pathname = '/onboarding';
      return NextResponse.redirect(url);
    }

    if (profile.role === 'client_user') {
      if (isStaffRoute || isAuthPage) {
        url.pathname = '/portal';
        return NextResponse.redirect(url);
      }
    } else {
      // partner / employee (and legacy roles during the port)
      if (isPortalRoute || isAuthPage) {
        url.pathname = '/dashboard';
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}
