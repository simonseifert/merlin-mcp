# merlin-mcp, self-hosted (Node). Same server as the Cloudflare Worker.
#   docker build -t merlin-mcp .
#   docker run --env-file merlin.env -p 8787:8787 -v merlin-data:/data merlin-mcp          (HTTP)
#   docker run -i --rm --env-file merlin.env -v merlin-data:/data merlin-mcp --stdio    (one local client)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.node.json ./
COPY src ./src
RUN npx tsc -p tsconfig.node.json && npm prune --omit=dev --ignore-scripts

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 MERLIN_DB=/data/merlin.sqlite NODE_NO_WARNINGS=1
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "dist/node.js"]
