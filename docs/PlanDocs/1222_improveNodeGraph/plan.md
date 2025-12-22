<!--
Purpose: Node Graph（Rete）性能改造计划（不换技术栈；保持现有功能与外观尽量不变；允许去掉连线阴影）。
Owner: ShuGu / Manager Node Graph
Created: 2025-12-21
Updated: 2025-12-22
Status: In Progress
-->

# Node Graph（Rete）性能改造计划

目标：解决你反馈的 **>20 节点无论 start/stop 都卡** 的问题，并把 Manager Node Graph 的交互性能推进到可承载更大规模节点系统。

明确约束：**不再引入/切换到任何新渲染器或新技术栈**（继续使用现有 **Rete + Svelte** 的 NodeCanvas）。

## 范围说明（本计划只做性能主线）

本计划**只聚焦 UI/渲染/交互性能**（Manager NodeCanvas），包括：

- edges 渲染成本（SVG 合成、阴影、数量级）
- nodes/edges 的可见裁剪（viewport culling / virtualization）
- 高频交互更新合并（rAF batching）
- live values / overlays 的降频（减少无意义的重渲染）

不在本计划范围（另起文档/另排期）：

- 权责/权限（Gate cascade）、Loop/Client 数据流收敛
- MIDI 批量下发、节点注册体系（node-core + JSON overlay）

---

# 0. 强约束（必须满足）

## 0.1 不影响现有功能（回归零容忍）

任何性能改动都不得破坏以下能力：

- 节点：新增/删除/拖拽/多选/框选（marquee）/复制粘贴/导入导出
- 连线：连线创建/替换/断开、端口类型兼容校验、sink 多连线
- 组：创建 group、子 group、拖拽 frame、改名、disassemble、开启/关闭 group
- loop：检测/高亮、Deploy/Stop/Remove、logs 面板
- patch：以 `audio-out` root 的 deploy/stop/remove
- MIDI：learn、midi-fuzzy/midi-boolean/midi-map 等节点输出、MIDI 高亮链路
- override：旋钮调参实时生效（TTL + commit）、部署后仍可调参
- 外观：节点外观/布局/样式尽量保持（你允许“去掉连线阴影”这一项变化）

## 0.2 允许的视觉变化（仅限性能需要且你已同意）

- **去掉连线 drop-shadow/滤镜**（保留线条颜色、粗细、激活态高亮）

---

# 1. 现状与根因（性能向）

## 1.1 “不 start 也卡”的关键判断

既然 stop 状态下仍卡，说明瓶颈主要在 **DOM/SVG 渲染与合成**（而非 runtime tick/compute）。

## 1.2 高概率根因清单（按影响排序）

1) **Edges：每条边一个 SVG**，且历史上存在超大画布与阴影滤镜导致合成成本指数级上涨  
2) **节点/边数量增长时，DOM 结点数过多**（尤其 edges 每条独立组件）  
3) **pointermove/drag/zoom/pan 触发过多同步更新**（多处 store/setState 叠加）  
4) **live values 与 overlays（minimap/frames）更新频率过高**，导致渲染链路持续忙碌  

---

# 2. 验收指标（必须量化）

## 2.1 交互性能指标（Manager UI）

在常见开发机（Chrome）上：

- 20 nodes / 30 edges：拖拽、缩放、平移稳定 55–60fps
- 60 nodes / 120 edges：交互稳定 45fps+
- 100 nodes / 200 edges：交互 30fps+（可用、无长时间冻结）

硬门槛：

- “stop 也卡”的问题必须显著缓解（stop 状态下不应有明显掉帧/冻结）

---

# 3. 执行步骤（可打勾）

## [x] Step 0 — 基线、观测与安全网（先做，避免盲改）

### [x] Step 0.1 Graph Fixtures（用于性能对比/回归）

固定 graph fixtures（JSON），覆盖 20/60/100 nodes（含典型 edge 密度与 loop/group/patch/midi 节点）。

### [x] Step 0.2 Perf Overlay（DEV 性能面板）

DEV-only 性能面板（FPS / nodes / edges / renderer / shadows），用于每一步量化对比。

### [x] Step 0.3 Feature Flags（DEV 开关 + localStorage 持久化）

- `?ng_shadows=on/off`（连线阴影）
- `?ng_live=on/off`（live port values）
- `?ng_perf=on/off`（性能面板）

---

## [x] Step 1 — 立即止血：先把 edges 成本砍下来（保持 Rete）

