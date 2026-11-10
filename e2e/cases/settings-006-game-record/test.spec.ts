import { expect, test } from '../_shared/read-account-fixture';
import { unique } from '../_shared/page';
import { goBack } from '../_shared/navigation';
import { collectGameRecordDiagnostics } from './diagnostics';

test.beforeEach(/** 在业务操作前安装只读战绩诊断。
 * @param root0 - 当前用例的页面。
 * @param info - 本次设备与重试身份。
 */ async ({ page }, info) => {
  await collectGameRecordDiagnostics(page, info);
});

test('SETTINGS-006：我的战绩加载为空态并返回个人设置', /** 验证SETTINGS-006：我的战绩加载为空态并返回个人设置。
 * @param root0 - 当前调用提供的页面、账号或其他夹具。 */ async ({ page, signedInAccount }) => {
  await test.step('登录并从我的进入战绩', /** 执行登录并从我的进入战绩。 */ async () => {
    expect(signedInAccount.userId).toBeTruthy();
    await (await unique(page, 'settings-tab')).click();
    await expect(await unique(page, 'game-record')).toHaveText('我的战绩');
    await (await unique(page, 'game-record')).click();
  });
  await test.step('等待接口完成并确认无战绩', /** 执行等待接口完成并确认无战绩。 */ async () => {
    await expect(await unique(page, 'no-records-text')).toHaveText('还没有战绩，您可以下拉重新获取');
    await expect(page.getByTestId('progress-hud-activity-indicator')).not.toBeVisible();
  });
  await test.step('通过导航返回我的', /** 执行通过导航返回我的。 */ async () => {
    await goBack(page);
    await expect(await unique(page, 'game-record')).toHaveText('我的战绩');
  });
});
