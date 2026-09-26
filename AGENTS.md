# Agent Payment Demo 工作入口

本仓库用于 Sheng 的个人 Demo。先确认当前任务、代码版本、机器边界和已有 owner；保留未交接改动。普通单任务不要求启动 Symphony。

## 使用 Symphony 时

安排、恢复或验收 Symphony 多任务时，读取仓库随附的 [symphony-orchestration Skill](.agents/skills/symphony-orchestration/SKILL.md)。即使本机没有安装全局 Skill，也可以直接读取这份文件；不要求安装 Self Learning、Taskboard 或复制其他机器的 Memory、配置和凭据。

主控维护现有队列，在依赖满足且无文件争写时持续补位；Worker 只执行分配的任务，交付后停止。并发、模型、网络、领取范围和重试限制取自当前明确授权及实际加载的 Workflow，不从历史 Issue 或示例推断。观察面板的 Running 状态和发布状态需要分别核实。

Skill 与 Workflow 是不同层：本 Skill 不扩大现有启动权限，不把历史单任务配置改成多任务入口，也不替代当前代码任务的验证约定。任务交接与当前基线见 [HANDOFF](docs/HANDOFF.md)。

## 机器与交付边界

- 公司电脑只进行授权的离线开发和验证；不访问加密货币相关网站、OFAC、风险 API、RPC、钱包或支付网络，不通过另一机器代理绕过该边界。
- 私人 Mac 的操作先读 [PRIVATE_MAC_AGENT.md](PRIVATE_MAC_AGENT.md)，按本轮明确授权执行。机器可以联网不等于已获扫描、签名或付款授权。
- 不把合成案例、真实扫描、项目策略结果和真实付款混为一谈。保护真实扫描历史，不写入合成记录。
- commit、push、merge 等复用适用的明确授权；本文件不新增外部发布、自动合并、付费或资金动作权限。

## 维护调度 Skill

通用规则只维护在 `.agents/skills/symphony-orchestration/` 的版本化便携包；有本机全局副本时同步同版本内容。现有 `skill-upper` 可通过 `skill-up validate .agents/skills/symphony-orchestration/evals/eval.yaml` 和 `skill-up list-cases .agents/skills/symphony-orchestration/evals/eval.yaml` 直接发现评测，无需中央注册。

结构验证不等于行为验证。运行真实引擎评测前确认本机能力及适用授权；不因维护 Skill 搜索或输出凭据。这里只验证规则，不修改正在运行的调度器。
