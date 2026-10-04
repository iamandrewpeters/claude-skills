# Email setup — coaching Leo by email, replies to churches, Ideas updates

Everything here runs through one subdomain, `reply.faithmade.app`:

| Direction | What | How |
|---|---|---|
| Leo → team | "Leo needs you" when a church asks for a person (plus follow-ups while the team owns a thread) | Resend |
| Team → Leo | **Reply to that email** and you're coaching Leo: Leo answers the church in its own words and remembers the answer | Cloudflare Email Routing → the Worker's `email()` handler |
| Team → church | **"Reply to Jane directly"** button → a phone-friendly page; your exact words go out as the Faithmade team | Resend |
| Church → us | Churches can reply to any answer we email them; it lands back in the same conversation | Email Routing → Worker |
| Ideas | New-idea emails to the team; "your idea is now planned/shipped" emails to voters | Resend |

Until email is configured, nothing breaks: every message is recorded in the inbox's **Emails** tab with status `logged` instead of being sent.

## 1. Worker settings

In `worker/wrangler.toml` → `[vars]`:

```toml
PUBLIC_URL = "https://helpdesk.faithmade.app"   # where the Worker answers; links in emails point here
REPLY_DOMAIN = "reply.faithmade.app"
EMAIL_FROM = "Leo · Faithmade <leo@reply.faithmade.app>"
TEAM_EMAILS = "you@yourdomain.com"              # comma-separated: who gets Leo's emails AND who may coach Leo
EMAIL_PROVIDER = "resend"                       # "log" = record only (the default)
```

Secrets:

```bash
cd worker
npx wrangler secret put TOKEN_SECRET     # openssl rand -hex 32 — Worker-only, never give it to tenant sites
npx wrangler secret put ADMIN_KEY        # your inbox sign-in key
npx wrangler secret put RESEND_API_KEY   # step 2
npm run db:migrate                       # applies migrations/ to the production D1
npm run deploy
```

`TOKEN_SECRET` signs the reply addresses, reply links, and inbox sessions. Rotating it invalidates all three (old emails can no longer be replied to, and everyone signs in again).

## 2. Sending — Resend

1. Resend → **Domains** → **Add domain** → `reply.faithmade.app`.
2. Add the DNS records Resend shows (DKIM `TXT` on `resend._domainkey.reply`, and an `MX` + SPF `TXT` on `send.reply`) in Cloudflare DNS for `faithmade.app`. They live on their own names, so they don't collide with the receiving records in step 3.
3. Click **Verify**, then create an API key with sending access and store it as `RESEND_API_KEY` (above).

Resend allows a couple of requests per second by default; emails to many idea voters go out through Resend's batch endpoint, 100 per call.

## 3. Receiving — Cloudflare Email Routing

Catch-all rules only cover the apex domain, so on a subdomain you list the two addresses literally. Plus-addressing does the rest: `leo+<conversation>.<signature>@reply.faithmade.app` matches the `leo@reply.faithmade.app` rule.

1. Cloudflare dashboard → `faithmade.app` → **Email** → **Email Routing**. Enable it if it isn't already.
2. **Settings** → add the subdomain `reply.faithmade.app` (Cloudflare adds its MX/SPF records). If the settings page has a **Subaddressing** option, make sure it's on.
3. **Routing rules** → **Create address**, twice:
   - `leo@reply.faithmade.app` → action **Send to a Worker** → `faithmade-helpdesk`
   - `chat@reply.faithmade.app` → action **Send to a Worker** → `faithmade-helpdesk`

## 4. Try it

1. In any tenant's wp-admin, open Leo → **Talk to a human** → send.
2. The "Leo needs you" email arrives. Reply above the line with how to answer, e.g. *"Tell her to open Sermons → Podcast Settings and click Save."*
3. Within a few seconds: Leo's answer appears in the church's chat (or goes to them by email if they've left), and you get **"✓ Leo replied to Jane"** with what Leo learned. Edit or switch off memories under **Leo's memory** in the inbox.
4. Or tap **Reply to Jane directly** in the email: your exact words, from your phone.

Writing *"don't remember this"* in a coaching reply answers the church without saving a memory.

## How it stays safe

- **Signed addresses.** Every reply address carries an HMAC of the conversation id (`TOKEN_SECRET`), so nobody can invent one or reach a different conversation. Coaching addresses (`leo+`) and church addresses (`chat+`) are signed differently and can't be swapped.
- **Sender checks.** Only addresses in `TEAM_EMAILS` can coach Leo; only the conversation's own church contact can reply on a `chat+` address. Anything else is bounced. Messages failing DMARC are bounced.
- **No loops.** Auto-replies (vacation responders, `Auto-Submitted`, bulk/list mail) are ignored, our own emails carry `Auto-Submitted: auto-generated`, and a conversation accepts at most 8 inbound emails per 10 minutes.
- **Only the team teaches Leo.** Coaching prompts treat the church's messages as untrusted context; only your guidance becomes memory, generalized and stripped of names and church details. Every memory is visible and editable.
- **Reply links expire** after 14 days and only ever post to their one conversation. The inbox signs you in with an HttpOnly session cookie, so the admin key never appears in an email link.

## Troubleshooting — the inbox's Emails tab

| Status | Meaning |
|---|---|
| `logged` | Recorded, not sent — `EMAIL_PROVIDER` isn't `resend` or `RESEND_API_KEY` is missing |
| `sent` | Accepted by Resend |
| `failed` | Resend refused it (the error is shown — usually an unverified domain) |
| `processed` | An inbound reply was accepted and acted on |
| `ignored` | An inbound auto-reply, empty reply, or loop-protection cut-off |
| `rejected` | Bounced: unknown/forged address, sender not allowed, or failed DMARC |

Nothing arriving inbound at all? Check that both routing addresses exist and point at the Worker, and that the `reply.faithmade.app` MX records are in place.
