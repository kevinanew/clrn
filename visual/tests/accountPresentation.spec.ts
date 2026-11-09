import { test, expect } from '../src/support/diagnosticTest';
import { buildScenarios } from '../scenarios';
import { accountPresentationRules } from '../cases/account/presentation';
import { applyContentStabilizers } from '../src/support/pageStabilizers';

test('账号池切换与异步重绘不会改变账号展示基准或真实会话', /** 验证账号池切换与异步重绘不会改变账号展示基准或真实会话。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page }) => {
  await page.route('https://account-presentation.invalid/', /** 提供空白本机页面，隔离账号展示稳定化测试。
 * @param route - 当前拦截的网络请求。 */ route => route.fulfill({body:'<html><body></body></html>',contentType:'text/html'}));
  await page.goto('https://account-presentation.invalid/');
  await page.evaluate(/** 注入展示测试所需的合成账号缓存。 */ ()=>localStorage.setItem('save.user.origin.data.from.server.key',JSON.stringify({user_id:'real-session-id',username:'clrnci26100901'})));
  const scenario=buildScenarios({VISUAL_SUITE:'app',VISUAL_LOCALES:'zh-Hans'}).find(/** 定位已登录个人中心场景，核对账号展示配置。
 * @param item - 当前遍历的条目。 */ item=>item.pageLabel==='signed_in_me')!;
  for (const title of ['用户名','用戶名','Username']) {
    await page.setContent(`<div data-testid="nickname-text">Testing User</div><div data-testid="username-text">${title}：clrnci26100901</div>`);
    await applyContentStabilizers(page,{...scenario,fixedTexts:await accountPresentationRules(page,scenario)});
    await expect(page.getByTestId('nickname-text')).toHaveText('Venom');
    await expect(page.getByTestId('username-text')).toHaveText(`${title}：laiwanvisual01`);
    await page.getByTestId('nickname-text').evaluate(/** 模拟 React 重绘昵称，验证稳定化规则会重新应用。
 * @param node - 当前遍历的 DOM 或语法节点。 */ node=>{node.textContent='Changed by React';});
    await expect(page.getByTestId('nickname-text')).toHaveText('Venom');
  }
  expect(await page.evaluate(/** 读取应用保存的用户信息，核对个人中心使用的展示资料。 */ ()=>JSON.parse(localStorage.getItem('save.user.origin.data.from.server.key')!))).toEqual({user_id:'real-session-id',username:'clrnci26100901'});
});

test('个人资料注册日期保留三语言文案，游客不应用账号规则', /** 验证个人资料注册日期保留三语言文案，游客不应用账号规则。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({page}) => {
  const scenario=buildScenarios({VISUAL_SUITE:'app',VISUAL_LOCALES:'zh-Hans'}).find(/** 定位已登录个人资料场景，核对资料页展示配置。
 * @param item - 当前遍历的条目。 */ item=>item.pageLabel==='signed_in_profile')!;
  for (const joined of ['在 2026-10-09 加入来玩','在 2026-10-09 加入來玩','Joined GoPlay360 on 2026-10-09.']) {
    await page.setContent(`<div data-testid="profile-item-0"><span data-testid="content-text-0">Testing User</span></div><div data-testid="profile-item-1"><span data-testid="content-text-1">clrnci26100901</span></div><div data-testid="profile-join-date">${joined}</div>`);
    await applyContentStabilizers(page,{...scenario,fixedTexts:await accountPresentationRules(page,scenario)});
    await expect(page.getByTestId('content-text-0')).toHaveText('Venom');
    await expect(page.getByTestId('content-text-1')).toHaveText('laiwanvisual01');
    await expect(page.getByTestId('profile-join-date')).toHaveText(joined.replace('2026-10-09','2026-07-18'));
  }
  expect(await accountPresentationRules(page,{...scenario,signIn:false})).toEqual([]);
  expect(await accountPresentationRules(page,{...scenario,pageLabel:'signed_in_hall'})).toEqual([]);
});
