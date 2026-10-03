# Faithmade Helpdesk

**Leo**, the Faithmade AI, plus a small custom help desk around it — replacing Help Scout for Faithmade church sites.

- **Chat with Leo** in every tenant's wp-admin (widget shipped by `faithmade-admin`). Leo already knows which church, site, and person is asking, and answers from the knowledge base in `kb/` and from **answers the team has taught it**.
- **Bring in a person.** Leo escalates when it can't help (or when asked). The team gets an SMS through HighLevel and an email.
- **Coach Leo by email.** Just reply to Leo's email with how to answer. Leo replies to the church in its own words and **remembers** the answer for the next church that asks. Every memory is visible and editable in the inbox.
- **Reply directly.** The "Reply to Jane directly" button in Leo's emails opens a phone-friendly page; your exact words go out signed by the Faithmade team.
- **Live chat or email, automatically.** If the church is still in their dashboard, replies appear live in the chat; if they've left, they get an email they can answer.
- **Ideas board.** Churches post feature ideas, vote, and comment from the lightbulb tab in the chat (Leo points feature requests there). The team triages on a kanban board and voters are emailed when an idea is planned, in progress, or shipped.
- **Team inbox** at `/admin`: conversations (with reply / coach / internal-note composer), Ideas, Leo's memory, and an Email log with full previews. Dark mode included.

```
wp-admin (each church)          Cloudflare Worker + D1                       The team
┌──────────────────┐  /chat    ┌──────────────────────────┐  SMS (HighLevel) ┌──────────────┐
│ Leo widget       │──────────▶│ Claude (Leo) + kb + memory│────────────────▶│ phone         │
│  · Chat          │  /ideas   │ conversations · ideas     │  email (Resend)  │ email         │
│  · Ideas         │◀──────────│ email in/out · inbox      │◀────────────────│ /admin inbox  │
└──────────────────┘           └──────────────────────────┘  replies (Email  └──────────────┘
                                                              Routing → Worker)
```

## Repo layout

| Path | What |
|---|---|
| `worker/src/` | The Worker: widget API (`index.js`), conversation rules (`service.js`), Leo (`claude.js`), memory, Ideas, email in/out (`email/`), reply-link page, inbox API (`admin.js`) |
| `worker/ui/` | The team inbox app (plain HTML/CSS/JS, inlined at build time by `tools/build-ui.js`) |
| `worker/migrations/` | D1 schema, applied with `wrangler d1 migrations apply` |
| `widget/` | The wp-admin widget (vanilla JS/CSS) — copied into `faithmade-admin/helpdesk/` |
| `kb/` | Markdown knowledge base Leo answers from (bundled by `tools/build-kb.js`) |
| `demo/index.html` | A fake wp-admin page for trying the widget against a local Worker |
| `docs/EMAIL-SETUP.md` | Resend + Cloudflare Email Routing setup for the email loop |
| `docs/GHL-SETUP.md` | HighLevel workflow for SMS escalation |
| `docs/ARCHITECTURE.md` | Design and decision record |

## Deploy

```bash
cd worker && npm install
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put WIDGET_SIGNING_SECRET   # shared with faithmade-admin (openssl rand -hex 32)
npx wrangler secret put TOKEN_SECRET            # Worker-only (openssl rand -hex 32)
npx wrangler secret put ADMIN_KEY               # inbox sign-in
npx wrangler secret put GHL_WEBHOOK_URL         # docs/GHL-SETUP.md
npx wrangler secret put RESEND_API_KEY          # docs/EMAIL-SETUP.md
# set TEAM_EMAILS / EMAIL_PROVIDER in wrangler.toml [vars]
npm run db:migrate
npm run deploy
```

Then sign in at `https://helpdesk.faithmade.app/admin`.

## Local development (no Cloudflare account or API key needed)

```bash
cd worker
npm install
npm test                         # 77 tests — the Worker against real SQLite built from migrations/
npm run e2e                      # 12 end-to-end flows: wrangler dev + a real browser + simulated inbound email
                                 #   (Chromium from `npx playwright install chromium`, or set CHROME_PATH)
cp .dev.vars.example .dev.vars   # MOCK_CLAUDE=1 gives canned Leo replies
npm run db:migrate:local
npm run dev                      # http://127.0.0.1:8787  (inbox: /admin, key from .dev.vars)
```

Serve the repo root (`python3 -m http.server 8899`) and open `/demo/index.html` for a fake wp-admin with the widget. Simulate an email reply with
`curl -X POST "http://127.0.0.1:8787/cdn-cgi/local/email?from=<team email>&to=<leo+… address from the Emails tab>" --data-binary @reply.eml`.

`MOCK_CLAUDE=1` is for dev and tests only — never set it in production. Leo runs on `claude-opus-5` with Anthropic's server-side refusal fallback; override with `CLAUDE_MODEL`. Set `ANTHROPIC_BASE_URL` to route Leo through Cloudflare AI Gateway (the e2e suite uses it to point the real SDK at a local stand-in for the API).

## Status

- [x] Leo chat, KB, escalation (SMS via HighLevel), team inbox with live chat — **built, tested**
- [x] Coach Leo by email + Leo's memory, reply-link page, email delivery to churches, Ideas board — **built, tested, not yet deployed**
- [ ] Deploy the Worker, apply migrations, set secrets/vars (above)
- [ ] Email: verify `reply.faithmade.app` in Resend, add the two Email Routing addresses (`docs/EMAIL-SETUP.md`)
- [ ] Add the `helpdesk_widget_secret` broker key so `faithmade-admin` turns the widget on
- [ ] Import Help Scout Docs into `kb/`, then cancel Help Scout
