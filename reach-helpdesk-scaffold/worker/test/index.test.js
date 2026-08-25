import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { testEnv, testContext, postJson } from './helpers.js';

function chatBody(env, message, overrides = {}) {
  return {
    context: testContext(env.WIDGET_SIGNING_SECRET),
    conversation_id: 'conv-test-1',
    message,
    ...overrides,
  };
}

test('GET /health returns ok', async () => {
  const env = testEnv();
  const res = await worker.fetch(new Request('https://helpdesk.test/health'), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('unknown route 404s', async () => {
  const env = testEnv();
  const res = await worker.fetch(postJson('/nope', {}), env);
  assert.equal(res.status, 404);
});

test('/chat rejects a bad signature', async () => {
  const env = testEnv();
  const body = chatBody(env, 'hello');
  body.context.sig = 'f'.repeat(64);
  const res = await worker.fetch(postJson('/chat', body), env);
  assert.equal(res.status, 401);
});

test('/chat answers and stores both sides of the exchange', async () => {
  const env = testEnv();
  const res = await worker.fetch(postJson('/chat', chatBody(env, 'How do I add a sermon?')), env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.match(data.reply, /mock reply/);
  assert.equal(data.escalate_suggested, false);
  assert.equal(env.DB.messages.length, 2);
  assert.deepEqual(
    env.DB.messages.map((m) => m.role),
    ['user', 'assistant']
  );
  assert.ok(env.DB.conversations.has('conv-test-1'));
});

test('/chat flags escalation when the mock detects a human request', async () => {
  const env = testEnv();
  const res = await worker.fetch(postJson('/chat', chatBody(env, 'I need a human, this is broken')), env);
  const data = await res.json();
  assert.equal(data.escalate_suggested, true);
});

test('/escalate posts transcript to GHL and records it', async () => {
  const env = testEnv();
  await worker.fetch(postJson('/chat', chatBody(env, 'How do I add a sermon?')), env);

  const captured = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured.push({ url, body: JSON.parse(init.body) });
    return new Response('ok', { status: 200 });
  };
  try {
    const res = await worker.fetch(
      postJson('/escalate', chatBody(env, undefined, {
        reason: 'User requested a human',
        user_message: 'The sermon player is blank on our homepage',
        phone: '555-0100',
      })),
      env
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, ghl_status: 200 });
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, env.GHL_WEBHOOK_URL);
  assert.equal(captured[0].body.email, 'jane@gracechurch.org');
  assert.equal(captured[0].body.church, 'Grace Church');
  assert.equal(captured[0].body.phone, '555-0100');
  assert.equal(captured[0].body.client_note, 'The sermon player is blank on our homepage');
  assert.match(captured[0].body.transcript, /USER: How do I add a sermon\?/);
  assert.equal(env.DB.escalations.length, 1);
  assert.equal(env.DB.escalations[0].ghl_status, 200);
  assert.match(env.DB.escalations[0].reason, /client note: The sermon player/);
});

test('/admin requires the key', async () => {
  const env = testEnv();
  const res = await worker.fetch(new Request('https://helpdesk.test/admin?key=wrong'), env);
  assert.equal(res.status, 401);
});

test('/admin lists conversations and /admin/conversation shows the transcript', async () => {
  const env = testEnv();
  await worker.fetch(postJson('/chat', chatBody(env, 'How do I add a sermon?')), env);

  const list = await worker.fetch(new Request('https://helpdesk.test/admin?key=test-admin'), env);
  assert.equal(list.status, 200);
  const listHtml = await list.text();
  assert.match(listHtml, /Grace Church/);
  assert.match(listHtml, /jane@gracechurch\.org/);

  const detail = await worker.fetch(
    new Request('https://helpdesk.test/admin/conversation?id=conv-test-1&key=test-admin'),
    env
  );
  assert.equal(detail.status, 200);
  const detailHtml = await detail.text();
  assert.match(detailHtml, /How do I add a sermon\?/);
  assert.match(detailHtml, /mock reply/);
});

test('/escalate reports GHL failure as 502', async () => {
  const env = testEnv();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('nope', { status: 500 });
  try {
    const res = await worker.fetch(
      postJson('/escalate', chatBody(env, undefined, { reason: 'x' })),
      env
    );
    assert.equal(res.status, 502);
    assert.equal((await res.json()).ok, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});
