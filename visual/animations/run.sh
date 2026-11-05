#!/usr/bin/env bash
# 运行动画回归检查。
set -euo pipefail

cd /repo/visual
ulimit -c 0 || true
pnpm install --frozen-lockfile
exec pnpm exec tsx animations/run.ts "$@"
