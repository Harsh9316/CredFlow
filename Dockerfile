FROM node:22-slim

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .

# Inlined into the client bundle at build time; docker-compose turns it on for demos.
ARG NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS=false
ENV NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS=$NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS

# The build only needs a syntactically valid secret; the real one is supplied at runtime.
RUN SESSION_SECRET=build-time-placeholder-secret-not-used-at-runtime npm run build

ENV NODE_ENV=production \
    DATABASE_URL=file:/data/credflow.db \
    PORT=3000

VOLUME /data
EXPOSE 3000

ENTRYPOINT ["sh", "docker/entrypoint.sh"]
