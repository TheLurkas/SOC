#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma db push --skip-generate

echo "Seeding database (skips if data exists)..."
npx ts-node prisma/seed.ts || echo "Seed failed or already seeded, continuing..."

echo "Starting API server..."
exec node dist/src/main
