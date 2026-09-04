FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     redis-tools \
     postgresql-client \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
  && corepack prepare pnpm@10.11.1 --activate

COPY . .

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @change-room/app build

ENV NODE_ENV=production

EXPOSE 10000

CMD ["sh", "-c", "pnpm --filter @change-room/app start"]
