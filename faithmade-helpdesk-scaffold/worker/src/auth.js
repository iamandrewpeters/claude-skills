// Verifies the HMAC-signed context minted by faithmade-admin for logged-in
// wp-admin users. Signature = hex HMAC-SHA256(secret, `${site}|${email}|${ts}`).

import { hmacHex, timingSafeEqual } from './crypto.js';

const MAX_AGE_SECONDS = 600;

export async function verifyContext(env, context) {
  if (!context || !context.site || !context.user_email || !context.ts || !context.sig) {
    return { ok: false, error: 'missing context fields' };
  }
  const age = Math.abs(Date.now() / 1000 - Number(context.ts));
  if (!Number.isFinite(age) || age > MAX_AGE_SECONDS) {
    return { ok: false, error: 'context signature expired' };
  }
  const expected = await hmacHex(
    env.WIDGET_SIGNING_SECRET,
    `${context.site}|${context.user_email}|${context.ts}`
  );
  if (!timingSafeEqual(expected, String(context.sig))) {
    return { ok: false, error: 'bad signature' };
  }
  return { ok: true };
}
