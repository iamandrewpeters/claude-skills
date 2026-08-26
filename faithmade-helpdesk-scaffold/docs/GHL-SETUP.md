# HighLevel Setup

One workflow + one email forward. Everything the Worker needs from GHL is the workflow's inbound-webhook URL.

## 1. The escalation workflow

**Automation → Workflows → Create Workflow → Start from Scratch**

1. **Trigger: Inbound Webhook.** GHL shows a webhook URL — copy it, this becomes the Worker's `GHL_WEBHOOK_URL` secret. Use "Test webhook" with the sample payload below so GHL learns the field names for mapping.
2. **Action: Create/Update Contact.** Map `email` → Email, `name` → Full Name, `phone` → Phone (may be empty), `church` → a custom field (create `Church` if needed), and tag the contact `helpdesk`.
3. **Action: Add Notes.** Body:
   ```
   Support escalation from {{inboundWebhookRequest.church}} ({{inboundWebhookRequest.site}})
   Reason: {{inboundWebhookRequest.reason}}

   {{inboundWebhookRequest.transcript}}
   ```
4. **Action: Send Internal Notification → SMS** to Andrew's number:
   ```
   🛟 Helpdesk: {{inboundWebhookRequest.name}} ({{inboundWebhookRequest.church}})
   {{inboundWebhookRequest.reason}}
   Reply from GHL: {{contact.contact_source_link}}
   ```
5. **(Optional) Action: Create Opportunity** in a "Support" pipeline, stage "New", so open items are visible on a board. Move to "Resolved" manually when done.
6. Publish the workflow.

### Sample webhook payload (what the Worker sends)

```json
{
  "source": "faithmade-helpdesk",
  "name": "Jane Smith",
  "email": "jane@gracechurch.org",
  "phone": "",
  "church": "Grace Church",
  "site": "https://gracechurch.org",
  "reason": "Bot could not resolve; user requested a human",
  "conversation_id": "b1f0…",
  "transcript": "USER: How do I …\nBOT: …"
}
```

## 2. support@ email into GHL

So email tickets land in the same inbox as escalations:

- Settings → Email Services → verify a sending domain for replies.
- Forward `support@thereach.company` / `support@faithmade.app` to the location's GHL inbound email address (Settings → Email → Forwarding address), so inbound mail appears in **Conversations**.
- Optional workflow: trigger "Customer Replied (Email)" → filter first-message → same SMS notification action.

When this works, Help Scout has no remaining job.

## 3. WordPress integration (implemented in faithmade-admin)

Lives at `faithmade-admin/includes/helpdesk-widget.php` (+ widget assets copied to `faithmade-admin/helpdesk/`). It signs the context server-side and enqueues the widget for logged-in wp-admin users.

Secret distribution uses the platform's existing broker: add the key **`helpdesk_widget_secret`** (same value as the Worker's `WIDGET_SIGNING_SECRET`) to auth.faithmade.app — every tenant picks it up via `FM_Secrets_Client`, no per-site config. The widget silently disables itself on sites where the secret doesn't resolve. Overrides: `FM_HELPDESK_SECRET` / `FM_HELPDESK_ENDPOINT` constants (local dev), `fm_helpdesk_endpoint` filter.

Historical reference snippet (superseded by the real module):

```php
add_action( 'admin_enqueue_scripts', function () {
    $secret = defined( 'FM_HELPDESK_SECRET' ) ? FM_HELPDESK_SECRET : '';
    if ( ! $secret || ! is_user_logged_in() ) {
        return;
    }

    wp_enqueue_style( 'fm-helpdesk', $base . 'widget.css', [], FM_HELPDESK_VER );
    wp_enqueue_script( 'fm-helpdesk', $base . 'widget.js', [], FM_HELPDESK_VER, true );

    $user = wp_get_current_user();
    $site = home_url();
    $ts   = time();
    $sig  = hash_hmac( 'sha256', $site . '|' . $user->user_email . '|' . $ts, $secret );

    wp_add_inline_script( 'fm-helpdesk', 'window.FaithmadeHelpdesk = ' . wp_json_encode( [
        'endpoint' => 'https://helpdesk.thereach.workers.dev',
        'context'  => [
            'site'       => $site,
            'church'     => get_bloginfo( 'name' ),
            'user_name'  => $user->display_name,
            'user_email' => $user->user_email,
            'ts'         => $ts,
            'sig'        => $sig,
        ],
    ] ) . ';', 'before' );
} );
```

`FM_HELPDESK_SECRET` = the Worker's `WIDGET_SIGNING_SECRET`. On GridPane, define it via the panel's wp-config management, not by editing `wp-config.php` directly.
