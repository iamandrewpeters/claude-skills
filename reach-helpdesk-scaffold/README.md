# reach-helpdesk

Claude-powered support bot + HighLevel escalation bridge for **The Reach Company** and **Faithmade**. This replaces Help Scout.

## What it does

- **Front line:** A chat widget in wp-admin of every Faithmade tenant site (shipped via `faithmade-admin`). Claude answers support questions from the knowledge base in `kb/`, already knowing which church, site, and user is asking.
- **Escalation:** When the bot can't resolve something (or the user asks for a human), the conversation is pushed into a HighLevel workflow via inbound webhook → contact upsert → **SMS notification to Andrew** → reply from GHL Conversations by email/SMS.
- **Human inbox:** HighLevel Conversations replaces the Help Scout mailbox. `support@` email forwards into GHL so email tickets land in the same place.

```
wp-admin (tenant site)                Cloudflare                     HighLevel
┌─────────────────────┐   HTTPS   ┌───────────────┐   webhook   ┌──────────────────┐
│ widget.js            │─────────▶│ Worker         │────────────▶│ Workflow:         │
│ (Help tab, knows     │  /chat   │  • Claude API  │  /escalate  │  upsert contact   │
│  site+user+church)   │◀─────────│  • kb/ docs    │             │  add note         │
└─────────────────────┘   reply   │  • D1 log     │             │  SMS → Andrew     │
                                  └───────────────┘             │  Conversations    │
                                                                └──────────────────┘
```

## Repo layout

| Path | What |
|---|---|
| `worker/` | Cloudflare Worker — chat API (Claude), escalation bridge (GHL), D1 conversation log |
| `widget/` | Embeddable vanilla-JS chat widget for wp-admin (later folded into `faithmade-admin`) |
| `kb/` | Markdown knowledge base the bot answers from (Help Scout Docs migrate here) |
| `docs/ARCHITECTURE.md` | Full design + decision record (why hybrid, not pure GHL / full custom) |
| `docs/GHL-SETUP.md` | HighLevel-side setup: inbound webhook workflow, SMS step, support@ forwarding |

## Status

- [x] Architecture decided (hybrid: custom Claude bot + GHL inbox — see `docs/ARCHITECTURE.md`)
- [x] Worker scaffold: `/chat`, `/escalate`, `/health`, HMAC auth, D1 schema
- [x] Widget scaffold (vanilla JS, no framework)
- [ ] Deploy Worker (`wrangler deploy`) + create D1 DB + set secrets
- [ ] Build GHL workflow (`docs/GHL-SETUP.md`) and set `GHL_WEBHOOK_URL`
- [ ] Import Help Scout Docs into `kb/`
- [ ] Ship widget through `faithmade-admin` (Help tab)
- [ ] Forward support@ into GHL Conversations, then cancel Help Scout

## Quickstart

```bash
cd worker
npm install

# 1. Create the D1 database, paste the id into wrangler.toml
npx wrangler d1 create reach-helpdesk
npx wrangler d1 execute reach-helpdesk --file=schema.sql --remote

# 2. Secrets
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put WIDGET_SIGNING_SECRET   # openssl rand -hex 32
npx wrangler secret put GHL_WEBHOOK_URL         # from docs/GHL-SETUP.md

# 3. Ship it
npx wrangler deploy

# Local dev (uses .dev.vars — copy .dev.vars.example)
npx wrangler dev
```

The bot defaults to `claude-opus-5` and ships with Anthropic's server-side refusal fallback enabled. Override the model with the `CLAUDE_MODEL` var in `wrangler.toml` (e.g. `claude-sonnet-5` to trade some quality for cost — support Q&A is a workload where Sonnet holds up well).
