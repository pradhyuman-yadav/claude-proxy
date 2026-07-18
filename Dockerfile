FROM node:20-alpine

# Install Claude Code CLI (provides `claude` binary) and the proxy server.
# ttyd powers the /terminal web login console.
RUN npm install -g @anthropic-ai/claude-code claude-max-api-proxy \
  && apk add --no-cache ttyd curl

# CLIProxyAPI — Gemini/Antigravity backend for GEMINI_BACKEND=cli.
# Latest release, arch-aware (x86_64 → amd64, aarch64 → aarch64).
RUN set -eux; \
  ARCH="$(uname -m)"; \
  case "$ARCH" in x86_64) A=amd64 ;; aarch64) A=aarch64 ;; *) echo "unsupported arch $ARCH" && exit 1 ;; esac; \
  URL="$(curl -fsSL https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest \
    | grep -o "https://[^\"]*_linux_${A}\.tar\.gz" | head -1)"; \
  curl -fsSL "$URL" -o /tmp/cpa.tar.gz; \
  mkdir -p /tmp/cpa && tar -xzf /tmp/cpa.tar.gz -C /tmp/cpa; \
  BIN="$(find /tmp/cpa -type f -name 'cli-proxy-api*' | head -1)"; \
  install -m 0755 "$BIN" /usr/local/bin/cli-proxy-api; \
  rm -rf /tmp/cpa /tmp/cpa.tar.gz; \
  cli-proxy-api --help >/dev/null 2>&1 || true

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js gemini-config.yaml ./
COPY lib ./lib
COPY public ./public
COPY bin ./bin

# Credentials from the /terminal logins live here — mount volumes to persist
RUN mkdir -p /home/node/.claude /home/node/.cli-proxy-api \
  && chown -R node:node /home/node/.claude /home/node/.cli-proxy-api

ENV PORT=3456
ENV INTERNAL_PORT=13456

EXPOSE 3456

# Drop root — node:alpine ships an unprivileged `node` user (uid 1000).
RUN chown -R node:node /app
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "server.js"]
