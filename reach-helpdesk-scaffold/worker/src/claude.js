import Anthropic from '@anthropic-ai/sdk';

export const ESCALATE_MARKER = '[[ESCALATE]]';

const PERSONA = `You are the support assistant for Faithmade (church websites built on WordPress + Beaver Builder by The Reach Company). You are chatting with a church staff member inside their site's wp-admin.

Ground rules:
- Answer only from the knowledge-base articles provided and general WordPress/Beaver Builder knowledge. Never invent account-specific facts (billing amounts, plan details, credentials, custom work) — those need a human.
- Keep replies short and stepwise; the user is mid-task in wp-admin.
- If the question is about something broken, data loss, billing, or anything you cannot resolve from the articles, or the user asks for a person, say you'll connect them with the team and end your reply with the literal marker ${ESCALATE_MARKER}
- Never output the marker for questions you did answer.`;

function contextBlock(context) {
  return `Current user context (trusted, provided by the platform):
- Site: ${context.site}
- Church: ${context.church || 'unknown'}
- User: ${context.user_name || 'unknown'} <${context.user_email}>`;
}

/**
 * history: [{role: 'user'|'assistant', content: string}, ...] ending with the new user message.
 * Returns { reply, escalate } — reply has the marker stripped.
 */
export async function askClaude(env, context, history, kb) {
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
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  });

  if (response.stop_reason === 'refusal') {
    return {
      reply: "I can't help with that one directly — let me connect you with the team.",
      escalate: true,
    };
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  const escalate = text.includes(ESCALATE_MARKER);
  const reply = text.replaceAll(ESCALATE_MARKER, '').trim();
  return { reply: reply || 'Sorry — I came up empty on that. Want me to loop in the team?', escalate };
}
