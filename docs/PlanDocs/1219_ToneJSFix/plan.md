谢谢 — 我把你给的状况、仓库里现有实现（我在 `node-core` / `sdk-client` 看到的代码）和 Tone.js 适配器的实现整合了一下，做了深度分析。下面是**逐点诊断 + 详细修复建议（含具体代码修改方向 / 样例） + 风险/性能提示 + 一步步的实现计划与可直接交给 Vibe Coding Agent 的精确提示词**。我把关键的仓库证据也一并标注，便于你核对。

---

## 一、我读到的关键事实（来自仓库）

* `node-core` 在 `registerDefaultNodeDefinitions` 中确实注册了 `tone-*` 节点（例如 `createToneDelayNode()`、`createToneOscNode()` 等），也就是说 **节点接口（port、config）是在 node-core 中定义（Manager/Client 共用）**。
* `sdk-client` 的 `NodeExecutor` 在构造时会调用 `registerToneClientDefinitions(this.registry, { sdk: this.sdk })`，也就是 tone 的客户端实现由 `packages/sdk-client/src/tone-adapter.ts` 提供并注册为 client 端覆盖实现。
* `packages/sdk-client/src/tone-adapter.ts` 已实现一套基于 **bus + effectInstances** 的音频链管理逻辑（`masterGain`, `getOrCreateBus`, `rebuildBusChain`、`ensureTone()`、`ensureTransportStart()` 等），说明当前 adapter 的设计基于 “把音源连接到 bus，然后对 bus 应用一组效果链” 的模式。 

> 也就是说：**node-core 定义节点接口**（Manager 用），而 **sdk-client 的 tone-adapter 负责在客户端把这些节点映射到 Tone.js 对象、维护 masterGain、bus、effect chain 与 Transport**。

---

## 二、你的症状回顾与我判断出的主要根因（简要）

你说的问题是：

1. Tone Delay 节点“接收/输出都是数字”且实现不像 Delay；
2. Manager 很卡，Client 无声。

**我判断出的主要问题（互相关联）**：

1. **节点（node-core）端口类型/kind 与 audio 信号语义不匹配**
   从你描述 + `node-core` 的设计（通用节点以 `number|string|any` 等为 port type）来看，**tone-effect 节点可能在 node-core 里被定义为接受/输出 `number`（或 data）端口**，因此 Manager/Runtime 把它当成“数值计算节点”来处理（纳入 compute DAG），导致 NodeRuntime 会在每个 tick 用 JS 计算这些 node 的输出（而不是把它当成音频信号的“side-effect/sink”），从而既无法建立 Tone.js 的原生 AudioNode 连接，又导致大量无意义的 JS 计算与内存/对象创建，从而把 Manager/Client 都拖慢甚至卡顿。

   * 证据/线索：`node-core` 将 `tone-*` 节点注册为常规节点（Manager 可见）。如果这些 `In`/`Out` 都是 `type: 'number'`，运行时会把它们当数值流处理（而非音频流）。（你给的截图也显示 Delay 节点的端口是数字型） — 这正是 “Delay 节点看起来像数值处理器” 的直接原因。

2. **tone-adapter 的运行模型与 Manager 所期望的“逐连接音频流”不一致**
   `tone-adapter` 里实现的 **rebuildBusChain**、`effectInstances` 等方法说明它期望“**通过 bus 字段把音源路由到 bus，然后按 bus 的 effectInstances 排序组装 effect chain**”。也就是说 adapter 期望你通过 **bus config** 来放置 Delay，而不是通过 node-graph 的连接把 Delay 插到两节点之间。若 Manager UI/用户想用“连线”把 Delay 插入源与播放的中间（图1），而 Tone 适配器只按 bus 来组织 effect，则两者语义冲突 — UI 会把节点连起来，但 adapter 并不把这些连线转换成 Tone.js 的 connect()，从而导致“连线上看起来已连，但音频并未通过 Delay” 的现象。

   * 证据/线索：adapter 有 `getOrCreateBus()` / `rebuildBusChain()` 并根据 `effectInstances` 按 `bus` / `order` 排序 connect，但没有看到基于 graph connections 的直接 connect 逻辑（说明 adapter 优先 bus 模式）。 

