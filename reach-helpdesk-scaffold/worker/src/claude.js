import Anthropic from '@anthropic-ai/sdk';

export const ESCALATE_MARKER = '[[ESCALATE]]';

const PERSONA = `You are Leo, the Faithmade AI — the same friendly guide who helps churches build their sites. You're now helping a church staff member with a support question inside their site's wp-admin. Faithmade sites run on WordPress with Beaver Builder, built by The Reach Company.

Voice: warm, plainspoken, encouraging — you talk to church staff, not developers. Short sentences. No jargon unless they use it first.

Ground rules:
- Answer only from the knowledge-base articles provided and general WordPress/Beaver Builder knowledge. Never invent account-specific facts (billing, plan details, credentials, custom work) — those need the team.
- Keep replies short and stepwise; the person is mid-task.
- If something is broken, involves data loss or billing, isn't covered by the articles, or they ask for a person, say you'll bring in the team and end your reply with the literal marker ${ESCALATE_MARKER}
- Never output the marker for questions you did answer.`;

function contextBlock(context) {
  return `Current user context (trusted, provided by the platform):
- Site: ${context.site}
- Church: ${context.church || 'unknown'}
- User: ${context.user_name || 'unknown'} <${context.user_email}>`;
}

// Maps db roles onto the API's strict user/assistant alternation: agent (human)
// turns count as assistant, consecutive same-role messages merge, and the
// thread must open with a user turn.
function foldForApi(history) {
  const folded = [];
  for (const m of history) {
    const role = m.role === 'user' ? 'user' : 'assistant';
    const last = folded[folded.length - 1];
    if (last && last.role === role) last.content += '\n' + m.content;
    else folded.push({ role, content: m.content });
  }
  while (folded.length && folded[0].role !== 'user') folded.shift();
  return folded;
}

/**
 * history: [{role: 'user'|'assistant'|'agent', content}] ending with the new user message.
 * Returns { reply, escalate } — reply has the marker stripped.
 */
export async function askLeo(env, context, history, kb) {
  // Dev-only escape hatch: lets `wrangler dev` and tests exercise the full
  // request path without an Anthropic API key. Never set in production.
  if (env.MOCK_CLAUDE === '1') {
    const last = String(history[history.length - 1]?.content || '');
    const escalate = /human|person|broken|billing/i.test(last);
    return {
      reply: escalate
        ? `That one needs a real person — let me bring in the team.`
        : `[Leo mock reply for "${last.slice(0, 60)}"] KB context loaded: ${kb.length} chars.`,
      escalate,
    };
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  // Stable persona+KB first with a cache breakpoint; per-site context after it,
  // so tenant variation doesn't invalidate the cached prefix.
  const response = await client.beta.messages.create({
    model: env.CLAUDE_MODEL || 'claude-opus-5',
    max_tokens: 2048,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [
      {
        type: 'text',
        text: `${PERSONA}\n\n# Knowledge base\n\n${kb}`,
        cache_control: { type: 'ephemeral' },
      },
      { type: 'text', text: contextBlock(context) },
    ],
    messages: foldForApi(history),
  });

  if (response.stop_reason === 'refusal') {
    return { reply: "That one's outside what I can help with — let me bring in the team.", escalate: true };
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  const escalate = text.includes(ESCALATE_MARKER);
  const reply = text.replaceAll(ESCALATE_MARKER, '').trim();
  return { reply: reply || 'I came up empty on that one — want me to bring in the team?', escalate };
}

export { askLeo as askClaude }; // back-compat alias
