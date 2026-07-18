# Jamgate — container image for one-click deploy (Railway / Render / any Docker host).
#
# Runs Jamgate in REMOTE mode (Streamable HTTP + bearer auth) so one instance can serve all
# of a single person's agents. It is the same gate and store as the local stdio install; only
# the transport differs. The image is a base install (fuzzy recall) — the optional embeddings
# peer is deliberately not bundled, matching the .mcpb bundle, so the image stays small and
# has zero native build steps.
#
# Required at runtime:  JAMGATE_TOKEN  (a strong secret; the server refuses to start without it)
# Data lives in a volume mounted at /data (JAMGATE_STORE=/data/memory.json) so memory survives
# restarts and redeploys. The listen port is taken from $PORT (set by the platform) or 8420.

# ---- Stage 1: build -------------------------------------------------------------------------
# Compile TypeScript to dist/ with the full (dev) dependency set. Nothing from this stage but
# dist/ reaches the final image.
FROM node:22-alpine AS build
WORKDIR /app

# Install with the lockfile for reproducible builds; devDependencies are needed for `tsc`.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Stage 2: runtime -----------------------------------------------------------------------
# A clean image with only production dependencies and the compiled output.
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Production deps only (@modelcontextprotocol/sdk). The optional @huggingface/transformers peer
# is not installed, so the image behaves like a base install (fuzzy recall, no ML runtime).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The compiled server.
COPY --from=build /app/dist ./dist

# Persistent store lives on a mounted volume at /data, owned by the non-root `node` user that
# ships with the base image. Declaring the VOLUME documents the mount point for plain
# `docker run`; Railway/Render attach their own managed disk here.
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

# Defaults for remote mode. Bind to all interfaces (a container has no localhost proxy in front
# of it) and keep the store on the volume. JAMGATE_TOKEN is intentionally NOT set here — it must
# be supplied per-deployment as a secret. JAMGATE_PORT is intentionally NOT set either: leaving
# it unset lets the server honor the platform's $PORT, falling back to 8420 (the built-in
# default) for a plain `docker run`. Setting JAMGATE_PORT here would override $PORT and break the
# health check on hosts that inject their own port.
ENV JAMGATE_HTTP=1 \
    JAMGATE_HOST=0.0.0.0 \
    JAMGATE_STORE=/data/memory.json

EXPOSE 8420

# Drop privileges — never run the server as root.
USER node

# Health probe hits the unauthenticated /healthz. Uses Node itself (no curl in alpine) and reads
# $PORT if the platform set one, else the 8420 default above.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const p=process.env.PORT||process.env.JAMGATE_PORT||8420;require('http').get('http://127.0.0.1:'+p+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js", "--http"]
