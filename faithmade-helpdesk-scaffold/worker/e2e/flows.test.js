// End-to-end: the real Workers runtime (wrangler dev + local D1 built from
// migrations/), a real browser on the demo wp-admin page, and inbound email
// delivered the way Cloudflare Email Routing hands it to the Worker.
//
//   npm run e2e                       Chromium from Playwright's browser cache
//   CHROME_PATH=/path/to/chrome npm run e2e
//   E2E_SHOTS=/some/dir npm run e2e   also saves a screenshot per step
//
// Hermetic: its own wrangler config, .dev.vars, and D1 state in a temp dir
// (your .dev.vars and local DB are untouched), stubs for the HighLevel webhook
// and the Claude Messages API (so the real Anthropic SDK runs inside workerd,
// with no key or network), emails logged rather than sent, fonts blocked.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';

const WORKER = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(WORKER, '..');
const PORT = {
  worker: +(process.env.E2E_WORKER_PORT || 8797),
  web: +(process.env.E2E_WEB_PORT || 8898),
  ghl: +(process.env.E2E_GHL_PORT || 9912),
  claude: +(process.env.E2E_CLAUDE_PORT || 9913),
};
const W = `http://127.0.0.1:${PORT.worker}`;
const WEB = `http://127.0.0.1:${PORT.web}`;
const TEAM = 'team@faithmade.test';
const ADMIN_KEY = 'e2e-admin';
const SECRET = 'dev-secret'; // what demo/index.html signs with
const SHOTS = process.env.E2E_SHOTS || '';

const VARS = {
  ANTHROPIC_API_KEY: 'sk-ant-e2e',
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT.claude}`,
  WIDGET_SIGNING_SECRET: SECRET,
  TOKEN_SECRET: 'e2e-token-secret',
  ADMIN_KEY,
  GHL_WEBHOOK_URL: `http://127.0.0.1:${PORT.ghl}/hook`,
  PUBLIC_URL: W,
  TEAM_EMAILS: TEAM,
  EMAIL_PROVIDER: 'log',
};

const SAM = { site: 'https://hopechurch.org', church: 'Hope Church', user_name: 'Sam Lee', user_email: 'sam@hopechurch.org' };
const RACHEL = { site: 'https://livingwaters.org', church: 'Living Waters', user_name: 'Rachel Kim', user_email: 'rachel@livingwaters.org' };

// --- harness ---------------------------------------------------------------

let tmp, dev, web, ghl, claude, browser, janeCtx, jane, admin;
const ghlHits = [];
const claudeCalls = [];
const devLog = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, { timeout = 15000, every = 250, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
}

function sign(person) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', SECRET).update(`${person.site}|${person.user_email}|${ts}`).digest('hex');
  return { ...person, ts, sig };
}

