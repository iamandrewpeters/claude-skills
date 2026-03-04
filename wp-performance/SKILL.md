---
name: wp-performance
description: "Diagnose and optimize WordPress performance: WP-CLI profiling, Query Monitor, database indexing, autoloaded options, object cache, cron events, and HTTP requests."
compatibility: "Targets WordPress 6.9+ (PHP 7.2.24+). Requires WP-CLI. Redis object cache available."
source: "https://github.com/WordPress/agent-skills"
---

# WP Performance

## When to use

- frontend pages slow to load
- admin UI laggy
- REST endpoints slow
- cron tasks taking too long
- need to identify bottlenecks

## Step 1 — Run diagnostics

```bash
wp doctor check --all
```

Identifies: missing object caches, bloated autoloaded options, slow queries, cron failures.

## Step 2 — Profile with `wp profile`

```bash
wp profile stage            # Profile all stages
wp profile hook wp_footer   # Profile specific hook
wp profile hook wp_head
```

Look for: heavy database queries, slow hook callbacks, hooks called many times.

## Step 3 — Fix by bottleneck type

### Database slowness

```bash
wp db query 'SHOW INDEXES FROM wp_posts'
wp profile stage --all
```

### Autoloaded options bloat

```bash
wp option list --autoload=yes --format=json \
  | python3 -c "import json,sys; data=json.load(sys.stdin); [print(d['option_name'], len(str(d.get('option_value','')))) for d in sorted(data, key=lambda x: len(str(x.get('option_value',''))), reverse=True)[:20]"
```

Identify large options that can be lazy-loaded or removed.

### Object cache not enabled

```bash
wp cache type   # Should show Redis, not "Default"
wp cache flush
```

For GridPane servers, Redis cache is managed via the GridPane dashboard.

### Slow external HTTP calls

- Grep code for `wp_remote_get` / `wp_remote_post`
- Cache responses with transients:
```php
$cached = get_transient( 'my_api_data' );
if ( false === $cached ) {
    $response = wp_remote_get( $url );
    $cached = wp_remote_retrieve_body( $response );
    set_transient( 'my_api_data', $cached, HOUR_IN_SECONDS );
}
```

### Slow cron tasks

```bash
wp cron event list --format=table
wp cron event run <hook>   # Run manually to time it
```

## Step 4 — Verify improvements

```bash
wp profile stage    # Re-run and compare
```

## Failure Modes

- **`wp profile stage` times out**: site too slow; use staging or smaller scope
- **Redis down**: verify Redis container is running; `docker ps | grep redis`
- **Query Monitor REST headers empty**: confirm QM plugin is active
