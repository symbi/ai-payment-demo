# Private Mac risk-check follow-up (payment off)

Status: **live check not run**. The private scan-only UI has local injected tests; this is not a live API or payment result. The provider's actual response schema, address/network coverage, score meaning, and compatibility remain unverified until this check is performed on the private Mac.

## Safety boundary

- Use only the existing `createInterceptaScanner` export in `apps/buyer/src/intercepta.ts`. It performs one bounded quick-scan request and always returns `decision: hold`.
- Do not start the buyer/seller service or any route that can reach payment code. Keep `ENABLE_TESTNET_PAYMENTS` absent or `false`; do not load a wallet or signing credential.
- Keep `INTERCEPTA_API_KEY` only in the private Mac's local environment. Do not paste it into a command, issue, report, screenshot, chat, or upload `.env`.
- Scan only an address that the operator is authorized to check. Confirm the intended network separately; the current request passes a requested-network label, but provider network coverage is unverified.

## 私人电脑地址评估页面（本轮新增）

这是同一 Demo 的地址评估入口，已加入任务许可与预算设置的持久保存；报告购买、预算扣减和付款执行仍未接通。按需求 v2.1，显示 **Intercepta 原始值＋我们的判断及理由**，不另算综合分，不使用权重、档位或 confidence。候选沿用 `INTERCEPTA_TEST_ADDRESS_CANDIDATES.md` 的7个地址；来源线索不是当前风险结论。

仅在私人电脑执行。公司电脑不能启动本节服务或扫描。此入口不启动 buyer/seller、不签名、不付款。

1. 使用经主控交付且已验收的集成版本，安装已有锁文件依赖，不从旧版拼接单个文件。`npm run private:risk:build` 仅生成页面，不扫描。
2. 私人操作者先核实免费额度和本轮实际已发请求数。**GH-9、旧 CLI 与这个页面共用本轮最多3次预算，不是各3次。** 如果此前已经发起任何一次请求或次数无法核实，先回报主控核对记录，暂不启用这个新计数库。ChatGPT 的使用额度不代表风险 API 额度。
3. API key 只留在私人本地环境；页面没有输入密钥的位置。核实本轮此前确实0次且无新增费用后，设置公开控制项：

   ```sh
   export PRIVATE_RISK_MACHINE=personal
   export PRIVATE_RISK_FREE_QUOTA_CONFIRMED=true
   export PRIVATE_RISK_PRIOR_REQUESTS=0
   npm run private:risk
   ```

4. 私人电脑浏览器打开 `http://127.0.0.1:47915/`，选择地址，手动点击“扫描这个真实地址”。打开页面、切换地址、查询记录均不会调用供应商；一个有效扫描点击至多一次调用，失败也消耗一次，每个候选最多一次。
5. 持久记录在 `.runtime/private-risk/scan-journal.json`，不要删除、替换或换目录来重置额度。原操作 pending、文件损坏、锁被占用时停止新扫描。超时后只查已有记录，不重试；不同时运行 CLI 或另一份扫描服务。
6. 看原始 toxicScore、从 traits 提取的标签和数量、本地接收时间、我们的检查说明。当前字段语义和覆盖尚未确认，因此判断保持 HOLD；**不能把“扫描模式不付款”声称为真实风险拦截。** 原始0不等于安全，不假定百分制。历史记录不是重新实时扫描。

保留本机原始证据；向主控只交脱敏字段/类型、来源依据、实际请求次数及未知项，不上传密钥或供应商自由文本。确认字段解释和覆盖后，由现有核心负责人接入有依据的规则，再验收真实决定影响付款。

## 历史单次 CLI（不与本轮页面并用）

下面保留原检查方式作历史参考；它不维护上述页面的次数账本。本轮页面启用后不要同时运行，以免重复消耗共同预算。

### One-shot scanner invocation

From the repository root, after `INTERCEPTA_API_KEY` is already present in the local shell environment, set only the public candidate address and requested network, then invoke the existing scanner directly:

```sh
INTERCEPTA_CHECK_ADDRESS=0x... INTERCEPTA_CHECK_NETWORK=eip155:84532 \
node --import tsx --input-type=module -e '
  import { createInterceptaScanner } from "./apps/buyer/src/intercepta.ts";
  const address = process.env.INTERCEPTA_CHECK_ADDRESS;
  const network = process.env.INTERCEPTA_CHECK_NETWORK;
  if (!address || !network) throw new Error("public address/network missing");
  const result = await createInterceptaScanner(process.env.INTERCEPTA_API_KEY)(address, network);
  console.log(JSON.stringify({
    address: result.address, checkedAt: result.checkedAt, source: result.source,
    decision: result.decision, reasons: result.reasons, scan: result.scan
  }, null, 2));
'
```

This calls the risk provider once. It does not start an app, sign, submit, settle, or retry a payment. Stop if the result is unavailable or the schema is rejected; do not loosen validation to make an unknown response pass.

## Evidence to retain locally

For each authorized candidate, record the address, requested network, UTC timestamp, success/failure, HTTP/schema compatibility outcome, raw `toxicScore`, bounded `traitsCount`, up to 20 allowlisted `traitLabels`, and the project decision (`hold`). If more than 20 validated traits are present, record that displayed labels were truncated and are not the full list.

Keep the sanitized result and the provider response shape locally for comparison, without the API key or unrelated response fields. Verify the actual field names/types, network/address coverage, timestamp/freshness behavior, and score/trait semantics before changing any project decision. A score of zero is not proof of safety, and no result from this check authorizes a funds action.
