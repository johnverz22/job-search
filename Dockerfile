# Web UI (static build, served by the app)
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build:server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# dist/server.js looks for ../web/dist and ../data/sources.json
COPY --from=web /web/dist ./web/dist
COPY data ./data
# Optional snapshot location (set SNAPSHOT_FILE=/app/snapshot/jobs.ndjson.gz and mount a volume here)
RUN mkdir snapshot && chown node:node snapshot
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
