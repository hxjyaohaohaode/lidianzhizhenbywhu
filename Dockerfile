FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
RUN mkdir -p .runtime/platform && chown -R appuser:appgroup .runtime
USER appuser
EXPOSE 3001
ENV NODE_ENV=production
ENV PORT=3001
ENV STORAGE_DIR=.runtime/platform
CMD ["node", "dist/server/server/index.js"]
