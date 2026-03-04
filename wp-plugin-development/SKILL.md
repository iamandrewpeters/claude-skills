---
name: wp-plugin-development
description: "Use when developing WordPress plugins: architecture and hooks, activation/deactivation/uninstall, admin UI and Settings API, data storage, cron/tasks, security (nonces/capabilities/sanitization/escaping), and release packaging."
compatibility: "Targets WordPress 6.9+ (PHP 7.2.24+). Some workflows require WP-CLI."
source: "https://github.com/WordPress/agent-skills"
---

# WP Plugin Development

## When to use

Use this skill for plugin work such as:

- creating or refactoring plugin structure (bootstrap, includes, namespaces/classes)
- adding hooks/actions/filters
- activation/deactivation/uninstall behavior and migrations
- adding settings pages / options / admin UI (Settings API)
- security fixes (nonces, capabilities, sanitization/escaping, SQL safety)
- packaging a release (build artifacts, readme, assets)

## Procedure

### 1) Follow a predictable architecture

- Keep a single bootstrap (main plugin file with header).
- Avoid heavy side effects at file load time; load on hooks.
- Prefer a dedicated loader/class to register hooks.
- Keep admin-only code behind `is_admin()` to reduce frontend overhead.

### 2) Hooks and lifecycle

- Register activation/deactivation hooks at top-level, not inside other hooks.
- Flush rewrite rules only when needed and only after registering CPTs/rules.
- Uninstall should be explicit and safe (`uninstall.php` or `register_uninstall_hook`).

### 3) Settings and admin UI (Settings API)

```php
register_setting( 'my_options_group', 'my_option' );
add_settings_section( 'my_section', 'Title', 'callback', 'my-page' );
add_settings_field( 'my_field', 'Label', 'field_callback', 'my-page', 'my_section' );
```

### 4) Security baseline (always)

- Validate/sanitize input early; escape output late.
- Use nonces to prevent CSRF **and** capability checks for authorization.
- Avoid directly trusting `$_POST` / `$_GET`; use `wp_unslash()`.
- Use `$wpdb->prepare()` for SQL — never build SQL with string concatenation.

```php
// Nonce check
if ( ! wp_verify_nonce( $_POST['_wpnonce'], 'my_action' ) ) {
    wp_die( 'Security check failed' );
}
// Capability check
if ( ! current_user_can( 'manage_options' ) ) {
    wp_die( 'Unauthorized' );
}
// Sanitize input
$value = sanitize_text_field( wp_unslash( $_POST['my_field'] ) );
// Escape output
echo esc_html( $value );
```

### 5) Data storage and cron

- Prefer options for small config; custom tables only if necessary.
- For cron tasks, ensure idempotency.
- For schema changes, write upgrade routines and store schema version.

```php
// Cron
add_action( 'my_cron_hook', 'my_cron_function' );
if ( ! wp_next_scheduled( 'my_cron_hook' ) ) {
    wp_schedule_event( time(), 'hourly', 'my_cron_hook' );
}
```

## Verification

- Plugin activates with no fatals/notices.
- Settings save and read correctly (capability + nonce enforced).
- Uninstall removes intended data (and nothing else).

## Failure modes

- **Activation hook not firing**: hook registered incorrectly (not in main file scope)
- **Settings not saving**: settings not registered, wrong option group, missing capability, nonce failure
- **Security regressions**: nonce present but missing capability checks; sanitized input not escaped on output
