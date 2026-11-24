FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json competition.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node deploy ./deploy
RUN node deploy/prepare-public.mjs public \
    && node --check src/server.js \
    && mkdir data && chown node:node data
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
