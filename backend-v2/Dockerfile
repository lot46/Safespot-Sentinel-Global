# SafeSpot Sentinel Global V2 - Backend Dockerfile

FROM node:20-alpine AS base
WORKDIR /app

# Install openssl for Prisma and libc6-compat for node modules
RUN apk add --no-cache openssl libc6-compat

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .

# Generate Prisma client if present
RUN if [ -f prisma/schema.prisma ]; then npx prisma generate; fi

# Build TS
RUN yarn build || true

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs

ENV NODE_ENV=production

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY --from=base /app/package.json ./package.json

USER nodejs
EXPOSE 8002
CMD ["node", "dist/index.js"]
