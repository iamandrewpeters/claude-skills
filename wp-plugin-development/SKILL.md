---
name: wp-plugin-development
description: "Use when developing WordPress plugins. Encodes architectural decisions, hook patterns, security requirements, and the judgment calls that prevent generic AI-generated plugin code."
compatibility: "WordPress 6.9+ (PHP 7.2.24+). Some workflows require WP-CLI."
---

# WP Plugin Development

## Decision Framework (Ask Before Building)

Before writing plugin code, resolve these questions — present tradeoffs, don't silently decide:

### Where does this live?

| Scenario | Answer |
|---|---|
| Feature used by one site | Site-specific plugin or theme `functions.php` |
| Feature used across the network | Dedicated plugin, network-activated |
| Must load before everything else | `mu-plugin` |
| Extends an existing faithmade-* plugin | Add to that plugin, don't create a new one |
| Standalone utility (cron, API integration) | New plugin only if it has clear boundaries |

### What data pattern?

| Data type | Storage | Why |
|---|---|---|
| Small config (< 1KB, rarely changes) | `get_option()` / `update_option()` | Simple, autoloaded, cached |
| Per-post metadata | `post_meta` | Native WP, shows in REST, queryable |
| Large datasets or relational queries | Custom table | Only when options/meta genuinely can't work |
| Expensive API responses | Transient | Built-in expiration, respects object cache |
| Temporary processing state | Transient with short TTL | Don't pollute options table |

**Never default to custom tables.** Justify why options or post meta won't work before proposing one.

---

## Architecture Rules

### File structure

```
my-plugin/
  my-plugin.php          # Bootstrap only: plugin header, constants, require loader
  includes/
    class-loader.php     # Hook registration lives here
    class-feature.php    # One responsibility per file
  admin/                 # Admin-only code (behind is_admin())
  assets/                # JS/CSS if needed
  uninstall.php          # Cleanup on delete
```

### Bootstrap pattern (main file)

```php
<?php
/**
 * Plugin Name: My Plugin
 */

defined( 'ABSPATH' ) || exit;

define( 'MY_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'MY_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

require MY_PLUGIN_DIR . 'includes/class-loader.php';
```

That's it. No logic in the bootstrap file. No conditional loading. No inline hook registration.

### Hook discipline

- Register activation/deactivation at top-level scope, not inside other hooks.
- All runtime hooks go through a loader class — never scattered across files.
- Flush rewrite rules only on activation/deactivation, never on `init`.
- Admin-only code gated behind `is_admin()` so frontend doesn't pay the cost.

---

## Security (Non-Negotiable)

Every form handler, AJAX endpoint, and REST callback must have:

```php
// 1. Nonce verification
if ( ! wp_verify_nonce( $_POST['_wpnonce'], 'my_action' ) ) {
    wp_die( 'Invalid nonce.' );
}

// 2. Capability check
if ( ! current_user_can( 'manage_options' ) ) {
    wp_die( 'Unauthorized.' );
}

// 3. Sanitize input
$value = sanitize_text_field( wp_unslash( $_POST['field'] ) );

// 4. Escape output (always at render time, never at save time)
echo esc_html( $value );
```

**No exceptions.** Missing any of these four is a bug, not a style choice.

SQL: `$wpdb->prepare()` for every query with user input. No string concatenation. Ever.

---

## Anti-Patterns (Reject These)

| Pattern | Why it's wrong | Do instead |
|---|---|---|
| Logic in main plugin file | Becomes untestable, unreadable | Bootstrap only; logic in classes |
| `add_action` calls at file parse time | Side effects on include, breaks load order | Register hooks in a loader/init method |
| Capability check without nonce | Nonce prevents CSRF; capability prevents unauthorized access. Need both. | Always pair them |
| `register_activation_hook` inside another hook | Won't fire — must be at top-level scope | Top-level in main plugin file |
| Custom tables for < 1000 rows of config | Overhead of schema management for no benefit | Use options or post meta |
| `wp_die()` with no message | Blank screen tells the user nothing | Always include a reason |
| Inline styles/scripts in PHP | Can't be cached, can't be deferred, breaks CSP | Enqueue properly |

---

## Verification Checklist

Before declaring plugin code complete:

- [ ] Activates with no fatals or notices (WP_DEBUG on)
- [ ] Deactivates cleanly (no orphaned hooks or cron events)
- [ ] Uninstall removes its data and nothing else
- [ ] Settings save and load (nonce + capability enforced)
- [ ] Works on multisite (no data leakage between sites)
- [ ] Admin code doesn't load on frontend
- [ ] No new Composer/npm dependencies without justification
