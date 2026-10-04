// Escalation bridge: fires the HighLevel inbound-webhook workflow, which
// upserts the contact, adds a transcript note, and SMSes Andrew.
// Workflow setup: docs/GHL-SETUP.md
//
// Returns the webhook's HTTP status, or 0 when it isn't configured or can't be
// reached — an outage at HighLevel must not stop the escalation emails.

export async function escalateToGhl(env, { context, conversationId, reason, userMessage, phone, transcript }) {
  if (!env.GHL_WEBHOOK_URL) return 0;

  const payload = {
    source: 'faithmade-helpdesk',
    name: context.user_name || context.user_email,
    email: context.user_email,
    phone: phone || '',
    church: context.church || '',
    site: context.site,
    reason,
    client_note: userMessage || '',
    conversation_id: conversationId,
    transcript,
  };

  try {
    const res = await fetch(env.GHL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.status;
  } catch (err) {
    console.error('GHL webhook unreachable', err);
    return 0;
  }
}
