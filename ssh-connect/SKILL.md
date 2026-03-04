---
name: ssh-connect
description: Use this skill when the user asks to SSH into a server, connect to a server, run commands on a remote server, or asks about servers I have access to. Triggers on phrases like "ssh into", "connect to the server", "run this on the server", "check the server", or mentions of specific server names like "build-faithmade", "n8n-hetzner".
version: 1.0.0
---

# SSH Connect Skill

Use the Bash tool to SSH into servers using the configured aliases.

## Available Servers

| Alias | IP | Notes |
|---|---|---|
| `build-faithmade` / `n8n-hetzner` | 178.156.221.8 | Hetzner Ubuntu 24.04, root, n8n stack |
| `faithmade-app-build` | 178.156.232.23 | Hetzner Ubuntu 24.04, root, mobile app build server |

All other servers in `~/.ssh/config` (key access not confirmed):
- `ClientSitesAtlanta` — 155.138.237.175
- `ClientSitesDallas` — 45.76.233.161
- `Faithmade-MT-Atlanta` — 155.138.207.77
- `Faithmade-MT-Dallas` — 144.202.75.90
- `Unstuck` — 144.202.25.139
- `FullyFunded` — 66.42.84.254
- `AEGAsites` — 155.138.229.140
- `DevHetzner` — 65.21.199.22
- `FaithmadeDallasVultr-NotMT` — 155.138.255.229

## SSH Key

Passwordless key for `build-faithmade`: `~/.ssh/build_faithmade`

## Usage

To run a command on a server:
```bash
ssh build-faithmade 'your command here'
```

To run multiple commands:
```bash
ssh build-faithmade 'command1 && command2'
```

To copy a file to the server:
```bash
scp /local/path build-faithmade:/remote/path
```
