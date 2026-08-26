import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyContext } from '../src/auth.js';
import { testContext } from './helpers.js';

const env = { WIDGET_SIGNING_SECRET: 'test-secret' };

test('valid signature passes', async () => {
  const ctx = testContext(env.WIDGET_SIGNING_SECRET);
  assert.deepEqual(await verifyContext(env, ctx), { ok: true });
});

test('tampered signature fails', async () => {
  const ctx = testContext(env.WIDGET_SIGNING_SECRET);
  ctx.sig = ctx.sig.replace(/^./, ctx.sig[0] === 'a' ? 'b' : 'a');
  assert.equal((await verifyContext(env, ctx)).ok, false);
});

test('tampered payload fails', async () => {
  const ctx = testContext(env.WIDGET_SIGNING_SECRET);
  ctx.user_email = 'attacker@evil.com';
  assert.equal((await verifyContext(env, ctx)).ok, false);
});

test('wrong secret fails', async () => {
  const ctx = testContext('other-secret');
  assert.equal((await verifyContext(env, ctx)).ok, false);
});

test('stale timestamp fails', async () => {
  const ctx = testContext(env.WIDGET_SIGNING_SECRET, { ts: Math.floor(Date.now() / 1000) - 3600 });
  const res = await verifyContext(env, ctx);
  assert.equal(res.ok, false);
  assert.match(res.error, /expired/);
});

test('missing fields fail', async () => {
  assert.equal((await verifyContext(env, null)).ok, false);
  assert.equal((await verifyContext(env, { site: 'x' })).ok, false);
});