async function widgetApi(path, person, body = {}) {
  const res = await fetch(W + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context: sign(person), ...body }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function adminApi(path, body) {
  const res = await fetch(`${W}/admin/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-admin-key': ADMIN_KEY, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`admin ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const emails = async (conversation) =>
  (await adminApi('emails' + (conversation ? `?conversation=${encodeURIComponent(conversation)}` : ''))).emails;

// Cloudflare Email Routing → the Worker's email() handler.
async function inbound({ from, to, subject, text }) {
  const raw =
    `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: <${randomUUID()}@mail.test>\r\n` +
    `Date: ${new Date().toUTCString()}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}`;
  const res = await fetch(`${W}/cdn-cgi/local/email?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
    method: 'POST',
    body: raw,
  });
  return { status: res.status, body: await res.text() };
}

async function shot(page, name) {
  if (!SHOTS) return;
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

// Serves demo/ and widget/ from the repo, pointing the demo page at this run's Worker.
function startWeb() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = decodeURIComponent(new URL(req.url, WEB).pathname);
      const file = normalize(join(ROOT, path));
      if (!/^\/(demo|widget)\//.test(path) || !file.startsWith(ROOT)) return res.writeHead(404).end();
      let body;
      try {
        body = readFileSync(file);
      } catch {
        return res.writeHead(404).end();
      }
      if (path === '/demo/index.html') body = String(body).replace('http://127.0.0.1:8787', W);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
    });
    server.listen(PORT.web, '127.0.0.1', () => resolve(server));
  });
}

function startGhl() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        ghlHits.push(JSON.parse(body || '{}'));
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      });
    });
    server.listen(PORT.ghl, '127.0.0.1', () => resolve(server));
  });
}

// A stand-in for POST /v1/messages that answers the way Leo would, keyed off
// the real request the SDK sends: escalation and idea markers for chat, the
// structured coaching schema when output_config.format is present.
function standInAnswer(body) {
  if (body.output_config?.format) {
    const prompt = body.messages[0].content;
    const guidance = /<team_guidance>\n([\s\S]*?)\n<\/team_guidance>/.exec(prompt)[1].trim();
    const person = /person="([^"]*)"/.exec(prompt)[1];
    const turns = /<conversation[^>]*>\n([\s\S]*?)\n<\/conversation>/.exec(prompt)[1].split('\n\n');
    const asked = [...turns].reverse().find((t) => t.startsWith(`${person}: `) && t.includes('?'));
    const direct = guidance.replace(/^(tell|let)\s+(her|him|them)\s+(know\s+)?(that\s+|to\s+)?/i, '');
    const answer = direct.charAt(0).toUpperCase() + direct.slice(1);
    return JSON.stringify({
      reply_to_church: `Thanks for your patience, ${person}! I checked with the Faithmade team. ${answer}`,
      remember: true,
      memory_question: asked ? asked.slice(person.length + 2) : '',
      memory_answer: answer,
      note_to_team: 'Sent your answer and saved it to my memory.',
    });
  }
  const last = body.messages[body.messages.length - 1].content;
  const taught = /# Answers the Faithmade team has taught you\n\nQ: .*\nA: (.*)/.exec(body.system[1].text);
  if (/human|person|broken|billing/i.test(last)) return 'That one needs a real person — let me bring in the team. [[ESCALATE]]';
  if (taught) return `Good news — the Faithmade team taught me this one. ${taught[1]}`;
  if (/\b(wish|feature|could you add|would love|idea|suggest)\b/i.test(last)) {
    return "Faithmade can't do that yet — but it would make a great idea for the board. [[IDEA]]";
  }
  return `Here's how to do that from your dashboard. (stand-in answer to "${last.slice(0, 40)}")`;
}

function startClaude() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = JSON.parse(raw || '{}');
        claudeCalls.push({ path: req.url, headers: req.headers, body });
        const text = standInAnswer(body);
        res.writeHead(200, { 'content-type': 'application/json', 'request-id': `req_e2e_${claudeCalls.length}` }).end(
          JSON.stringify({
            id: `msg_e2e_${claudeCalls.length}`,
            type: 'message',
            role: 'assistant',
            model: body.model,
            content: [{ type: 'text', text }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 100, output_tokens: 40 },
          })
        );
      });
    });
    server.listen(PORT.claude, '127.0.0.1', () => resolve(server));
  });
}

async function newContext(options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, ...options });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  return ctx;
}