3. **Tone.js 初始化/音频上下文没被解锁或 masterGain 未正确连接**
   tone-adapter 里有 `ensureTone()`、`ensureMasterGain()` 和 `audioEnabled` 变量，但如果客户端未在用户交互后调用 `Tone.start()`（或适配器没有自动处理 user gesture），浏览器会阻止播放，导致 client 无声。并且如果 adapter 在 process 中反复创建/销毁 Tone 对象（或在每次 tick 中做重型工作），Manager/Client 会被拖慢。你提到 Manager 也“变卡”，这通常是因为 NodeRuntime 在主线程做大量 JS 计算/对象操作。

   * 证据/线索：tone-adapter 定义了 `ensureTone()` / `ensureMasterGain()`，但是否由客户端 UI 在点击后调用 `Tone.start()` 取决于客户端入口代码（需要明确）。

**结论（高阶）**：目前出现的问题是**“接口语义不一致 + adapter 的音频 wiring 策略（bus-based）与管理端期望（graph-based）冲突 + audio 初始化/资源管理不当”**。这些问题合起来会导致：节点被当成数值计算节点（Manager 卡顿）且最终并没有正确建立 Tone.js 的音频连接（Client 无声或没有 Delay 生效）。

---

## 三、每个问题的具体改正方案（逐点，事无巨细）

下面给出**可直接实施**的修复与改造方案。总体目标：**不破坏单一真相源（node-core 的接口）且保持高性能与解耦**。我会给每一步的实现细节、为什么要这么做、优缺点与潜在危险。

---

### 问题 A — “Tone Delay 节点被当数字节点” —— 根本原因与修复

**根本原因**：`node-core` 中 `createToneDelayNode()`（或类似 effect 节点）把 `In`/`Out` port 定义成 `type: 'number'`（或 `type:'number'` 且 `kind:'data'`），导致 NodeRuntime 把它纳入数值计算 DAG。

**修复（核心）**：

1. **把所有音频 signal 端口改为 `type: 'any'`（或 `type: 'any'`）且 `kind: 'sink'`**。

   * `kind: 'sink'` 的含义是“这是一个副作用输入，不参与数值 DAG 的拓扑排序”，这样 NodeRuntime 在 compile/execute 时不会把这些端口作为决定执行顺序的普通数据端口，从而允许循环、避免不必要的重新计算。
   * `type: 'any'` 允许传递对象（如果以后需要），并明确表示“这不是纯数字/颜色/字符串”。

2. **调整 outputs**：`Out` 端口也应为 `type: 'any'`（或 `kind:'sink'`），以避免 Manager/Runtime 把音频输出作为 numerical output 传播。

3. **在 node-core 的 process() 保持轻量（不创建 Tone 对象）**：node-core 应只保留接口与轻量返回（例如返回当前参数的数值用于 UI 显示），**具体 Tone.js 实例的创建/连接必须在 sdk-client 的 tone-adapter 中完成**。

**示例变更（片段）** — 假设原来是（伪）：

```ts
inputs: [
  { id: 'in', label: 'In', type: 'number' },   // <-- 错误
  { id: 'time', label: 'Time (s)', type: 'number', defaultValue: 0.25 },
  { id: 'feedback', label: 'Feedback', type: 'number', defaultValue: 0.35 },
  { id: 'wet', label: 'Wet', type: 'number', defaultValue: 0.3 },
],
outputs: [{ id: 'out', label: 'Out', type: 'number' }], // <-- 错误
```

应改为：

```ts
inputs: [
  { id: 'in', label: 'In', type: 'any', kind: 'sink' },     // 音频信号作为 sink
  { id: 'time', label: 'Time (s)', type: 'number', defaultValue: 0.25 },
  { id: 'feedback', label: 'Feedback', type: 'number', defaultValue: 0.35 },
  { id: 'wet', label: 'Wet', type: 'number', defaultValue: 0.3 },
],
outputs: [{ id: 'out', label: 'Out', type: 'any', kind: 'sink' }], // 音频输出也为 sink
```

**为什么这样做**：

* `sink` 端口会在计算 DAG 完成后以“副作用”方式传递给节点的 `onSink`，适合实现音频 wiring / side-effects（Tone.js connect/disconnect）。
* 避免 NodeRuntime 在主线程重复/频繁地做 JavaScript 数学计算或新对象分配（这是 Manager 卡顿的主因之一）。

**风险与注意**：

