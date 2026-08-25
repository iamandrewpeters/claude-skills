// Escalation bridge: fires the HighLevel inbound-webhook workflow, which
// upserts the contact, adds a transcript note, and SMSes Andrew.
// Workflow setup: docs/GHL-SETUP.md

export async function escalateToGhl(env, { context, conversationId, reason, userMessage, phone, transcript }) {
  if (!env.GHL_WEBHOOK_URL) return 0; // workflow not wired yet — recorded in D1, surfaced to the client as a failure

  const payload = {
    source: 'reach-helpdesk',
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

  const res = await fetch(env.GHL_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.status;
}
