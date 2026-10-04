// HMAC-SHA256 helpers shared by the widget-context check and signed tokens.

const keyCache = new Map();

async function hmacKey(secret) {
  let key = keyCache.get(secret);
  if (!key) {
    key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    keyCache.set(secret, key);
  }
  return key;
}

export async function hmacHex(secret, message) {
  if (!secret) throw new Error('missing HMAC secret');
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
