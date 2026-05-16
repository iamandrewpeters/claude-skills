---
name: faithmade
description: "Use when working on the Faithmade platform. Encodes platform-specific decisions, plugin boundaries, multisite isolation rules, and the architectural judgment for this specific codebase."
version: 2.0.0
---

# Faithmade Platform

## Architecture Overview

WordPress Multisite platform for church communities. Two repos:

- **`faithmade-wp/`** — Full WordPress Multisite installation
- **`faithmade-admin/`** — Network Admin Plugin (v1.1.1)

## Decision Framework

### "Where does this go?"

This is the first question for any new feature. The answer is almost never "create a new plugin."

| Feature type | Location | Reasoning |
|---|---|---|
| New content type (like sermons, events) | Existing `faithmade-{type}` plugin | One CPT per plugin is the pattern |
| New Beaver Builder module | `faithmade-modules` plugin | All custom modules live here |
| Customizer/styling controls | `faithmade-styles` plugin | Kirki-based, SCSS compilation |
| Theme-level template change | Child theme | `page-builder-framework-child/` |
| CHMS integration feature | `faithmade-chms` plugin | PSR-4, Nunjucks templates |
| Network admin functionality | `faithmade-admin` plugin | UIKit admin UI |
| Shared utility (used by multiple plugins) | Consider: does it need its own plugin, or should it live in the plugin that uses it most? Ask first. |

### Multisite Isolation (Critical)

Every feature must answer: **Will Site B see Site A's data?**

- Posts, post meta, options are per-site by default — usually safe.
- Custom tables: must include `blog_id` or use `$wpdb->prefix` (site-specific prefix).
- Network-activated plugins serve all sites — any stored data must be site-aware.
- Transients: site-specific by default. Use `get_site_transient()` only for network-wide data.

### Data Storage Decisions

| Data | Current pattern | Notes |
|---|---|---|
| Sermon metadata | Post meta on `sermon` CPT | Speaker, date, series, media URLs |
| Event metadata | Post meta on `event` CPT | Date, location, registration |
| Plugin settings | Options API | Per-site settings via Customizer/Kirki |
| CHMS sync data | Transients (cached API responses) | Short TTL, refreshed on cron |
| Theme customizations | Theme mods (Customizer) | Via Kirki framework |

---

## Codebase Patterns (Match These)

### Plugin structure (existing pattern)

```
faithmade-{name}/
  faithmade-{name}.php    # Bootstrap: header, constants, requires
  includes/               # Classes and logic
  assets/                 # JS/CSS if needed
```

### Beaver Builder module (existing pattern)

```
faithmade-modules/modules/{module-name}/
  {module-name}.php       # FLBuilderModule class + register_module
  includes/
    frontend.php          # Template (uses $module->settings)
    frontend.css.php      # Dynamic CSS
  css/frontend.css        # Static CSS
  js/frontend.js          # Static JS
```

### Module registration

```php
class MyModule extends FLBuilderModule {
    public function __construct() {
        parent::__construct([
            'name'     => __( 'My Module', 'faithmade' ),
            'category' => __( 'Faithmade', 'faithmade' ),
            'dir'      => FM_MODULES_DIR . 'modules/my-module/',
            'url'      => FM_MODULES_URL . 'modules/my-module/',
        ]);
    }
}

FLBuilder::register_module( 'MyModule', [ /* fields */ ] );
```

### Child theme

- **Build**: Gulp (Ruby Sass, BrowserSync)
- **Styles**: SCSS in `assets/styles/`, compiled to CSS
- **Scripts**: JS in `assets/scripts/`, minified by Gulp
- **Config**: `assets/manifest.json`
- **Templating**: Twig via Toolbox plugin shortcodes

---

## Anti-Patterns for This Codebase

| Don't | Why | Do instead |
|---|---|---|
| Create a new plugin for a small feature | Proliferates plugins, complicates deployment | Add to the relevant existing plugin |
| Put business logic in BB module frontend.php | Templates should only render, not query/process | Process in the module class, pass via settings |
| Hardcode site URLs or paths | Multisite — paths differ per site | Use `home_url()`, `plugin_dir_path()`, etc. |
| Add Composer dependencies to individual plugins | No autoloader consistency across the platform | Use WP-native solutions or add to the theme's build |
| Modify Toolbox/Twig core | It's a third-party plugin | Use hooks and custom shortcodes |
| Skip `esc_html()` / `esc_attr()` in BB templates | These render user content — XSS risk | Escape everything in frontend.php |

---

## Deployment (GridPane)

- Git-based via GridPane hooks in `.gpconfig/`
- `predeploy.sh` / `postdeploy.sh` — per-site hooks
- `predeploy-server.sh` / `postdeploy-server.sh` — server-level hooks
- **Never committed**: `wp-config.php`, `wp-content/uploads/`, `docker-compose.yml`

### Deploy changes are high-risk

Any modification to `.gpconfig/` scripts or deployment pipeline:
1. Explain what will change and what could break
2. Test on staging first
3. Keep changes small and reversible

---

## Third-Party Stack

| Tool | Role | Skill reference |
|---|---|---|
| Beaver Builder | Page builder | `beaver-builder` skill |
| Kirki Framework | Customizer controls | Part of `faithmade-styles` |
| Meta Box AIO | Custom fields | Field registration in plugins |
| FluentForm | Forms | Shortcode-based |
| WP All Import Pro | Data import | One-off imports |
| Redis | Object cache | Managed via GridPane |
| Toolbox | Twig templating | Shortcode integration |
