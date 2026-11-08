# syntax=docker/dockerfile:1
#
# Hosts MS2SceneEditor. The game's extracted files are NOT in the image: mount the `extracted` folder (the output of
# the extraction scripts, with Xml/, Resource/ and converted/ inside) at /extracted.
#
#   docker build -t ms2sceneeditor .
#   docker run --rm -p 3000:3000 \
#     -v /path/to/extracted:/extracted:ro \
#     -v ms2se-data:/data \
#     ms2sceneeditor
#
# The first start builds the search indexes from the mounted files into /data (a minute or two); keep a volume there so
# later starts skip it. Set REINDEX=1 to rebuild them.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    MS2_EXTRACTED=/extracted \
    MS2_DATA=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
# The index builder runs on the first start (Node strips its TypeScript itself, so no extra tooling is needed).
COPY scripts ./scripts
COPY docker-entrypoint.sh ./

# /data holds the indexes and caches the app writes, so it must be writable by the user the container runs as.
RUN mkdir /data /extracted && chown node:node /data && chmod +x docker-entrypoint.sh
VOLUME /data
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/meta').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "build"]
