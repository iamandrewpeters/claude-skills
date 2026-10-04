import test from 'node:test';
import assert from 'node:assert/strict';
import { testEnv, run, chat, outbound, BASE } from './helpers.js';
import { replyLinkUrl, replyLinkToken } from '../src/tokens.js';

const form = (url, fields) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

async function setup() {
  const env = testEnv();
  await chat(env, 'How do I add a sermon?');
  await env.DB.prepare("UPDATE conversations SET client_last_seen = datetime('now', '-10 minutes')").run();
  const url = await replyLinkUrl(env, 'conv-test-1', 'reply');
  return { env, url, path: new URL(url).pathname };
}

test('the reply link opens a page with the conversation and both modes', async () => {
  const { env, url } = await setup();
  assert.ok(url.startsWith(`${BASE}/r/conv-test-1.`));
  const res = await run(env, new Request(url));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  const html = await res.text();
  assert.match(html, /Jane Smith/);
  assert.match(html, /How do I add a sermon\?/);
  assert.match(html, /Reply to Jane/);
  assert.match(html, /Coach Leo/);
  assert.match(html, /id="m-reply" checked/);
  assert.match(html, /Away · replies go by email/);
});

test('replying directly sends Jane your exact words by email', async () => {
  const { env, url, path } = await setup();
  const res = await run(env, form(url, { mode: 'reply', content: 'Hi Jane — it’s under Sermons → Add New.' }));
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), new RegExp(`^${path.replace(/\./g, '\\.')}\\?mode=reply&sent=reply$`));

  const agent = env.DB.row("SELECT * FROM messages WHERE role = 'agent'");
  assert.equal(agent.content, 'Hi Jane — it’s under Sermons → Add New.');
  assert.equal(agent.via, 'link');
  assert.equal(env.DB.row("SELECT handled_by FROM conversations").handled_by, 'team');
  const [email] = outbound(env, 'team_reply');
  assert.equal(email.to_addr, 'jane@gracechurch.org');

  const page = await (await run(env, new Request(new URL(res.headers.get('location'), BASE)))).text();
  assert.match(page, /✓ Sent to Jane/);
});

test('coaching from the link page: Leo replies and the memory shows up', async () => {
  const { env, url } = await setup();
  const res = await run(env, form(url, { mode: 'coach', content: 'Sermons → Add New, then upload the audio in the Media box.' }));
  const location = res.headers.get('location');
  assert.match(location, /sent=coach&m=1$/);
  const page = await (await run(env, new Request(new URL(location, BASE)))).text();
  assert.match(page, /✓ Leo replied to Jane/);
  assert.match(page, /Leo learned/);
  assert.equal(outbound(env, 'leo_reply').length, 1);
});

test('empty submissions come back with an error, nothing sent', async () => {
  const { env, url } = await setup();
  const res = await run(env, form(url, { mode: 'reply', content: '   ' }));
  assert.match(res.headers.get('location'), /err=/);
  assert.equal(env.DB.rows("SELECT * FROM messages WHERE role = 'agent'").length, 0);
});

test('expired or tampered links show the expired page', async () => {
  const { env } = await setup();
  const expired = await replyLinkToken(env, 'conv-test-1', -1);
  const r1 = await run(env, new Request(`${BASE}/r/${expired}`));
  assert.equal(r1.status, 404);
  assert.match(await r1.text(), /This reply link has expired/);
  const r2 = await run(env, new Request(`${BASE}/r/conv-test-1.zzzz.${'0'.repeat(24)}`));
  assert.equal(r2.status, 404);
  const r3 = await run(env, form(`${BASE}/r/${expired}`, { mode: 'reply', content: 'sneaky' }));
  assert.equal(r3.status, 404);
  assert.equal(env.DB.rows("SELECT * FROM messages WHERE role = 'agent'").length, 0);
});
