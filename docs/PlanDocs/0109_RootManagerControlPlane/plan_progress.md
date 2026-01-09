# 0109 Root/Manager ControlPlane Plan - 执行进度

> Purpose: 记录本计划（`docs/PlanDocs/0109_RootManagerControlPlane/plan.md`）的执行日志与勾选状态。

## 总进度

- [ ] Phase 0：大清洗与新骨架（先解耦/删冗余/拆巨石；不引入新功能）
- [ ] Phase 1：功能回归（保证“现有全部能力”在新骨架上跑通）
- [ ] Phase 2：删除旧实现（只保留一套路径）+ 关键护栏落地（防止再变屎山）
- [ ] Phase 3：Root/Manager 形态重构（同一 app：`/root` + `/manager`，强制 code-splitting）
- [ ] Phase 4：ControlPlane v2（授权/转交/回溯/收回/终止；Server 仲裁可开关）
- [ ] Phase 5：分布式执行器 v2（授权 client 运行子图并可控他端）
- [ ] Phase 6：插件体系一致化（Tone / 多媒体 / Visual / AI 统一契约）
- [ ] Phase 7：多 Display 输出与输出路由（多屏、远程/本地通道统一）
- [ ] Phase 8：AI 接口与模型资产化（后台下载；未启用 0 计算开销；手机本地推理）
- [ ] Phase 9：工程化：测试、可观测性、性能预算（演出级稳定性）

---

## 执行日志

### 2026-01-09

- [ ] 初始化：设计冻结（待你确认关键决策点）
- [x] Phase 0 启动：新增依赖护栏脚本 `scripts/guard-deps.mjs`（阻止 deep-import；约束 protocol/node-core 依赖）。
- [x] Phase 0 验证：运行 `node scripts/guard-deps.mjs`（无违规）。
- [x] Phase 0 文档产出：新增 `docs/PlanDocs/0109_RootManagerControlPlane/phase0_artifacts.md`（依赖规则 v0 / 删除清单 v1 / 回归清单 v1）。
- [x] Phase 0 拆分：`packages/node-core/src/definitions.ts` 拆为 `packages/node-core/src/definitions/*` 模块，保留原有导出入口。
- [x] Phase 0 验证：运行 `pnpm --filter @shugu/node-core run lint`（仅 warnings：no-explicit-any / unused-vars，历史问题未处理）。
- [ ] Phase 0 进行中：拆巨石与 transport 抽象尚未开始（待你确认优先顺序与切分策略）。
