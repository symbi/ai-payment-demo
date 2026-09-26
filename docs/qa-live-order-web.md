# ETH25 当前订单主屏局部独立QA

2026-09-26 JST；QA窗口01a0d98f-4c49-7aa0-b8d9-4988f54198b3。**PASS，限默认页面实际观察+源码核对+已审fixture复用，无新增阻断发现。** 不代表完整API/签前控制/链上购买通过。

web23清单 `/private/tmp/intercepta-live-web-manifest.txt` SHA256 `215885eec3bd702a5f3c25667dee8d30dfd777443ea0e943c6713b1ea4c3ee8d`，QA前后23/23文件匹配、清单摘要一致。c882为交接基线，不是本候选提交。

## 本QA实际观察

独立Chrome39154942打开真实5178：默认Current order，报价/Recipient/Network均Awaiting quote，Evidence unavailable，Get quote first；只出现Get quote，没有可执行Check risk。签名/提交/结算均Unreported，无报告完成声明。说明清楚区分检查报价收款方与分析独立bundled Solidity样例。

Details初始折叠，Offline examples进一步折叠其中；展开后独立标记Synthetic evidence/EXAMPLE ORDER/Preview check，不作为当前订单响应。QA仅展开详情，没有点Get quote、Check risk或Preview check。

390×844主屏innerWidth=scrollWidth=390，标题/地址待定/来源/主动作可读，实际截图在本对话，未另存图片；控制台warn/error为空，视口恢复。未监听网络，不能把页面观察当成零请求抓包证据；初始health读取与无自动风险扫描是不同事实。

## 独立源码核对

- api.ts新增isExecution验证字段/nullable值/枚举/retryAllowed:false/完成约束；缺execution仍允许旧响应，界面显示Unreported，不推断未签未付。
- executionUnknown覆盖旧settlement_unknown及任一执行阶段unknown。主App保留executionSeen；曾有执行事实后缺execution不能清除不确定性。响应ID错配/解析失败/请求失败进入uncertain。
- LivePaymentCheck优先显示Unknown而非旧状态；查询失败即不再展示旧settled/完成状态。data仅显示收到数据且交付未验证；backend taskComplete/settled不被当作已验证报告。
- canCheck要求实际同ID报价、固定网络/币种/金额、付款禁用、未尝试且无execution；actionLock和recheckAttempted防双击/自动重复。页面初始仅refreshHealth，扫描入口为显式动作。此为源码证据，不是本轮实时HTTP观测。

复用B15新+19旧fixture交互/build、原独立reviewer28单测/typecheck（02交接）；本QA阅读相关测试断言确认覆盖legacy、三unknown、malformed、响应丢失、missing execution、失败清旧success、settled+public-sample非完成。没有重跑这些测试、没有注入页面状态，没有运行共享runtime的真实扫描或付款。

## 范围与交接

无新缺陷。正反例交互属于fixture/源码证据；本QA浏览器仅证明初始真实订单入口、空状态、来源折叠和390布局。待03安全候选精确提交后再按V1做统一版本路由signer正1/负0验收。本次不改变ETH27最终依赖或挑战完成度。

卡片对账操作此前被自动审批拒绝，未与本轮QA混为失败，也不重试绕过。仅新增本报告，不改产品/服务、不读秘密或03A隔离成果。
