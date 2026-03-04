---
name: wp-wpcli-and-ops
description: "Use for WordPress operational tasks: safe plugin/theme/language management, database ops (export/import/reset), cron debugging, site infrastructure (cache, rewrites), multi-site coordination."
compatibility: "Targets WordPress 6.9+ (PHP 7.2.24+). Requires WP-CLI."
source: "https://github.com/WordPress/agent-skills"
---

# WP-CLI and Ops

## When to use

- plugin, theme, language management (install/activate/deactivate/delete)
- database operations (export, import, find/replace, reset)
- cron event management and debugging
- cache flushing, rewrite rules
- multisite site coordination
- automation scripts via `wp-cli.yml` or CI pipelines

## Critical Safety Protocol

**WP-CLI commands can be destructive. Before running anything that writes:**

1. Confirm the environment (dev/staging/prod).
2. Confirm targeting (path/url) so you don't hit the wrong site.
3. Make a backup when performing risky operations.
4. Use `--dry-run` or `--porcelain` modes when available to preview.

## Plugin and Theme Lifecycle

```bash
wp plugin list --status=active
wp plugin install <slug>
wp plugin activate <slug>
wp plugin deactivate <slug>
wp theme install <slug>
wp theme activate <slug>
```

## Database Operations

```bash
wp db export backup.sql                            # Safe export
wp search-replace 'old.domain' 'new.domain' --dry-run  # Preview
wp search-replace 'old.domain' 'new.domain' --all-tables  # Execute
wp db import backup.sql                            # Risky — confirm first
wp db reset                                        # Destructive — confirm intent
```

## Cron Management

```bash
wp cron test
wp cron event list
wp cron event run <hook>
wp cron schedule list
```

## Cache and Rewrites

```bash
wp cache flush
wp cache type          # Detect type: Redis, Memcached, etc.
wp rewrite flush
```

## Multisite Coordination

```bash
wp site list
wp --url=sub.domain.com plugin list
# Apply to all sites:
wp site list --field=url | xargs -I {} wp --url={} cache flush
```

## wp-cli.yml Automation

```yaml
path: /var/www/site
url: https://example.com

@dev:
  path: /var/www/dev
  url: https://dev.example.com

@prod:
  path: /var/www/prod
  url: https://example.com
```

Then: `wp @prod plugin list`

## Failure Modes

- **Command not found**: WP-CLI not installed or not in PATH
- **Plugin install fails**: check slug/URL; check network access
- **Database import fails**: check file encoding and disk space
- **Cron events don't run**: check `wp cron test`; loopback requests may be blocked
