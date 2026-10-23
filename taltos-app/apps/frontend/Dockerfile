# syntax=docker/dockerfile:1
# Build-kontextus: a taltos-app/ gyökér (lásd compose.yaml).

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@taltos/frontend..."
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/frontend apps/frontend
RUN pnpm --filter @taltos/frontend build

# Az nginx szolgálja ki az SPA-t, és ugyanez a reverse proxy a backend felé (D50).
FROM nginxinc/nginx-unprivileged:1.30-alpine AS runtime
COPY apps/frontend/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY apps/frontend/nginx/proxy-headers.conf /etc/nginx/snippets/proxy-headers.conf
COPY --from=build /repo/apps/frontend/dist /usr/share/nginx/html
EXPOSE 8080