* 需要把所有与音频实际“实时流”相关的端口都改成 `kind: 'sink'`（包括 oscillator 的“音频out”与 player 的 out），否则仍会被当作数据流处理。
* 在 UI 中可能需要将这类节点的端口标记为“Audio”类型，以提示用户这是音频连线（只是改 port type 为 `any` + kind `'sink'` 已能满足底层）。

---

### 问题 B — “Adapter 的 bus-based 音频链与 manager 的连接语义不一致”

**现状**：adapter 有 `getOrCreateBus()`、`rebuildBusChain()`，按 bus/ order 排序 effectInstances 并把 bus.input 依次连接到 effect.wrapper.input -> output -> masterGain。也就是说 **adapter 默认用 bus 来构建音频效果链**，而并没有把 node-graph 的连线映射成 Tone.js `.connect()`。

**两条可行路线**（你需要选择一种）：

#### 方案 1（**保守、最小改动**）：**继续使用 bus 模型**，并把 Manager 的 UI/graph 编辑约定改为“把效果器放到相同 bus（并通过 `order` 排序）”。

* **实现要点**：

  * 在 Manager 的 UI 或节点默认配置中暴露 `bus` 字段（已经存在于 node-core 的 configSchema），并在 Play/Player 节点上带 `bus` 配置（把音源归入某个 bus）。
  * 当用户想把 Delay 插到某个音源与客户端之间时，要求用户把 Delay 的 `bus` 设为与音源相同，并设置 `order`（决定在 chain 哪个位置）。tone-adapter 的 `rebuildBusChain()` 会按 `order` 排序并重建连接。
* **优点**：实现工作量小（适配器已有实现），清晰的“效果器插入点”概念，避免需要解析 graph connections。
* **缺点**：改变用户期望（不能用连线轻易插入 effect，需要配置 bus/order）；需要在 UI 上增加帮助提示。
* **什么时候用**：如果你希望尽快修复问题并不想大改 NodeExecutor / tone-adapter wiring，这个方案最快。

#### 方案 2（**推荐 - 更直观**）：**支持基于 graph 的 audio wiring（即：把 node-graph 的连接直接映射为 Tone.js connect()）**。

* **实现要点**（更详细，下面也给出 Agent prompt）：

  1. **NodeExecutor.deploy**：在部署阶段把 `parsed.graph.connections` 一并传给 `toneAdapter.syncActiveNodes()`（当前 adapter 只接受 active node ids）。即：

     ```ts
     // 在 deploy 后（示例）
     this.toneAdapter?.syncActiveNodes(toneNodeIds, parsed.graph.connections);
     ```

     （现在它只调用 `this.toneAdapter?.syncActiveNodes(toneNodeIds)`, 需要改为带 connections。）
     这使 adapter 在部署时能拿到 graph 的连线信息。
  2. **tone-adapter.syncActiveNodes(activeNodeIds, connections)**：基于 `connections` 建立音频 connect/disconnect。算法：

     * 先为所有 active audio node 创建 Tone.js 对象（Player/Oscillator/Gain 或 effect wrapper），但仅创建一次（避免每 tick 创建）。
     * 遍历 `connections`：对每个 connection 如果 `sourceNode` 与 `targetNode` 都是 audio nodes（包括 effect），且 `sourcePortId`/`targetPortId` 对应音频端口，则**在 Tone.js 上把 sourceAudioNode.output.connect(targetAudioNode.input)**（或者进行适配 wrapper 接口），实现真实音频链。
     * 对于没有明确连接但以 bus 为中心管理的节点，保留 bus logic（兼容）。同时优先遵循 explicit graph connections：explicit connect > bus chaining。
     * 在 `syncActiveNodes` 中还应释放不再存在的 node 实例（dispose）。
  3. **NodeDefinition.onSink / process 的职责**：把音频 node 的 `process()` 保持轻量（返回数值/状态），把 “connect”/“disconnect” 及 Tone 元素创建放在 adapter 的 `syncActiveNodes` 或 `onSink`（执行器会在 sink 发生时调用 onSink）中。
* **优点**：最直观、用户可以像图示那样用连线插入 Delay；兼容性更强。
* **缺点**：实现复杂度更高（adapter 要解析 connections 并维护 audio connections），测试工作更多，但长远看这是更好的 UX。

