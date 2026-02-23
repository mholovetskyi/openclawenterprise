# ── Stage 1: Builder ──────────────────────────────────────────────────────────
# Full bookworm image required for native module compilation (better-sqlite3,
# canvas, etc.) and Bun build tooling. Dev tools stay in this stage only.
FROM node:22-bookworm@sha256:cd7bcd2e7a1e6f72052feb023c7f6b722205d3fcab7bbcbd2d1bfdab10b1e935 AS builder

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app
RUN chown node:node /app

ARG OPENCLAW_DOCKER_APT_PACKAGES=""
RUN if [ -n "$OPENCLAW_DOCKER_APT_PACKAGES" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $OPENCLAW_DOCKER_APT_PACKAGES && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --chown=node:node ui/package.json ./ui/package.json
COPY --chown=node:node patches ./patches
COPY --chown=node:node scripts ./scripts

USER node
RUN pnpm install --frozen-lockfile

# Optionally install Chromium and Xvfb for browser automation.
# Build with: docker build --build-arg OPENCLAW_INSTALL_BROWSER=1 ...
# Adds ~300MB but eliminates the 60-90s Playwright install on every container start.
# Must run after pnpm install so playwright-core is available in node_modules.
USER root
ARG OPENCLAW_INSTALL_BROWSER=""
RUN if [ -n "$OPENCLAW_INSTALL_BROWSER" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb && \
      mkdir -p /home/node/.cache/ms-playwright && \
      PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright \
      node /app/node_modules/playwright-core/cli.js install --with-deps chromium && \
      chown -R node:node /home/node/.cache/ms-playwright && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

USER node
COPY --chown=node:node . .
RUN pnpm build
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build


# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
# bookworm-slim strips compiler toolchain, ImageMagick, gnupg, perl, and other
# dev packages that are not needed at runtime — eliminating the bulk of OS-level
# CVEs while keeping the same glibc version so native .node binaries are compatible.
FROM node:22-bookworm-slim AS runtime

RUN corepack enable

WORKDIR /app

# Copy the fully-built application from the builder stage.
# Compiled native modules (.node files) are glibc-compatible: both stages use
# Debian bookworm; only the non-essential OS packages differ.
COPY --from=builder --chown=node:node /app /app

# Copy Playwright browser cache if it was installed in the builder stage.
# The /home/node directory always exists, so this COPY is always safe.
COPY --from=builder --chown=node:node /home/node /home/node

# Re-install xvfb in the slim runtime if the browser build arg was set,
# since slim does not include it and Chromium needs it for headless operation.
ARG OPENCLAW_INSTALL_BROWSER=""
USER root
RUN if [ -n "$OPENCLAW_INSTALL_BROWSER" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

# Update npm to latest to pull in patched versions of bundled packages
# (tar, minimatch, glob) that ship with older npm releases and carry CVEs.
RUN npm install -g npm@latest && npm cache clean --force

# Remove the corepack cache — it contains a full pnpm tarball with its own
# transitive dependencies that Trivy flags as CVEs. At runtime pnpm runs from
# /app/node_modules, not from the corepack download cache.
RUN rm -rf /root/.cache/node/corepack /home/node/.cache/node/corepack

# Remove development-only files that are not needed at runtime.
# This eliminates false-positive secret-scanner (Trivy) alerts caused by:
#   - docs/         : config-reference examples with realistic-looking credentials
#   - test fixtures : *.test.ts files contain fake RSA keys, JWTs, API tokens
#   - .secrets.baseline / .gitleaks.toml : secret-scanning metadata files
# find is used for test files so that cached builder layers (built before the
# .dockerignore exclusions were added) don't carry stale test fixtures forward.
RUN find /app -maxdepth 6 \( \
      -name "*.test.ts" -o -name "*.spec.ts" \
      -o -name "*.test.js" -o -name "*.spec.js" \
    \) -delete && \
    rm -rf \
      /app/docs \
      /app/.secrets.baseline \
      /app/.detect-secrets.cfg \
      /app/.gitleaks.toml \
      /app/tsconfig.json \
      /app/tsdown.config.ts \
      /app/.github

ENV NODE_ENV=production
ENV OPENCLAW_PREFER_PNPM=1

# Security hardening: Run as non-root user (uid 1001 in bookworm-slim)
USER node

# Start gateway server with default config.
# Binds to loopback (127.0.0.1) by default for security.
#
# For container platforms requiring external health checks:
#   1. Set OPENCLAW_GATEWAY_TOKEN or OPENCLAW_GATEWAY_PASSWORD env var
#   2. Override CMD: ["node","openclaw.mjs","gateway","--allow-unconfigured","--bind","lan"]
CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
