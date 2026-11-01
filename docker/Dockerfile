############################################
# Healthcheck binary (Go)
#
# Built on the builder's own platform and with CGO off, so the resulting
# static binary works for every target arch we publish without needing an
# emulated toolchain per platform.
############################################
FROM --platform=$BUILDPLATFORM golang:1.21.4-bookworm AS build_healthcheck
WORKDIR /app
COPY ./extra/healthcheck.go ./extra/healthcheck.go
RUN CGO_ENABLED=0 go build -o ./extra/healthcheck ./extra/healthcheck.go

############################################
# Base image: Node + docker CLI + compose plugin
#
# Everything this project needs is installed here, so the image no longer
# depends on a prebuilt third-party base image from a Docker Hub namespace.
#
# DOCKER_APT_BASE can be pointed at a mirror when download.docker.com is slow,
# e.g. --build-arg DOCKER_APT_BASE=https://mirrors.aliyun.com/docker-ce/linux/debian
############################################
FROM node:22-bookworm-slim AS base
ARG DOCKER_APT_BASE=https://download.docker.com/linux/debian
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        dumb-init \
        gnupg \
        unzip \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL "${DOCKER_APT_BASE}/gpg" \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] ${DOCKER_APT_BASE} $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        docker-ce-cli \
        docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g tsx

############################################
# Build: production dependencies only
############################################
FROM base AS build
WORKDIR /app
COPY --chown=node:node ./package.json ./package.json
COPY --chown=node:node ./package-lock.json ./package-lock.json
RUN npm ci --omit=dev

############################################
# Frontend assets
#
# vite lives in devDependencies, so this stage needs the full dependency tree.
# Keeping it separate means the runtime image still ships production deps only,
# and `docker build` no longer depends on a frontend-dist prepared on the host.
############################################
FROM base AS build_frontend
WORKDIR /app
COPY --chown=node:node ./package.json ./package.json
COPY --chown=node:node ./package-lock.json ./package-lock.json
RUN npm ci --no-fund
COPY --chown=node:node ./tsconfig.json ./tsconfig.json
COPY --chown=node:node ./common ./common
COPY --chown=node:node ./frontend ./frontend
RUN npm run build:frontend

############################################
# ⭐ Main image
############################################
FROM base AS release
WORKDIR /app
COPY --chown=node:node --from=build_healthcheck /app/extra/healthcheck /app/extra/healthcheck
COPY --from=build /app/node_modules /app/node_modules
COPY --chown=node:node . .
COPY --chown=node:node --from=build_frontend /app/frontend-dist ./frontend-dist
RUN mkdir ./data

# It is just for safe, as by default, it is disabled in the latest Node.js now.
# Read more:
# - https://github.com/sagemathinc/cocalc/issues/6963
# - https://github.com/microsoft/node-pty/issues/630#issuecomment-1987212447
ENV UV_USE_IO_URING=0

VOLUME /app/data
EXPOSE 5001
HEALTHCHECK --interval=60s --timeout=30s --start-period=60s --retries=5 CMD extra/healthcheck
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["tsx", "./backend/index.ts"]

############################################
# Mark as nightly
############################################
FROM release AS nightly
RUN npm run mark-as-nightly
