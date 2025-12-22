<!--
Purpose: Node Graph 性能 + 权责（执行/权限）+ MIDI 批量 + 节点注册体系的改造计划（保持现有功能与外观尽量不变，允许去掉连线阴影）。
Owner: ShuGu / Manager Node Graph
Created: 2025-12-21
Status: Draft
-->

本文档给出一份**事无巨细**的改造计划，用于解决你提出的 Node Graph 四大问题：

1) **信息发送结构不稳定 / 权责不清**（start/loop/group activate/deactivate 的行为混杂、补丁/override 的语义不清）；  
2) **MIDI “一起传递”**（同一时刻多路输入希望合并下发，减少 server 压力与错开）；  
3) **性能（最重要）**：>20 节点无论 start/stop 都卡；  
4) **节点注册体系混乱**：node-core + JSON specs + register.ts 三套来源叠加，导致“JSON 标了但没功能/还要去 register 里再标”的体验。

本计划按你的要求做了修订：

- UI 渲染层：**去掉连线阴影**，并**迁移到 React Flow（XYFlow 系列）**来获得可见元素裁剪（virtualization）等高性能特性；同时保留一个 **WebGPU 渲染增强**的后备方案（前两步仍不理想时再进入）。
- 权责/权限：采用你提出的“类似 CSS 的层叠权限（gate cascade）”思路，但补齐三个硬条件：**frame 树约束、跨 frame 连线语义、停/启生命周期**；并明确要反映到 Group 逻辑与 UI。
- Loop：Loop 部署后，Manager **不再重复 compute/显示 live 值**；但 client 仍需要最小的 status 回报（deployed/stopped/error）以保证系统可观测与一致性。
- JSON：不删除 JSON 的“可见性/约束（min/max/step）”优点；将 JSON 角色降级为 **UI overlay 层**，node-core 仍作为 **运行时唯一真相源（SOT）**。

---

# 0. 强约束（必须满足）

## 0.1 不影响现有功能（回归零容忍）

在最终默认路径切换前，必须保证以下能力不回归：

- 节点：新增/删除/拖拽/多选/框选（marquee）/复制粘贴/导入导出
- 连线：连线创建/替换/断开、端口类型兼容校验、sink 多连线
- 组：创建 group、子 group、拖拽 frame、改名、disassemble、开启/关闭 group
- loop：检测/高亮、Deploy/Stop/Remove、logs 面板
- patch：以 `audio-out` root 的 deploy/stop/remove
- MIDI：learn、midi-fuzzy/midi-boolean/midi-map 等节点输出、MIDI 高亮链路
- override：旋钮调参实时生效（TTL + commit）、部署后仍可调参
- 现有外观：节点外观/布局/样式尽量保持；允许去掉连线 drop-shadow（你明确允许）

## 0.2 外观不受影响（允许的例外）

允许的视觉变化（仅限性能需要且你已同意）：

- **去掉连线 drop-shadow/滤镜**（保留线条颜色、粗细、激活态高亮）

其他外观变化必须被当作 bug 处理，除非你显式确认。

## 0.3 迁移必须可回滚（Feature Flag）

任何结构性重构必须具备：

- 运行时 feature flag（默认仍走旧实现）
- 可回滚到旧渲染器（Rete）或旧逻辑的开关
- 明确的“验收门槛”和“切换条件”

---

# 1. 现状与根因（基于代码）

## 1.1 性能根因（“不 start 也卡”）

根据现有实现，>20 节点卡顿的主因很可能在 **DOM/SVG 渲染成本**（而非 runtime tick）：

- 当前每条连线使用一个独立的 `<svg>`（并且 `width/height: 9999px`），同时给 `<path>` 加 `filter: drop-shadow(...)`（非常昂贵），见：
  - `apps/manager/src/lib/components/nodes/node-canvas/rete/ReteConnection.svelte`
- 这会导致：
  - edges 数量增大时，GPU/CPU 合成压力巨大
  - 即使 engine stop（runtime 不 tick），仍会卡（因为渲染/布局/滚动/缩放交互仍在）

## 1.2 权责不清根因（状态机碎片化）

目前“运行/停止”分散在多个机制中：

