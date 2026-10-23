# syntax=docker/dockerfile:1
#
# One file, two images you can run:  `api` (Express) and `web` (nginx + the built React app).
# `deps` and `build` are intermediate stages that exist only to produce them.
#   docker compose --profile app up --build

ARG NODE_VERSION=22

# ---- install every workspace's dependencies (cached until a package.json changes) ----
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
# Scripts are skipped here (the root postinstall builds `shared`); `build` below does it explicitly.
RUN npm ci --ignore-scripts

# ---- compile shared, server and client ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY client client
RUN npm run build

# ---- API runtime: production dependencies + compiled output only ----
FROM node:${NODE_VERSION}-alpine AS api
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --ignore-scripts -w server -w shared && npm cache clean --force
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/server/dist server/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:4000/api/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/dist/server.js"]

# ---- web runtime: static files behind nginx, which also proxies /api to the API ----
FROM nginxinc/nginx-unprivileged:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 8080
