FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY vendor/braces ./vendor/braces
RUN mkdir -p .sites-runtime/npm-cache \
  && npm ci --include=dev --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production
CMD ["npm", "run", "start"]
