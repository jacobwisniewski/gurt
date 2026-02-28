#!/bin/bash
# Helper script to run Flyway migrations with individual PostgreSQL params
# This script constructs DATABASE_URL from POSTGRES_* environment variables

# Check if DATABASE_URL is already set
if [ -n "$DATABASE_URL" ]; then
  echo "Using existing DATABASE_URL"
  flyway -configFiles=database/flyway.conf "$@"
  exit $?
fi

# Check if individual params are set
if [ -z "$POSTGRES_HOST" ] || [ -z "$POSTGRES_PORT" ] || [ -z "$POSTGRES_USER" ] || [ -z "$POSTGRES_DB" ]; then
  echo "Error: Either DATABASE_URL or all POSTGRES_* variables must be set"
  echo "Required: POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_DB"
  echo "Optional: POSTGRES_PASSWORD"
  exit 1
fi

# Construct DATABASE_URL
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
echo "Constructed DATABASE_URL from individual parameters"

# Run Flyway
flyway -configFiles=database/flyway.conf "$@"