- Graph 总开关（Start/Stop）
- Group disable（通过 disabledNodeIds 影响 manager runtime）
- Loop deploy（offloaded 只 skip sink，不 skip compute）
- Patch deploy（独立于 group disable）
- override TTL + commit（client executor 端的 overrides 可能残留）

在 UI/逻辑上这些机制的优先级与组合语义未统一，导致“我关了但还在动”。

## 1.3 节点注册混乱根因（多源定义叠加）

Manager 当前是：

- 先注册 node-core 的 default definitions
- 再扫描 `apps/manager/src/lib/nodes/specs/**/*.json`
- 但如果 node-core 已存在同名 type，就 `continue` 跳过 JSON spec（导致 JSON 不生效）

这会造成“看起来有 JSON，但实际没用”的错觉，并迫使你在多个地方打补丁。

---

# 2. 总体方案概览（你要的最终形态）

## 2.1 渲染层：Rete → React Flow（XYFlow）+ 无阴影

目标：把 Editor 渲染/交互迁移到 React Flow（XYFlow 系列）以获得：

- only render visible elements（viewport culling / virtualization）
- 更成熟的 edges 管理与性能优化路径
- 更容易扩展到 canvas/WebGPU 的路线

策略：

- **先做：无阴影（Rete 立即止血）**
- **再做：React Flow 渲染器（并行存在，flag 切换）**
- 如果仍不理想：进入 WebGPU 增强思路（见 Step 7）

> 说明：本仓库是 SvelteKit。实现 React Flow 有两条路：
> - 路线 A（推荐，风险更低）：使用 XYFlow 的 Svelte 版本（同一生态/思路），避免引入 React runtime；  
> - 路线 B（严格按“React Flow”字面）：在 Svelte 中嵌入 React root，React Flow 作为 client-only 子树运行。
>
> 本计划默认以**路线 A 为主**（更符合“不影响外观/功能”），若你坚持“必须 React Flow”，可在 Step 2 的里程碑点改为路线 B。

## 2.2 权责/权限：Gate Cascade（类似 CSS）

将执行权限统一为一套“层叠 gate”规则：

- 默认：Graph 处于 STOP（全停）
- Graph START 后：root 层节点（不属于任何 frame）可运行
- Group 是 gate：开启则其内部节点运行；关闭则**阻断**（节点停 + side-effect 停）
- Loop/Patch 是 execution partition：部署到 client 后，manager 对其节点停止 compute，只保留“参数传递/override”能力与最小状态监控

关键补齐（必须写死）：

1) **Frame 树约束（tree invariant）**
2) **跨 frame 连线语义**
3) **停/启生命周期（stop semantics）**

并且 UI 必须能解释这一切（用户一眼就知道为什么这个节点在跑/不跑）。

## 2.3 Loop：部署后 manager 不再重复显示 live 值；client 只回传最小状态

- 部署后 manager 不再 compute（避免重复与误导）
- client 仍回传：
  - deployed / started / stopped / removed / rejected / error
  - watchdog（slow tick / compile error 等）
- 不回传每节点数据/每 tick 数据（目前也没有这类回传；我们只需要保持 status）

## 2.4 节点注册：node-core SOT + JSON UI overlay

- node-core：唯一运行时定义（ports + config schema + process/onSink）
- JSON：只做 UI overlay（label/category/可见性/约束补充/展示选项），不得定义运行时逻辑
- 兼容：现有 JSON `runtime.kind` 逐步迁移/废弃，但先保证现有节点不破坏

## 2.5 MIDI：批量下发（同 tick 合并为单包）

满足你“同时按两个 MIDI，希望参数一起传过去”的要求：

- manager 在同一 tick 内对同一 clientId 的多条 control 合并为一个 batch（单条网络消息）
- client 解析 batch，在同一调度点执行（可共享 executeAt）
- 可选：对“update 类 action”（例如 `modulateSoundUpdate`）做合并（同 tick 只保留最后值/merge 字段）

---

# 3. 验收指标（必须量化）

## 3.1 交互性能指标（Manager UI）

在 Mac/常见开发机上（Chrome）：

- 20 节点 / 30 edges：拖拽、缩放、平移稳定 55–60fps
- 60 节点 / 120 edges：交互稳定 45fps+（无明显卡顿）
- 100 节点 / 200 edges：交互 30fps+（可用、无长时间冻结）

