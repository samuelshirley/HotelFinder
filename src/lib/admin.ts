/**
 * Who may open /admin: the emails in ADMIN_EMAILS (comma-separated), compared
 * case-insensitively. Unset or empty means nobody — there is no default admin.
 */
export function adminEmails(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminEmail(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  return !!email && adminEmails(env).has(email.trim().toLowerCase());
}
