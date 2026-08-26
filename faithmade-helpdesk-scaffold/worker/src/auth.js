// Verifies the HMAC-signed context minted by faithmade-admin for logged-in
// wp-admin users. Signature = hex HMAC-SHA256(secret, `${site}|${email}|${ts}`).

const MAX_AGE_SECONDS = 600;

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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
