// Signed tokens, all keyed by TOKEN_SECRET. That secret lives only in the
// Worker — unlike WIDGET_SIGNING_SECRET, it is never handed to tenant sites —
// so no church site can mint these. Rotating it invalidates every outstanding
// reply address, reply link, and inbox session.
//
//   Reply-to addresses (no expiry — replies can come days later):
//     leo+<convId>.<sig>@REPLY_DOMAIN    the team coaching Leo
//     chat+<convId>.<sig>@REPLY_DOMAIN   the church replying to an email
//   Reply links (expire):   /r/<convId>.<exp>.<sig>
//   Inbox session cookie:   fmhd_admin=<exp>.<sig>   (also bound to ADMIN_KEY)

import { hmacHex, timingSafeEqual } from './crypto.js';

// Widget ids are UUIDs (36). Capped at 40 so "leo+<id>.<sig>" stays inside
// the 64-character limit on an email address's local part.
export const CONVERSATION_ID_RE = /^[a-z0-9-]{8,40}$/;

const ADDRESS_RE = /^(leo|chat)[+-]([a-z0-9-]{8,40})\.([0-9a-f]{16})@/;
const LINK_RE = /^([a-z0-9-]{8,40})\.([0-9a-z]{1,10})\.([0-9a-f]{24})$/;
const LINK_DAYS = 14;
const SESSION_DAYS = 30;

const now = () => Math.floor(Date.now() / 1000);

async function sig(env, message, length) {
  return (await hmacHex(env.TOKEN_SECRET, message)).slice(0, length);
}

export async function replyAddress(env, kind, convId) {
  return `${kind}+${convId}.${await sig(env, `${kind}|${convId}`, 16)}@${env.REPLY_DOMAIN || 'reply.faithmade.app'}`;
}

export async function parseReplyAddress(env, address) {
  const m = ADDRESS_RE.exec(String(address || '').trim().toLowerCase());
  if (!m) return null;
  const [, kind, convId, given] = m;
  return timingSafeEqual(await sig(env, `${kind}|${convId}`, 16), given) ? { kind, convId } : null;
}

export async function replyLinkToken(env, convId, days = LINK_DAYS) {
  const exp = (now() + days * 86400).toString(36);
  return `${convId}.${exp}.${await sig(env, `link|${convId}|${exp}`, 24)}`;
}

export async function verifyReplyLinkToken(env, token) {
  const m = LINK_RE.exec(String(token || ''));
  if (!m) return null;
  const [, convId, exp, given] = m;
  if (parseInt(exp, 36) < now()) return null;
  return timingSafeEqual(await sig(env, `link|${convId}|${exp}`, 24), given) ? { convId } : null;
}

export async function replyLinkUrl(env, convId, mode) {
  const base = String(env.PUBLIC_URL || '').replace(/\/+$/, '');
  return `${base}/r/${await replyLinkToken(env, convId)}${mode ? `?mode=${mode}` : ''}`;
}

export async function adminSessionCookie(env, secure) {
  const exp = (now() + SESSION_DAYS * 86400).toString(36);
  const value = `${exp}.${await sig(env, `admin|${exp}|${env.ADMIN_KEY}`, 64)}`;
  return `fmhd_admin=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
}

export async function verifyAdminSession(env, cookieHeader) {
  const m = /(?:^|;\s*)fmhd_admin=([0-9a-z]{1,10})\.([0-9a-f]{64})/.exec(cookieHeader || '');
  if (!m || !env.ADMIN_KEY || !env.TOKEN_SECRET) return false;
  const [, exp, given] = m;
  if (parseInt(exp, 36) < now()) return false;
  return timingSafeEqual(await sig(env, `admin|${exp}|${env.ADMIN_KEY}`, 64), given);
}