### [x] Step 1.1 去掉连线 drop-shadow

直接移除/默认关闭 `filter: drop-shadow(...)`，只保留颜色与粗细变化。

### [x] Step 1.2 把每条 edge 的 SVG 从“超大画布”收敛到 bbox

把单条 connection 的 `<svg>` 视口限制在 start/end 的包围盒附近（加 padding），避免无意义的超大合成区域。

---

## [/] Step 2 — 主线优化：让 Rete 在更大规模节点下可交互

### [x] Step 2.1 View Adapter 抽象（为后续单层 edges / 裁剪做铺垫）

把控制器/overlays 对 Rete 内部对象的直接依赖收敛到 adapter（避免后续优化牵一发动全身）。

### [ ] Step 2.2 Edges 单层化（收益最大）

目标：把 “每条 edge 一个 `<svg>` 组件” 改为 “单层绘制”，减少 DOM 数量与合成层数量。

实现路线（二选一，推荐先 A）：

#### [ ] Step 2.2.A 单 SVG ConnectionsLayer（低风险优先）

- 新增统一的 edges layer：一个 `<svg>` 绘制全部 edges（paths）
- 高亮规则（active/localLoop/deployedLoop）保持不变
- 交互优先级：以 sockets/节点为主；边点击/hover 可降级（或用一条 invisible hit-path）

#### [ ] Step 2.2.B Canvas2D EdgesLayer（高收益）

- 用一个 `<canvas>` overlay 绘制全部 edges
- 若实现成本过高，可接受“边不可点”，保留 sockets/节点交互即可

验收：

- fixtures（20/60/100）下性能达标（见 Step 3.1）
- Step 0.1 回归清单全通过（包含 patch、override、MIDI、group/loop）
- `ng_renderer=rete` 可随时回滚（线上救火开关）

---

## [ ] Step 3 — Gate Cascade（CSS-like 权限）落地：规则、数据结构、UI

> 目标：把“运行/停止”的语义统一，消灭“关了还会动”与“权责不清”。

### [ ] Step 3.1 Frame 树模型（Tree Invariant）

定义统一的 frame：

- `root`：整个 graph（由 Start/Stop 控制）
- `group:<id>`：用户创建的 group（可嵌套）
- `loop:<id>`：检测出的 loop（仅在“部署到 client”时成为执行 partition；不作为树父节点）
- `patch:<id>`：以 audio-out root 导出的 patch（同上）

树 invariant：

- 每个 node 至多属于一个 group 路径（已有 parentId 体系满足）
- group 之间只允许包含/不相交，不允许交叉覆盖

对 loop/patch：

- 不把它们强行纳入树；它们是“执行分区”的 overlay
- 但 gate 计算会考虑它们的状态（例如 group 关闭会 stop/undeploy 相交的 loop/patch）

### [ ] Step 3.2 Gate 计算规则（Cascade）

对每个 node 计算 `EffectiveRunState`：

- `graphRunning`（root gate）
- `groupGateOpen`（沿 parent group 链 AND）
- `deploymentMode`：
  - `local`：manager 本地执行（compute+sinks 可能）
  - `remote(loop|patch)`：client 端执行（manager compute/sinks 均停）

最终：

- `computeEnabled = graphRunning && groupGateOpen && deploymentMode === 'local'`
- `sinkEnabled = graphRunning && groupGateOpen && deploymentMode === 'local' && nodeNotOffloaded`

> 注意：这会把“loop deployed 但 manager 仍 compute（为了 UI）”的旧语义改掉（你要求不重复显示/不重复执行）。

### [ ] Step 3.3 跨 frame 连线语义（必须写死）

当某个 node compute 被 gate 关闭：

- 它的 `outputValues` 必须清空（等价于“停=无输出”），避免下游继续拿到旧值造成“还在动”的错觉。
  - 这与当前 `isNodeEnabled=false` 时 `node.outputValues = {}` 的行为一致（稳定、直观）

当下游端口没有输入（因为上游停）：

- 使用其 `defaultValue` / config fallback（保持现有语义）

### [ ] Step 3.4 停/启生命周期（Stop Semantics）

为避免“停了但副作用持续”（例如 playMedia 已经触发播放）：

- 引入 node-level 可选生命周期：`onDisable`（或 `onGateClosed`）  
  - 典型用途：发送 stopSound/stopMedia/hideImage/flashlight off 等“撤销副作用”的命令
