<!--
Purpose: Node Graph（Rete）性能改造计划的执行进度跟踪（与 plan.md 对齐）。
Updated: 2025-12-22
-->

# Node Graph（Rete）性能改造 - 执行进度

## 变更记录

- 2025-12-22：计划收敛为“只做 Rete 性能优化，不换技术栈”；移除所有“引入新渲染器/切换渲染器”的相关内容。

## 执行时间线

### 2025-12-22

#### Step 0 — 基线、观测与安全网 ✅
#### Step 1 — 立即止血 ✅
#### Step 2 — 主线优化（Rete 扩容） 🔄

**已完成：**
- [x] Step 2.1：View Adapter 抽象（为后续 edges 单层化/裁剪做铺垫）

**待完成：**
- [ ] Step 2.2：Edges 单层化（单 SVG 或 Canvas2D）
- [ ] Step 2.3：可见裁剪（viewport culling / virtualization）
- [ ] Step 2.4：高频更新合并与降频（rAF batching）
- [ ] Step 2.5：量化验收与回归（fixtures 20/60/100）

#### Step 3 — WebGPU/Canvas 增强（兜底） ⏳

---

## 关键产物（已落地）

- `apps/manager/src/lib/features/node-graph-flags.ts`：`ng_shadows/ng_live/ng_perf`（含 localStorage 持久化）
- `apps/manager/src/lib/components/nodes/node-canvas/ui/PerformanceDebugOverlay.svelte`：性能面板（右下角）
- `apps/manager/src/lib/components/nodes/node-canvas/rete/ReteConnection.svelte`：默认无阴影 + 单条 edge SVG bbox 收敛