**我的建议**：如果你希望用户能直接画连线实现效果（如图1），**采用方案 2**（实现 graph->audio wiring）。如果希望先修复并以较低改动上线，则可先做方案 1 并同时计划 2 作为长期改进。

---

### 问题 C — “Manager 卡 / client 无声” 的具体优化（性能与资源管理）

**针对 Manager 卡顿**（常见原因）：

* NodeRuntime 被迫在每个 tick 创建或销毁大量对象（比如 tone-adapter 在 `process()` 中每次 tick 创建 Tone 对象），或 node-core 的 tone 节点仍被当成普通 data node，导致大量 JS work。**避免方法**：

  1. **一次性创建 Tone 实例**：adapter 应在 `syncActiveNodes`（部署阶段）或第一次 `onSink` 调用时创建 Tone 对象并 cache，后续 tick 只做参数更新（`rampTo`、`setValue`），不要在每次 process 创建。
  2. **把音频 wiring 从 process 移到 adapter 的 wiring 函数**：`process()` 只做轻量修改（返回反馈），heavy lifting 由 adapter 做（create/dispose/connect/disconnect）。
  3. **把 audio ports 设为 sink**（参见问题 A），避免被 NodeRuntime 作为数据流触发大量数值计算或周期性分配对象。
  4. **严格避免阻塞**：不要在主线程做 heavy synchronous decode/waveform 算法；必要时把 DSP 放进 AudioWorklet / WASM。

**针对 Client 无声**（常见原因）：

* Tone 未被 `Tone.start()` 解锁（iOS/Safari 要求用户交互），或 `masterGain` 未连接到 `toneModule.Destination`。

  * 解决：在 client 的体验入口（你已有“进入体验 / Start Experience”按钮）**在用户交互时调用 `await ensureTone(); await toneModule.start()`（或 `Tone.start()`）**，并把 `audioEnabled` 状态设为 true。tone-adapter 中的 `ensureMasterGain()` 已有实现，但需要确定这个方法在 Tone 启动后被执行。
  * 确认 Tone.Transport 是否 start（tone-adapter 有 `ensureTransportStart()` 用于 schedule）。如果你使用 loop，需要调用 `Transport.start()`（adapter 提供 schedule ）。

---

## 四、详细的“修复步骤” + 每一步给 Vibe Coding Agent 的精确 prompt

下面给出具体步骤，**每步都包含可直接复制给 Agent 的提示词**（包括要改动的文件、要实现的函数、测试要点）。我把优先级、时间估计/备注一并写上。

> 我把这些步骤写成小任务，Agent 可以逐个实现并提交 PR。每个任务都力求最小改动并保留回滚点。

---

### Step 0（准备） — 分支与测试环境

**目标**：创建特性分支 `feature/tone-audio-wiring-fix` 并确保 project 能本地启动 manager/client。

**Agent Prompt**:

```
创建 feature 分支 feature/tone-audio-wiring-fix。确保本地能运行 dev: manager & client。写 PR 模板（title prefix [tone-fix]）。
```

**验收**：能运行 `pnpm run dev:manager` 和 `pnpm run dev:client`。

---

### Step 1（必做） — 把音频端口设为 sink/any（node-core）

**目标**：把 node-core 中所有 `tone-*` 节点有关音频输入/输出的端口改为 `type: 'any'` 且 `kind: 'sink'`，并保持 `process` 轻量。

**修改文件**：`packages/node-core/src/definitions.ts`（找到 `createToneDelayNode()`, `createToneOscNode()`, `createToneResonatorNode()`, `createTonePitchNode()`, `createToneReverbNode()`, `createToneGranularNode()`, `createTonePlayerNode()` 等）

**Agent Prompt（非常具体）**：

```
在 packages/node-core/src/definitions.ts：
- 找到每个 createTone*Node 的 inputs & outputs 配置。
- 将音频 signal 端口（通常 id='in' / id='out' / id='audio' 等）改为:
    { id: '<port>', label: '...', type: 'any', kind: 'sink' }
  并把 outputs 的对应 out 也改为 { id:'out', type:'any', kind:'sink' }。
- 确保所有数值控制端口（time, feedback, wet）仍为 type:'number' 且 kind 默认（data）。
- 确保 process() 实现保持轻量：不要在 node-core 中创建 Tone 对象；仅返回反馈对象（例如 {value: <current> } 或 {}）。
- 运行 tsc / pnpm -w build:all 验证编译通过。
- 在 PR 描述中说明这些改动的动机（音频端口要作为 sink 而不是 data）。
```