- 对 remote executor：
  - group gate 关闭时必须 `stop` +（必要时）`remove` 对应 loop/patch，避免 client 继续执行
  - 同时清理 overrides（避免下次 start 带着旧补丁）

### [ ] Step 3.5 UI 反映（Group/Loop/Node）

#### [ ] Step 3.5.1 GroupFramesOverlay（必须反映 gate）

UI 文案/状态：

- `Deactivate group` 等价于 `Close gate`（阻断执行）
- `Activate group` 等价于 `Open gate`
- 显示该 group 当前 gate 状态（Open/Closed）
- 显示“阻断原因”（例如：Graph STOP / Parent group closed / Remote deployed）

交互：

- 关闭 group 时：
  - 立即在 UI 中把该 group 内 nodes 标记为 Stopped（灰态）
  - 同时触发 stop deployed loops/patches intersecting（不仅 loop，patch 也要）

#### [ ] Step 3.5.2 Node 外观（Stopped vs Remote vs Local）

新增统一状态展示（不一定要大改外观，优先复用现有 class）：

- `group-disabled`：保持
- `deployed-loop`：表示 remote 执行（但此时 manager 不 compute）
- `stopped`：gate 关闭导致 compute 停止（可用轻量样式）

端口值：

- remote 执行的 nodes：manager 不再显示 live values（避免误导）
- local 执行：保持现状

#### [ ] Step 3.5.3 LoopFramesOverlay（部署后语义更清晰）

部署后：

- 标识 “Remote Running”
- 显示 last status event（deployed/started/stopped/error）
- Stop/Remove 行为与 gate 一致（stop 会让 nodes 回到 local 可执行，但默认仍受 group gate 约束）

---

## [ ] Step 4 — Loop/Client 数据流收敛（避免重复与误导）

### [ ] Step 4.1 部署后 manager 不再 compute loop nodes

实现要点：

- `nodeEngine` 层引入 `computeDisabledNodeIds`（由 deploymentMode 计算得出）
- loop deployed 时将其 nodeIds 加入 computeDisabled（不仅仅是 sinkDisabled）

### [ ] Step 4.2 client 回传只保留最小状态（必须保留）

保留 node-executor 的 status events：

- deployed/started/stopped/removed/rejected/error
- watchdog（slow-tick、compile-error、oscillation…）

不新增每 tick 数据回传（性能/网络无意义）。

### [ ] Step 4.3 override 语义与 gate 对齐

- 当 loop/patch remote 执行：override 仍可发（参数传递）
- 当 group gate 关闭：必须清理 remote overrides（通过 remove 或显式清空）

---

## [ ] Step 5 — 节点注册体系：node-core SOT + JSON overlay（保留 JSON 优点）

### [ ] Step 5.1 明确职责分层

#### [ ] Step 5.1.1 运行时层（SOT）

来源：`@shugu/node-core`（NodeDefinition）

- ports/types/kind
- configSchema（含 min/max/step 默认）
- process/onSink（运行时逻辑）

#### [ ] Step 5.1.2 UI overlay 层（JSON）

来源：`apps/manager/src/lib/nodes/specs/**/*.json`

允许提供：

- label/category 覆盖（仅 UI）
- 可见性/分组/排序/搜索关键字
- UI-only 的 min/max/step（用于比 core 更严格的 UI 限制）
- widgetType/展示选项（如 slider/input/select）

禁止提供：

- runtime.kind / process/onSink 的选择（逐步废弃）

### [ ] Step 5.2 兼容策略（不破坏现有节点）

短期（过渡）：

- 继续支持旧 JSON 格式（包含 runtime.kind），但把它视为“manager-only 节点”的来源
- 对于 node-core 已存在的 type：
  - 不再 `continue` 跳过
  - 改为读取 overlay 并合并到 UI 展示（label/category/constraints）

中期（收敛）：

- 把常用节点（math/lfo/proc-* 等）全部迁移为 node-core 主导
- JSON 只保留 overlay 字段

### [ ] Step 5.3 工具与校验

- 增加一个校验脚本（dev）：扫描 JSON，报告：
  - overlay 字段是否合法
  - 是否试图覆盖 runtime
  - min/max/step 是否冲突

验收：

- “我在 json 里标了节点但没功能”的情况消失：  
  对 core node 来说，json 至少能影响 UI（类别/label/约束/可见性），不会完全无效。

---

## [ ] Step 6 — MIDI 批量下发（同 tick 合并，减少 server 压力）

> 目标：你同时按两个键/推两个 MIDI，参数“一起传过去”，而不是 2 条消息错开。

