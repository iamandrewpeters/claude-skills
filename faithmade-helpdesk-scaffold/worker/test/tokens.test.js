import test from 'node:test';
import assert from 'node:assert/strict';
import {
  replyAddress,
  parseReplyAddress,
  replyLinkToken,
  verifyReplyLinkToken,
  adminSessionCookie,
  verifyAdminSession,
} from '../src/tokens.js';

const env = { TOKEN_SECRET: 'test-token-secret', ADMIN_KEY: 'test-admin', REPLY_DOMAIN: 'reply.faithmade.app' };
const ID = 'b3c1a9e2-6f0d-4a51-9c8e-1d2f3a4b5c6d';

test('reply addresses round-trip and fit in an email local part', async () => {
  const addr = await replyAddress(env, 'leo', ID);
  assert.match(addr, /^leo\+[a-z0-9-]+\.[0-9a-f]{16}@reply\.faithmade\.app$/);
  assert.ok(addr.split('@')[0].length <= 64);
  assert.deepEqual(await parseReplyAddress(env, addr), { kind: 'leo', convId: ID });
  assert.deepEqual(await parseReplyAddress(env, addr.toUpperCase()), { kind: 'leo', convId: ID });
});

test('reply addresses can’t be forged or repurposed', async () => {
  const addr = await replyAddress(env, 'leo', ID);
  assert.equal(await parseReplyAddress(env, addr.replace(/\.([0-9a-f])/, (m, c) => '.' + (c === 'a' ? 'b' : 'a'))), null);
  // A church's chat+ address must not work as a coaching address.
  const chat = await replyAddress(env, 'chat', ID);
  assert.equal(await parseReplyAddress(env, chat.replace(/^chat/, 'leo')), null);
  // Another deployment's secret doesn't verify.
  assert.equal(await parseReplyAddress({ ...env, TOKEN_SECRET: 'other' }, addr), null);
});

test('reply links verify, and expire', async () => {
  const token = await replyLinkToken(env, ID);
  assert.deepEqual(await verifyReplyLinkToken(env, token), { convId: ID });
  assert.equal(await verifyReplyLinkToken(env, token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')), null);
  const expired = await replyLinkToken(env, ID, -1);
  assert.equal(await verifyReplyLinkToken(env, expired), null);
});

test('inbox sessions verify, and die when the admin key rotates', async () => {
  const cookie = await adminSessionCookie(env, true);
  assert.match(cookie, /HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
  const header = cookie.split(';')[0];
  assert.equal(await verifyAdminSession(env, header), true);
  assert.equal(await verifyAdminSession({ ...env, ADMIN_KEY: 'rotated' }, header), false);
  assert.equal(await verifyAdminSession(env, 'fmhd_admin=zzz.' + '0'.repeat(64)), false);
});
