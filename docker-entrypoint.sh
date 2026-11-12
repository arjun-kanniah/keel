#!/bin/sh
set -e
if [ "$1" = "migrate" ]; then
  # Node 24 runs the TypeScript migration script directly (type stripping)
  exec node scripts/migrate.ts
fi
exec node server.js "$@"