### [ ] Step 6.1 Batch 协议（不破坏现有协议类型）

使用现有 `ControlAction: 'custom'` 作为载体：

- action: `custom`
- payload:
  - `kind: 'control-batch'`
  - `items: Array<{ action: ControlAction; payload: ControlPayload; executeAt?: number }>`
  - 可选：`executeAt`（统一调度）

### [ ] Step 6.2 Manager 聚合策略

聚合位置建议（二选一）：

- 方案 A：在 `client-object` 的 sink 里聚合（同 tick 内收集后一次 send）
- 方案 B：在 SDK 层增加 `sendControlBatch`（更通用）

本计划建议方案 B（更干净）：

- `packages/sdk-manager` 增加 helper：`sendControlBatch(target, items, executeAt?)`
- node graph 只调用一次

合并策略：

- 同一 clientId、同一 tick 收到多条：
  - 默认：按顺序保留全部 items
  - 可选优化：对 `modulateSoundUpdate` 等“update 类 action”同 tick 合并（只保留最后一次，并 merge payload 字段）

### [ ] Step 6.3 Client 执行策略

在 `apps/client/src/lib/stores/client.ts` 的 `executeControl` 中处理：

- case 'custom':
  - 如果 payload.kind === 'control-batch'：遍历 items，调用内部 executeControl（共享调度）
  - 否则保持现有 default（日志）

验收：

- 同一 tick 内两路 MIDI 驱动：
  - server 只收到 1 条 control（custom batch）
  - client 侧声音/画面变化同步性提升

---

## [ ] Step 7 — WebGPU 渲染增强（仅当前两步仍不理想时进入）

> 这是后备路线：Step 1（无阴影止血）+ Step 2（XYFlow 可见裁剪）做完后仍达不到 100 nodes 可用，再启动。

### [ ] Step 7.1 目标

- 将 edges（必要时 nodes）迁移为 GPU 批量渲染（instancing），显著降低 DOM/SVG 负担
- 保持现有 UI 外观（节点仍可用 DOM/Svelte 组件；先只把 edges GPU 化）

### [ ] Step 7.2 推荐路线：Edges GPU 化（节点保持 DOM）

- 节点仍用 DOM（便于控件/输入）
- 连线用 WebGPU/Canvas2D 绘制在单层 overlay（随 viewport transform 重绘）
- 高亮（active/localLoop/deployedLoop）通过每条 edge 的 style buffer 实现

优点：

- 改动范围小：不需要重写 node UI
- 性能提升显著（edges 是大头）

风险：

- hit-test：需要额外实现“点到线”的交互（可保留 invisible SVG 线用于 hit-test 或实现近似算法）

### [ ] Step 7.3 启动条件（必须满足其一）

- XYFlow 已启用 onlyRenderVisibleElements 仍无法在 100 nodes fixtures 达到 30fps+
- 或在低端设备（目标机）上仍出现严重卡顿

---

# 5. 回归测试清单（手动 + 自动）

## 5.1 必跑命令

- `pnpm --filter @shugu/manager run check`
- `pnpm --filter @shugu/manager run lint`（若当前 lint 对 warnings 也 fail，至少保证无新增 error）

## 4.2 手动性能回归步骤

1) 打开 NodeCanvas，加载 graph-20/60/100 fixtures
2) stop 状态：拖拽/缩放/平移（观察 FPS 与卡顿）
3) 新增节点、连线、替换单连接输入
4) 创建 group/subgroup，toggle gate，确认：
   - 关闭后节点不再产生副作用
   - 重新开启后按规则恢复
5) 生成 loop，deploy/stop/remove，确认：
   - deploy 后 manager 不再显示 loop 内 live 值
   - status events 正常更新
6) patch（audio-out）deploy/stop/remove，确认 group gate 关闭能停止 patch
7) MIDI：同时按两键，确认 server 侧消息数量减少且 client 变化同步

---

# 6. 风险与对策

## 6.1 Gate Cascade 的语义复杂

- 风险：跨 frame 连线与 lifecycle 若不清晰，会出现新 bug
- 对策：先写规则与测试（纯函数），再接 UI；并对关键节点（playMedia/sound/screen/flashlight）补齐 onDisable 行为

## 6.2 JSON overlay 兼容风险

- 风险：旧 JSON runtime.kind 与新 overlay schema 冲突
- 对策：分阶段迁移；先“读取 overlay 而不破坏旧运行时”，再逐步废弃 runtime.kind

