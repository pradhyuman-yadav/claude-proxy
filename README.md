# claude-proxy

Standalone Docker container that wraps [`claude-max-api-proxy`](https://www.npmjs.com/package/claude-max-api-proxy) and exposes:

- **OpenAI-compatible API** on the configured port (default `3456`)
- **Health dashboard** at `GET /` — auto-refreshes every 30 s
- **JSON health endpoint** at `GET /health` — for monitoring / uptime checks

Designed for self-hosting in Portainer or any Docker-capable environment.

> **Note:** `claude-max-api-proxy` is a community tool that uses your Claude Max/Pro
> subscription instead of pay-per-token API keys. Anthropic has blocked some subscription
> usage outside Claude Code in the past. Verify current terms before relying on this.

---

## Prerequisites

1. A **Claude Max or Pro** subscription
2. **Claude Code CLI** installed and authenticated on your local machine:
   ```bash
   npm install -g @anthropic-ai/claude-code
   claude auth login
   ```
3. Your **OAuth token** (extracted after login):
   - **Linux/Mac:** `~/.claude/credentials.json`
   - **Windows:** `%APPDATA%\Claude\credentials.json`
   - Token format: `sk-ant-oat01-...`

---

## Quick start (Docker Compose)

```bash
cp .env.example .env
# Edit .env and paste your CLAUDE_CODE_OAUTH_TOKEN

docker compose up -d
```

Dashboard → http://localhost:3456/
Health    → http://localhost:3456/health

---

## Portainer deployment

### Option A — Build from source (Portainer Stack)

1. In Portainer, go to **Stacks → Add stack**
2. Paste the contents of `docker-compose.yml`
3. Under **Environment variables**, add:
   | Variable | Value |
   |---|---|
   | `CLAUDE_CODE_OAUTH_TOKEN` | `sk-ant-oat01-...` |
   | `HOST_PORT` | `3456` (or any free port) |
4. Click **Deploy the stack**

### Option B — Pre-built image from GHCR

After the GitHub Actions workflow runs on `main`, a pre-built image is available at:

```
ghcr.io/pradhyuman-yadav/claude-proxy:main
```

Use this `docker-compose.yml` snippet in Portainer:

```yaml
services:
  claude-proxy:
    image: ghcr.io/pradhyuman-yadav/claude-proxy:main
    container_name: claude-proxy
    restart: unless-stopped
    ports:
      - "3456:3456"
    environment:
      - CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
      - PORT=3456
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | — | **Required.** OAuth token for Claude Code CLI. The container refuses to start without it. |
| `API_KEY` | — | Optional. Set to protect `/v1/*` with `Authorization: Bearer <key>`. Empty = open access. Generate: `openssl rand -hex 32`. |
| `HOST_PORT` | `3456` | Port exposed on the host (docker-compose only) |
| `PORT` | `3456` | Port the container listens on |
| `INTERNAL_PORT` | `13456` | Internal port for the raw proxy (do not expose) |

## Architecture

```
client ──▶ :3456 Express wrapper ──▶ :13456 claude-max-api ──▶ Claude (subscription)
             │  routes /, /health
             │  auth (API_KEY) on /v1/*
             │  strips unsupported params
             │  normalizes model aliases
             └▶ rewrites "model" in the response (SSE + JSON)
```

The internal `claude-max-api` process is spawned as a child on `INTERNAL_PORT`
and is never exposed. Only the Express wrapper faces the network.

---

## Using the proxy

Point any OpenAI-compatible client at `http://<host>:3456`.

**Auth depends on whether you set `API_KEY`:**

| `API_KEY` env | What clients send as `api_key` |
|---|---|
| **not set** (open access) | any value — it is ignored |
| **set** (recommended) | that exact key — sent as `Authorization: Bearer <API_KEY>`, else `401` |

The client `api_key` is **only** the proxy's `API_KEY` gate. Your Claude
subscription is authenticated separately via `CLAUDE_CODE_OAUTH_TOKEN` on the
server — clients never see it.

### Generic "OpenAI Compatible" connectors

Any tool with an OpenAI-compatible provider option (n8n, OpenWebUI, Flowise,
LibreChat, LangChain, …) works with just two fields — no custom connector:

| Field | Value |
|---|---|
| Base URL | `http://<host>:3456/v1` |
| API key | your `API_KEY` (any string if unset) |

Compatibility provided by the proxy:
- `GET /v1/models` for model discovery / key validation
- OpenAI error envelope (`{"error": {"message", "type", "code"}}`) on 401/502
- `max_completion_tokens` accepted as an alias for `max_tokens`
- `api-key` header accepted as an alternative to `Authorization: Bearer`
- CORS + `OPTIONS` preflight for browser-based clients
- Unsupported params stripped server-side, so strict clients don't error

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3456/v1",
    api_key="YOUR_API_KEY",  # the value of API_KEY; use any string if API_KEY is unset
)

response = client.chat.completions.create(
    model="claude-sonnet-4-5",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)
```

---

## Health check

```bash
curl http://localhost:3456/health
```

```json
{
  "status": "ok",
  "uptime_seconds": 142,
  "requests": 7,
  "errors": 0,
  "auth_configured": true,
  "api_key_required": true,
  "registry_ready": true,
  "models": 9,
  "port": 3456
}
```

Returns `200 ok` once the internal proxy is up, `503 starting` during startup.
`registry_ready` is `true` only after `/v1/models` has been read successfully —
if it stays `false`, model aliases (e.g. `sonnet`) will not resolve.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Container exits immediately with `CLAUDE_CODE_OAUTH_TOKEN is not set` | Token env var missing | Set `CLAUDE_CODE_OAUTH_TOKEN` in `.env` / stack |
| `/health` stuck at `503 starting` | Internal proxy not binding — bad/expired token or slow start | Check logs; re-run `claude auth login` and refresh the token |
| `registry_ready: false` but status `ok` | `/v1/models` returned nothing; aliases won't resolve | Check logs for registry retries; use full model ids meanwhile |
| Completions return `401` | `API_KEY` set but client sent wrong/no bearer token | Send `Authorization: Bearer <API_KEY>` |
| `502 proxy_unavailable` | Upstream error or still starting | Retry; inspect container logs |

## Development

```bash
npm install
npm test        # runs the node:test suite in test/
```
