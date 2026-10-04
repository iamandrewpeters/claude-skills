import test from 'node:test';
import assert from 'node:assert/strict';
import { testEnv, run, chat, adminPost, adminGet, BASE } from './helpers.js';

const login = (env, key, hash = '') =>
  run(
    env,
    new Request(`${BASE}/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key, hash }).toString(),
    })
  );

test('the inbox asks you to sign in, and signing in sets a session cookie', async () => {
  const env = testEnv();
  const page = await run(env, new Request(`${BASE}/admin`));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Sign in to the team inbox/);

  assert.equal((await login(env, 'wrong')).status, 401);
  const ok = await login(env, 'test-admin', '#c=conv-test-1');
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/admin#c=conv-test-1');
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /^fmhd_admin=[0-9a-z]+\.[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);

  const session = cookie.split(';')[0];
  const app = await run(env, new Request(`${BASE}/admin`, { headers: { cookie: session } }));
  assert.equal(app.headers.get('x-frame-options'), 'DENY');
  assert.match(await app.text(), /Leo’s memory/);
  const api = await run(env, new Request(`${BASE}/admin/api/conversations`, { headers: { cookie: session } }));
  assert.equal(api.status, 200);
});

test('a key in the URL is traded for a session and dropped from the address bar', async () => {
  const env = testEnv();
  const res = await run(env, new Request(`${BASE}/admin?key=test-admin`));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/admin');
  assert.ok(res.headers.get('set-cookie'));
});

test('the API refuses strangers, forms, and malformed hashes', async () => {
  const env = testEnv();
  assert.equal((await run(env, new Request(`${BASE}/admin/api/conversations`))).status, 401);
  assert.equal((await run(env, new Request(`${BASE}/admin/api/conversations`, { headers: { cookie: 'fmhd_admin=abc.' + '0'.repeat(64) } }))).status, 401);
  const formPost = await run(
    env,
    new Request(`${BASE}/admin/api/presence`, { method: 'POST', headers: { 'x-admin-key': 'test-admin', 'content-type': 'text/plain' }, body: '{"online":true}' })
  );
  assert.equal(formPost.status, 415);
  const weird = await login(env, 'test-admin', '#"><script>');
  assert.equal(weird.headers.get('location'), '/admin');
});

test('coaching from the inbox: Leo replies, remembers, and the memory is editable', async () => {
  const env = testEnv();
  await chat(env, 'How do I change the time on a recurring event?');
  const res = await run(env, adminPost('/admin/api/coach', { id: 'conv-test-1', content: 'Edit the event, change the time, and choose “All events in the series”.' }));
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.match(r.reply, /^Thanks for your patience, Jane!/);
  assert.equal(r.memory.question, 'How do I change the time on a recurring event?');
  assert.equal(r.memory.created_via, 'inbox');

  const thread = await (await run(env, adminGet('/admin/api/conversation?id=conv-test-1'))).json();
  assert.deepEqual(thread.messages.map((m) => m.role), ['user', 'assistant', 'coach', 'assistant', 'note']);

  await run(env, adminPost('/admin/api/memory/update', { id: r.memory.id, answer: 'Open the event → change the time → “All events in the series”.', enabled: false }));
  const { memories } = await (await run(env, adminGet('/admin/api/memories'))).json();
  assert.equal(memories[0].enabled, 0);
  assert.match(memories[0].answer, /^Open the event/);

  // Disabled memories aren't used.
  await chat(env, 'How do I change the time on a recurring event?', { conversation_id: 'conv-test-2' });
  assert.equal(env.DB.row('SELECT match_count FROM memories').match_count, 0);
});

test('memories can be added and removed by hand', async () => {
  const env = testEnv();
  const created = await (await run(env, adminPost('/admin/api/memory/create', { question: 'Do you offer refunds?', answer: 'Email billing@faithmade.app.' }))).json();
  assert.equal(created.memory.created_via, 'manual');
  assert.match((await chat(env, 'Do you offer refunds on annual plans?')).reply, /taught me this one\. Email billing@faithmade\.app/);
  await run(env, adminPost('/admin/api/memory/delete', { id: created.memory.id }));
  assert.equal(env.DB.rows('SELECT * FROM memories').length, 0);
});

test('the email log lists what went out, with full previews', async () => {
  const env = testEnv();
  await chat(env, 'How do I add a sermon?');
  await env.DB.prepare("UPDATE conversations SET client_last_seen = NULL").run();
  await run(env, adminPost('/admin/api/reply', { id: 'conv-test-1', content: 'Sermons → Add New.' }));
  const { emails } = await (await run(env, adminGet('/admin/api/emails'))).json();
  assert.equal(emails.length, 1);
  assert.equal(emails[0].kind, 'team_reply');
  assert.ok(!('html' in emails[0]));
  const { email } = await (await run(env, adminGet(`/admin/api/email?id=${emails[0].id}`))).json();
  assert.match(email.html, /Sermons → Add New\./);
  const cfg = await (await run(env, adminGet('/admin/api/config'))).json();
  assert.equal(cfg.email, 'log');
  assert.deepEqual(cfg.team_emails, ['andrew@faithmade.test']);
});
