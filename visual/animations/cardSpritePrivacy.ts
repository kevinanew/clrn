import { createHash } from 'node:crypto';

/**
 * 图集资源仅保留稳定逻辑指纹，不持久化任意路径、连接入口或查询参数。
 * @param value - 浏览器送来的资源路径。
 */
export function cardSpriteResource(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return 'asset-' + createHash('sha256').update(value.split(/[?#]/)[0]).digest('hex').slice(0, 16);
}
