import 'server-only';

/**
 * The ONE place the Anthropic credentials are read. null when no key is set.
 * A key that is not scoped to a workspace is refused by the API (HTTP 400)
 * unless the request names one: ANTHROPIC_WORKSPACE_ID supplies it.
 */
export function anthropicCredentials(env: Record<string, string | undefined> = process.env): { apiKey: string; workspaceId: string | null } | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, workspaceId: env.ANTHROPIC_WORKSPACE_ID?.trim() || null };
}
