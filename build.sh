#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "==> VZDNUR-CONTACT-API build started"

# Load .env without overriding values already provided by the shell.
if [ -f .env ]; then
  echo "==> Loading .env"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*)
        continue
        ;;
    esac

    if [[ "$line" != *=* ]]; then
      continue
    fi

    name="${line%%=*}"
    value="${line#*=}"

    if [[ ! "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      continue
    fi

    if [ -z "${!name+x}" ]; then
      export "$name=$value"
    fi
  done < .env
fi

if [ ! -f package.json ]; then
  echo "ERROR: package.json not found"
  exit 1
fi

echo "==> Installing dependencies"
npm install

echo "==> Cleaning old dist"
rm -rf dist

echo "==> Running TypeScript build"
npm run build

echo "==> Build finished"
du -sh dist
