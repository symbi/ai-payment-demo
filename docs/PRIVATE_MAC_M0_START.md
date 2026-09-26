# 私人电脑现在从这里开始：GH-9

本文件是已发布首轮 Prompt 的补充交接。正式任务是 [GitHub #9](https://github.com/symbi/ai-payment-demo/issues/9)。私人主控可立即开始下述准备和字段资料核对，不用等公司 GH-8 的 QA；Symphony worker 只在配置核对完成后启动。业务基线固定为 `2320b665ffd95e8267e007c044462335c9f5ef6f`，配置包来自包含本文件的新文档提交，二者分别记录。

## 已完成的不要重做

按私人电脑回报：Symphony v0.0.3、Node 26.6.0 已就绪；固定业务版本的 432 项离线测试、类型检查和构建通过；已有字段核对草稿与 3 个未扫描候选。直接复用，不重装、不再跑完整测试、不重新收集大地址池。

## 本轮明确交接

- Owner：私人 Mac 主控；唯一执行卡 GH-9。公司 GH-8 和总目标卡不可领取。
- 工作目录：私人自选本地独立 pilot 目录中的 `workspaces/GH-9`。
- 唯一产物目录：`docs/private-validation/m0-20260927/`，内含 `REPORT.md`、`FIELD_MAP.md`、`observations.json`。
- 业务代码、核心、依赖、测试全部只读。单 worker，无子 Agent，单次 20 分钟，自动重试 0。
- 新增扫描最多 3 次、每候选一次，无新增费用。用户记忆中的约 1,000 请求不是已核实剩余额度。私人主控先核实额度；不明、收费提示或限流时停止扫描，继续字段资料核对并交付缺口。
- 契约仍未冻结，`contractRevision` 写 `unapproved-m0-proposal`；实际没有已发布策略版本时写未确定，不猜阈值。
- 编程 worker 不接收 API key。真实扫描仅私人主控按 `docs/PRIVATE_MAC_RISK_CHECK.md` 启动现有专用 scan-only 进程；将脱敏结果提供给 worker。没有结果时也可完成 FIELD_MAP 并停止待验收，不能无限等待。

## 复用随附配置，不另造调度器

1. 在现有仓库先记录未提交改动，再安全获取包含本文件的提交；不要覆盖工作树。将 `tools/symphony-private-m0/WORKFLOW.md` 和 `once.py` 复制到自选、未被 Git 跟踪的本机 pilot 目录。不要复制公司机器的配置、token 或状态。
2. 设置 `PRIVATE_SYMPHONY_HOME` 为这个目录的绝对路径。使用现有仓库创建独立 worktree：

   ```sh
   git worktree add --detach "$PRIVATE_SYMPHONY_HOME/workspaces/GH-9" 2320b665ffd95e8267e007c044462335c9f5ef6f
   ```

   保留已有依赖；如需现有 scanner，复用同版本依赖，不在本轮重新安装。将已准备且脱敏的草稿/结果放到任务唯一产物目录。不复制 `.env`。
3. 使用该机已有 ChatGPT 登录和实际 Codex 模型列表，选一个可调用的轻量模型用于字段整理。将实际模型写入 pilot 根目录的 `model.local.json`，结构为 `{"model":"实际可调用的模型ID","reasoning":"medium","verifiedOnThisMachine":true}`。尚未核对时不得写 true。无需再次付费买 API，也不自动升级套餐或回退模型。额度阻塞就留回执停止。
4. 确认 GitHub CLI 与 Symphony 使用私人账号的本机授权；不复制/打印 token。只监听 GH-9 的 `machine:private-validation` 与 `symphony-private-m0-ready-20260927` 两个标签。不得同时出现 company 标签。配置默认 disabled；就绪后仅将 `required_labels` 中的 `symphony-private-m0-disabled` 改为 `symphony-private-m0-ready-20260927`，不要全文替换或修改其他保护。
5. 在 GH-9 工作目录运行 `python3 "$PRIVATE_SYMPHONY_HOME/once.py" --check`。确认通过且没有旧 `state/attempt-GH-9`。随后为 Issue #9 添加 ready 标签，用现有 `symphony` 命令加载 pilot 中的 `WORKFLOW.md`（具体参数用该机 v0.0.3 的帮助核对，不重新安装）。面板只监听 `127.0.0.1`，不暴露公网。
6. 第一次看到 running 时核对 Issue=GH-9、工作目录、模型回执；不另跑一轮安装演示。若有授权/额度/配置阻塞，保存错误并停下，不绕过或删除启动锁。
7. 完成后 launcher 会禁用此工作流，after_run 移除 ready 并加待验收标签；私人主控确认 running/retrying 均为 0。若标签更新失败，手动移除 GH-9 ready 标签并刷新，保留本地证据。不要删除一次性 marker 重跑。

本配置沿用已有 Python 单次启动机制，使用 Symphony v0.0.3 的现有 GitHub 适配器。公司侧仅做本地静态/模拟验证，不能替代私人电脑实际启动验收；实际领取、模型与停止由该机记录。

## 回传什么

无需等待更多规划。先回传 GH-9 已开始、固定版本、实际模型及字段核对进展，最后给主控三份产物的脱敏摘要/缺口。现有 scanner 返回 HOLD 不能当成真实风险规则拦截证明；本轮没有真实购买验收。

仓库公开；完整扫描证据先留本机，未取得该批公开发布授权不提交或推送。GitHub 仅发当前 Issue 的简短脱敏进展。不得上传 key、请求头、签名、未授权个人地址、完整自由文本。主控和 QA/02 对照字段证据后再决定下一阶段。
