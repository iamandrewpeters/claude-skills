---
name: wp-rest-api
description: "Use when building, extending, or debugging WordPress REST API endpoints: register_rest_route, WP_REST_Controller, schema/argument validation, permission callbacks, response shaping, register_rest_field, or exposing CPTs/taxonomies via show_in_rest."
compatibility: "Targets WordPress 6.9+ (PHP 7.2.24+). Some workflows require WP-CLI."
source: "https://github.com/WordPress/agent-skills"
---

# WP REST API

## When to use

- creating custom endpoints via `register_rest_route()` or `WP_REST_Controller`
- exposing CPTs/taxonomies via `show_in_rest`
- registering custom fields via `register_rest_field()` or `register_meta()`
- debugging 404 / 401 / 403 permission issues
- shaping responses (adding/removing fields)
- authentication and permission callbacks

## Register a Custom Route

```php
add_action( 'rest_api_init', function() {
    register_rest_route( 'myplugin/v1', '/items/(?P<id>\d+)', [
        'methods'             => 'GET',
        'callback'            => 'my_get_item',
        'permission_callback' => function() {
            return current_user_can( 'read' );
        },
        'args' => [
            'id' => [
                'type'              => 'integer',
                'required'          => true,
                'sanitize_callback' => 'intval',
            ],
        ],
    ] );
} );
```

## Permission Callbacks

```php
// Public
'permission_callback' => '__return_true',

// Logged in
'permission_callback' => 'is_user_logged_in',

// Capability-based
'permission_callback' => function() {
    return current_user_can( 'manage_options' );
},

// Nonce-based (browser clients)
'permission_callback' => function( $request ) {
    return wp_verify_nonce( $request->get_header( 'X-WP-Nonce' ), 'wp_rest' );
},
```

## Expose a CPT via REST

```php
register_post_type( 'sermon', [
    'show_in_rest' => true,
    'rest_base'    => 'sermons',
    // ...
] );
```

## Add Custom Fields to REST Response

```php
register_rest_field( 'sermon', 'speaker', [
    'get_callback'    => fn( $post ) => get_post_meta( $post['id'], 'speaker', true ),
    'update_callback' => fn( $value, $post ) => update_post_meta( $post->ID, 'speaker', $value ),
    'schema'          => [ 'type' => 'string' ],
] );
```

## Register Meta via REST

```php
register_meta( 'post', 'my_meta_key', [
    'show_in_rest'  => true,
    'type'          => 'string',
    'single'        => true,
    'auth_callback' => fn() => current_user_can( 'manage_posts' ),
] );
```

## Shape Responses with Filters

```php
add_filter( 'rest_prepare_sermon', function( $response ) {
    $response->data['custom'] = 'value';
    unset( $response->data['guid'] );
    return $response;
} );
```

## Debugging

```bash
# List all routes
wp rest api list

# Test an endpoint
curl https://example.com/wp-json/myplugin/v1/items/1
```

## Failure Modes

- **404**: permalinks not enabled, or wrong namespace/path — run `wp rewrite flush`
- **401/403**: missing auth header or wrong permission_callback
- **Missing fields**: `show_in_rest` not set, or `register_rest_field` not called
- **Invalid params**: missing sanitize/validate callbacks in args
