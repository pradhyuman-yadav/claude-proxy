FROM node:20-alpine

# Install Claude Code CLI (provides `claude` binary) and the proxy server.
# ttyd powers the /terminal web login console.
RUN npm install -g @anthropic-ai/claude-code claude-max-api-proxy \
  && apk add --no-cache ttyd

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY bin ./bin

# Credentials from the /terminal login live here — mount a volume to persist
RUN mkdir -p /home/node/.claude && chown -R node:node /home/node/.claude

ENV PORT=3456
ENV INTERNAL_PORT=13456

EXPOSE 3456

# Drop root — node:alpine ships an unprivileged `node` user (uid 1000).
RUN chown -R node:node /app
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "server.js"]
