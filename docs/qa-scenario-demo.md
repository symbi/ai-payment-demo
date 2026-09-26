# ETH46 Scenario 局部独立QA

2026-09-26 JST；QA窗口01a0d98f-4c49-7aa0-b8d9-4988f54198b3，报告交02。**PASS，本地规则/示例场景，无阻断发现。** 不代表真实AI、商家接入、采购、许可核验或03完成。

web17 manifest `/private/tmp/scenario-web-manifest.txt`，SHA256 `24e82625313662dd76045568b02168bf586f1a3de8166ee19d4eeecf758f013f`，QA前后17/17匹配且清单摘要相同。不是新Git提交证明。

## 实际浏览器检查

使用独立Chrome39154936、现有5178，未改服务/配置/源码。

1. Services只查看，未点Get quote/Check；进入Scenario demo。三家商家/价格明确为examples，demo credits与真实服务test USDC区分，显示Rule-based、No live search or AI call。
2. 默认outline、3credits、SVG/Commercial选中：Lucent4/4、Open Shapes3/4、Prism2/4。Review selection显示Conditions match；Preview draft显示outline图标，Bundled sample · Not purchased，明确不是商家下载或已完成购买。Integration Not connected、Purchase Not completed、License Unverified。
3. 将Style改Solid、Budget改0：旧Review变Not reviewed；原选Lucent显示风格不符和超预算。免费Open Shapes标Rule match、4/4。选它后草稿切solid，Review后Conditions match，理由含SVG、商业声明未核实、预算内。不暗示付费更好。
4. 已review后改选Prism：立即Not reviewed；草稿随选项变duotone。Style改Duotone、Budget改3、保持Editable SVG：Prism3/4，明确SVG not listed，No seller meets every condition；Review显示Needs a different option。未把不匹配变成获准购买。
5. 390×844，文档innerWidth=scrollWidth=390；实际观察solid落地页草稿截图，标题/图标/边界标注可读无横溢。截图在本对话展示，未保存独立图片文件。控制台warn/error为空。恢复默认视口并返回Services，原报告商品入口仍可见，未操作真实扫描。

## 无API证据与复用边界

本QA未做网络抓包，因此不把浏览器观察称为独立测得0条网络请求。源码检查：ScenarioDemo仅导入React、本地规则及CSS，动作仅更新本地state，图标为bundled SVG；规则模块为静态示例和纯条件匹配。作者12组隔离交互中的Scenario零API断言/旧请求保留、5规则tests/typecheck/build及原Astra/xhigh Review PASS从工作日志复用，没有重跑。初始App健康请求与Scenario动作零API是不同范围。

未运行170/后台/真实API测试，未签名/交易/采购。许可只是示例商家声明，草稿不是商家资源交付；风险图功能也不在本次验收。QA实际模型/深度未独立核实，未主动切换。

本报告保存后QA可暂停文档写入供M delta commit；没有新增源码修改。ETH27保留最终依赖与状态。