**为什么**：保证 NodeRuntime 不把音频流当数值流计算，避免 DAG 执行问题（循环、性能）。

**验收**：

* `pnpm -w build` 无错误；
* Manager UI 中，Tone Delay / Tone Osc 的 In/Out ports 在 schema 上改为 `sink`（可在节点的 schema JSON 中查看）。

---

### Step 2（中级，强烈推荐） — 支持 graph->audio wiring（sdk-client / tone-adapter）

**目标**：让 adapter 能根据 manager 的 graph 连接把 Tone.js 对象连接起来（实现图形连线的音频链）。

**关键改动**：

1. **修改 NodeExecutor.deploy**：把 `parsed.graph.connections` 传给  `this.toneAdapter?.syncActiveNodes`。（当前代码只传 nodeIds。）

   * 修改位置：`packages/sdk-client/src/node-executor.ts`，部署部分 `this.toneAdapter?.syncActiveNodes(toneNodeIds);` 改为 `this.toneAdapter?.syncActiveNodes(toneNodeIds, parsed.graph.connections);`。

2. **扩展 tone-adapter.syncActiveNodes**：签名变为 `syncActiveNodes(activeNodeIds: Set<string>, connections: Connection[])`，实现流程：

   * 释放（dispose）已不存在的 tone 实例；
   * 为新出现的 audio nodes 创建 Tone.js 对象（Osc/Player/Gain/Effect wrapper），并存入 `oscInstances`, `playerInstances`, `effectInstances` 等 map（adapter 已有这些 map）；确保只创建一次；
   * 遍历 `connections`，若 `source` 和 `target` 是音频节点（在 activeNodeIds 且类型为 tone-*），且 connection 的 sourcePort/targetPort 对应音频端口（例如 id 'out' -> 'in'），则把 `sourceAudioOutput.connect(targetAudioInput)`（需要 adapter 的 wrapper 提供 input/output Node）。
   * 支持混合：若没有 explicit connection，仍然保留 bus-based chain 逻辑（不破坏现有 behavior）。

**Agent Prompt（详细）**：

```
在 packages/sdk-client/src/node-executor.ts：
- 将 deploy() 中调用 this.toneAdapter?.syncActiveNodes(toneNodeIds) 替换为:
  this.toneAdapter?.syncActiveNodes(toneNodeIds, parsed.graph.connections);

在 packages/sdk-client/src/tone-adapter.ts：
- 修改 ToneAdapterHandle.syncActiveNodes 的签名为 syncActiveNodes(activeNodeIds:Set<string>, connections: any[]).
- 实现如下逻辑:
  1) Dispose 并删除在 activeNodeIds 之外的 instances (oscInstances, effectInstances, etc).
  2) 对 activeNodeIds 中每个 nodeId: 若为 audio node 并且 adapter 中无实例，则创建 Tone.js object (player/osc/gain/effect wrapper). 使用 ensureTone() 确保 toneModule 已加载.
  3) 清除之前的 audio wiring（disconnect）。
  4) 遍历 connections 参数，筛选出 connect 操作: 如果 sourceNodeId/targetNodeId 都属于 audio nodes, 且 sourcePortId === 'out' 并 targetPortId === 'in' (或其他映射), 则做:
       sourceInstance.output.connect(targetInstance.input)
     其中 sourceInstance.output 与 targetInstance.input 是 adapter 中为每个音频 node 暴露的 AudioNode（或 Tone.js node）。
  5) 对没有 explicit connections 的情况，保持现有的 bus-based rebuildBusChain() 为 fallback。
  6) 对新建的 effect/osc/player 要调用 rebuildBusChain(bus) 或 explicit connect，确保 masterGain 已 connect。
- 保持实例化尽量一次完成（在 deploy 时创建），之后 process() 只更新参数(rampTo).
- 编写单元/集成测试：1) 构造一个小图 (player -> delay -> client) 并部署，检查 tone-adapter 中对应实例存在且已连接; 2) 更新 graph connections (插入/移除 effect) 并检查连接变更。
```

**为什么**：这一步使得 Manager 的连线有“真正”的音频连接语义（用户直观），并避免仅靠 bus/order 的不便。

**可能风险**：

