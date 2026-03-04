---
name: n8n
description: Use this skill when working with n8n workflows, automation, the n8n server, managing n8n containers, or building integrations with n8n.
version: 1.0.0
---

# n8n Skill

## Server

- **Host:** `build-faithmade` (178.156.221.8) — Hetzner Ubuntu 24.04
- **Stack:** Docker Compose — n8n + Redis + PostgreSQL 15 + Traefik
- **n8n port:** 5678 (internal), exposed via Traefik on 443

## SSH Access

```bash
ssh build-faithmade
```

## Docker Management

```bash
# View running containers
ssh build-faithmade 'docker ps'

# View n8n logs
ssh build-faithmade 'docker logs n8n-n8n-1 --tail 50'

# Restart n8n
ssh build-faithmade 'docker restart n8n-n8n-1'

# Restart full stack
ssh build-faithmade 'cd /path/to/compose && docker compose restart'

# View all logs
ssh build-faithmade 'docker compose logs -f --tail 100'
```

## n8n Concepts

- **Workflows** — sequences of nodes triggered by events or schedules
- **Nodes** — individual steps (HTTP Request, Webhook, Set, IF, etc.)
- **Credentials** — stored securely, referenced by name in nodes
- **Expressions** — `{{ $json.field }}` to reference data between nodes
- **Webhook nodes** — expose URLs to receive external data

## Common Node Types

- **Webhook** — receive HTTP requests
- **HTTP Request** — call external APIs
- **Schedule Trigger** — cron-based triggers
- **Set** — transform/set data fields
- **IF** — conditional branching
- **Code** — run JavaScript
- **Send Email** — email notifications

## Environment Variables

n8n config is typically in the Docker Compose file or `.env`:
```
N8N_HOST=
N8N_PORT=5678
N8N_PROTOCOL=https
WEBHOOK_URL=https://your-domain.com/
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=postgres
```
