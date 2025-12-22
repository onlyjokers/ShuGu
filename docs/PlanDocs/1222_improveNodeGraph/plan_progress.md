# Node Graph Improvement Plan - 执行进度

## 执行时间线

### 2025-12-22

#### Step 0 — 基线、观测与安全网 ✅
#### Step 1 — 立即止血 ✅

#### Step 3 — Gate Cascade（CSS-like 权限）✅

**已完成:**
- [x] Gate 规则落地：`graphRunning` + `groupGateOpen` + `deploymentMode(local/remote)` 统一 compute/sink 行为
- [x] Stop 语义收敛：stop=无输出；新增 `onDisable` 撤销副作用（client-object 下发 stopSound/stopMedia/hideImage/flashlight off/screen reset）
- [x] group gate 关闭：stop/remove 相交的 deployed loop/patch，并清理 manager 侧 offload/highlight 状态
- [x] UI：GroupFramesOverlay 显示 Gate Open/Closed + reason；Node 增加 `stopped`/`deployedPatch` 样式；remote 节点不再展示 live values；LoopFramesOverlay 文案更清晰

**验证:**
- `pnpm lint` ✅（0 errors）
- `pnpm e2e:node-executor:offline` ✅

**涉及文件（核心）:**
- `packages/node-core/src/runtime.ts`
- `packages/node-core/src/types.ts`
- `packages/node-core/src/definitions.ts`
- `apps/manager/src/lib/nodes/engine.ts`
- `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`
- `apps/manager/src/lib/components/nodes/node-canvas/controllers/group-controller.ts`
- `apps/manager/src/lib/components/nodes/node-canvas/ui/overlays/GroupFramesOverlay.svelte`
- `apps/manager/src/lib/components/nodes/node-canvas/ui/overlays/LoopFramesOverlay.svelte`
- `apps/manager/src/lib/components/nodes/node-canvas/rete/ReteNode.svelte`
- `apps/manager/src/lib/components/nodes/node-canvas/ui/NodeCanvasLayout.svelte`
