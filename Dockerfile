# syntax=docker/dockerfile:1
# One image for the app and its migrate job:
#   docker run IMAGE            -> the Next.js server on $PORT
#   docker run IMAGE migrate    -> applies db/migrations (the deploy runs this first)

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build

# Next's standalone output carries only the dependencies the server actually imports
FROM node:24-slim AS app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY help ./help
COPY db ./db
COPY scripts/migrate.ts ./scripts/migrate.ts
COPY docker-entrypoint.sh ./
USER node
EXPOSE 8080
ENTRYPOINT ["./docker-entrypoint.sh"]
