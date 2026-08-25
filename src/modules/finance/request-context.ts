import type { Request } from 'express';

/**
 * Pulls the caller's IP and user-agent for the finance audit trail.
 *
 * The app runs behind Supabase/a proxy, so `req.ip` alone is the proxy. The
 * left-most entry of X-Forwarded-For is the real client. It is attacker-
 * controllable, so it is recorded as a hint for investigators, never used for
 * an authorisation decision — and it is length-capped so a forged header
 * cannot bloat the audit table.
 */
export function requestContext(req: Request): { ip: string | null; userAgent: string | null } {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const candidate = (raw ?? '').split(',')[0]?.trim() || req.ip || null;

  // The column is INET: anything that is not a plausible address is dropped
  // rather than sent to Postgres to fail the whole write.
  const ip = candidate && /^[0-9a-fA-F:.]{3,45}$/.test(candidate) ? candidate : null;

  const ua = req.headers['user-agent'];
  return { ip, userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null };
}
