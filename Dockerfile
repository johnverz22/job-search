# Web UI (static build, served by the API container)
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
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# dist/api.js looks for ../web/dist; without it the container serves the API only.
COPY --from=web /web/dist ./web/dist
COPY migrations ./migrations
CMD ["node", "dist/api.js"]
