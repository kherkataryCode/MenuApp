# Hungry Mango — production image (~60 MB). Node 22.13+ is required for built-in SQLite.
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
# Dependencies first for better layer caching. Runtime has zero required deps;
# "pg" (optional) is installed so the same image works with PostgreSQL.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund; else npm install --omit=dev --no-audit --no-fund; fi && npm cache clean --force
COPY server ./server
COPY web ./web
COPY seed ./seed
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 8080
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
