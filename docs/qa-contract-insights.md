# Contract Insights 局部独立QA

2026-09-26 JST。QA窗口：01a0d98f-4c49-7aa0-b8d9-4988f54198b3；模型未切换，实际型号/深度未另行核实。结果交02，02协调原作者修复及向用户交付。

## 结论与版本

**PASS：英文公开样例图表、本机新资源报价、02同次真实扫描的只读结果核对。** 无新增阻断缺陷。不是最终三案例/付款/安全放行验收，不代表用户接受。

- seller8 manifest：`/private/tmp/seller-insights-manifest.txt`，SHA256 `e54fde8873460c08a979276267e8b4b90b32941cd7d8f751f4834179c2aeeb55`。
- buyer/web/shared30 manifest：`/private/tmp/contract-buyer-web-manifest.txt`，SHA256 `989d4caa22301b09d498e2e0b1f4602c504f39c785822f569e6b12782c06aee7`。
- QA前后逐项8+30均匹配。未提交文件摘要，不是Git版本或完整依赖环境摘要。旧天气10a64的PASS不覆盖本版。

## 实际操作与证据

1. 独立Chrome页39154924打开5178：英文Contract Insights首页，Preview/Get quote；主要页面没有旧天气服务或中文标题。
2. 点击Preview：Sample · Structure only，ExampleVault.sol，横向柱图Functions4/Events2/Modifiers1，单位count，图长比例4:2:1。Source & method折叠详情明确非安全审计、未部署、非收款地址。
3. 本地卖方/前端public-sample.json逐字一致；人工核对ExampleVault.sol四函数、两event、一modifier，source SHA256 `1f9fb6a40a10aed8b91c0370e527b2e35e54ad8e0c56e2f448c2277a2fedd810`。真实GET seller `/api/contract-insights/sample`也返回同一hash和4/2/1，无declarations/源码。Sample是公开样例，不是已购报告或风险评分。
4. 临时390×844：Sample预览和报价页均innerWidth=scrollWidth=390；实际预览截图已显示于QA对话，未保存独立截图文件。恢复默认视口。Chrome本页warn/error为空。
5. 仅点击一次Get quote，不点击Check：QA请求 `1af92965-a5ac-4567-a1ed-2c5243d2931d`，0.001 test USDC、Base Sepolia、hold、Scan not requested、transport Not recorded、sign0/settle0、Buy禁用、No purchased report displayed。健康GET确认resourcePath `/api/contract-insights`、paymentEnabled=false、Key布尔Configured；不读取Key内容。
6. 02唯一操作的真实扫描请求 `224a7df3-c294-497b-865d-2e150cca9ca8`：QA仅GET `http://127.0.0.1:4031/api/requests/224a7df3-c294-497b-865d-2e150cca9ca8`，没有新扫描。实际结果：risk.source=live、provider=intercepta、transport=received、checkedAt=2026-09-25T17:57:27.589Z；risk.address与terms.payTo均为 `0xf01222d4B343e991353b87aeFb9f24CdB42f8868`；requestedNetwork与terms.network均eip155:84532。toxicScore=0、traitsCount=0，coverage/semantics均unverified，held/hold，paymentEnabled=false，sign0/settle0，9条事件。0与空traits未变成allow。

真实扫描UI的Scan received/Checked禁用由02在IAB观察，QA以同请求只读JSON独立核对，未伪造浏览器状态。02保存同次响应于 `/private/tmp/contract-insights-live-request.json`；QA本次证据为自己的GET输出。后台HTTP402来自事件记录；QA未另抓带认证头网络日志。

## 复用、限制、回写

复用B当前138测试/typecheck/build、19组隔离浏览器及原独立review PASS；复用A32测试及review PASS。错误/超时/并发去重、无自动重试、秘密边界由fixture/安全review支持，本QA未用额外真实API请求复测；只读响应和页面未见凭据，不将此等同于完整泄漏审计。未读取.env或Key、未改源码、未启动/停止服务、未付款、未安装。

扫描后页面390px未由QA亲测，已有B扫描页fixture和02真实IAB观察；QA实测390px仅公开预览与未扫描报价。未知/风险语义、主网/测试网覆盖、已知风险拒绝样例、真实签名/结算、付费报告交付、干净安装/私人电脑/Git/CI仍未由本轮证明。健康响应的通用风险说明不是请求级真实扫描结果，验收使用请求risk字段。

ETH27最终依赖/状态不变。首次回写前bootstrap遇到SERVICE_UNAVAILABLE；02通知服务可达后，已重新读取并确认没有本轮报告重复评论，按授权补同步，不重跑测试。
