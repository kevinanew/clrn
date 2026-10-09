import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { Script } from 'node:vm';
import { renderSnapshotGallery } from './snapshot-gallery-page';
import { displayPageName } from './snapshot-gallery-names';
import { pageKey, type GalleryPage } from './snapshot-gallery-model';

const manifest = JSON.parse(readFileSync(path.join(__dirname, 'gallery/manifest.json'), 'utf8'));
const pages: GalleryPage[] = manifest.pages;

function embeddedData(source: string): GalleryPage[] {
  return JSON.parse(source.match(/<script id="gallery-data" type="application\/json">([\s\S]*?)<\/script>/)![1]);
}

test('生成的独立 HTML 保留所有截图版本，默认说明折叠，内嵌脚本语法有效', () => {
  const source = renderSnapshotGallery(pages);
  assert.equal(embeddedData(source).length, pages.length);
  assert.ok(source.includes(`${new Set(pages.map(pageKey)).size} 个页面 · ${pages.length} 张截图 · ${new Set(pages.map(page => page.group)).size} 个模块`));
  assert.match(source, /<details id="gallery-about" class="about"><summary[^>]*>截图说明/);
  assert.match(source, /<details class="more-filters"><summary[^>]*>更多筛选/);
  assert.ok(!source.includes('class="pagination"'), '连续浏览无需翻页');
  assert.ok(!/<script[^>]+src=/.test(source), '直接打开不依赖外部脚本');
  for (const match of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (!match[0].includes('application/json')) assert.doesNotThrow(() => new Script(match[1]));
  }
});

test('同页的多语言、多设备、多分辨率计为一个页面，不合并登录状态或模块', () => {
  const base = pages[0];
  const variants: GalleryPage[] = [
    base,
    { ...base, locale: 'en' },
    { ...base, viewport: { label: 'mobile', width: 375, height: 812 } },
    { ...base, viewport: { label: 'mobile', width: 390, height: 844 } },
    { ...base, signedIn: !base.signedIn },
    { ...base, group: 'auth' },
  ];
  const source = renderSnapshotGallery(variants);
  assert.match(source, /3 个页面 · 6 张截图 · 2 个模块/);
  assert.match(source, /value="390x844">390 × 844/);
  assert.equal(embeddedData(source).length, 6);
});

test('页面名称可读，原始场景名保持不变且仍可搜索', () => {
  assert.equal(displayPageName('signed_in_texas_pre_game_chat'), '德州 · 开局前 · 聊天');
  assert.equal(displayPageName('login_forgot_password_email'), '登录 · 找回密码 · 邮箱');
  assert.equal(displayPageName('guest_private_room'), '游客 · 私人房');
  assert.equal(displayPageName('signed_in_game_records_v2_delete_confirm'), '我的战绩（新版） · 确认删除');
  for (const page of pages) {
    assert.ok(!/[a-z]{2,}/i.test(displayPageName(page.page).replace('Telegram', '')), page.page);
  }
  assert.equal(embeddedData(renderSnapshotGallery(pages))[0].page, pages[0].page);
});

test('场景文本无法终止内嵌数据脚本，特殊字符无损保存', () => {
  const value = '</script><script>throw new Error("unexpected")</script>&\"\'';
  const source = renderSnapshotGallery([{ ...pages[0], label: value, page: value, navigation: [value], file: value }]);
  assert.equal((source.match(/<script[\s>]/g) || []).length, 2);
  assert.equal(embeddedData(source)[0].label, value);
  assert.equal(embeddedData(source)[0].file, value);
});
