#!/usr/bin/env bash
set -euo pipefail

cd /repo/visual

# Chromium 被宿主机杀掉时不要在挂载的工作区写入数百 MB 的 ELF core dump。
ulimit -c 0 || true

if [[ ! -x node_modules/.bin/tsx || ! -x node_modules/.bin/playwright ]]; then
  echo "正在安装视觉回归依赖（首次或依赖有更新）..."
  pnpm install --frozen-lockfile
fi

export VISUAL_SKIP_VISUAL_INSTALL=true
exec pnpm exec tsx run-visual.ts "$@"
