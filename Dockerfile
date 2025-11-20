# syntax=docker/dockerfile:1.7

FROM node:20-slim AS base
WORKDIR /app
ENV NODE_ENV=production \
    APP_MODE=server

FROM base AS deps
COPY package*.json ./
RUN npm install --production=false

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations
RUN npm run build

FROM base AS runner
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY --from=build /app/dist ./dist
COPY scripts ./scripts
COPY migrations ./migrations
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh
EXPOSE 4000
CMD ["./docker-entrypoint.sh"]
