// Single source of truth for password strength — shared by signup and
// password reset so reset can never enforce a weaker rule than signup does.
// (settings/actions.ts's changePasswordAction predates this and still
// enforces its own, stricter 8-character rule for an already-authenticated
// user changing their own password — a separate, pre-existing feature this
// intentionally does not touch.)
export function validatePassword(password: string): string | null {
  if (!password || password.length < 6) {
    return 'Password must be at least 6 characters.';
  }
  return null;
}
