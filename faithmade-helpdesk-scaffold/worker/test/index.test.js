import test from 'node:test';
import assert from 'node:assert/strict';
import { testEnv, testContext, postJson, adminPost, adminGet, pollRequest, run, widget, chat, withFetch, okFetch, outbound, TEAM } from './helpers.js';

const roles = (env) => env.DB.rows('SELECT role FROM messages ORDER BY id').map((m) => m.role);
const conv = (env, id = 'conv-test-1') => env.DB.row('SELECT * FROM conversations WHERE id = ?', id);

test('GET /health returns ok', async () => {
  const res = await run(testEnv(), new Request('https://helpdesk.test/health'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('unknown route 404s', async () => {
  assert.equal((await run(testEnv(), postJson('/nope', {}))).status, 404);
});

test('/chat rejects a bad signature', async () => {
  const env = testEnv();
  const body = { context: { ...testContext(env.WIDGET_SIGNING_SECRET), sig: 'f'.repeat(64) }, conversation_id: 'conv-test-1', message: 'hi' };
  assert.equal((await run(env, postJson('/chat', body))).status, 401);
});

test('/chat rejects malformed conversation ids', async () => {
  const env = testEnv();
  const res = await widget(env, '/chat', { message: 'hi', conversation_id: 'NOT VALID!' });
  assert.equal(res.status, 400);
});

test('/chat: Leo answers and stores both sides', async () => {
  const env = testEnv();
  const data = await chat(env, 'How do I add a sermon?');
  assert.match(data.reply, /Leo mock reply/);
  assert.equal(data.handled_by, 'leo');
  assert.equal(data.escalate_suggested, false);
  assert.ok(data.user_id < data.last_id);
  assert.deepEqual(roles(env), ['user', 'assistant']);
});

test('/chat: escalation suggested on human request', async () => {
  const data = await chat(testEnv(), 'I need a human, this is broken');
  assert.equal(data.escalate_suggested, true);
});

test('/chat: feature requests get pointed at the Ideas board', async () => {
  const data = await chat(testEnv(), 'I wish Faithmade could add a prayer wall feature');
  assert.equal(data.idea_suggested, true);
  assert.equal(data.escalate_suggested, false);
});

test("a conversation can't be read or written with someone else's identity", async () => {
  const env = testEnv();
  await chat(env, 'How do I add a sermon?');
  const other = { user_email: 'mallory@gracechurch.org' };
  const poll = await widget(env, '/messages', { after_id: 0 }, other);
  assert.equal(poll.status, 403);
  assert.equal((await poll.json()).error, 'conversation_mismatch');
  assert.equal((await widget(env, '/chat', { message: 'hi' }, other)).status, 403);
});

test('/escalate: GHL gets note, phone, transcript; team is emailed; status flips', async () => {
  const env = testEnv({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test' });
  await chat(env, 'How do I add a sermon?');

  const calls = await withFetch(okFetch, async () => {
    const res = await widget(env, '/escalate', {
      reason: 'User requested a human',
      user_message: 'The sermon player is blank on our homepage',
      phone: '555-0100',
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.emailed, 1);
    assert.ok(data.user_id);
  });

  const ghl = calls.find((c) => c.url === env.GHL_WEBHOOK_URL);
  assert.equal(ghl.body.phone, '555-0100');
  assert.equal(ghl.body.client_note, 'The sermon player is blank on our homepage');
  assert.match(ghl.body.transcript, /USER: How do I add a sermon\?/);

  const resend = calls.find((c) => c.url === 'https://api.resend.com/emails');
  assert.deepEqual(resend.body.to, [TEAM]);
  assert.equal(resend.body.subject, 'Leo needs you · Grace Church: How do I add a sermon?');
  assert.match(resend.body.html, /The sermon player is blank on our homepage/); // the note
  assert.match(resend.body.reply_to, /^leo\+conv-test-1\.[0-9a-f]{16}@reply\.faithmade\.app$/);
  assert.match(resend.body.html, /Reply to Jane directly/);
  assert.match(resend.body.html, /https:\/\/helpdesk\.test\/r\/conv-test-1\./);
  assert.match(resend.body.text, /Reply above this line to coach Leo/);
  assert.equal(resend.body.headers['Auto-Submitted'], 'auto-generated');

  assert.equal(env.DB.rows('SELECT * FROM escalations').length, 1);
  assert.equal(conv(env).status, 'escalated');
  assert.equal(outbound(env, 'escalation')[0].status, 'sent');
});

test('/escalate reports failure when nobody could be reached', async () => {
  const env = testEnv({ GHL_WEBHOOK_URL: '', TEAM_EMAILS: '' });
  await chat(env, 'How do I add a sermon?');
  const res = await widget(env, '/escalate', { reason: 'User requested a human' });
  assert.equal(res.status, 502);
  assert.equal(conv(env).status, 'escalated'); // still in the inbox
});

test('live chat: agent reply takes over, Leo stands down, client polls it', async () => {
  const env = testEnv();
  await chat(env, 'How do I add a sermon?');

  await run(env, adminPost('/admin/api/presence', { online: true }));
  const replyRes = await run(env, adminPost('/admin/api/reply', { id: 'conv-test-1', content: 'Hey Jane — Andrew here, looking now.' }));
  assert.equal(replyRes.status, 200);
  const reply = await replyRes.json();
  assert.equal(reply.delivery.channel, 'widget'); // she's watching: no email
  assert.equal(conv(env).handled_by, 'team');

  const pollData = await (await run(env, pollRequest(env, 'conv-test-1', 2))).json();
  assert.equal(pollData.team_online, true);
  assert.equal(pollData.handled_by, 'team');
  assert.equal(pollData.messages.length, 1);
  assert.equal(pollData.messages[0].role, 'agent');
  assert.match(pollData.messages[0].content, /Andrew here/);

  const data2 = await chat(env, 'Thanks! It is the homepage.');
  assert.equal(data2.reply, null);
  assert.equal(data2.handled_by, 'team');
  assert.deepEqual(roles(env), ['user', 'assistant', 'agent', 'user']);

  await run(env, adminPost('/admin/api/handoff', { id: 'conv-test-1' }));
  assert.match((await chat(env, 'One more question about sermons')).reply, /Leo mock reply/);
});

test('polling from scratch restores the whole visible thread, never team notes', async () => {
  const env = testEnv();
  await chat(env, 'How do I add a sermon?');
  await run(env, adminPost('/admin/api/note', { id: 'conv-test-1', content: 'Internal: she is on the old theme' }));
  const data = await (await run(env, pollRequest(env, 'conv-test-1', 0))).json();
  assert.deepEqual(data.messages.map((m) => m.role), ['user', 'assistant']);
  assert.ok(!JSON.stringify(data).includes('Internal'));
});

test('a passive poll (closed widget) does not mark the church as watching', async () => {
  const env = testEnv();
  await chat(env, 'How do I add a sermon?');
  await env.DB.prepare("UPDATE conversations SET client_last_seen = datetime('now', '-1 hour')").run();
  await run(env, pollRequest(env, 'conv-test-1', 0, { passive: true }));
  assert.match(conv(env).client_last_seen, /^\d{4}-/);
  assert.ok(Date.now() - Date.parse(conv(env).client_last_seen.replace(' ', 'T') + 'Z') > 30 * 60 * 1000);
  await run(env, pollRequest(env, 'conv-test-1', 0));
  assert.ok(Date.now() - Date.parse(conv(env).client_last_seen.replace(' ', 'T') + 'Z') < 60 * 1000);
});

test('/messages rejects bad signature', async () => {
  const env = testEnv();
  const body = { context: { ...testContext(env.WIDGET_SIGNING_SECRET), sig: 'f'.repeat(64) }, conversation_id: 'conv-test-1', after_id: 0 };
  assert.equal((await run(env, postJson('/messages', body))).status, 401);
});

test('admin APIs serve inbox data and mark threads read', async () => {
  const env = testEnv();
  await chat(env, 'How do I add a sermon?');
  const listData = await (await run(env, adminGet('/admin/api/conversations'))).json();
  assert.equal(listData.conversations.length, 1);
  assert.equal(listData.conversations[0].church, 'Grace Church');
  assert.match(listData.conversations[0].last_snippet, /Leo mock reply/);

  const detail = await (await run(env, adminGet('/admin/api/conversation?id=conv-test-1'))).json();
  assert.equal(detail.messages.length, 2);
  assert.equal(detail.client_active, true);
  assert.equal(conv(env).agent_last_read_id, 2);
});

test('resolved conversations reopen when the client writes again', async () => {
  const env = testEnv();
  await chat(env, 'How do I add a sermon?');
  await run(env, adminPost('/admin/api/reply', { id: 'conv-test-1', content: 'Fixed!' }));
  await run(env, adminPost('/admin/api/status', { id: 'conv-test-1', status: 'resolved' }));
  assert.equal(conv(env).status, 'resolved');
  await chat(env, 'Actually, still broken');
  assert.equal(conv(env).status, 'open');
});

test('team replies go by email when the church has left the dashboard', async () => {
  const env = testEnv();
  await chat(env, 'How do I add a sermon?');
  await env.DB.prepare("UPDATE conversations SET client_last_seen = datetime('now', '-10 minutes')").run();
  const r = await (await run(env, adminPost('/admin/api/reply', { id: 'conv-test-1', content: 'Try Sermons → Add New.' }))).json();
  assert.equal(r.delivery.channel, 'email');
  const [email] = outbound(env, 'team_reply');
  assert.equal(email.to_addr, 'jane@gracechurch.org');
  assert.equal(email.subject, 'Re: How do I add a sermon?');
  assert.match(email.reply_to, /^chat\+conv-test-1\.[0-9a-f]{16}@reply\.faithmade\.app$/);
  assert.match(email.html, /The Faithmade team/);
  assert.match(email.html, /gracechurch\.org\/wp-admin\/\?fmhd=chat/);
  assert.equal(email.status, 'logged'); // EMAIL_PROVIDER unset: recorded, not sent
});

test('when the team owns a thread and is offline, church follow-ups are emailed (throttled)', async () => {
  const env = testEnv();
  await chat(env, 'How do I add a sermon?');
  await run(env, adminPost('/admin/api/reply', { id: 'conv-test-1', content: 'Looking into it.' }));
  await chat(env, 'It is on the homepage');
  await chat(env, 'And the podcast page');
  const followups = outbound(env, 'followup');
  assert.equal(followups.length, 1);
  assert.match(followups[0].subject, /^Jane replied · Grace Church: It is on the homepage/);
  assert.match(followups[0].reply_to, /^leo\+conv-test-1\./);
});
