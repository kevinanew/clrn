#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

lock_dir=".visual-reference.lock"

acquire_lock() {
  if mkdir "$lock_dir" 2>/dev/null; then
    return
  fi

  local lock_pid=""
  if [[ -f "$lock_dir/pid" ]]; then
    lock_pid="$(<"$lock_dir/pid")"
  fi

  if [[ "$lock_pid" =~ ^[0-9]+$ ]] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "已有 visual-reference 正在运行（PID: $lock_pid），禁止并发启动。" >&2
    exit 1
  fi

  echo "发现失效的 visual-reference 锁，正在恢复..." >&2
  rm -f "$lock_dir/pid"
  rmdir "$lock_dir"
  mkdir "$lock_dir"
}

cleanup() {
  rm -f "$lock_dir/pid"
  rmdir "$lock_dir" 2>/dev/null || true
}

acquire_lock
printf '%s\n' "$$" >"$lock_dir/pid"
trap cleanup EXIT

for locale in zh-Hans zh-Hant en; do
  docker compose run --rm \
    -e "VISUAL_LOCALES=$locale" \
    -e VISUAL_FILTER \
    -e VISUAL_SCOPE \
    -e VISUAL_REFERENCE_SHARDS \
    -e VISUAL_REFERENCE_START_SHARD \
    -e VISUAL_RETRIES=0 \
    -e VISUAL_WORKERS=1 \
    visual reference
done