before(
  async () => {
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
    tmp = mkdtempSync(join(tmpdir(), 'fmhd-e2e-'));
    const config = join(tmp, 'wrangler.toml');
    const state = join(tmp, 'state');
    writeFileSync(
      config,
      readFileSync(join(WORKER, 'wrangler.toml'), 'utf8')
        .replace(/^name = .*$/m, 'name = "faithmade-helpdesk-e2e"')
        .replace(/^main = .*$/m, `main = ${JSON.stringify(join(WORKER, 'src', 'index.js'))}`)
        .replace(/^migrations_dir = .*$/m, `migrations_dir = ${JSON.stringify(join(WORKER, 'migrations'))}`)
    );
    writeFileSync(join(tmp, '.dev.vars'), Object.entries(VARS).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');

    const wrangler = join(WORKER, 'node_modules', '.bin', 'wrangler');
    const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
    execFileSync(wrangler, ['d1', 'migrations', 'apply', 'faithmade-helpdesk', '--local', '--config', config, '--persist-to', state], {
      cwd: tmp,
      env,
      stdio: 'pipe',
    });

    [web, ghl, claude] = await Promise.all([startWeb(), startGhl(), startClaude()]);
    dev = spawn(wrangler, ['dev', '--config', config, '--persist-to', state, '--port', String(PORT.worker), '--ip', '127.0.0.1'], {
      cwd: tmp,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    dev.stdout.on('data', (d) => devLog.push(String(d)));
    dev.stderr.on('data', (d) => devLog.push(String(d)));
    await until(() => fetch(`${W}/health`).then((r) => r.ok), { timeout: 90000, what: 'wrangler dev' }).catch((err) => {
      console.error(devLog.join(''));
      throw err;
    });

    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
    janeCtx = await newContext();
  },
  { timeout: 180000 }
);

after(async () => {
  await browser?.close().catch(() => {});
  if (dev) {
    try {
      process.kill(-dev.pid, 'SIGTERM');
    } catch {}
    await sleep(500);
  }
  web?.close();
  ghl?.close();
  claude?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

// --- the flows, in order -----------------------------------------------------

let janeConv, leoAddress, escSubject;
const samConv = `e2e-sam-${randomUUID().slice(0, 8)}`;

test('Jane asks Leo something it can’t answer and brings in the team (SMS + email)', async () => {
  jane = await janeCtx.newPage();
  await jane.goto(`${WEB}/demo/index.html`);
  await jane.click('#rhd-root .rhd-launcher');
  await jane.waitForSelector('.rhd-chip');
  await jane.fill('.rhd-input', 'Why is our sermon podcast feed broken on Spotify?');
  await jane.press('.rhd-input', 'Enter');
  await jane.waitForSelector('.rhd-escalate:not([hidden])');
  await jane.fill('.rhd-esc-msg', 'We submitted the feed last week but Spotify says it’s invalid.');
  await jane.fill('.rhd-esc-phone', '(555) 201-3344');
  await jane.click('.rhd-escalate-btn');
  await jane.waitForFunction(() => document.querySelector('.rhd-messages').textContent.includes('Done —'));
  await shot(jane, '01-escalated');

  janeConv = await jane.evaluate(() => JSON.parse(localStorage.getItem('rhd-conversation')).id);
  assert.match(janeConv, /^[0-9a-f-]{36}$/);

  const sms = ghlHits.find((h) => h.conversation_id === janeConv);
  assert.equal(sms.phone, '(555) 201-3344');
  assert.match(sms.transcript, /USER: Why is our sermon podcast feed broken on Spotify\?/);

  const esc = (await emails(janeConv)).find((e) => e.kind === 'escalation');
  assert.equal(esc.to_addr, TEAM);
  assert.equal(esc.subject, 'Leo needs you · Grace Church: Why is our sermon podcast feed broken on Spotify?');
  assert.match(esc.reply_to, /^leo\+[0-9a-f-]{36}\.[0-9a-f]{16}@reply\.faithmade\.app$/);
  leoAddress = esc.reply_to;
  escSubject = esc.subject;
});

test('replying to Leo’s email coaches Leo: Jane sees the answer live, Leo remembers', async () => {
  const guidance = 'Tell her to open Sermons → Podcast Settings and click Save to refresh the feed.';
  const quoted = 'On Sat, Oct 3, 2026 at 9:14 AM Leo <leo@reply.faithmade.app> wrote:\r\n> — Reply above this line to coach Leo —\r\n> Leo needs you\r\n';
  const r = await inbound({ from: TEAM, to: leoAddress, subject: `Re: ${escSubject}`, text: `${guidance}\r\n\r\n${quoted}` });
  assert.equal(r.status, 200, r.body);

  // Jane still has the chat open, so it arrives live — no email to her.
  await jane.waitForFunction(() => document.querySelector('.rhd-messages').textContent.includes('Thanks for your patience, Jane'), null, {
    timeout: 20000,
  });
  await shot(jane, '02-coached-answer-live');
  const all = await emails(janeConv);
  assert.ok(all.some((e) => e.kind === 'coach_confirm' && e.to_addr === TEAM), 'confirmation to the team');
  assert.ok(!all.some((e) => e.kind === 'leo_reply'), 'Jane was watching the chat, so no email to her');

  const coaching = claudeCalls.find((c) => c.body.output_config?.format?.type === 'json_schema');
  assert.ok(coaching, 'coaching went to Claude as a structured-output request');
  assert.match(coaching.body.messages[0].content, /<team_guidance>\nTell her to open Sermons/);

  const { memories } = await adminApi('memories');
  assert.equal(memories.length, 1);
  assert.equal(memories[0].question, 'Why is our sermon podcast feed broken on Spotify?');
  assert.equal(memories[0].answer, 'Open Sermons → Podcast Settings and click Save to refresh the feed.');
  assert.equal(memories[0].created_via, 'email');
});

test('the next church that asks gets the answer the team taught Leo', async () => {
  const { status, data } = await widgetApi('/chat', SAM, {
    conversation_id: samConv,
    message: 'How do we get our sermon podcast feed working on Spotify again?',
  });
  assert.equal(status, 200);
  assert.match(data.reply, /the Faithmade team taught me this one\. Open Sermons → Podcast Settings/);
  assert.equal((await adminApi('memories')).memories[0].match_count, 1);
  // The taught answer rode along in the request the real SDK sent from workerd.
  const call = claudeCalls[claudeCalls.length - 1];
  assert.match(call.body.system[1].text, /Q: Why is our sermon podcast feed broken on Spotify\?/);
  assert.match(call.body.system[2].text, /Church: Hope Church/);
});

test('a team reply while Jane is away shows up as a badge and preview, then in the restored thread', async () => {
  await jane.click('.rhd-launcher'); // she closes the chat
  await adminApi('reply', { id: janeConv, content: 'Hi Jane — Andrew here. I re-saved your feed too, so you should be all set.' });
  await jane.reload();
  await jane.waitForSelector('.rhd-peek:not([hidden])', { timeout: 15000 });
  assert.equal(await jane.textContent('.rhd-badge'), '1');
  assert.match(await jane.textContent('.rhd-peek-text'), /Andrew here/);
  await shot(jane, '03-badge-and-peek');

  await jane.click('.rhd-peek-text');
  await jane.waitForFunction(() => document.querySelector('.rhd-messages').textContent.includes('Andrew here'));
  const thread = await jane.textContent('.rhd-messages');
  assert.match(thread, /Why is our sermon podcast feed broken on Spotify\?/); // whole thread restored
  assert.match(thread, /Thanks for your patience, Jane/);
  assert.equal(await jane.isHidden('.rhd-badge'), true);
});

test('Leo points a feature request at the Ideas board, and duplicates surface before posting', async () => {
  const seeded = await widgetApi('/ideas/new', RACHEL, { title: 'Prayer wall page', body: 'A page where members can post prayer requests.' });
  assert.equal(seeded.status, 200);
  await adminApi('handoff', { id: janeConv }); // the team hands the thread back to Leo

  await jane.fill('.rhd-input', 'I wish we could have a prayer wall where members post requests');
  await jane.press('.rhd-input', 'Enter');
  await jane.waitForSelector('.rhd-idea-card');
  await shot(jane, '04-leo-suggests-idea');
  await jane.click('.rhd-idea-card button');
  await jane.waitForSelector('.rhd-similar:not([hidden]) .rhd-idea');
  assert.equal(await jane.inputValue('.rhd-new-title'), 'A prayer wall where members post requests');
  assert.match(await jane.textContent('.rhd-similar'), /Prayer wall page/);
  await shot(jane, '05-similar-ideas');

  // Vote for the existing idea instead of posting a duplicate.
  await jane.click('.rhd-similar [data-vote]');
  await until(async () => (await adminApi('ideas')).ideas.find((i) => i.title === 'Prayer wall page').vote_count === 2, {
    what: 'the vote to land',
  });
});

test('Jane posts a new idea; the team hears about it; the board sorts by votes', async () => {
  await jane.fill('.rhd-new-title', 'Online giving with recurring gifts');
  await jane.fill('.rhd-new-body', 'Let members set up monthly gifts right from our site.');
  await jane.click('.rhd-idea-new .rhd-primary');
  await jane.waitForSelector('.rhd-notice');
  assert.match(await jane.textContent('.rhd-detail-top'), /Online giving with recurring gifts/);
  assert.match(await jane.textContent('.rhd-detail-top .rhd-vote'), /1/);
  await shot(jane, '06-idea-posted');

  assert.ok((await emails()).some((e) => e.kind === 'idea_new' && e.subject === 'New idea · Online giving with recurring gifts'));

  await jane.click('.rhd-idea-detail .rhd-back');
  await jane.waitForSelector('.rhd-ideas-items .rhd-idea');
  const titles = await jane.$$eval('.rhd-ideas-items .rhd-idea-title', (els) => els.map((e) => e.textContent));
  assert.deepEqual(titles, ['Prayer wall page', 'Online giving with recurring gifts']);
});

test('the team triages in the inbox; voters get an email that opens their own dashboard', async () => {
  const ctx = await newContext({ viewport: { width: 1440, height: 900 } });
  admin = await ctx.newPage();
  await admin.goto(`${W}/admin`);
  await admin.fill('input[name=key]', ADMIN_KEY);
  await Promise.all([admin.waitForNavigation(), admin.click('button[type=submit]')]);
  await admin.waitForSelector('#rows');

  await admin.evaluate(() => (location.hash = 'ideas'));
  await admin.locator('.icard', { hasText: 'Prayer wall page' }).click();
  await admin.waitForSelector('#i-statuses');
  await admin.click('#i-statuses [data-s=planned]');
  await admin.fill('#i-note', 'Coming this summer!');
  assert.equal(await admin.isChecked('#i-notify'), true);
  await shot(admin, '07-admin-idea-drawer');
  await admin.click('#i-apply');
  await admin.waitForSelector('.toast:not([hidden])');

  const update = (await emails()).find((e) => e.kind === 'idea_status' && e.to_addr === 'jane@gracechurch.org');
  const { email } = await adminApi(`email?id=${update.id}`);
  assert.equal(email.subject, 'Planned: Prayer wall page');
  assert.match(email.html, /https:\/\/gracechurch\.org\/wp-admin\/\?fmhd=idea-\d+/);
  assert.match(email.html, /Coming this summer!/);
});

test('the inbox tells the whole story, and coaching works from there too', async () => {
  await admin.evaluate((id) => (location.hash = `c=${id}`), janeConv);
  await admin.waitForSelector('#msgs .side.coach');
  const text = await admin.textContent('#msgs');
  assert.match(text, /Escalated · Leo couldn’t answer/);
  assert.match(text, /Coached Leo/);
  assert.match(text, /Leo → team/);
  assert.match(text, /Andrew here/);

  await admin.click('#modes [data-mode=coach]');
  await admin.fill('#reply', 'Tell her new Spotify listings can take up to 48 hours to appear.');
  await admin.click('#send');
  // The previous step's notice may still be up; wait for this one's.
  await admin.waitForFunction(() => /Leo replied to Jane/.test(document.querySelector('#toast').textContent), null, { timeout: 20000 });
  await shot(admin, '08-admin-thread');
  await jane.waitForFunction(() => document.querySelector('.rhd-messages').textContent.includes('48 hours'), null, { timeout: 20000 });
});

test('the reply link works from a phone: the church gets the team’s exact words', async () => {
  await widgetApi('/chat', SAM, { conversation_id: samConv, message: 'Can a person help me update the billing card on our account?' });
  const esc = await widgetApi('/escalate', SAM, { conversation_id: samConv, reason: 'Leo suggested escalation', user_message: 'Our card expired last week.' });
  assert.equal(esc.status, 200);
  const sent = (await emails(samConv)).find((e) => e.kind === 'escalation');
  const { email } = await adminApi(`email?id=${sent.id}`);
  const link = /href="(http:\/\/127\.0\.0\.1:\d+\/r\/[^"]+)"/.exec(email.html)[1].replace(/&amp;/g, '&');

  const phone = await newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await phone.newPage();
  await p.goto(link);
  assert.match(await p.textContent('h1'), /Sam Lee/);
  await p.fill('textarea', 'Hi Sam — I just texted you a secure link to update the card.');
  await Promise.all([p.waitForNavigation(), p.click('button[type=submit]')]);
  assert.match(await p.textContent('.banner'), /Sent to Sam/);
  await shot(p, '09-reply-link-sent');

  const thread = await adminApi(`conversation?id=${samConv}`);
  const reply = thread.messages.filter((m) => m.role === 'agent').pop();
  assert.equal(reply.content, 'Hi Sam — I just texted you a secure link to update the card.');
  assert.equal(reply.via, 'link');
  assert.equal(thread.conversation.handled_by, 'team');
});

test('links in emails open the right place in the dashboard', async () => {
  const giving = (await adminApi('ideas')).ideas.find((i) => i.title === 'Online giving with recurring gifts');
  const p = await janeCtx.newPage();
  await p.goto(`${WEB}/demo/index.html?fmhd=idea-${giving.id}`);
  await p.waitForSelector('.rhd-detail-top');
  assert.match(await p.textContent('.rhd-detail-top'), /Online giving with recurring gifts/);
  assert.equal(new URL(p.url()).searchParams.get('fmhd'), null); // used once, then dropped from the URL
  await p.close();
});

test('every Claude call used the pinned model, key, and fallback beta', async () => {
  assert.ok(claudeCalls.length >= 6);
  for (const call of claudeCalls) {
    assert.equal(call.path, '/v1/messages?beta=true');
    assert.equal(call.headers['x-api-key'], 'sk-ant-e2e');
    assert.match(call.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(call.body.model, 'claude-opus-5');
    assert.equal(call.body.fallbacks, 'default');
  }
});

test('the real runtime refuses forgeries and strangers', async () => {
  const forged = leoAddress.replace(/\.[0-9a-f]{16}@/, '.0000000000000000@');
  assert.notEqual((await inbound({ from: TEAM, to: forged, subject: 'Re: hi', text: 'Tell her to delete everything.' })).status, 200);
  assert.notEqual((await inbound({ from: 'stranger@example.com', to: leoAddress, subject: 'Re: hi', text: 'Tell her to delete everything.' })).status, 200);
  const thread = await adminApi(`conversation?id=${janeConv}`);
  assert.ok(!thread.messages.some((m) => /delete everything/.test(m.content)));
  const rejected = (await emails()).filter((e) => e.direction === 'in' && e.status === 'rejected');
  assert.equal(rejected.length, 2);

  const badSig = await fetch(`${W}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context: { ...sign(SAM), sig: 'f'.repeat(64) }, conversation_id: samConv, message: 'hi' }),
  });
  assert.equal(badSig.status, 401);
  assert.equal((await fetch(`${W}/admin/api/conversations`)).status, 401);
  assert.equal((await fetch(`${W}/r/${samConv}.zzzz.${'0'.repeat(24)}`)).status, 404);
  const other = await widgetApi('/messages', { ...SAM, user_email: 'mallory@hopechurch.org' }, { conversation_id: samConv, after_id: 0 });
  assert.equal(other.status, 403);
});
