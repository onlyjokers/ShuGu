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

### 2025-12-23

#### Step 3 — Gate Cascade（补充：Disabled Bypass / “节点等于导线”）✅

**已完成:**
- [x] group-disabled 节点直通：当 In/Out 类型一致且两侧都连线时，节点被 Deactivate 后等价于导线（`Out = In`）；`command/client` 不参与 bypass
- [x] Patch 导出一致性：patch-export 对可 bypass 的 disabled nodes 做 rewiring（移除节点并直接连接上下游），保证 client patch 与本地语义一致
- [x] UI：group-disabled + 可 bypass 节点在节点内部绘制一根线（In→Out）提示“直通”状态
- [x] UI：MIDI highlight 会穿透 bypass 直通节点，连线高亮不中断，且内部直通线同步高亮
- [x] 文档：plan.md 清理与渲染器迁移路线相关的描述，并补充 Disabled Bypass 规则与 UI 说明

**验证:**
- `pnpm --filter @shugu/node-core test` ✅
- `pnpm lint` ✅（0 errors）

**涉及文件（核心）:**
- `packages/node-core/src/runtime.ts`
- `apps/manager/src/lib/nodes/patch-export.ts`
- `apps/manager/src/lib/nodes/engine.ts`
- `apps/manager/src/lib/components/nodes/node-canvas/rete/ReteNode.svelte`
- `apps/manager/src/lib/components/nodes/node-canvas/rete/ReteControl.svelte`
- `packages/node-core/test/runtime.test.mjs`
- `docs/PlanDocs/1222_improveNodeGraph/plan.md`

#### Step 4 — Loop/Client 数据流收敛（避免重复与误导）✅

**已完成:**
- [x] Manager：loop/patch remote 执行时不再 compute（`offloadedNodeIds`/`offloadedPatchNodeIds` → `isComputeEnabled=false`），并停止 sinks
- [x] Client：node-executor 仅回传最小 status events（deployed/started/stopped/removed/rejected/error + watchdog），不做每 tick 回传
- [x] UI：LoopFramesOverlay 展示 Remote running/stopped + lastEvent + error；remote nodes 不展示 live values
- [x] Override：remote loop/patch 仍支持 override-set（含 TTL）；group gate 关闭/Graph stop 时 stop+remove remote 执行并清理 overrides

**验证:**
- `pnpm --filter ./apps/manager lint` ✅（0 errors）
- `pnpm e2e:node-executor:offline` ✅

**涉及文件（核心）:**
- `apps/manager/src/lib/nodes/engine.ts`
- `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`
- `apps/manager/src/lib/components/nodes/node-canvas/controllers/loop-controller.ts`
- `apps/manager/src/lib/components/nodes/node-canvas/controllers/loop-helpers.ts`
- `apps/manager/src/lib/components/nodes/node-canvas/ui/overlays/LoopFramesOverlay.svelte`
- `packages/sdk-client/src/node-executor.ts`

#### Step 5 — 节点注册体系：node-core SOT + JSON overlay ✅

**已完成:**
- [x] node-core 作为运行时 SOT：Manager 启动时先 `registerDefaultNodeDefinitions(nodeRegistry, ...)` 注册 core definitions
- [x] JSON specs 变为 UI overlay：对已存在于 registry 的 core type，不再跳过，而是合并 label/category + ports/configSchema 的 label/min/max/step
- [x] 兼容旧 JSON：仅当 core registry 不存在该 type 时，才使用 JSON 的 `runtime.kind` 作为 manager-only 节点来源（缺字段会 warn 并跳过）
- [x] 工具：新增 `pnpm validate:node-specs` 扫描 JSON overlay 冲突（端口/key 不存在、type 不匹配、min/max 冲突、core 类型仍含 runtime 等）
- [x] 文档：更新 specs README，说明 JSON overlay / manager-only 的边界与校验方式

**验证:**
- `pnpm --filter ./apps/manager lint` ✅（0 errors）
- `pnpm validate:node-specs` ✅（0 errors, warnings only）

**涉及文件（核心）:**
- `apps/manager/src/lib/nodes/specs/register.ts`
- `apps/manager/src/lib/nodes/specs/README.md`
- `scripts/validate-node-specs.mjs`
- `package.json`
- `docs/PlanDocs/1222_improveNodeGraph/plan.md`

#### Step 6 — MIDI 批量下发（同 tick 合并，减少 server 压力）✅

**已完成:**
- [x] Batch 协议：新增 `ControlBatchPayload(kind='control-batch')` 与 `ControlBatchItem`，仍走 `ControlAction: 'custom'`（不新增 message type）。
- [x] Manager 聚合：`sdk-manager` 在同一 tick 内对同一 target 的多次 `sendControl(...)` 自动聚合；flush 时仅发送 1 条 control（多条→`custom` batch，单条保持原 action）。
- [x] Client 执行：Client 侧 `executeControl` 支持 `custom` batch，展开 items 并按 `item.executeAt ?? batch.executeAt ?? message.executeAt` 执行。

**验证:**
- `pnpm --filter @shugu/protocol build` ✅
- `pnpm --filter @shugu/sdk-manager build` ✅
- `pnpm --filter @shugu/sdk-manager lint` ✅（0 errors）
- `pnpm --filter @shugu/client lint` ✅（0 errors）
- `pnpm --filter @shugu/manager lint` ✅（0 errors）

**手动回归:**
- Manager 开启 MIDI，同时按两键/推两路 MIDI 到同一个 client-object：server 侧应只看到 1 条 `control(action='custom', payload.kind='control-batch')`，client 侧变化更同步。

**涉及文件（核心）:**
- `packages/protocol/src/types.ts`
- `packages/sdk-manager/src/manager-sdk.ts`
- `apps/client/src/lib/stores/client.ts`
- `docs/PlanDocs/1222_improveNodeGraph/plan.md`
