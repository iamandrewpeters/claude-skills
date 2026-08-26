import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { testEnv, testContext, postJson, adminPost, pollRequest } from './helpers.js';

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

test('/chat: Leo answers and stores both sides', async () => {
  const env = testEnv();
  const res = await worker.fetch(postJson('/chat', chatBody(env, 'How do I add a sermon?')), env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.match(data.reply, /Leo mock reply/);
  assert.equal(data.handled_by, 'leo');
  assert.equal(data.escalate_suggested, false);
  assert.deepEqual(
    env.DB.messages.map((m) => m.role),
    ['user', 'assistant']
  );
});

test('/chat: escalation suggested on human request', async () => {
  const env = testEnv();
  const res = await worker.fetch(postJson('/chat', chatBody(env, 'I need a human, this is broken')), env);
  const data = await res.json();
  assert.equal(data.escalate_suggested, true);
});

test('/escalate: GHL payload carries note, phone, transcript; status flips', async () => {
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
    assert.equal((await res.json()).ok, true);
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, env.GHL_WEBHOOK_URL);
  assert.equal(captured[0].body.phone, '555-0100');
  assert.equal(captured[0].body.client_note, 'The sermon player is blank on our homepage');
  assert.match(captured[0].body.transcript, /USER: How do I add a sermon\?/);
  assert.equal(env.DB.escalations.length, 1);
  assert.equal(env.DB.conversations.get('conv-test-1').status, 'escalated');
});

test('live chat: agent reply takes over, Leo stands down, client polls it', async () => {
  const env = testEnv();
  await worker.fetch(postJson('/chat', chatBody(env, 'How do I add a sermon?')), env);

  // Agent goes online and replies from the inbox
  await worker.fetch(adminPost('/admin/api/presence', { online: true }), env);
  const replyRes = await worker.fetch(
    adminPost('/admin/api/reply', { id: 'conv-test-1', content: 'Hey Jane — Andrew here, looking now.' }),
    env
  );
  assert.equal(replyRes.status, 200);
  assert.equal(env.DB.conversations.get('conv-test-1').handled_by, 'team');

  // Client poll sees the agent message and presence
  const poll = await worker.fetch(pollRequest(env, 'conv-test-1', 2), env);
  const pollData = await poll.json();
  assert.equal(pollData.team_online, true);
  assert.equal(pollData.handled_by, 'team');
  assert.equal(pollData.messages.length, 1);
  assert.equal(pollData.messages[0].role, 'agent');
  assert.match(pollData.messages[0].content, /Andrew here/);

  // Next client message: no Leo auto-reply
  const res2 = await worker.fetch(postJson('/chat', chatBody(env, 'Thanks! It is the homepage.')), env);
  const data2 = await res2.json();
  assert.equal(data2.reply, null);
  assert.equal(data2.handled_by, 'team');
  const roles = env.DB.messages.map((m) => m.role);
  assert.deepEqual(roles, ['user', 'assistant', 'agent', 'user']);

  // Hand back to Leo re-enables auto-replies
  await worker.fetch(adminPost('/admin/api/handoff', { id: 'conv-test-1' }), env);
  const res3 = await worker.fetch(postJson('/chat', chatBody(env, 'One more question about sermons')), env);
  assert.match((await res3.json()).reply, /Leo mock reply/);
});

test('/messages rejects bad signature', async () => {
  const env = testEnv();
  const req = pollRequest(env, 'conv-test-1');
  const url = new URL(req.url);
  url.searchParams.set('sig', 'f'.repeat(64));
  const res = await worker.fetch(new Request(url), env);
  assert.equal(res.status, 401);
});

test('admin shell requires the key; APIs serve inbox data', async () => {
  const env = testEnv();
  assert.equal((await worker.fetch(new Request('https://helpdesk.test/admin?key=wrong'), env)).status, 401);

  const shell = await worker.fetch(new Request('https://helpdesk.test/admin?key=test-admin'), env);
  assert.equal(shell.status, 200);
  assert.match(await shell.text(), /Faithmade Helpdesk/);

  await worker.fetch(postJson('/chat', chatBody(env, 'How do I add a sermon?')), env);
  const list = await worker.fetch(new Request('https://helpdesk.test/admin/api/conversations?key=test-admin'), env);
  const listData = await list.json();
  assert.equal(listData.conversations.length, 1);
  assert.equal(listData.conversations[0].church, 'Grace Church');
  assert.match(listData.conversations[0].last_snippet, /Leo mock reply/);

  const detail = await worker.fetch(
    new Request('https://helpdesk.test/admin/api/conversation?id=conv-test-1&key=test-admin'),
    env
  );
  const detailData = await detail.json();
  assert.equal(detailData.messages.length, 2);
  // opening the thread marks it read
  assert.equal(env.DB.conversations.get('conv-test-1').agent_last_read_id, 2);
});

test('resolved conversations reopen when the client writes again', async () => {
  const env = testEnv();
  await worker.fetch(postJson('/chat', chatBody(env, 'How do I add a sermon?')), env);
  await worker.fetch(adminPost('/admin/api/reply', { id: 'conv-test-1', content: 'Fixed!' }), env);
  await worker.fetch(adminPost('/admin/api/status', { id: 'conv-test-1', status: 'resolved' }), env);
  assert.equal(env.DB.conversations.get('conv-test-1').status, 'resolved');

  await worker.fetch(postJson('/chat', chatBody(env, 'Actually, still broken')), env);
  assert.equal(env.DB.conversations.get('conv-test-1').status, 'open');
});
