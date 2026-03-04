---
name: gridpane
description: Use this skill when working with GridPane server management, deployment hooks, site configuration, deployment pipelines, or managing WordPress sites on GridPane infrastructure.
version: 1.0.0
---

# GridPane Skill

## Overview

GridPane manages the WordPress hosting infrastructure for faithmade sites. Deployment is git-based with hook scripts.

## Deployment Hooks

Located in `faithmade-wp/.gpconfig/`:

| File | When it runs |
|---|---|
| `predeploy.sh` | Before site-level deploy |
| `postdeploy.sh` | After site-level deploy |
| `predeploy-server.sh` | Before server-level deploy |
| `postdeploy-server.sh` | After server-level deploy |

## Common Hook Tasks

```bash
# postdeploy.sh examples
wp cache flush
wp rewrite flush
wp cron event run --due-now
composer install --no-dev
npm ci && npm run build
```

## Gitignored Files

These are NOT in the repo and must be managed separately on the server:
- `wp-config.php`
- `wp-content/uploads/`
- `docker-compose.yml`

## GridPane Stack

- Nginx web server
- PHP-FPM
- Redis object cache
- Automated SSL via Let's Encrypt
- Server-level caching (Nginx FastCGI or Redis page cache)

## WP-CLI on GridPane

GridPane servers use a specific WP-CLI path. Always run as the site user:
```bash
gp site-user sitename.com
wp --path=/var/www/sitename.com/htdocs cache flush
```

## Useful GridPane GP-CLI Commands

```bash
gp stack nginx reload sitename.com
gp redis flush sitename.com
gp fix-permissions sitename.com
gp logs nginx sitename.com
```

## Notes

- GridPane uses server-level PHP-FPM pools per site
- Object cache via Redis is configured per-site
- Page cache rules set in GridPane dashboard, not .htaccess
