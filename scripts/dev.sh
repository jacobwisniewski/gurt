#!/bin/bash
# Development environment helper script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

show_help() {
  echo "Gurt Development Environment Helper"
  echo ""
  echo "Usage: $0 [command]"
  echo ""
  echo "Commands:"
  echo "  up           Start PostgreSQL service"
  echo "  down         Stop all services"
  echo "  migrate      Run database migrations"
  echo "  logs         Show service logs"
  echo "  reset        Stop services and remove volumes"
  echo "  tools        Start adminer (database UI)"
  echo "  status       Show running services"
  echo "  dev          Start services + run the bot"
  echo ""
  echo "Examples:"
  echo "  $0 up              # Start infrastructure"
  echo "  $0 migrate         # Run migrations"
  echo "  $0 dev             # Start everything and run the bot"
  echo "  $0 down            # Stop everything"
}

start_services() {
  echo "Starting infrastructure services..."
  docker-compose up -d postgres
  
  echo "Waiting for services to be healthy..."
  docker-compose exec -T postgres pg_isready -U gurt > /dev/null 2>&1 || sleep 5
  
  echo "✓ Services are ready!"
  echo "  PostgreSQL: localhost:5432 (user: gurt, password: gurt, db: gurt)"
}

stop_services() {
  echo "Stopping services..."
  docker-compose down
}

run_migrations() {
  echo "Running database migrations..."
  
  # Check if .env exists
  if [ ! -f .env ]; then
    echo "Creating .env from .env.docker..."
    cp .env.docker .env
  fi
  
  # Source the .env file for the migration script
  set -a
  source .env
  set +a
  
  npm run db:migrate
}

show_logs() {
  docker-compose logs -f
}

reset_all() {
  echo "This will stop all services and DELETE all data!"
  read -p "Are you sure? (y/N) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    docker-compose down -v
    echo "✓ All services stopped and volumes removed"
  else
    echo "Cancelled"
  fi
}

start_tools() {
  echo "Starting adminer (database UI) on http://localhost:8080"
  docker-compose --profile tools up -d adminer
  echo "Connect with:"
  echo "  System: PostgreSQL"
  echo "  Server: postgres"
  echo "  Username: gurt"
  echo "  Password: gurt"
  echo "  Database: gurt"
}

show_status() {
  docker-compose ps
}

dev_mode() {
  start_services
  
  if [ ! -f .env ]; then
    echo "Creating .env from .env.docker..."
    cp .env.docker .env
    echo "⚠️  Please edit .env and add your Slack/AWS credentials!"
    exit 1
  fi
  
  # Check if migrations have been run
  echo "Checking database..."
  set -a
  source .env
  set +a
  
  npm run db:migrate 2>/dev/null || echo "⚠️  Migrations may have already been run"
  
  echo ""
  echo "Starting development server..."
  npm run dev
}

case "${1:-}" in
  up)
    start_services
    ;;
  down)
    stop_services
    ;;
  migrate)
    run_migrations
    ;;
  logs)
    show_logs
    ;;
  reset)
    reset_all
    ;;
  tools)
    start_tools
    ;;
  status)
    show_status
    ;;
  dev)
    dev_mode
    ;;
  help|--help|-h)
    show_help
    ;;
  *)
    show_help
    exit 1
    ;;
esac
