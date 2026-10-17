/** Nasdaq's profile endpoint provides issuer prose, separate from quote data.
 * Reject empty and boilerplate values so a failed profile stays explicitly
 * unavailable instead of appearing as a sourced company explanation. */
export function nasdaqCompanyDescription(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const field = (data as { CompanyDescription?: unknown }).CompanyDescription;
  if (!field || typeof field !== 'object') return null;
  const value = (field as { value?: unknown }).value;
  if (typeof value !== 'string') return null;
  const description = value.replace(/\s+/g, ' ').trim();
  return description.length >= 40 && /[a-zA-Z]{5}/.test(description) ? description.slice(0, 3_600) : null;
}
