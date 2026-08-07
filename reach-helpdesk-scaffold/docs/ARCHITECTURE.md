# Architecture & Decision Record

## Problem

The Reach Co / Faithmade support currently runs on **Help Scout**. Pain points:

1. Another per-seat SaaS to pay for and manage.
2. Notifications don't reach Andrew where he lives — he wants **SMS**, which HighLevel already does well via workflows.
3. No smart deflection: every "how do I add a sermon?" question becomes a human ticket, even though the answer is in the docs.

## Options considered

| Option | Verdict |
|---|---|
| **A. All HighLevel, no code** — webchat + Conversation AI + support pipeline + workflow SMS | Covers the inbox and SMS today with zero maintenance, and GHL has no true ticketing (people fake it with a pipeline — workable at our volume). But GHL's Conversation AI is generic: it can't see wp-admin context (which church, which plan, which site) and is weak on deep Faithmade how-tos. Deflection is the whole point. |
| **B. Full custom help desk** — bot + ticket store + our own inbox UI | Building an inbox that GHL already provides, with SMS built in, is wasted effort at our size. |
| **C. Hybrid (chosen)** — custom Claude bot for deflection, GHL for the human side | The custom piece is exactly the part GHL is weak at; the GHL piece is exactly the part not worth building. |

**Decision: Option C.** The bot is small (one Worker + one widget), rides infrastructure we already have (Cloudflare, the faithmade plugin distribution channel), and GHL becomes the human inbox + SMS notifier, replacing Help Scout entirely.

## Components

### 1. Cloudflare Worker (`worker/`) — the brain

- `POST /chat` — verifies the HMAC-signed site context, loads conversation history from D1, picks relevant `kb/` docs, calls the Claude API, stores both sides of the exchange, returns the reply.
- `POST /escalate` — pulls the transcript from D1, fires the GHL inbound-webhook workflow (contact upsert → note with transcript → SMS to Andrew), marks the conversation escalated.
- `GET /health` — deploy check.
- **D1** holds conversations/messages/escalations — the lightweight "ticket log" (searchable history, status), not a full ticketing system.
- Model: `claude-opus-5` by default (`CLAUDE_MODEL` var to override). Thinking is on by default on Opus 5; no sampling params (removed on this model family). Server-side refusal fallback (`fallbacks: "default"`) is enabled so a classifier decline degrades gracefully instead of erroring.
- Prompt caching: the stable persona + KB block carries a `cache_control` breakpoint; per-site context and messages come after it, so tenant variation doesn't bust the cache.

### 2. Widget (`widget/`) — the face

Vanilla JS + CSS, no framework, so it can be dropped into wp-admin by `faithmade-admin` (its admin bundle is React, but the widget stays self-contained and framework-free on purpose). The plugin will:

1. Enqueue `widget.js` / `widget.css` on admin pages.
2. Print a config object with the Worker endpoint and a **server-signed context**: site URL, church name, user display name + email, plan. Signature = `HMAC-SHA256(secret, site|email|timestamp)` — the same `WIDGET_SIGNING_SECRET` the Worker holds. wp-admin users are already authenticated, so the plugin only signs for logged-in users; the Worker rejects unsigned or stale (>10 min) contexts.

Reference PHP for the plugin side lives in `docs/GHL-SETUP.md` § WordPress integration.

### 3. Knowledge base (`kb/`)

Markdown files, bundled into the Worker at deploy time (wrangler `Text` rule). Retrieval is deliberately naive for v1 — keyword-overlap ranking, top 3 docs into the system prompt. At Faithmade's doc volume that's plenty; if the KB outgrows the prompt, the upgrade path is Cloudflare Vectorize, not a rewrite. **Help Scout Docs export lands here** — see `kb/README.md`.

### 4. HighLevel — the human side

- **Inbound webhook workflow** (see `docs/GHL-SETUP.md`): upsert contact → add note with summary + transcript → **SMS to Andrew** → optionally drop into a "Support" pipeline stage.
- **Conversations** is the inbox. Andrew replies by email/SMS from GHL; the client gets a normal email.
- **support@ email** forwards into GHL Conversations so email tickets share the same inbox. Once that's live and the widget is deployed, Help Scout can be cancelled.

Why webhook-into-workflow instead of the GHL REST API: a Private Integration token + API 2.0 works, but the inbound-webhook trigger gets contact-upsert, notes, SMS, and pipeline moves natively inside one workflow with zero token management. The Worker just POSTs JSON. If we later want two-way sync (GHL replies flowing back into the widget), that's when the API/marketplace-app route earns its complexity.

## Escalation triggers

1. User clicks **"Talk to a human"** in the widget.
2. The bot decides it can't help: the system prompt tells it to end such replies with a literal `[[ESCALATE]]` marker; the Worker strips it and returns `escalate_suggested: true`, and the widget shows the escalate card. (v1 convention — clean upgrade path is a proper `escalate_to_human` tool call.)

## Security model

- Worker endpoints are public but useless without a valid HMAC context signature; signatures expire after 10 minutes and are minted only for logged-in wp-admin users.
- CORS reflects the requesting origin (tenant domains are many and changing); auth is the signature, not the origin list.
- No secrets in the widget or the repo: `ANTHROPIC_API_KEY`, `WIDGET_SIGNING_SECRET`, `GHL_WEBHOOK_URL` are Worker secrets.
- D1 stores support conversations — no passwords, no payment data. Retention/purge policy TBD.

## Rollout phases

1. **P1 — internal pilot:** deploy Worker, seed `kb/` with top-20 Help Scout articles, hand-embed the widget on one tenant's wp-admin, wire the GHL workflow, verify the SMS loop end-to-end.
2. **P2 — fleet:** ship the widget via `faithmade-admin` update to all tenants; import the full Help Scout Docs export; forward support@ into GHL; cancel Help Scout.
3. **P3 — expand:** public marketing sites (faithmade.app / thereach.co) pre-sales bot; possibly tenant public sites; two-way GHL sync if reply-in-widget is wanted.

## Open questions

- Per-tenant KB additions (church-specific docs) — folder-per-site under `kb/` or skip until asked for.
- Whether n8n should own the escalation glue instead of a GHL workflow (both work; GHL-native keeps SMS + contact in one place, n8n wins if we add non-GHL destinations later).
- Transcript viewer: D1 has the data; a tiny read-only admin page can come later if grepping `wrangler d1 execute` gets old.
