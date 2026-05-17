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
| `CLAUDE_CODE_OAUTH_TOKEN` | — | **Required.** OAuth token for Claude Code CLI |
| `HOST_PORT` | `3456` | Port exposed on the host (docker-compose only) |
| `PORT` | `3456` | Port the container listens on |
| `INTERNAL_PORT` | `13456` | Internal port for the raw proxy (do not expose) |

---

## Using the proxy

Point any OpenAI-compatible client at `http://<host>:3456`:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3456/v1",
    api_key="not-needed",  # auth handled by the proxy
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
  "port": 3456
}
```

Returns `200 ok` when ready, `503 starting` during startup.
