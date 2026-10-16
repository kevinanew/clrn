#!/usr/bin/env bash
set -euo pipefail

cd /repo/visual
ulimit -c 0 || true
pnpm install --frozen-lockfile
exec pnpm exec tsx animations/run.ts "$@"
