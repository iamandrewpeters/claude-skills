# Architecture & Decision Record

## Problem

Faithmade support ran on **Help Scout**. Pain points:

1. Another per-seat SaaS to pay for and manage.
2. Notifications don't reach Andrew where he lives — he wants **SMS**, which HighLevel already does well.
3. No smart deflection: every "how do I add a sermon?" question became a human ticket, even when the answer is in the docs.
4. Answers given once had to be given again: nothing learned from the team's replies.

## Decisions

| When | Decision | Why |
|---|---|---|
| v1 | **Hybrid**: custom Claude bot (Leo) for deflection, HighLevel for SMS | GHL's Conversation AI can't see wp-admin context; SMS was the one thing not worth building |
| v1.1 | **Custom team inbox** in the Worker instead of GHL Conversations | Live chat with the church inside their dashboard needed our own thread store and presence anyway; GHL stayed as the SMS notifier |
| v2 | **Email loop + Leo's memory + Ideas board** (this release) | The team lives in email: replying to Leo should be the fastest way to answer *and* to teach Leo. Feature requests needed a home other than the support queue. Built custom (FeedBear/Intercom were inspiration only) |

## Components

### Cloudflare Worker (`worker/`) + D1

- **Widget API** (`index.js`): `POST /chat`, `/messages` (poll), `/escalate`, `/ideas*`. Every call carries an HMAC-signed context minted by `faithmade-admin` for the logged-in user (site, church, name, email, timestamp; 10-minute expiry). Conversation ids are random per browser and must also match the signed identity.
- **Conversation rules** (`service.js`): one place decides who speaks. Leo answers until a person takes over (`handled_by = team`); coaching hands the thread back to Leo. Whatever reaches the church goes live to the widget if they polled in the last 60 s, otherwise by email with a signed Reply-To that brings their answer back into the thread.
- **Leo** (`claude.js`): `claude-opus-5`, adaptive thinking, medium effort for chat. The cached system prompt is the persona; per-question knowledge (top KB docs + matching memories) and the site context come after it so tenant variation doesn't bust the cache. Markers `[[ESCALATE]]` / `[[IDEA]]` become `escalate_suggested` / `idea_suggested` in the API.
- **Coaching** (`coachLeo`): structured output (`reply_to_church`, `remember`, `memory_question`, `memory_answer`, `note_to_team`). Only the team's guidance is trusted; the church's messages are context, never instructions, and never become memory on their own.
- **Leo's memory** (`memory.js`): generalized Q&A rows, matched by keyword overlap (question matches weighted ×3), fed into future chats as trusted "answers the team has taught you". Visible, editable, and switchable in the inbox. Upgrade path: Vectorize, if keyword matching stops being enough.
- **Email** (`email/`): Resend for outbound (single sends + batch for idea voters), Cloudflare Email Routing for inbound into the `email()` handler. Every message in or out is logged to `email_log` (the inbox's Email log). Setup: `docs/EMAIL-SETUP.md`.
- **Reply-link page** (`reply-page.js`): signed, 14-day link from Leo's emails; reply directly or coach Leo from a phone. Plain form POST → redirect, works without JavaScript.
- **Ideas** (`ideas.js`): one board shared by every Faithmade church — one vote per person, comments, similar-idea suggestions while typing, statuses (under review → planned → in progress → shipped / declined), merging duplicates (votes deduplicated), voter emails on status changes.
- **Team inbox** (`admin.js` + `ui/`): conversations with a three-way composer (reply / coach Leo / internal note), Ideas kanban, Leo's memory, Email log. 30-day HttpOnly session cookie (SameSite=Lax, JSON-only POSTs); the admin key never appears in links.
- **Schema** (`migrations/`): applied with `wrangler d1 migrations apply`; tests run the same files on real SQLite (`node:sqlite`).

### Widget (`widget/`)

Vanilla JS + CSS, no framework, enqueued by `faithmade-admin` in wp-admin. Two tabs — **Chat** and **Ideas**. Restores the thread on reload, shows an unread badge + preview when the team replies while it's closed (a passive poll that doesn't count as "watching", so the email still goes out), and opens straight to the chat or an idea from email links (`?fmhd=chat`, `?fmhd=idea-<id>`).

### Knowledge base (`kb/`)

Markdown, bundled at build time; naive keyword ranking, top 3 docs per question. Help Scout Docs migrate here.

### HighLevel

Inbound-webhook workflow for SMS escalation (`docs/GHL-SETUP.md`). An outage there no longer blocks escalation — the team email still goes out.

## Security model

- Widget endpoints are public but require a valid, fresh HMAC context; conversations are bound to the signed identity.
- `TOKEN_SECRET` (Worker-only — unlike `WIDGET_SIGNING_SECRET`, never shared with tenant sites) signs reply addresses, reply links, and inbox sessions, so no tenant can mint them.
- Inbound email: signed address + sender allowlist (team) or sender match (church), DMARC-fail bounce, auto-reply detection, per-conversation rate cap.
- Team-only messages (`coach`, `note`) never reach the widget, the church's email, or Leo's conversation history.
- No secrets in the repo or the widget. D1 holds support conversations and ideas — no passwords or payment data.

## Open questions

- Per-church KB additions — folder-per-site under `kb/`, or skip until asked for.
- Unsubscribe link for idea emails if voter lists grow beyond "people who asked to hear back".
- Retention policy for conversations and the email log.
