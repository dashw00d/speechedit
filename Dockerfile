FROM oven/bun:1.3.14 AS build

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build:web

FROM oven/bun:1.3.14

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    SPEECHEDIT_WEB_ROOT=/app/src/renderer/dist \
    SPEECHEDIT_CACHE_DIR=/data/whisper-cache \
    SPEECHEDIT_REVIEW_DIR=/data/reviews

COPY --chown=bun:bun --from=build /app/package.json ./package.json
COPY --chown=bun:bun --from=build /app/scripts/web-server.ts ./scripts/web-server.ts
COPY --chown=bun:bun --from=build /app/scripts/review-server.ts ./scripts/review-server.ts
COPY --chown=bun:bun --from=build /app/scripts/recording-server.ts ./scripts/recording-server.ts
COPY --chown=bun:bun --from=build /app/src/shared ./src/shared
COPY --chown=bun:bun --from=build /app/node_modules/zod ./node_modules/zod
COPY --chown=bun:bun --from=build /app/src/renderer/dist ./src/renderer/dist

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /data/whisper-cache /data/reviews && chown -R bun:bun /data
USER bun

VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "const r=await fetch('http://127.0.0.1:3000/healthz'); if(!r.ok) process.exit(1)"

CMD ["bun", "run", "start:web"]