硬门槛：

- “不 start 也卡”的问题必须消失（stop 状态下不应有明显掉帧）

## 3.2 网络指标（MIDI 批量）

- 同一 tick（例如 33ms）内对同一 client 的多条 MIDI 驱动更新：
  - server 侧应看到 **1 条 control 消息**（而不是 N 条）
  - client 执行动作的 jitter 明显下降（肉眼可感）

## 3.3 权责一致性指标（Gate）

必须做到：

- 任何节点“为什么在跑/不跑”可由 UI 解释（显示 gate path 与阻断原因）
- group/loop/patch 状态变化不会出现“关了还在动”的悬空状态（尤其是 side-effect）

---

# 4. 执行步骤（可打勾）

## [x] Step 0 — 基线、观测与安全网（先做，避免盲改）

### [x] Step 0.1 建立基线用例（Graph Fixtures）

新增固定 graph fixtures（JSON），用于：

- 性能对比（20/60/100 节点）
- 回归测试（功能一致）

建议放置：

- `apps/manager/src/lib/components/nodes/node-canvas/fixtures/graph-20.json`
- `.../graph-60.json`
- `.../graph-100.json`

内容要求：

- 包含典型 edges 密度（含 sink 多连线）
- 至少包含：midi-*、math/lfo、proc-*、client-object、audio-out（patch）
- 至少包含：一个 group + subgroup；一个 loop（可 deploy）；一个 patch（audio-out）

### [x] Step 0.2 性能观测（Debug Overlay）

新增一个 DEV-only 的性能面板（不影响生产）：

- FPS（requestAnimationFrame 统计）
- 交互延迟（pointermove 到视图更新的耗时粗测）
- 渲染器类型（rete/xyflow）
- 连接数、节点数
- “是否启用阴影/滤镜”

目的：每一步改动都能量化。

### [x] Step 0.3 Feature Flags（必须）

新增环境/URL 开关：

- `NODE_GRAPH_RENDERER`：`rete`（默认） / `xyflow`
- `NODE_GRAPH_EDGE_SHADOWS`：`on`（默认旧） / `off`（新默认）
- `NODE_GRAPH_LIVE_VALUES`：`on/off`（后续可用于进一步优化，但先不改行为）

在 UI 上也提供一个 DEV-only 的切换入口（避免改 env 才能试）。

---

## [x] Step 1 — 立即止血：去掉阴影 + 降低 edges 渲染开销（保持 Rete）

> 目标：在不动大结构的情况下，先把“20 节点不 start 也卡”大幅缓解，为迁移争取时间。

### [x] Step 1.1 去掉连线 drop-shadow（你允许的外观变化）

修改：

- `apps/manager/src/lib/components/nodes/node-canvas/rete/ReteConnection.svelte`
  - 移除 `filter: drop-shadow(...)`
  - 保留 active/localLoop/deployedLoop 的颜色与粗细变化

验收：

- 20/60 节点 fixtures 下，stop 状态的平移/缩放明显变顺畅

### [x] Step 1.2 修正“每条 edge 一个 9999px SVG”的极端开销（可选但强烈建议）

这是一个高收益点，但改动可能稍多。两种策略二选一：

#### 策略 A（低风险）：缩小 SVG 的 viewBox/尺寸

- 将每个 edge 的 svg 尺寸限制在 start/end 的包围盒附近（加 padding）
- 避免 9999x9999 的大区域参与合成

#### 策略 B（中风险，高收益）：edges 统一画在单层（canvas 或单 SVG）

- 用一个 overlay 层绘制所有 edges（每帧/每变更重画）
- Rete 侧只保留 sockets hit-test

本计划建议：

- Step 1 先做策略 A（低风险）
- Step 2 迁移到 XYFlow 后再考虑策略 B（因为 XYFlow 自带更合理的 edge 渲染）

### [x] Step 1.3 保持功能不变的回归清单（Step 1）

- 连线 hover/active 高亮仍可见
- loop/deployed 高亮仍可见
- 鼠标点击/拖拽连线不受影响

---

## [/] Step 2 — 渲染器迁移：React Flow（XYFlow）并行上线（功能/外观不变）

> 目标：把性能从“勉强可用”提升到“可规模化”（>=100 nodes），并为后续 gate/权限重构提供更干净的 view 层。

