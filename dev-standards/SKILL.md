---
name: dev-standards
description: "ALWAYS active. Encodes architectural decisions, anti-patterns, and quality gates that apply to ALL code generation regardless of domain. This is the decision framework — how I think, not what to build."
version: 1.0.0
---

# Dev Standards — Engineering Judgment

## Load-Bearing Decisions

These are non-negotiable. Every piece of generated code must satisfy these before being presented.

### 1. Write less, not more

The minimal implementation wins. I can add complexity later — I can't easily subtract it. If 12 lines does the job, don't write 40. No premature abstractions, no "just in case" code.

### 2. Ask before deciding architecture

Never silently pick a storage mechanism, hook strategy, file location, or data model. Present the tradeoff in 2-3 sentences and let me choose. The decisions that matter:

- **Where does it live?** New plugin vs existing plugin vs theme vs mu-plugin
- **What data does it touch?** Options vs post meta vs custom table vs transient
- **What's the scope?** Network-wide vs per-site (multisite is always the context)

### 3. Match my existing code, not textbook patterns

Look at how the codebase already works. Match that style, structure, and naming — even if a "better" pattern exists in theory. Consistency in a living codebase beats theoretical purity.

### 4. Fewer dependencies, always

Don't add a library for something writable in 20 lines. Every Composer/npm package is a liability — maintenance burden, supply chain risk, version conflicts. Use what the platform gives you first.

### 5. Complexity must earn its place

Every new abstraction, file, class, or pattern must justify why it exists over the simpler option. "It might be useful later" is not justification. Three repeated lines is cheaper than a premature helper function.

---

## Anti-Slop Rules

Reject output that exhibits these tells:

| Tell | Why it's slop |
|---|---|
| Multi-line docblocks on obvious functions | Noise. The function name should be the documentation. |
| Inline comments explaining what code does | If you need a comment to explain `$user = get_user()`, rename the variable. |
| Factory/Strategy/Builder patterns for single-use code | Over-engineering. Write the thing directly. |
| Try/catch wrapping WordPress core functions | WP functions have defined return behaviors. Trust them. Validate at boundaries only. |
| Abstract base classes with one implementation | YAGNI. Write the concrete class. |
| Defensive null checks 5 layers deep | If the data shouldn't be null, fix the source. Don't patch over it. |
| Type-hinting every parameter in a 3-line helper | Pragmatic PHP. Type-hint public API boundaries, not internals. |
| `// TODO: add error handling` | Either handle it or don't. No placeholder comments. |

---

## Error Philosophy

- **Dev environment**: Fail loud. `WP_DEBUG` + `WP_DEBUG_LOG` show everything. Errors surface immediately.
- **Production**: Graceful. Never show raw errors to users. Log everything to `debug.log`. Surface only what the user needs to act on.
- **Trust the platform**: Don't wrap WP functions in try/catch. If `get_post()` returns null, handle that case — don't try/catch it.
- **Log everything, surface what matters**: Every error hits `error_log()`. Only user-facing failures get UI treatment.

---

## Quality Gates (Self-Evaluation Before Presenting)

Before presenting code, verify:

1. **Could this be shorter?** If removing a line doesn't break functionality, remove it.
2. **Does this match the existing codebase?** Same naming, same file structure, same patterns.
3. **Did I make an architectural decision I should have asked about?** Storage, scope, location, dependencies.
4. **Is there dead code, placeholder comments, or defensive bloat?** Remove them.
5. **Would I understand this in 6 months with no context?** Clear naming > comments.

---

## Deployment & Server Changes

- **Explain before doing**: State the blast radius. What changes, what could break, what's the rollback path.
- **Small and reversible**: One change at a time. If it breaks, I roll back to last known-good.
- **Never auto-deploy**: Any change to deployment scripts, Docker config, or automation gets reviewed first.
- **Staging before prod**: Verify on non-production before touching live sites.

---

## Frontend (React) Decisions

- Functional components + hooks. No class components.
- Minimal state. Don't store what you can derive. Don't duplicate server truth locally.
- Small components, flat hierarchy. Each component understandable in isolation.
- Reach for state management libraries only when local state and prop drilling genuinely fail.
- No premature optimization (useMemo/useCallback) unless measured performance problem exists.

---

## WordPress-Specific Judgment

- **Hooks in the right place**: No side effects at file load time. Register on `init`, `admin_init`, `rest_api_init` — the appropriate lifecycle hook.
- **Use the platform**: Transients before external cache libraries. WP Cron before custom queue systems. Options API before custom tables (unless data shape genuinely demands it).
- **Multisite is always the context**: Every feature must consider site isolation. Will Site B see Site A's data?
- **Security is not optional**: Nonce + capability check on every form handler. `$wpdb->prepare()` for every query. Escape on output, sanitize on input. No exceptions.
