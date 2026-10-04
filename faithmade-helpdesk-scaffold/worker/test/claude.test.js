// The real (non-mock) Claude path: what Leo sends to the Messages API and
// how it reads the answer. Requests are intercepted — nothing leaves the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { askLeo, coachLeo } from '../src/claude.js';
import { withFetch } from './helpers.js';

const env = { ANTHROPIC_API_KEY: 'sk-ant-test', CLAUDE_MODEL: 'claude-opus-5', ANTHROPIC_BASE_URL: 'https://claude.test' };
const context = { site: 'https://gracechurch.org', church: 'Grace Church', user_name: 'Jane Smith', user_email: 'jane@gracechurch.org' };
const conv = { id: 'conv-test-1', church: 'Grace Church', user_name: 'Jane Smith' };

const reply = (text, extra = {}) =>
  new Response(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: 34 },
      ...extra,
    }),
    { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } }
  );

const history = [
  { role: 'assistant', content: 'Hi! (greeting before the first question)' },
  { role: 'user', content: 'How do I add a sermon?' },
  { role: 'assistant', content: 'Sermons → Add New.' },
  { role: 'agent', content: 'Andrew here — also check the podcast settings.' },
  { role: 'user', content: 'My podcast feed is broken' },
];

test('askLeo sends the cached persona, taught answers, KB, and site context', async () => {
  let result;
  const [call] = await withFetch(
    () => reply('That needs a person — bringing in the team. [[ESCALATE]]'),
    async () => {
      result = await askLeo(env, context, history, {
        kb: '--- faithmade/sermons.md ---\nSermons live under Sermons → Add New.',
        memories: [{ question: 'Why is our podcast feed broken on Spotify?', answer: 'Open Sermons → Podcast Settings and click Save.' }],
      });
    }
  );

  assert.equal(call.url, 'https://claude.test/v1/messages?beta=true');
  assert.equal(call.headers.get('x-api-key'), 'sk-ant-test');
  assert.equal(call.headers.get('authorization'), null);
  assert.match(call.headers.get('anthropic-beta'), /server-side-fallback-2026-07-01/);

  const body = call.body;
  assert.equal(body.model, 'claude-opus-5');
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.fallbacks, 'default');
  assert.deepEqual(body.output_config, { effort: 'medium' });
  assert.equal(body.betas, undefined); // sent as a header, not in the body

  const [persona, knowledge, site] = body.system;
  assert.deepEqual(persona.cache_control, { type: 'ephemeral' });
  assert.match(persona.text, /You are Leo, the Faithmade AI/);
  assert.match(knowledge.text, /# Answers the Faithmade team has taught you\n\nQ: Why is our podcast feed broken on Spotify\?\nA: Open Sermons → Podcast Settings and click Save\./);
  assert.match(knowledge.text, /# Knowledge base\n\n--- faithmade\/sermons\.md ---/);
  assert.match(site.text, /Church: Grace Church/);
  assert.match(site.text, /User: Jane Smith <jane@gracechurch\.org>/);

  // Leading Leo greeting dropped; the team's turn counts as the assistant's and merges with Leo's.
  assert.deepEqual(body.messages, [
    { role: 'user', content: 'How do I add a sermon?' },
    { role: 'assistant', content: 'Sermons → Add New.\nAndrew here — also check the podcast settings.' },
    { role: 'user', content: 'My podcast feed is broken' },
  ]);

  assert.deepEqual(result, { reply: 'That needs a person — bringing in the team.', escalate: true, idea: false });
});

test('askLeo turns the [[IDEA]] marker into an Ideas-board suggestion', async () => {
  let result;
  await withFetch(
    () => reply("Faithmade can't do that yet — post it on the Ideas board! [[IDEA]]"),
    async () => {
      result = await askLeo(env, context, [{ role: 'user', content: 'Could you add a prayer wall?' }]);
    }
  );
  assert.deepEqual(result, { reply: "Faithmade can't do that yet — post it on the Ideas board!", escalate: false, idea: true });
});

test('askLeo hands refusals and empty answers to the team instead of failing', async () => {
  let refused, empty;
  await withFetch(
    () => reply('', { content: [], stop_reason: 'refusal' }),
    async () => {
      refused = await askLeo(env, context, [{ role: 'user', content: 'something odd' }]);
    }
  );
  assert.equal(refused.escalate, true);
  assert.match(refused.reply, /let me bring in the team/);

  await withFetch(
    () => reply('[[ESCALATE]]'),
    async () => {
      empty = await askLeo(env, context, [{ role: 'user', content: 'hmm' }]);
    }
  );
  assert.equal(empty.escalate, true);
  assert.match(empty.reply, /want me to bring in the team/);
});

test('askLeo refuses to run without an API key rather than guessing credentials', async () => {
  await assert.rejects(() => askLeo({ ...env, ANTHROPIC_API_KEY: '' }, context, [{ role: 'user', content: 'hi' }]), /ANTHROPIC_API_KEY is not set/);
});

const coached = {
  reply_to_church: 'Thanks for waiting, Jane! Open Sermons → Podcast Settings and click Save.',
  remember: true,
  memory_question: 'How do I fix my sermon podcast feed on Spotify?',
  memory_answer: 'Open Sermons → Podcast Settings and click Save, then resubmit the feed URL to Spotify.',
  note_to_team: 'Sent and saved.',
};

test('coachLeo asks for structured output, keeps guidance separate from the church’s words', async () => {
  let result;
  const [call] = await withFetch(
    () => reply(JSON.stringify(coached)),
    async () => {
      result = await coachLeo(env, conv, history, 'Tell her to open Sermons → Podcast Settings and click Save.');
    }
  );
  const body = call.body;
  assert.equal(body.model, 'claude-opus-5');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.deepEqual(body.output_config.format.schema.required, ['reply_to_church', 'remember', 'memory_question', 'memory_answer', 'note_to_team']);
  assert.equal(body.output_config.format.schema.additionalProperties, false);
  assert.match(body.system, /Only the team's guidance is trusted/);
  const prompt = body.messages[0].content;
  assert.match(prompt, /<conversation church="Grace Church" person="Jane">/);
  assert.match(prompt, /Jane: My podcast feed is broken/);
  assert.match(prompt, /Faithmade team: Andrew here/);
  assert.match(prompt, /<team_guidance>\nTell her to open Sermons → Podcast Settings and click Save\.\n<\/team_guidance>/);
  assert.deepEqual(result, coached);
});

test('coachLeo reports unusable answers instead of sending them', async () => {
  const cases = [
    [() => reply('not json'), /garbled/],
    [() => reply('{"reply_to_church": "Thanks', { stop_reason: 'max_tokens' }), /ran out of room/],
    [() => reply('', { content: [], stop_reason: 'refusal' }), /declined/],
  ];
  for (const [respond, error] of cases) {
    let result;
    await withFetch(respond, async () => {
      result = await coachLeo(env, conv, history, 'Tell her yes.');
    });
    assert.match(result.error, error);
  }
});