### [x] Step 2.1 关键策略：先抽象 View Adapter，再换渲染器（避免一次性重写）

#### [x] Step 2.1.1 定义渲染器无关的接口（GraphViewAdapter）

新增一个渲染器抽象层（示例接口）：

- 获取节点/连线的可视对象（用于高亮状态）
- 更新节点/连线的渲染状态（active/localLoop/deployedLoop/groupDisabled/selected…）
- 读取/设置节点位置
- 读取 viewport transform（k/tx/ty）
- 框选/节点命中测试（用于 picker 与 group/marquee）
- 请求一次 frames update（等价 requestAnimationFrame 合并）

目的：

- 现有 group/loop/midi/minimap 控制器大量依赖 Rete `areaPlugin`、`nodeViews`、`update('node')` 等；  
  先把这些依赖收敛到 adapter，才能同时支持 Rete 与 XYFlow。

#### [x] Step 2.1.2 先实现 ReteAdapter（行为不变）

把当前 NodeCanvas 中对 `areaPlugin/nodeMap/connectionMap` 的直接使用改为 adapter 调用：

- `createGroupController`、`createLoopController`、`createMidiHighlightController`、`createMinimapController`
- `LiveDOMSocketPosition` 的触发点（requestFramesUpdate）也接入 adapter

验收：

- renderer 仍是 Rete，但行为/外观完全一致（除了 Step 1 去掉阴影）

### [x] Step 2.2 引入 XYFlow（React Flow 系列）作为新渲染器

#### [x] Step 2.2.1 路线选择（A 推荐 / B 备选）

路线 A（推荐）：

- 使用 XYFlow 的 Svelte 集成包（同生态/同思路），避免在 SvelteKit 中嵌 React runtime  
- 复用现有 Svelte node UI 组件与样式，达到“外观不变”的要求更容易

路线 B（备选）：

- 在 Svelte 组件中 `onMount` 创建 React root（client-only），React Flow 在其中运行  
- 样式通过共享 CSS/变量保持一致

本计划默认路线 A；如果你坚持 React Flow 字面实现，在开始 Step 2.2.2 前确认切换到路线 B。

#### [x] Step 2.2.2 新增 XYFlowRenderer（并行存在）

新增一个新的渲染器组件（不替换旧的，先并行）：

- `apps/manager/src/lib/components/nodes/NodeCanvasXYFlow.svelte`（或类似命名）
- 通过 `NODE_GRAPH_RENDERER=xyflow` 切换

它负责：

- 读取 `nodeEngine.graphState` 生成 XYFlow nodes/edges
- 把用户交互（拖拽、连线、选择）回写到 `nodeEngine`（同现有接口）
- 暴露 adapter 能力给 controllers（实现 `XYFlowAdapter`）

#### [x] Step 2.2.3 节点外观与交互一致性

要求：节点外观与现在 `ReteNode.svelte` 尽量一致。

实施策略：

- 抽取共享样式（例如 node 容器、title、ports 行、value badge）
- XYFlow node component 复用这些 className/CSS（Svelte/React 版本同名 class）

必须覆盖的交互：

- inline 控件（number/string/boolean/color）
- socket 点击/连线
- 展示 live port values（先保持现状；后续可做开关/降频）

#### [x] Step 2.2.4 Edges（连线）策略：无阴影 + 高亮保持

在 XYFlow 中实现：

- normal/localLoop/deployedLoop/active 的颜色/粗细变化保持与旧版一致
- 默认不加 drop-shadow（性能优先）

#### [x] Step 2.2.5 虚拟化（only render visible）

必须启用：

- onlyRenderVisibleElements（或等价能力）
- 对 nodes/edges 做 viewport culling（这是迁移到 XYFlow 的核心价值）

验收：

- 100 节点 fixtures 在 stop 状态可顺畅缩放/平移

### [x] Step 2.3 迁移现有 overlays 与工具面板（不改变 UX）

需要逐个迁移/对齐：

- NodePickerOverlay（add/connect 模式）
- GroupFramesOverlay（显示 frame、按钮、拖拽 header）
- LoopFramesOverlay（deploy/stop/logs）
- MarqueeOverlay（框选后 create group）
- Minimap（保持 UI 位置/大小/交互一致）
- ExecutorLogsPanel（不变）
- Toolbar（不变）

