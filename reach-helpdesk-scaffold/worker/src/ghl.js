// Escalation bridge: fires the HighLevel inbound-webhook workflow, which
// upserts the contact, adds a transcript note, and SMSes Andrew.
// Workflow setup: docs/GHL-SETUP.md

export async function escalateToGhl(env, { context, conversationId, reason, transcript }) {
  const payload = {
    source: 'reach-helpdesk',
    name: context.user_name || context.user_email,
    email: context.user_email,
    phone: context.user_phone || '',
    church: context.church || '',
    site: context.site,
    reason,
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
