# Web 图片比较统一规则

依据用户确认，在合并请求第 73 号中落实[第 67 号问题](https://github.com/kevinanew/clrn/issues/67)的
完整 Web 范围。[已合入的第 60 号合并请求](https://github.com/kevinanew/clrn/pull/60)
已经建立共用配置，本轮沿用该结构，将差异像素比例从 0.003 改为 **0.005（0.5%）**。
Android、iOS 和应用仓库不在本轮修改范围内。

## 各入口及颜色容差

| 实际入口 | 共用比例的来源 | 保留的单像素颜色容差 |
| --- | --- | --- |
| 应用、启动、俱乐部、战绩、德州及拼三张静态截图 | `playwright.config.ts` 的 `toHaveScreenshot` 配置 | Playwright 现有默认值 0.2 |
| 搜索提示等动画截图 | `animations/playwright.config.ts` | 0.1 |
| 普通、局部前景、排除背景、数字遮罩动画关键帧 | `animations/timeline.ts` 调用 `imageComparisonOptions` | 0.1 |
| WebP 素材每一帧 | `animations/imageFrames.ts` 调用 `imageComparisonOptions` | 0 |
| 动画各分支的相邻截图稳定性 | `animations/screenshotComparison.ts` | 0.1 |

所有比例都来自 `screenshotComparisonConfiguration.ts`，不能逐用例覆盖成不同的标准。
颜色容差判断一个像素是否不同；差异比例决定允许多少个这样的像素，两者分别保留。
静态截图的内部稳定性判断由 Playwright 使用同一截图配置执行。
动画不再在局部或遮罩分支要求 PNG 压缩字节完全相同。

## 有效面积与失败边界

- 完整图片使用实际宽度乘以高度作为有效面积。
- 局部前景使用原有顶部区域与弹层覆盖区域的面积之和。
- 定位器遮罩、数字遮罩和排除背景使用原遮罩区域的并集，从图片总面积中扣除；重叠部分只扣一次。
  保留原始遮罩、边界取整和区域存在／不遮挡主体的断言，不扩大或移动遮罩。
- 局部断言使用 `floor(有效面积 × 0.005)` 作为允许差异像素数。
  一万有效像素中五十个差异像素通过，五十一个失败；不能使用包含排除区域的整张图片面积放宽门槛。
- 尺寸不符、有效面积为空、缺少基准、资源失败和业务断言仍失败。
  帧数、时长、主体运动、不同动画帧和覆盖范围仍按原断言检查，不用差异比例代替这些断言。

## 验证与基准审查

`screenshotComparisonConfiguration.test.ts` 调用当前锁定 Playwright 版本中截图断言实际使用的
图片比较器，分别验证静态配置、动画配置、关键帧、素材帧和局部比较的五十／五十一像素边界，
并检查尺寸、排除区域并集与颜色容差。`animations/screenshotComparison.test.ts`
验证真实 pixelmatch 稳定性边界、PNG 重编码及尺寸变化。

`animations/timeline.browser.ts` 使用临时基准执行真实 Playwright 子进程，覆盖普通、局部前景、
排除背景、数字遮罩及普通定位器遮罩分支：容差内微差继续采样，超限仍失败，缺图与业务错误仍报告，
正式基准不被创建或修改。

本合并请求此前相对 master 没有 PNG 改动，本轮也不替换基准。
当前英语德州失败产物仍须逐图核对，再由新提交的完整自动测试验证新规则，
不能以旧失败结果或离线复算代替新提交的通过结果。
第 67 号问题在完整验证和合并前保持开放；第 70 号问题仍须完成全部网络夹具迁移验收。