关键点：

- overlays 的坐标系必须与 viewport transform 一致（k/tx/ty）
- adapter 提供 `getViewportTransform()` 统一坐标换算

---

### [ ] Step 2.4 XYFlow parity（补齐 Rete 行为，不改默认路径）

> 目标：让 `ng_renderer=xyflow` 真正可用（功能/外观不输 Rete），然后才讨论把默认渲染器切过去。

#### [ ] Step 2.4.1 Patch / Override 逻辑抽取（renderer-agnostic）

现状：Patch（`audio-out` root）deploy/stop/remove、override TTL/commit 目前主要写在 `NodeCanvas.svelte` 内。

计划：把这些“非渲染器核心”的逻辑抽到独立 controller（例如 `node-canvas/controllers/runtime-controller.ts`）：

- 输入：`nodeEngine`、`getSDK()`、selected clients、clock/tick（如需要）
- 输出：`start/stop`、`applyOverride`、`commitOverrides`、`deployPatch/stopPatch/removePatch`
- 两个渲染器都调用同一套 controller（避免 XYFlow 再复制一份）

验收：

- XYFlow 路径下：Start/Stop、Patch deploy/stop/remove、override 行为与 Rete 路径一致

#### [ ] Step 2.4.2 Clipboard / Hotkeys（复制粘贴/删除/框选）

补齐你在 Step 0.1 的回归项：

- Cmd/Ctrl+C / V：复制粘贴选中节点（含内部连线恢复）
- Backspace/Delete：删除选中节点/边
- Esc：关闭 picker / 清 selection / 退出 edit mode（保持与 Rete 一致）

建议：先把“graph editing commands”抽象成纯函数（接 `GraphState` + selection + cursorPos），再分别挂到 Rete/XYFlow 的事件系统。

#### [ ] Step 2.4.3 切换条件（何时可以把默认渲染器切到 XYFlow）

必须满足（全部）：

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

- `pnpm lint`
- `pnpm dev:manager`（至少跑起来）
- `pnpm dev:client`（验证 custom batch 与 node-executor 不回归）

## 5.2 手动回归步骤（每个里程碑都要过一遍）

1) 打开 NodeCanvas，加载 graph-20/60/100 fixtures
2) stop 状态下拖拽/缩放/平移
3) start 后拖拽/缩放/平移
4) 新增节点、连线、替换单连接输入
5) 创建 group/subgroup，toggle gate，确认：
   - 关闭后节点不再产生副作用
   - 重新开启后按规则恢复
6) 生成 loop，deploy/stop/remove，确认：
   - deploy 后 manager 不再显示 loop 内 live 值
   - status events 正常更新
7) patch（audio-out）deploy/stop/remove，确认 group gate 关闭能停止 patch
8) MIDI：同时按两键，确认 server 侧消息数量减少且 client 变化同步

---

# 6. 风险与对策

## 6.1 XYFlow/React Flow 集成风险

- 风险：引入新依赖导致 bundle 变大、Svelte/React 混用复杂
- 对策：优先采用 Svelte 集成路线；且全程 feature flag，随时可回退 Rete

## 6.2 Gate Cascade 的语义复杂

- 风险：跨 frame 连线与 lifecycle 若不清晰，会出现新 bug
- 对策：先写规则与测试（纯函数），再接 UI；并对关键节点（playMedia/sound/screen/flashlight）补齐 onDisable 行为

## 6.3 JSON overlay 兼容风险

- 风险：旧 JSON runtime.kind 与新 overlay schema 冲突
- 对策：分阶段迁移；先“读取 overlay 而不破坏旧运行时”，再逐步废弃 runtime.kind

---

# 7. 明确待你确认的决策点（开始实施前）

1) React Flow 的“字面要求”是否必须：  
   - A：接受 XYFlow 的 Svelte 集成（推荐、风险小）  
   - B：必须使用 React Flow（将走 React 嵌入方案）
2) stop 语义：节点停时输出清空（本计划默认），是否有例外需要“冻结最后值”？
3) custom batch 的 action 选择：是否接受 `action:'custom'` + `kind:'control-batch'`？

只要你对这三个点确认，本计划即可进入实施阶段（逐阶段落地）。