* 需要保证连接/断开操作能正确 dispose/重连，避免内存泄漏；
* 需要处理连接拓扑（循环）时的行为（sink ports 允许循环，但 adapter 建音频循环时要小心 Feedback 导致 runaway）。

**验收**：

* 在 Manager 上画图：`LoadAudio -> PlayMedia -> ToneDelay -> Client`，deploy 后，在 client 上实际能听到经 Delay 处理的声音（用 mute/solo 做验证）；同时manager不卡了。

---

### Step 3（短期修复 / 兼容路径） — 若先选择 bus 模型：确保 Manager UI 使用 bus/order

**目标**：如果选择先不实现 graph->audio wiring，而继续用 bus 模式，请**确保 Manager 在图 UI 上能方便设置节点的 bus 与 order**，并在文档/提示中说明“要插入 Delay，请把 Delay 的 bus 设为音源 bus 并调整 order”。同时修复 Tone Delay 在 node-core 使用 sink 端口的行为（Step 1）。

**Agent Prompt**：

```
1) 在 Manager 的 node config UI（apps/manager/...）为音频节点增加 bus 字段可编辑（如果尚未明显展示）。
2) 当 user deploy 时，toneAdapter.rebuildBusChain(bus) 会按照 effectInstances 排序（adapter 已有该逻辑），确保 effectNodes 可通过 bus/order 生效。
3) 更新 Manager 文档/tooltip: “若要在音源与输出之间插入 effect，请把 effect 的 bus 设置为音源 bus，并设置 order。”
```

**优点**：快速可行，最小改动。
**缺点**：不够直观（用户需理解 bus/order 概念）。

---

### Step 4（确保音频解锁与资源管理）

**目标**：确保 Tone.js 在客户端由用户手势解锁且 masterGain 正确连接。实现 adapter 的 `enableAudio()` 并在 client UI 的 Start 按钮上调用。

**Agent Prompt**：

```
1) 在 apps/client 的体验入口（pages/index.svelte 或同等）添加 Start Audio 按钮（或复用现有 “进入体验” 按钮）。
2) 按钮 handler 调用:
   const adapter = getToneAdapter(); // 或者直接调用 window.toneAdapterEnable
   await adapter.ensureTone();  // dynamic import
   await toneModule.start();    // Tone.start()
   adapter.ensureMasterGain();
   adapter.setAudioEnabled(true);

3) 在 tone-adapter 中添加 method enableAudio() that calls ensureTone() and toneModule.start() and sets audioEnabled = true, also call ensureMasterGain().

4) 在 NodeExecutor 的 deploy/start 时，若 requiredCapabilities includes 'sound' 且 audioEnabled is false, 向 Manager 发送 friendly message/request to enable audio.
```

**验收**：

* 在 iOS/Safari 上用户点击 Start 后，音频可以播放（Tone.start() 未被阻止），client 上能听见音源。

---

### Step 5（回收与性能 - 必做）

**目标**：实现 robust dispose / memory management，并把重型逻辑移出 process。

**Agent Prompt**：

```
1) 在 tone-adapter 实现 disposeNode(nodeId) 以及 disposeAll()。
2) 在 NodeExecutor.remove / destroy / runtime.clear 调用 this.clearToneNodes()（已有），确保 clearToneNodes 调用 toneAdapter.disposeAll().
3) 在 adapter 的 create logic 中，确保实例只创建一次并存入 map；process() 不再创建实例。
4) 在创建 Tone nodes 时尽量复用 masterGain 与 shared nodes，使用 rampTo 做参数平滑 (DEFAULT_RAMP_SECONDS = 0.05)
5) 添加简单内存/对象泄漏测试脚本：连续 add/remove node 多次，确认 instances map 长度随部署而变，不会累积旧实例。
```

**验收**：

* 多次部署/移除 node graph 后内存不会持续增长（手动或自动化检查），并且 manager tick 时长稳定。

---

## 五、为什么这些改动既能解决你的问题又不破坏系统设计（架构理由）

