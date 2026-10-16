FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
COPY tools ./tools
RUN npx vite build

FROM caddy:2-alpine
COPY deploy/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
