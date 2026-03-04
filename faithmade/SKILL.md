---
name: faithmade
description: Use this skill when working on Faithmade platform code, including faithmade plugins, the child theme, Beaver Builder custom modules, CHMS integration, sermon/event/group/staff content types, or any faithmade-specific WordPress development.
version: 1.0.0
---

# Faithmade Platform Skill

## Overview

Faithmade is a WordPress Multisite platform for a church/faith community. Two repos:

- **`faithmade-wp/`** — Full WordPress Multisite installation
- **`faithmade-admin/`** — WordPress Network Admin Plugin (v1.1.1)

## Child Theme

**Path:** `faithmade-wp/wp-content/themes/page-builder-framework-child/`

**Build commands:**
```bash
gulp            # Build + dev server + BrowserSync
gulp styles     # Compile SCSS → CSS
gulp scripts    # Minify JS
gulp watch      # Watch for changes
gulp serve      # BrowserSync live reload
```

Requires Ruby Sass. Build config: `assets/manifest.json`.

**Custom features:**
- Twig shortcode support
- Custom fonts: Dharma Gothic, Gotham
- Announcement bar hooks

## Custom Plugins (9 total)

All in `wp-content/plugins/faithmade-*/`

| Plugin | Purpose |
|---|---|
| `faithmade-modules` | 15+ custom Beaver Builder modules |
| `faithmade-chms` | Church Management System integration (PSR-4, Nunjucks) |
| `faithmade-styles` | Customizer controls via Kirki + SCSS compilation |
| `faithmade-sermons` | Sermon custom post type & management |
| `faithmade-events` | Events custom post type & management |
| `faithmade-groups` | Groups custom post type & management |
| `faithmade-staff` | Staff custom post type & management |
| `faithmade-hub` | Hub functionality |
| `faithmade-resources` | Resources management |

## faithmade-modules (Beaver Builder Modules)

Key modules include:
- Sermon grids
- Event grids
- Group grids
- Card sliders
- Menus

Each module lives in its own directory under `faithmade-modules/modules/`.

## faithmade-admin Plugin

Single-file plugin (`faithmade-admin-area.php`) loading UIKit for admin UI.

Feature modules in `includes/`:
- `fm-admin-chat.php` — Admin chat
- `ultimo-twig-addition.php` — Twig integration
- Analytics, shortcodes, login redirect, WP Ultimo injection, custom meta box visibility

## Templating

**Twig** (via Toolbox plugin) used throughout — integrated via shortcodes.
**Nunjucks** — used in `faithmade-chms` plugin.

## Deployment

Via **GridPane**. Hooks in `faithmade-wp/.gpconfig/`:
- `predeploy.sh` / `postdeploy.sh`
- `predeploy-server.sh` / `postdeploy-server.sh`

Gitignored: `wp-config.php`, `wp-content/uploads/`, `docker-compose.yml`

## Third-Party Dependencies

Beaver Builder, Kirki Framework, Meta Box AIO, FluentForm, WP All Import Pro, Redis Cache, Toolbox (Twig)
