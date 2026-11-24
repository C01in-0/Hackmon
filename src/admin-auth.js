import { timingSafeEqual } from 'node:crypto';

export const EXAMPLE_ADMIN_TOKEN = 'replace_with_a_long_random_admin_token';
const DOCUMENTED_ADMIN_TOKENS = new Set([EXAMPLE_ADMIN_TOKEN, 'local_archive_token_change_me']);
export const validAdminToken = value => typeof value === 'string' && !DOCUMENTED_ADMIN_TOKENS.has(value) && /^[A-Za-z0-9_-]{20,200}$/.test(value);

export function matchesAdminToken(expected, actual) {
  if (!validAdminToken(expected) || typeof actual !== 'string') return false;
  const expectedBytes = Buffer.from(expected), actualBytes = Buffer.from(actual);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
