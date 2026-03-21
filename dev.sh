#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
  echo ""
  echo "[dev] Shutting down all services..."
  kill 0 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

# Backend
echo "[dev] Starting backend on :5001..."
(cd "$ROOT/backend-v2" && poetry run python app.py) 2>&1 | sed 's/^/[backend] /' &

# Frontend
echo "[dev] Starting frontend on :5173..."
(cd "$ROOT/frontend-v2" && npm run dev) 2>&1 | sed 's/^/[frontend] /' &

# Wait for services to start before tunneling
sleep 3

# ngrok tunnel for backend
echo "[dev] Starting ngrok tunnel for backend..."
ngrok http 5001 --log stdout 2>&1 | sed 's/^/[ngrok] /' &

# localhost.run tunnel for frontend (has QR code)
echo "[dev] Starting localhost.run tunnel for frontend..."
ssh -o StrictHostKeyChecking=no -R 80:localhost:5173 localhost.run 2>&1 | sed 's/^/[localhost.run] /' &

echo "[dev] All services started. Press Ctrl+C to stop."
wait
