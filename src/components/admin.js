// Admin-only surfaces. This is a UI gate, not a security boundary: it decides what the panel
// renders, and anyone running an unpacked copy could flip it. Never gate anything that must be
// enforced (data access, account changes) on this — enforce those on the paper server.
import { ADMIN_EMAILS } from '../config.js';

const ADMINS = new Set(ADMIN_EMAILS.map((e) => e.trim().toLowerCase()));

export function isAdmin(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  return !!email && ADMINS.has(email);
}
