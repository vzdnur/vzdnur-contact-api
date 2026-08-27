#!/usr/bin/env bash
set -euo pipefail

SERVER="jrnas@srv.mehic.at"
REMOTE_DIR="/home/jrnas/vzdnur-contact-api"

cd "$(dirname "$0")"

if [ ! -d dist ]; then
  echo "dist folder missing. Run ./build.sh first."
  exit 1
fi

echo "==> Deploying to $SERVER:$REMOTE_DIR"

rsync -avz --delete \
  --exclude node_modules \
  --exclude .env \
  --exclude .git \
  ./ "$SERVER:$REMOTE_DIR/"

echo "==> Restarting container"
ssh "$SERVER" "cd $REMOTE_DIR && docker compose up -d --build"

echo "==> Deployment finished"
