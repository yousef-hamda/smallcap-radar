/**
 * SEC fair-access identity. Set SEC_USER_AGENT in the hosting environment to
 * include a reachable contact, for example:
 *   SmallCapRadar/2.2 (contact: data-admin@example.com)
 * Never use a GitHub noreply address as the SEC contact.
 */
export function secUserAgent(override?: string | null): string | null {
  const configured = override ?? (typeof process !== 'undefined' ? process.env.SEC_USER_AGENT : undefined);
  const value = configured?.trim();
  if (!value || value.length > 256 || /[\r\n\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }
  const contact = value.match(/\((?:[^)]*\bcontact\s*:\s*)?([^()\s]+@[^()\s]+)\)/i)?.[1]
    ?? value.match(/\bcontact\s*:\s*([^\s;)]+@[^\s;)]+)/i)?.[1];
  if (!contact || /users\.noreply\.github\.com/i.test(contact) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return null;
  return value;
}

/** Operator-controlled generation changes invalidate SEC identity caches without deriving keys from contact data. */
export function secUserAgentCacheVersion(): string {
  const value = secUserAgent();
  if (!value) return 'v27-unconfigured';
  const revision = typeof process !== 'undefined' ? process.env.SEC_USER_AGENT_CACHE_REVISION?.trim() : undefined;
  const safeRevision = revision && /^[a-zA-Z0-9_-]{1,24}$/.test(revision) ? revision : '1';
  return `v27-configured-${safeRevision}`;
}
