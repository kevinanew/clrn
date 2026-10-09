import type { LocaleCode, ScenarioGroup, ViewportDef } from './scenarioTypes';

export type GalleryPage = {
  label: string;
  page: string;
  group: ScenarioGroup;
  locale: LocaleCode;
  viewport: ViewportDef;
  signedIn: boolean;
  navigation: string[];
  file: string;
};

export const MODULE_NAMES: Record<ScenarioGroup, string> = {
  hall: '大厅', auth: '登录与认证', message: '消息', 'private-room': '私人房',
  'texas-holdem': '德州牌桌', zhajinhua: '拼三张牌桌', club: '俱乐部',
  account: '个人账号', wallet: '钱包与记录', 'game-record': '我的战绩', help: '帮助与下载',
};

export const LOCALE_NAMES: Record<string, string> = {
  'zh-Hans': '简体中文', 'zh-Hant': '繁体中文', en: 'English',
};

export function pageKey(page: GalleryPage): string {
  return JSON.stringify([page.group, page.page, page.signedIn]);
}

export function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, character => entities[character]);
}
