# ETH25 简化Intercepta主屏局部QA

2026-09-26 JST；独立QA窗口01a0d98f-4c49-7aa0-b8d9-4988f54198b3。**PASS，限定离线展示切片；无新增阻断发现。** 不代表真实扫描、付款或挑战验收达标。

冻结web22：`/private/tmp/intercepta-check-web-manifest.txt`，SHA256 `1be2dce241dd301658b079583a8457dc0a0826bc264fa32d4def5edb4834da09`。QA前后22/22文件匹配且清单摘要一致。基线40e822为02交接信息，本QA未另核Git提交。

## 独立实际浏览器验证

真实5178主屏、独立Chrome39154938，使用产品内明确标注的离线预设；没有注入响应或调用真实Check接口。

1. 默认单个Contract Report订单，无01/02/03步骤和主导航；持续可见Offline example · Synthetic evidence、EXAMPLE ORDER、Example recipient、No API call。
2. 默认Check risk→Block；签名Not signed、付款Not paid，Decision only · No payment。
3. 切Example: unavailable→旧Block清空为Not checked；点击才显示Pause。
4. 切Example: continue→旧Pause清空；点击显示Continue，同时明确No real authorization、Decision only · No payment。没有付款操作。
5. 展开Details：Full recipient与Intercepta target均为示例地址0x1111111111111111111111111111111111111111；主卡有短地址，详情可核对完整目标。Call status Not called、toxicScore/traits Not simulated、coverage Not asserted。未把示例当实时结果。
6. 390×844下Continue及展开详情文档innerWidth=scrollWidth=390；截图实际显示主卡、地址、按钮及决定边界可读，无横溢。截图位于QA对话，未持久化独立图片。恢复默认视口。
7. 切Existing request：Current request · No data，Not available/Not recorded，Check risk禁用，No existing order in this session，签付No record。没有保留离线Continue或伪造当前请求。控制台warn/error为空。

## 源码、复用证据与限制

- 独立阅读PaymentCheck.tsx：Check risk仅setReviewed；切换视图清旧决定；组件没有API调用，主卡/详情均取同一显示模型。主App初始useEffect仍有健康请求，因此“不发扫描”不应被扩大为“页面完全无网络”。
- 独立阅读payment-check.ts：current分支只有Block/Pause，不因toxicScore0或backend allow显示Continue；uncertain或settlement_unknown使signature/payment均Unconfirmed。示例分支固定为合成数据，不生成PurchaseResult或付款输入。
- 上述真实零分/未知分支本轮没有构造新运行请求或注入UI，属于源码核对及复用已有8模型测试、13交互/作者typecheck/build与原reviewer独立8测试/typecheck PASS，不能称本轮真实浏览器覆盖。
- 本QA未开启网络监听/抓包；不能独立宣称测得0条扫描网络请求。无扫描副作用结论依据操作限定、本地处理源码及既有隔离测试，浏览器直接证据仅页面状态/控制台。没有读取.env/秘密、签名/付款、共享runtime操作或后台全套重跑。

报告已保存后停止全部项目文件写入，无在途写命令；QA未改产品源码。结果供02交付，历史完成度/最终依赖/用户接受不由本报告改变。实际模型/深度未独立核实，未主动切换。
