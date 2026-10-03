import test from 'node:test';
import assert from 'node:assert/strict';
import { testEnv, run, widget, adminPost, adminGet, withFetch, okFetch, outbound, TEAM } from './helpers.js';

const SAM = { site: 'https://hopechurch.org', church: 'Hope Church', user_name: 'Sam Lee', user_email: 'sam@hopechurch.org' };
const call = async (env, path, body, who) => (await widget(env, path, body, who)).json();

async function postIdea(env, title, body = '', who) {
  return call(env, '/ideas/new', { title, body }, who);
}

test('a church posts an idea: it starts with their vote, and the team hears about it', async () => {
  const env = testEnv();
  const d = await postIdea(env, 'Spanish sermon notes', 'Half our congregation reads Spanish.');
  assert.equal(d.idea.title, 'Spanish sermon notes');
  assert.equal(d.idea.status, 'under_review');
  assert.equal(d.idea.vote_count, 1);
  assert.equal(d.idea.voted, true);
  assert.equal(d.idea.mine, true);
  assert.ok(!('author_email' in d.idea)); // other churches never see addresses

  const [email] = outbound(env, 'idea_new');
  assert.equal(email.to_addr, TEAM);
  assert.equal(email.subject, 'New idea · Spanish sermon notes');
  assert.match(email.html, /https:\/\/helpdesk\.test\/admin#idea=1/);
});

test('titles are required', async () => {
  const env = testEnv();
  const res = await widget(env, '/ideas/new', { title: 'ab' });
  assert.equal(res.status, 400);
});

test('voting is one per person, and can be taken back', async () => {
  const env = testEnv();
  const { idea } = await postIdea(env, 'Prayer wall');
  assert.deepEqual(await call(env, '/ideas/vote', { id: idea.id, on: true }, SAM), { vote_count: 2, voted: true });
  assert.deepEqual(await call(env, '/ideas/vote', { id: idea.id, on: true }, SAM), { vote_count: 2, voted: true });
  assert.deepEqual(await call(env, '/ideas/vote', { id: idea.id, on: false }, SAM), { vote_count: 1, voted: false });
});

test('the board sorts by votes or newest, and shows each person their own votes', async () => {
  const env = testEnv();
  const a = (await postIdea(env, 'Prayer wall')).idea;
  const b = (await postIdea(env, 'Sermon series pages', '', SAM)).idea;
  await call(env, '/ideas/vote', { id: b.id, on: true }, { ...SAM, user_email: 'pat@hopechurch.org' });
  const top = await call(env, '/ideas', { sort: 'top' });
  assert.deepEqual(top.ideas.map((i) => i.title), ['Sermon series pages', 'Prayer wall']);
  assert.deepEqual(top.ideas.map((i) => i.voted), [false, true]);
  const fresh = await call(env, '/ideas', { sort: 'new' });
  assert.equal(fresh.ideas[0].id, b.id);
  assert.ok(a.id < b.id);
});

test('similar ideas surface while typing, so votes don’t split', async () => {
  const env = testEnv();
  await postIdea(env, 'Spanish sermon notes', 'Translate sermon notes into Spanish');
  await postIdea(env, 'Online giving page');
  const d = await call(env, '/ideas/similar', { text: 'sermon notes in spanish please' }, SAM);
  assert.equal(d.ideas.length, 1);
  assert.equal(d.ideas[0].title, 'Spanish sermon notes');
});

test('comments show first names, and team comments are marked', async () => {
  const env = testEnv();
  const { idea } = await postIdea(env, 'Prayer wall');
  await call(env, '/ideas/comment', { id: idea.id, body: 'We would use this weekly!' }, SAM);
  await run(env, adminPost('/admin/api/idea/comment', { id: idea.id, body: 'On our list for spring.' }));
  const d = await call(env, '/ideas/get', { id: idea.id });
  assert.deepEqual(
    d.comments.map((c) => [c.author, c.is_team, c.body]),
    [
      ['Sam', false, 'We would use this weekly!'],
      ['Faithmade team', true, 'On our list for spring.'],
    ]
  );
  assert.equal(d.idea.comment_count, 2);
});

test('moving an idea emails every voter with a link into their own dashboard', async () => {
  const env = testEnv({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test' });
  let idea;
  const calls = await withFetch(
    (url) => (url.endsWith('/batch') ? new Response(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] })) : okFetch()),
    async () => {
      idea = (await postIdea(env, 'Prayer wall')).idea;
      await call(env, '/ideas/vote', { id: idea.id, on: true }, SAM);
      const res = await run(env, adminPost('/admin/api/idea/status', { id: idea.id, status: 'planned', note: 'Building it this spring!', notify: true }));
      const d = await res.json();
      assert.equal(d.idea.status, 'planned');
      assert.deepEqual(d.notified, { voters: 2, sent: 2 });
    }
  );
  const batch = calls.find((c) => c.url === 'https://api.resend.com/emails/batch');
  assert.equal(batch.body.length, 2);
  assert.deepEqual(batch.body.map((m) => m.to[0]).sort(), ['jane@gracechurch.org', 'sam@hopechurch.org']);
  const sams = batch.body.find((m) => m.to[0] === 'sam@hopechurch.org');
  assert.equal(sams.subject, 'Planned: Prayer wall');
  assert.match(sams.html, /hopechurch\.org\/wp-admin\/\?fmhd=idea-1/);
  assert.match(sams.html, /Building it this spring!/);

  // The note also lands on the idea for everyone to see.
  const d = await call(env, '/ideas/get', { id: idea.id }, SAM);
  assert.equal(d.comments[0].body, 'Building it this spring!');
  assert.equal(d.idea.status, 'planned');
});

test('merging folds duplicate votes and comments into one idea', async () => {
  const env = testEnv();
  const keep = (await postIdea(env, 'Spanish sermon notes')).idea;
  const dupe = (await postIdea(env, 'Sermon notes en español', '', SAM)).idea;
  await call(env, '/ideas/vote', { id: dupe.id, on: true }); // Jane voted on both
  await call(env, '/ideas/comment', { id: dupe.id, body: 'Yes please' }, SAM);

  const res = await run(env, adminPost('/admin/api/idea/merge', { id: dupe.id, into: keep.id }));
  assert.equal(res.status, 200);
  const merged = await call(env, '/ideas/get', { id: keep.id });
  assert.equal(merged.idea.vote_count, 2); // Jane + Sam, Jane not double-counted
  assert.equal(merged.comments.length, 1);
  assert.deepEqual((await call(env, '/ideas', {})).ideas.map((i) => i.id), [keep.id]);
  // Old links to the duplicate land on the merged idea.
  assert.equal((await call(env, '/ideas/get', { id: dupe.id })).idea.id, keep.id);
});

test('the admin board lists ideas with voters and lets the team edit', async () => {
  const env = testEnv();
  const { idea } = await postIdea(env, 'Prayer wal');
  await run(env, adminPost('/admin/api/idea/update', { id: idea.id, title: 'Prayer wall' }));
  const list = await (await run(env, adminGet('/admin/api/ideas'))).json();
  assert.equal(list.ideas[0].title, 'Prayer wall');
  assert.equal(list.ideas[0].author_email, 'jane@gracechurch.org');
  const one = await (await run(env, adminGet(`/admin/api/idea?id=${idea.id}`))).json();
  assert.equal(one.voters[0].voter_name, 'Jane Smith');
  await run(env, adminPost('/admin/api/idea/delete', { id: idea.id }));
  assert.equal((await (await run(env, adminGet('/admin/api/ideas'))).json()).ideas.length, 0);
});