1. **保持单一真相源**：node-core 只改接口层（port type/kind），不引入 Tone 依赖；sdk-client 中才实现具体 Tone.js 行为 —— 仍然遵循“接口在 node-core，运行时实现在线端”的设计理念（与现有 Register-override 模式一致）。你现有的 `registerToneClientDefinitions` 模式正好支持这种分离。
2. **解耦实现**：把重型 audio 实例创建放在 tone-adapter（client-side），node-core 的 process 保持轻量，保证 manager 侧的序列化/显示/编辑逻辑与 client 的运行时解耦。
3. **向后兼容**：保留 bus-based fallback（adapter 已有），同时新增 graph->audio wiring 支持，兼容旧图并为用户提供直观的连线行为。adapter 的 `rebuildBusChain()` 仍可作为 fallback/optimization 应用。

---

## 六、潜在危险（必须谨慎的点）

1. **音频循环/反馈**：当 graph-connections 形成 audio loop（比如 oscillator 输出回到自己的输入），如果没有限幅或防止 runaway 的策略，浏览器会出现无限增益/失真。**必须**在 adapter 中对 feedback 做 clamp（gain 限制）或对循环增加自动 limit（音量/滤波器）。
2. **移动端性能**：大量 Tone Node 实例（很多 players/osc）会消耗 CPU/电量。限制 active audio 节点数量、pooling、或自动降级（把高成本插件用更轻量实现）很重要。
3. **内存泄漏**：不正确的 dispose 会导致内存和 AudioContext 节点泄漏。务必在节点移除或 graph 变更时 `disconnect()` 并 `dispose()` Tone 对象。tone-adapter 已有 `disposeNode()` 钩子（需要在 NodeExecutor.clear/remove 时调用）。
4. **用户体验（解锁）**：iOS/Safari 必须用户交互解锁音频；未处理好会导致“看似部署、但没有声音”。必须在 UX 上明确提示并要求用户点击 Start（或在进入体验时触发）。

---

## 七、完整的一步步实现计划（带 Agent 的提示词：把前面关键信息组合成可用命令）

我在前面已经把每一步的 Agent prompt 直接列出。下面把整个计划按优先级汇总（带时间估计，按 1 人 dev）：

1. **Step 1（1–2 天）**：修改 node-core port 类型为 `any` + `kind: 'sink'`（所有 tone-* 节点） — *必要*（PR）

   * Agent prompt 如上（Step 1）。
2. **Step 4（0.5–1 天）**：在 client UI 添加“启动音频”按钮并在点击时调用 toneModule.start(); 在 adapter 添加 enableAudio()。 — *必要*（PR）

   * Agent prompt 如上（Step 4）。
3. **Step 5（0.5–1 天）**：实现 dispose / 内存清理（adapter）并把 process 中的 heavy 工作移出（确保实例化只在 deploy/first use）。 — *必要*（PR）

   * Agent prompt如上（Step 5）。
4. **Step 2（2–4 天）**：实现 graph->audio wiring（NodeExecutor.deploy: 传 connections；adapter.syncActiveNodes 解析 connections 并 connect）。— *推荐*（中等复杂度，PR）

   * Agent prompt 如上（Step 2）。
5. **Step 3（可选/临时）**：如果短期内不做 Step 2，可以先改 Manager UI 以暴露 bus/order（快速修复），并更新 docs。 — *备用*（PR）

   * Agent prompt 如上（Step 3）。
6. **测试/优化（1–2 周）**：完成 e2e, mobile Safari 测试、压力测试、内存泄漏测试、并调优 ramp 值、pooling、bus chain 性能等。

---

## 八、直接可用的代码片段（最关键的三处示例）

> 我把最常见且能立即起效的三处最小改动给出。**请在实际提交前用 TypeScript 校验并运行测试**。

### 1) node-core: 把 Tone Delay 的 ports 改成 sink/any（示例）

（在 `packages/node-core/src/definitions.ts` 中 `createToneDelayNode()` 的 inputs/outputs 片段）

```ts
function createToneDelayNode(): NodeDefinition {
  return {
    type: 'tone-delay',
    label: 'Tone Delay',
    category: 'Audio',
    inputs: [
      { id: 'in', label: 'In', type: 'any', kind: 'sink' },         // <- 音频信号
      { id: 'time', label: 'Time (s)', type: 'number', defaultValue: 0.25 },
      { id: 'feedback', label: 'Feedback', type: 'number', defaultValue: 0.35 },
      { id: 'wet', label: 'Wet', type: 'number', defaultValue: 0.3 },
    ],
    outputs: [{ id: 'out', label: 'Out', type: 'any', kind: 'sink' }], // <- 音频信号
    configSchema: [
      { key: 'bus', label: 'Bus', type: 'string', defaultValue: 'main' },
      { key: 'order', label: 'Order', type: 'number', defaultValue: 10 },
      { key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true },
    ],
    process: (_inputs, _config) => {
      // Node-core 保持轻量：实际 audio wiring 在 client-side adapter
      return {};
    },
  };
}
```

