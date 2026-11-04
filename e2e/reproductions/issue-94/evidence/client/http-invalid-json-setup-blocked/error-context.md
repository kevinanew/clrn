# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: http-buy-in.scenario.ts >> 私人桌 HTTP 带入 invalid-json 应正确提示并可恢复
- Location: e2e/reproductions/issue-94/http-buy-in.scenario.ts:25:7

# Error details

```
Error: 设置创建账号钻石失败：method=POST operation=set-creation-diamonds source=laiwan_prd status=unavailable response=not-received reason=timeout
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e24]:
    - generic [ref=e28]:
      - generic [ref=e34] [cursor=pointer]: Lv 1
      - generic [ref=e39] [cursor=pointer]: 搜索
    - generic [ref=e41]:
      - generic [ref=e49]:
        - generic [ref=e52]:
          - generic [ref=e53] [cursor=pointer]:
            - generic:
              - generic: 消息通知
          - generic [ref=e54] [cursor=pointer]:
            - generic:
              - generic: 商店
          - generic [ref=e55] [cursor=pointer]:
            - generic:
              - generic: 邀请朋友
          - generic [ref=e56] [cursor=pointer]:
            - generic:
              - generic: 每日奖励
        - button "免费抽奖" [ref=e60] [cursor=pointer]:
          - generic:
            - generic:
              - generic:
                - generic: 50 / 50
              - generic:
                - generic:
                  - generic:
                    - generic: 已满
        - generic [ref=e63]:
          - button "创建私人房间" [ref=e64] [cursor=pointer]:
            - generic:
              - generic:
                - generic:
                  - generic: 创建私人房间
          - button "加入私人房间" [ref=e65] [cursor=pointer]:
            - generic:
              - generic:
                - generic:
                  - generic: 加入私人房间
        - generic [ref=e68]:
          - generic [ref=e69]:
            - generic [ref=e75]: 德州扑克
            - generic [ref=e80] [cursor=pointer]: 快速开始
          - generic [ref=e83]:
            - generic [ref=e85] [cursor=pointer]:
              - generic [ref=e91]: 1/2
              - generic [ref=e95]: "100"
            - generic [ref=e97] [cursor=pointer]:
              - generic [ref=e103]: 5/10
              - generic [ref=e107]: "1000"
            - generic [ref=e109] [cursor=pointer]:
              - generic [ref=e115]: 25/50
              - generic [ref=e119]: "5000"
            - generic [ref=e121] [cursor=pointer]:
              - generic [ref=e127]: 50/100
              - generic [ref=e131]: "70000"
        - generic [ref=e134]:
          - generic [ref=e135]:
            - generic [ref=e141]: 拼三张
            - generic [ref=e146] [cursor=pointer]: 快速开始
          - generic [ref=e149]:
            - generic [ref=e151] [cursor=pointer]:
              - generic [ref=e157]: "1"
              - generic [ref=e161]: "200"
            - generic [ref=e163] [cursor=pointer]:
              - generic [ref=e169]: "5"
              - generic [ref=e173]: "1000"
            - generic [ref=e175] [cursor=pointer]:
              - generic [ref=e181]: "20"
              - generic [ref=e185]: "5000"
            - generic [ref=e187] [cursor=pointer]:
              - generic [ref=e193]: "100"
              - generic [ref=e197]: "50000"
        - generic [ref=e199]:
          - generic [ref=e201]: 我的俱乐部牌局
          - generic [ref=e203]:
            - generic [ref=e204]: 没有牌局!
            - generic [ref=e205]:
              - generic [ref=e210] [cursor=pointer]: 创建俱乐部
              - generic [ref=e215] [cursor=pointer]: 搜索俱乐部
      - tablist [ref=e217]:
        - tab "消息" [ref=e219] [cursor=pointer]:
          - generic [ref=e227]: 消息
        - tab "私人房间" [ref=e229] [cursor=pointer]:
          - generic [ref=e237]: 私人房间
        - tab [active] [selected] [ref=e239] [cursor=pointer]
        - tab "俱乐部" [ref=e248] [cursor=pointer]:
          - generic [ref=e256]: 俱乐部
        - tab "我的" [ref=e258] [cursor=pointer]:
          - generic [ref=e268]: 我的
  - generic:
    - iframe
```

# Test source

```ts
  1  | /** 在读取响应的边界丢弃不可信诊断；实际 HTTP 状态在读取正文之前取得。 */
  2  | import type { APIResponse } from '@playwright/test';
  3  | import { requestFailure, requestErrorSummary } from './requestError';
  4  |
  5  | type JsonResponse = Pick<APIResponse, 'ok' | 'status' | 'json'>;
  6  |
  7  | /**
  8  |  * 读取 HTTP 和业务均成功的 JSON，保留错误阶段与实际响应状态。
  9  |  * @param response - 已收到的真实响应。
  10 |  * @param operation - 代码固定的逻辑操作。
  11 |  */
  12 | export async function readRequestJson(response: JsonResponse, operation: string) {
  13 |   const status = response.status();
  14 |   if (!response.ok()) throw requestFailure(operation, 'http-error', status);
  15 |   let body;
  16 |   try { body = await response.json(); }
  17 |   catch (error) {
  18 |     throw requestFailure(operation, error instanceof SyntaxError ? 'invalid-json' : 'body-read-failed', status);
  19 |   }
  20 |   if (body?.ok !== true) throw requestFailure(operation, 'business-rejected', status);
  21 |   return body;
  22 | }
  23 |
  24 | /**
  25 |  * 包装 Node fetch 的网络与响应解析出口，不携带底层错误或后端正文。
  26 |  * @param url - 仅用于实际请求的连接地址。
  27 |  * @param options - 原有请求配置、认证头和超时。
  28 |  * @param operation - 代码固定的逻辑操作。
  29 |  */
  30 | export async function fetchRequestJson(url: string, options: RequestInit, operation: string) {
  31 |   const response = await fetch(url, options).catch(error => {
> 32 |     throw new Error(requestErrorSummary(error, operation));
     |           ^ Error: 设置创建账号钻石失败：method=POST operation=set-creation-diamonds source=laiwan_prd status=unavailable response=not-received reason=timeout
  33 |   });
  34 |   const body = await readRequestJson({ status: /** 读取真实状态。 */ () => response.status, ok: /** 读取真实 HTTP 结果。 */ () => response.ok,
  35 |     json: /** 读取真实响应正文。 */ () => response.json() }, operation);
  36 |   return { body, status: response.status };
  37 | }
  38 |
```
