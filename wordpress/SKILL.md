---
name: wordpress
description: Use this skill when working on WordPress development tasks including plugins, themes, shortcodes, hooks, WP-CLI commands, multisite, custom post types, meta boxes, the REST API, or debugging WordPress issues.
version: 1.0.0
---

# WordPress Development Skill

## Stack

- **WordPress Multisite** — primary setup for all faithmade sites
- **Beaver Builder** — page builder (see beaver-builder skill)
- **Kirki Framework** — Customizer controls
- **Meta Box AIO** — custom fields
- **FluentForm** — forms
- **WP All Import Pro** — data import
- **Redis** — object cache
- **Twig** (via Toolbox plugin) — templating via shortcodes

## Key WP-CLI Commands

```bash
wp plugin list
wp theme list
wp post list --post_type=sermon
wp cache flush
wp rewrite flush
wp cron event run --due-now
wp search-replace 'old.domain.com' 'new.domain.com' --all-tables
wp db export backup.sql
wp media regenerate
wp user list
```

For multisite:
```bash
wp site list
wp --url=sub.domain.com plugin list
wp super-admin list
```

## Common Debugging

- Enable `WP_DEBUG` and `WP_DEBUG_LOG` in wp-config.php
- Check `/wp-content/debug.log`
- Use `error_log(print_r($var, true))` for quick dumps
- Redis issues: `wp cache flush` or restart Redis container

## File Structure (faithmade-wp)

```
wp-content/
  themes/
    page-builder-framework-child/   # Child theme
      assets/
        styles/   # SCSS source
        scripts/  # JS source
      functions.php
  plugins/
    faithmade-*/   # 9 custom plugins
    toolbox/       # Twig integration
```

## Hooks Pattern

```php
add_action('init', function() { ... });
add_filter('the_content', function($content) { return $content; });
```

## Multisite Notes

- Main site URL is the network root
- Sub-sites share plugins but can activate independently
- `switch_to_blog($blog_id)` / `restore_current_blog()` for cross-site queries
- Network-activated plugins apply to all sites
