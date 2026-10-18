# syntax=docker/dockerfile:1
FROM node:26-alpine@sha256:ef24c5053d50fdc3e4e56eb4e7ddb7861874ab0fdc797046ba897581deb8e868 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js svelte.config.js jsconfig.json ./
COPY src ./src
COPY public ./public
COPY scripts/verify-pwa.mjs ./scripts/verify-pwa.mjs
RUN npm run check && npm run build

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:bb6b03d81066993293a10feda7250e8e1cc034035fe9b61cfceededa7c8bf04d AS runtime
LABEL org.opencontainers.image.source="https://github.com/TimoSchoenberger/passport-photo-printer" \
      org.opencontainers.image.description="Self-hosted passport photo crop and print-sheet tool" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=65532:65532 /app/dist ./dist
COPY --chown=65532:65532 server ./server
COPY --chown=65532:65532 LICENSE ./LICENSE
USER 65532:65532
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["server/index.mjs"]
