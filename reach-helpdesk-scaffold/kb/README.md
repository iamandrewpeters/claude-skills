# Knowledge base

Markdown docs the bot answers from. Every file here is bundled into the Worker at deploy time and searched per question — write for the bot, not for humans (short, factual, one topic per file).

## Format

```markdown
# How do I add a sermon?

tags: sermons, media, upload

Step-by-step answer…
```

The first `# heading` is the title; a `tags:` line improves retrieval. Keep files under ~300 lines.

## Layout

- `faithmade/` — platform docs (sermons, groups, events, Beaver Builder modules, styles/customizer, Planning Center sync…)
- `reach/` — The Reach Co agency docs (billing, hosting, requesting changes…)

## Migrating from Help Scout

1. Help Scout → Manage → Docs → export each collection (or copy/paste — the volume is small).
2. One article = one `.md` file, named after the question it answers.
3. Strip Help Scout boilerplate; keep the steps.
4. Deploy the Worker (`npm run deploy`) — every `.md` here is picked up automatically by the build step (`tools/build-kb.js`); no registration needed.
