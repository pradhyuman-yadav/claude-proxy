FROM node:20-alpine

# Install Claude Code CLI (provides `claude` binary) and the proxy server
RUN npm install -g @anthropic-ai/claude-code claude-max-api-proxy

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./

ENV PORT=3456
ENV INTERNAL_PORT=13456

EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "server.js"]