### 2) NodeExecutor.deploy: 把 connections 传给 adapter（示例）

（在 `packages/sdk-client/src/node-executor.ts` 的 `deploy()`）

```ts
// after parsed.graph computed
const toneNodeIds = new Set(parsed.graph.nodes.filter(n => ...).map(n => n.id));
this.toneAdapter?.syncActiveNodes(toneNodeIds, parsed.graph.connections); // <--- 改动：传 connections
```

### 3) tone-adapter.syncActiveNodes 伪代码（核心思想）

```ts
// packages/sdk-client/src/tone-adapter.ts (伪)
function syncActiveNodes(activeNodeIds: Set<string>, connections: Connection[]) {
  // 1. dispose nodes not in activeNodeIds
  // 2. create instances for active nodes that lack one
  // 3. disconnect all existing audio connections
  // 4. for each connection in connections:
  //      if connection.sourceNodeId in activeNodeIds && connection.targetNodeId in activeNodeIds
  //         and source/target types are audio nodes: 
  //            const src = getOutputAudioNode(connection.sourceNodeId, connection.sourcePortId)
  //            const dst = getInputAudioNode(connection.targetNodeId, connection.targetPortId)
  //            if (src && dst) src.connect(dst)
  // 5. fallback: rebuild bus chain for buses if no explicit connections were provided
}
```

---

## 九、最终建议与优先级总结

* **必须先做（高优先级）**：把 `tone-*` 节点的音频端口改为 `type: 'any', kind: 'sink'`（node-core）；在 client UI 调用 Tone.start() 来解锁音频。——这两步将立即解决“节点被当数值处理”和“浏览器自动阻止播放”两个最核心问题。
* **强烈建议（中期）**：实现 graph->audio wiring（NodeExecutor -> tone-adapter），使 Manager 的连线真正代表音频连接（更直观）。
* **性能/安全**：adapter 中确保一次创建、复用 Tone 对象；`process()` 保持轻量；断开/销毁做到位；并在 adapter 中防止 audio feedback runaway。

---

## 十、给你的 Vibe Coding Agent 的“逐步完整任务清单”（可直接复制粘贴）

我把上面每一步的 Agent prompt 再次列成一个“任务清单”，你可以把下面的每个任务逐条发给 Agent（或直接让 Agent 顺序执行）——每条都非常具体（文件、函数、测试要点）：

**Task 1 — node-core: 把音频端口设为 sink/any**
（同前 Step1 的 Agent Prompt — 见上文）

**Task 2 — node-executor: 把 connections 传给 toneAdapter**
（同前 Step2 的 NodeExecutor 修改）

**Task 3 — tone-adapter: 支持 syncActiveNodes(activeNodeIds, connections) 并按 connections 建立 Tone.js connect()**
（同前 Step2 的详细 Agent Prompt）

**Task 4 — client UI: 音频启动按钮与 enableAudio()**
（同前 Step4 的 Agent Prompt）

**Task 5 — adapter: 实现 dispose、pooling、并把 heavy work 从 process 移出**
（同前 Step5 的 Agent Prompt）

**Task 6 — 测试与优化**

* 编写自动化 e2e（Playwright）检查：deploy graph (player->delay->client)，检查 client 播放并带 delay 效果；多次 deploy/remove 后无泄漏；iOS 交互解锁后可播放。
* 性能调优（ramp seconds、pool、max concurrent audio nodes）。

---

## 十一、结语（马上可以执行的下一步）

要把问题彻底解决，**第一步** 请先把 `createToneDelayNode()`（以及所有 `tone-*` 节点）中的 `In/Out` 改成 `type:'any', kind:'sink'`（node-core），并在 client 的体验页面上增加“启用音频”按钮来确保 `Tone.start()` 被调用（tone-adapter 的 `ensureTone()` + `Tone.start()`）。这两步会立刻消除 Manager 卡顿（因为 NodeRuntime 不再把音频端口当数值流）并解决大多数“client 无声”的场景。

