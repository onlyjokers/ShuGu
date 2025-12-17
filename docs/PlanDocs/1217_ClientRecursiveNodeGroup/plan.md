下面是我基于你仓库 `onlyjokers/ShuGu`（`manager_renew` 分支）代码做的**详细分析 + 设计方案 + 实现计划（含逐步修改清单与 Vibe Code Agent 的提示词）**。我把关键点分成三部分：**原有架构与可复用点（快速回顾）**、**解决方案（算法 + 协议 + UI + 客户端运行时）**、**分步实现计划（每步要改的文件、关键代码片段示例、Vibe Agent 提示词）**。同时我会列出**优缺点和潜在风险/缓解办法**。为了便于参考，我在关键论据处引用了仓库里相关实现的位置（可直接打开查看实现细节）。


# 一、快速回顾（可复用的现有实现）

在你的项目中已经存在一个相当成熟的“节点图 + 引擎”体系，值得复用：

* Manager 侧有一个 `NodeEngine`（无 UI 的执行引擎），执行模型是：**compile（构建无环 DAG，忽略 sink 输入）→ tick（按照 DAG 顺序计算 outputs）→ 执行 sinks（onSink）**。`NodeEngine` 在 manager 端已有 cycle 检测（Kahn’s algorithm），但注意 **编译时故意忽略 `sink`（kind === 'sink'）**，因此允许“通过 sink 回到源”的环路（这正是你要检测并打包的那类自循环）。参考实现：`apps/manager/src/lib/nodes/engine.ts`（compile / tick / cycle 检测等）。见示例：compile 的处理和“忽略 sink”逻辑以及 cycle 抛错位置。 

* Node 类型里已经有 `client-object`（Manager 端代表 Client 的节点，输出 client + sensors，输入 `in` 为 sink 用来发送控制命令）和 `proc-client-sensors`（把 client 的传感器消息解析为多个 numeric output），以及 `proc-flashlight` 等处理型节点（它们输出 command 信息，由 `client-object` 的 sink 最终发送）。参考：`ClientObjectNode.ts`、`ClientSensorsProcessorNode.ts`、`FlashlightProcessorNode.ts`。  

* Manager UI 使用 Rete 做可视化编辑器（`apps/manager/src/lib/components/nodes/NodeCanvas.svelte` + `ReteNode.svelte`），这意味着我们可以在 UI 层对节点/连线设定额外状态以用于高亮（例如 `localLoop` 标志，触发 Rete view 重新渲染并改变 CSS）。NodeCanvas 已经是 graphState 的观察者（`nodeEngine.graphState`），修改后它可以订阅新的“检测到的本地循环” store 来高亮对应节点/连线（NodeCanvas 主文件在 `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`）。

* Client SDK (`packages/sdk-client`) 已有丰富的“动作执行器”（`action-executors.ts`）来处理 flashlight、screen、vibrate 等具体设备行为。我们可以在 client 侧的 node-runtime 中直接复用这些执行器，来把 manager 的“cmd”变为本地行为。

---

# 二、总体设计 —— “检测并发给客户端运行的局部自循环”

目标：只要有“自循环链路里既包含 `client-object`（Client 节点）又包含 `proc-client-sensors`（Client Sensors）”——即从 Client 出发，经 Client Sensors 等节点再回到 Client（主要通过 Client.in sink 实现回路）——就将这个**局部子图**打包并下发到对应 Client，本地在 Client 端执行，从而节省网络带宽并降低 manager 与 server 的工作量（仅在参数改变时才下发）。

我们分三层实现：**检测（manager）→ 打包 + 协议（manager→client）→ 客户端运行时（client）**。

---

## 2.1 检测（Manager 侧）

### 原因

`NodeEngine.compile()` 有意在构建 DAG 时**忽略 sink**边（so that sinks can create closed loops). 这会让 **典型的 client→sensors→...→client（通过 sink）** 的闭环不被判为“循环而拒绝”。因此我们需要专门的检测逻辑来 **发现包含 client 与 client-sensors 的闭环**。

### 算法（要点）

* **构建一个完整的有向图**，**包含 sink 边**（即不再忽略 sink）。
* 对每个 `client-object` 节点做 DFS / Tarjan / Johnson 的简单循环检测，**找出能从 client 回到自身且路径中包含 `proc-client-sensors` 节点的 cycle / simple cycle**。只要路径中出现 `proc-client-sensors` 并最终回到 client，即判定为“可下发子图”。
* 为性能与可读性，采取针对每个 client 的**受限 DFS**（图通常不大），记录第一圈发现的 cycle 即可（UI 只需标出“存在此类局部自循环”并展示这部分节点与连线）。

### 输出

针对每一个检测到的局部自循环，返回结构：

```ts
type LocalLoop = {
  id: string; // loop id
  nodeIds: string[]; // nodes in this local loop
  connectionIds: string[]; // connections that connect them
  requiredCapabilities: string[]; // e.g. ['accel','gyro','mic','flashlight']
  clientsInvolved: string[]; // client-node IDs (通常 1)
}
```

> 实现位置建议：扩展现有 `NodeEngine`（`apps/manager/src/lib/nodes/engine.ts`）增加方法 `detectLocalClientLoops()`，并在图发生变化（`addConnection`、`removeConnection`、`loadGraph`、`removeNode` 等）时更新 `localLoops` 可观察 store（`Writable<LocalLoop[]>`），Manager UI 订阅它以改变显示与按钮可用性。

> 证据：`NodeEngine` 已处理节点/连线，可在同一类中新增检测调用。

---

## 2.2 打包 + 协议（Manager → Client）

### 打包策略

* **最小子图**：只包含 local loop 中的节点与它们相互之间的连接（`graph.nodes.filter(n => nodeIds.includes(n.id))`；`connections.filter(c => nodeIds.includes(c.sourceNodeId) && nodeIds.includes(c.targetNodeId))`）。
* **仅允许白名单节点类型**：出于安全和健壮性，只允许下发一份 **白名单**，例如：

  * `client-object`（在 client 端会被实现为“本地 ClientObject”）
  * `proc-client-sensors`
  * `proc-flashlight`, `proc-screen-color`, `proc-vibrate`, `MathNode`, `LFONode`, `NumberNode`, `ParamGet/SetNode`（注意 Param 会涉及 manager 参数 —— 只允许 ParamGet/Set 引用 manager 可下发的参数或把参数值序列化到节点 config 中）
  * 其它纯计算类节点（需评估）
* **Capability 列表**：根据子图节点类型导出 `requiredCapabilities`（如 sensors/mic、flashlight、screen），下发前 manager 在 UI 告知（必须 client 授权 / 支持）。
* **Metadata**：版本号、timestamp、id、执行周期建议（例如 tickInterval），以及是否自动启动/按需 start/stop。
* **序列化格式**：采用现有 `GraphState`（`nodes`, `connections`）的精简副本 + `meta` 字段即可 —— 便于在 client 端直接 `loadGraph()`。

示例 payload（发送给 client）：

```json
{
  "graph": {
    "nodes": [ /* 节点：id,type,config,inputValues,position... */ ],
    "connections":[ /* id,sourceNodeId,sourcePortId,targetNodeId,targetPortId */ ]
  },
  "meta": {
    "requiredCapabilities": ["accel","gyro","flashlight"],
    "tickInterval": 33,
    "version": "1"
  }
}
```

### 协议（利用现有 protocol）

* 你已有 `PluginControlMessage` 专门用于插件控制（manager→client）。我们可以 **复用 / 扩展 protocol** 的 `PluginControlMessage`：

  * `pluginId = 'node-executor'`（新增类型到 `PluginId` 联合）
  * `command = 'deploy' | 'start' | 'stop' | 'remove'`（新增到 `PluginCommand`）
  * `payload` 按上面 `graph+meta` 格式
* 在 manager 侧调用 `managerSdk.sendPluginControl(targetClients(...), 'node-executor', 'deploy', payload)` 即可将子图下发到某些 client（ManagerSDK 已有 `sendPluginControl` 方法）。

> 需要在 `packages/protocol/src/types.ts` 中把 `PluginId` 增加 `'node-executor'`、把 `PluginCommand` 增加 `'deploy' | 'start' | 'stop' | 'remove'`。

---

## 2.3 客户端运行时（Client 端轻量 NodeEngine）

### 总体思路

* 在 `packages/sdk-client` 中实现一个 **轻量版 NodeEngine（NodeRuntime）**，结构与 manager 端的 NodeEngine 接近，但精简（去掉与 manager 特有的 Parameter modulation、UI store 等），并且：

  * 可接受来自 manager 的 `graph`（同样的 `GraphState`）并 `loadGraph()`。
  * 在 NodeDefinitions 中**注册若干 client 特有的 node 实现**：

    * `client-object`（client 端实现）**关键点**：其 `process` 返回实时 sensor snapshot（由 `sensor-manager` 提供），其 `onSink` 不发 socket，而是**本地执行命令**：调用 `action-executors`（例如 `FlashlightController.setMode`、`ScreenController.setColor`、`navigator.vibrate` 等）。这恰好把 manager graph 中 `proc-flashlight` 产生的 `cmd` 通过 client-object 的 sink 在本地执行。
    * `proc-client-sensors`、`proc-flashlight`、`MathNode` 等节点可复用 manager 的 `process`（只要 `process` 不依赖 manager-only 服务）。
  * NodeRuntime 的 `tick()`（默认每 33ms）执行与 manager 类似（先 compile 再 tick），因为 manager 的 compile 算法 O(V+E) 适合用于生成执行顺序（**注意**：compile 仍然应忽略 sink，以保持原有的 compute-sinks 两段模型）。
  * 在 `onSink` 执行实际动作时，需要考虑 `executeAt`（时间同步），使用 SDK 的 `getServerTime()` / scheduleAt 支持（client SDK 已有时间同步工具）。
* 在 client SDK 中增加一个 `node-executor` 模块（例如 `packages/sdk-client/src/node-executor.ts`），当接收到 plugin 控制 `deploy` 命令时，验证 `requiredCapabilities`、把 graph `loadGraph()`，并根据 meta 决定立即 `start()` 或保持就绪；并提供 `start/stop/remove` 控制接口。

### 权限与资源限制（client 侧）

* Client 需要在接收 `deploy` 时**自动检测能力**（是否支持 torch、vibrate、sensor permission 等）；如果不支持或未授权，则**拒绝运行并回报 manager**（使用系统 message 或 plugin response）。
* 需要一个**watchdog**：限制 node 数量（比如 ≤ 50）、tickInterval 下限（例如不能低于 20ms）、禁止任意 JS 执行（我们只下发 node graph 的数据，不下发脚本）。
* 允许用户（或设备）在 client UI 中**开关允许远程子图执行**（隐私／能耗控制）。

---

# 三、优点 / 缺点 / 危险点（与缓解）

## 优点

* **节省网络/CPU**：高频的本地数据循环（传感器→处理→执行）在 client 本地跑，manager/server 不再转发与处理高频数据命令。
* **响应更快**：减少 RTT 引起的延迟，特别是 blink / LFO / 模拟实时反馈场景。
* **可控制、渐进式部署**：只把“自循环”下发，不影响 manager 的其它逻辑；manager 仍然可远程修改参数并重新下发或更新 graph。

## 缺点 & 风险

1. **安全/隐私**：下发的 graph 能操控设备（闪光、震动、摄像头/麦克风权限等）。

   * 缓解：**严格白名单 node**、metadata 列出 `requiredCapabilities`、client 必须明确授予/启用远程执行权限；manager 在 UI 提示风险与权限要求。
2. **能耗**：错误或恶意下发会耗电/升温/占用资源。

   * 缓解：tickInterval 最小值约束、最大节点数、watchdog（超出时间/CPU 限制自动停止）。
3. **版本/兼容性**：manager 的节点定义与 client 的实现需要**版本对齐**。

   * 缓解：payload 中带 `executorVersion` / `protocolVersion`，client 在接收时比对。
4. **调试复杂度**：分布式调试复杂。

   * 缓解：提供 manager UI 的“模拟运行（Local Simulate）”和 client 侧日志上报（plugin / system message）。
5. **安全攻击面**：如果允许任意节点类型（或未来插件），可能被滥用。

   * 缓解：only allow whitelisted node types, no eval / arbitrary JS.

---

# 四、详细实现计划（逐步 + 代码片段 + Vibe Code Agent 提示词）

下面把实现拆成**7 个主要任务**（按先后）。每步列出要改的文件、关键代码思路/片段、以及给 Vibe Code Agent 的**详细提示词**（你可以直接把这些提示词交给 agent 去生成代码 / PR）。我尽量把每步做到“事无巨细”。

---

## 任务 1 — 在 NodeEngine 中增加“检测 local client loops”并暴露 store

**目标**：`nodeEngine.detectLocalClientLoops()` + `nodeEngine.localLoops: Writable<LocalLoop[]>`，并在图变更时更新。

**修改文件**：`apps/manager/src/lib/nodes/engine.ts`

**关键点 / 伪码**：

在类 `NodeEngineClass` 中：

1. 新类型：

```ts
type LocalLoop = {
  id: string;
  nodeIds: string[];
  connectionIds: string[];
  requiredCapabilities: string[];
  clientsInvolved: string[]; // list of client-node.id (usually one)
};
```

2. 新 store：

```ts
public localLoops: Writable<LocalLoop[]> = writable([]);
```

3. 新方法（重要 — 我把要点写成 TypeScript 代码，agent 可据此实现）：

```ts
private detectLocalClientLoops(): LocalLoop[] {
  const nodes = Array.from(this.nodes.values());
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  // Build adjacency including sink edges
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const conn of this.connections) {
    const outs = adj.get(conn.sourceNodeId) || [];
    outs.push(conn.targetNodeId);
    adj.set(conn.sourceNodeId, outs);
  }

  const loops: LocalLoop[] = [];

  // Helper: is client-object? is client-sensors?
  const isClient = (nodeId: string) => nodeMap.get(nodeId)?.type === 'client-object';
  const isClientSensors = (nodeId: string) => nodeMap.get(nodeId)?.type === 'proc-client-sensors';

  // For each client node, search for cycles that return to it and include proc-client-sensors
  for (const startNode of nodes.filter(n => n.type === 'client-object')) {
    const startId = startNode.id;
    const stack: string[] = [];
    const onStack = new Set<string>();
    const visitedLocal = new Set<string>();

    const dfs = (curId: string) => {
      if (onStack.has(curId)) {
        // found cycle: extract cycle nodes from stack
        const idx = stack.indexOf(curId);
        const cycle = stack.slice(idx);
        if (cycle.includes(startId) && cycle.some(isClientSensors)) {
          // Collect connection ids among cycle
          const connIds = this.connections
            .filter(c => cycle.includes(c.sourceNodeId) && cycle.includes(c.targetNodeId))
            .map(c => c.id);
          // compute requiredCapabilities by node types (simple mapping)
          const reqCaps = new Set<string>();
          for (const nid of cycle) {
            const t = nodeMap.get(nid)?.type;
            if (t === 'proc-client-sensors') {
              reqCaps.add('sensors');
            } else if (t === 'proc-flashlight') reqCaps.add('flashlight');
            else if (t === 'proc-screen-color') reqCaps.add('screen');
            else if (t === 'proc-vibrate') reqCaps.add('vibrate');
          }
          loops.push({
            id: `loop-${crypto.randomUUID?.() ?? Date.now()}`,
            nodeIds: [...cycle],
            connectionIds: connIds,
            requiredCapabilities: Array.from(reqCaps),
            clientsInvolved: [startId],
          });
        }
        return;
      }
      if (visitedLocal.has(curId)) return;
      visitedLocal.add(curId);

      onStack.add(curId);
      stack.push(curId);
      for (const neigh of adj.get(curId) || []) {
        dfs(neigh);
      }
      stack.pop();
      onStack.delete(curId);
    };

    dfs(startId);
  }

  // Deduplicate loops by node-set signature
  const uniq: LocalLoop[] = [];
  const seen = new Set<string>();
  for (const l of loops) {
    const key = l.nodeIds.slice().sort().join(',');
    if (!seen.has(key)) {
      seen.add(key);
      uniq.push(l);
    }
  }
  return uniq;
}
```

4. 在 `addConnection` / `removeConnection` / `addNode` / `removeNode` / `loadGraph` 等操作后，调用 `this.updateLocalLoops()`：

```ts
private updateLocalLoops() {
  const loops = this.detectLocalClientLoops();
  this.localLoops.set(loops);
}
```

5. 在构造或初始化时，确保 `localLoops` store 存在并初始为 `[]`。

**Vibe Code Agent 的提示词（中文）**：

> 请在仓库分支 `manager_renew` 中对文件 `apps/manager/src/lib/nodes/engine.ts` 做如下改动：
>
> 1. 在 `NodeEngineClass` 中新增 `type LocalLoop` 类型和 `public localLoops: Writable<LocalLoop[]> = writable([])`。
> 2. 新增方法 `private detectLocalClientLoops(): LocalLoop[]`，实现上采用完整有向图（包含 sink 边）的 DFS，针对每个 `client-object` 节点找出从该节点出发并最终回到自身的环路，要求环路中**必须包含**类型为 `proc-client-sensors` 的节点。循环判定后收集循环内节点 ids 与连接 ids，并根据节点类型构造 `requiredCapabilities`（例如 proc-flashlight → 'flashlight'等）。
> 3. 新增 `private updateLocalLoops()`，在 `addConnection`、`removeConnection`、`addNode`、`removeNode`、`loadGraph` 这些图修改点调用该方法以更新 store。
> 4. 保持代码风格、TS 类型定义完整并添加必要的单元测试（至少覆盖检测到一个由 client→proc-client-sensors→flashlight→client.in 的循环）。
>    请把实现提交为一个小 PR，并在 PR 描述中附上简单测试用例与性能说明（复杂图下 DFS 的上界）。

---

## 任务 2 — 在 Manager UI（NodeCanvas）高亮本地循环，并提供“下发”按钮

**目标**：NodeCanvas 订阅 `nodeEngine.localLoops`，一旦检测到 loop，**高亮 loop 中的节点和连线**（例如通过在 Rete 的 node data 上增加 `localLoop: true` 标志，areaPlugin.update('node', id) 触发重渲染），并在 UI 上增添“Deploy to client”按钮（当选择一个 loop 时）。

**修改文件**：

* `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`（订阅 `nodeEngine.localLoops` 并在构建节点视图时把 `data.localLoop = true`）
* `apps/manager/src/lib/components/nodes/ReteNode.svelte`（增加用于高亮的 class，例如 `.node.local-loop { box-shadow: ... }`）

**关键代码点**（伪码）：

在 NodeCanvas 初始化或 graphState subscription 中：

```ts
import { nodeEngine } from '$lib/nodes'; // 已存在
let localLoopUnsub = nodeEngine.localLoops.subscribe((loops) => {
  // 清除之前高亮
  for (const [id, view] of nodeMap.entries()) {
    view.localLoop = false;
    areaPlugin?.update?.('node', id);
  }
  // 遍历 loops，将对应 node/connection 打上标记，触发 update
  for (const loop of loops) {
    for (const nid of loop.nodeIds) {
      const view = nodeMap.get(nid);
      if (view) {
        view.localLoop = true;
        areaPlugin?.update?.('node', nid);
      }
    }
    for (const cid of loop.connectionIds) {
      const connView = connectionMap.get(cid);
      if (connView) {
        connView.localLoop = true;
        areaPlugin?.update?.('connection', cid);
      }
    }
  }
});
```

在 `ReteNode.svelte` 的根 `div` 上增加 class：

```html
<div class="node {data.selected ? 'selected' : ''} {data.localLoop ? 'local-loop' : ''}" ...>
```

并为 `.node.local-loop` 和 `.connection.local-loop` 写 CSS（高亮色、动画等）。

**Deploy 按钮**：
在 NodeCanvas 的工具栏中增加：`Deploy Loop` 按钮（仅在选中 loop 时有效）：

* 弹出对话框选择 target clients（使用现有 ClientSelector）。
* 显示 requiredCapabilities。
* 点击确认后，调用 `managerSdk.sendPluginControl(target, 'node-executor','deploy', payload)`，其中 payload = `serialize loop graph + meta`（下述任务 3 实现 `serializeLoop`）。

**Vibe Agent 提示词（中文）**：

> 在 `apps/manager/src/lib/components/nodes/NodeCanvas.svelte` 中添加对 `nodeEngine.localLoops` 的订阅：当 localLoops 更新时，给 nodeMap 中对应 node 设置 `localLoop = true` 并调用 `areaPlugin.update('node', id)`；同样为 connectionMap 设置 `localLoop` 并 `areaPlugin.update('connection', id)`。
> 在 `apps/manager/src/lib/components/nodes/ReteNode.svelte` 的根元素中加入 `data.localLoop` 绑定并添加 CSS `.node.local-loop`（醒目颜色），`.output-line` 等连线也要在 connection 视图中支持 `.local-loop` 样式。
> 在 NodeCanvas UI 增加一个“Deploy Loop”按钮（仅当存在 local loop）与弹窗：显示 loop 的 `requiredCapabilities`，允许选择目标 client（使用现有 ClientSelector），确认后调用 `managerSdk.sendPluginControl(target, 'node-executor', 'deploy', payload)`，`payload` 使用 `nodeEngine.exportGraph()` 的精简子集（只包含该 loop 的 nodes 和 connections + meta）。
> 请把实现做成小 PR，并在 Manager 界面可以正确高亮与下发（本地测试：构造一个 client→proc-client-sensors→proc-flashlight→client.in 的链路并尝试 deploy）。

---

## 任务 3 — 在 NodeEngine 中实现“序列化 / 精简子图”工具

**目标**：当 Manager 要下发某个 loop 时，提供一个函数 `serializeLoop(loopId)` 返回 `GraphState + meta`（只包含 loop 内部节点与连接），并计算 `requiredCapabilities`。

**修改文件**：继续修改 `apps/manager/src/lib/nodes/engine.ts`（新增 `serializeLoop`）

**伪码**：

```ts
exportGraphForLoop(loopId: string): { graph: GraphState, meta: any } {
  const loops = get(this.localLoops);
  const loop = loops.find(l => l.id === loopId);
  if (!loop) throw new Error('Loop not found');
  const nodes = loop.nodeIds.map(id => {
    const n = this.nodes.get(id);
    // Only include allowed fields: id,type,config,inputValues,position
    return {
      id: n.id, type: n.type, config: n.config ?? {}, inputValues: n.inputValues ?? {}, position: n.position ?? {}
    };
  });
  const connections = this.connections.filter(c => loop.connectionIds.includes(c.id));
  return {
    graph: { nodes, connections },
    meta: {
      requiredCapabilities: loop.requiredCapabilities,
      tickInterval: 33,
      protoVersion: PROTOCOL_VERSION
    }
  };
}
```

**Vibe Agent 提示词（中文）**：

> 在 `apps/manager/src/lib/nodes/engine.ts` 增加 `exportGraphForLoop(loopId)` 方法，返回 `{ graph: GraphState, meta }`，graph 只包含 loop 节点/连接的精简信息（避免把 manager-only 字段下发）；meta 包含 `requiredCapabilities`、`tickInterval`、`protocolVersion` 等。要求函数对未 whitelist 的节点类型抛出错误（不允许下发）。编写对应单元测试（例如给一个 loop，序列化后只含 5 个节点，且 meta 中有 'flashlight'）。

---

## 任务 4 — 扩展 Protocol（`PluginId` / `PluginCommand`）与 Manager 下发调用

**修改文件**：

* `packages/protocol/src/types.ts`

**改动要点**：

* 在 `PluginId` 联合中增加 `'node-executor'`。
* 在 `PluginCommand` 联合中增加 `'deploy' | 'start' | 'stop' | 'remove'`（或更语义性的 `configure`/`unconfigure`，但 `deploy` 更直观）。
* 无需改变 socket 事件逻辑（ManagerSDK 已有 `sendPluginControl`），Manager 端仅需传入上述 id/command。

**Vibe Agent 提示词（中文）**：

> 修改 `packages/protocol/src/types.ts`：向 `PluginId` 加入 `'node-executor'` 字面量，并向 `PluginCommand` 加入 `'deploy'|'start'|'stop'|'remove'`；更新 types 文件里对 PluginControlMessage 的注释（并 bump PROTOCOL_VERSION 如果需要）。增加一个小测试保证 `createPluginControlMessage(target, 'node-executor', 'deploy', payload)` 产生符合 `PluginControlMessage` 的结构。

---

## 任务 5 — 在 Client SDK 中实现 Node Runtime（轻量 NodeEngine）与 node-executor 插件

**目标**：在 `packages/sdk-client` 中新增：

* `node-runtime.ts`：轻量 NodeEngine（基于 manager 的实现，删减 manager-only 功能），实现 `loadGraph()`, `start()`, `stop()`, `exportGraph()`。
* `node-definitions.ts`：注册 client 专用的 `ClientObjectNode`（本地实现），并在 client 启动时自动注册与准备。
* `node-executor.ts`：注册到 ClientSDK 的插件控制处理器，处理 `deploy/start/stop/remove`。当接到 `deploy` 时，验证 `requiredCapabilities` 与 `protocolVersion`，然后 `runtime.loadGraph(graph)`，并（根据 meta）`start()`。

**关键点说明**：

* `ClientObjectNode` 的 `process` 返回当前的 sensor snapshot（使用 `sensor-manager`），而 `onSink` 接收 `cmd` 对象并 **直接调用 action-executors**（比如 `FlashlightController.setMode` 等），支持 `executeAt`（用 SDK 的 time sync API scheduleAt / scheduleAtServerTime）。
* Node definitions (`proc-client-sensors` / `proc-flashlight`) 在 client 端可直接复用 manager 的 `process`（改写小部分如果依赖 SDK）。
* NodeRuntime 保持和 manager 一致的 two-phase tick（先 compute outputs，后 sinks），并保留 compile（Kahn，忽略 sink）以保证可预测顺序。

**Vibe Agent 提示词（中文）**：

> 在 `packages/sdk-client/src/` 新增模块：
>
> 1. `node-runtime.ts`：实现一个简化的 `NodeEngine`。基本逻辑参考 `apps/manager/src/lib/nodes/engine.ts`，但去除 manager-only store/parameter 模块。保留 `compile()`（忽略 sinks）、`tick()`（compute outputs + deliver sinks）、`start()`、`stop()`、`loadGraph()`、`exportGraph()`。tickInterval 可从 meta 指定默认 33ms。
> 2. `node-definitions.ts`：实现并注册以下节点（都遵循 Manager 侧的 NodeDefinition 接口）：
>
>    * `client-object`（关键）：`process` 返回 `sensorManager.getLatestSnapshot()`；`onSink` 接受 `inputs.in`（可能为数组），对每个 `cmd` 做 switch(action) 直接调用 `action-executors` 对应方法（flashlight/screen/vibrate/...），并支持 `executeAt`（使用 client SDK 的时间同步方法实现 schedule）。
>    * 注册 `proc-client-sensors`，`proc-flashlight` 等（如果 manager 的 `process` 代码可以直接复用，请直接复制/共享实现）。
> 3. `node-executor.ts`：在 `ClientSDK` 连接建立后，调用 `sdk.onPluginControl(...)` 注册 handler：当 pluginId === 'node-executor' 且 command === 'deploy' 时，先验证 `payload.meta.requiredCapabilities`（调用现有 action-executor / sensor-manager 的能力检测接口），如果不满足或用户未授权则通过 SDK 发送 system message 或 plugin response 拒绝；如果满足，`runtime.loadGraph(payload.graph)`，并根据 meta 启动 runtime。支持 `start/stop/remove` 命令。
>    请为 client runtime 添加日志并确保在接收不合法 graph 时能回滚（拒绝或抛错但不 crash）。同时编写集成测试（模拟 server 下发 graph 并验证 action-executors 的调用）。

---

## 任务 6 — 权限 / 能力检测与安全策略（Manager + Client）

**目标**：确保下发之前 manager 在 UI 告知 `requiredCapabilities`，client 可以拒绝，并且 client 端只能运行白名单节点、并受资源限制约束。

**修改项**：

* Manager：`serializeLoop` 只允许 `allowedNodes`，UI 在 `Deploy` 弹窗展示 `requiredCapabilities` 与 `白名单` 信息。
* Protocol：Plugin payload 加入 `requiredCapabilities` 与 `executorVersion`。
* Client：在 plugin handler 中，检测权限与能力（例如 `FlashlightController.isSupported()`），并如果缺失回报 manager（`sdk.sendSystemMessage` 或 plugin response）。在 `node-runtime` 启动后，启动一个 watchdog（例如：测量 tick 时间、节点计算时间，若超阈值自动停止并发回告警）。

**Vibe Agent 提示词（中文）**：

> 在 manager 的 Deploy 弹窗里把 `requiredCapabilities` 显示出来并要求管理员确认。
> 在 `packages/sdk-client` 的 plugin handler 中实现能力检测：对于 'flashlight' 调用 `FlashlightController.isSupported()`，对于 sensors 检查 `sensor-manager` 的 permission 状态，若能力不足则回报 manager（system message `error` 或 plugin 控制消息 `error`）。并在 client 侧实现 watchdog（最长连续执行时间、最大节点数、最小 tickInterval）并在超阈值时自动 stop 并上报。

---

## 任务 7 — 文档、测试、监控与回滚

**事项**：

* 在仓库中新增 README.md 段落，描述 node-executor 的协议、capabilities 和 UI 行为。
* 编写 end-to-end 测试（在本地 server + manager + client 模拟环境）：确保 manager 创建 loop、UI 高亮、下发到 client、client 执行、client 可 stop/remove、manager 可更新 graph（并重新部署）。
* 在 manager UI 中显示 client 的运行状态（`node-executor: running/stopped`）并显示 client 上报的日志 / errors。

**Vibe Agent 提示词（中文）**：

> 增加文档与测试：在 `docs/` 中添加 `node-executor.md` 描述部署流程、协议消息示例与权限要求。为 manager 的 NodeCanvas 增加“模拟运行(log)”按钮便于调试。为 client 添加 e2e 测试脚本（可用 puppeteer 或 playwright）来模拟 manager 下发并断言执行器调用。

---

# 五、示例：核心修改的代码样例（摘录）

下面是 `NodeEngine.detectLocalClientLoops()` 的更完整样例（可以给 agent 直接用）：

```ts
// 放在 apps/manager/src/lib/nodes/engine.ts 中 NodeEngineClass 内
private detectLocalClientLoops(): LocalLoop[] {
  const nodes = Array.from(this.nodes.values());
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const conn of this.connections) {
    const outs = adj.get(conn.sourceNodeId) ?? [];
    outs.push(conn.targetNodeId);
    adj.set(conn.sourceNodeId, outs);
  }
  const loops: LocalLoop[] = [];
  const isClient = (id:string) => nodeMap.get(id)?.type==='client-object';
  const isSensors = (id:string) => nodeMap.get(id)?.type==='proc-client-sensors';
  // For each client node try to find cycles returning to it
  for (const start of nodes.filter(n=>n.type==='client-object')) {
    const startId = start.id;
    const stack:string[] = [];
    const onStack = new Set<string>();
    const visited = new Set<string>();
    const dfs = (cur:string) => {
      if (onStack.has(cur)) {
        const idx = stack.indexOf(cur);
        if (idx >= 0) {
          const cycle = stack.slice(idx);
          // ensure cycle contains start and client-sensors
          if (cycle.includes(startId) && cycle.some(isSensors)) {
            const connIds = this.connections
              .filter(c => cycle.includes(c.sourceNodeId) && cycle.includes(c.targetNodeId))
              .map(c => c.id);
            const caps = new Set<string>();
            for (const nid of cycle) {
              const t = nodeMap.get(nid)?.type;
              if (t === 'proc-client-sensors') caps.add('sensors');
              if (t === 'proc-flashlight') caps.add('flashlight');
              if (t === 'proc-screen-color') caps.add('screen');
              if (t === 'proc-vibrate') caps.add('vibrate');
            }
            loops.push({ id:`loop-${crypto.randomUUID?.() ?? Date.now()}`, nodeIds: cycle, connectionIds: connIds, requiredCapabilities: Array.from(caps), clientsInvolved:[startId] });
          }
        }
        return;
      }
      if (visited.has(cur)) return;
      visited.add(cur);
      onStack.add(cur);
      stack.push(cur);
      for (const n of adj.get(cur) ?? []) dfs(n);
      stack.pop();
      onStack.delete(cur);
    };
    dfs(startId);
  }
  // dedupe by node set signature
  const uniq:LocalLoop[] = [];
  const seen = new Set<string>();
  for (const l of loops) {
    const key = l.nodeIds.slice().sort().join(',');
    if (!seen.has(key)) { seen.add(key); uniq.push(l); }
  }
  return uniq;
}
```

> 把这段代码融合到 `updateLocalLoops()` 的机制中，并确保每次 `addConnection/removeConnection/addNode/removeNode/loadGraph` 都会调用 `this.updateLocalLoops()`。

---

# 六、验收标准（Acceptance Criteria）

1. **检测**：在 manager 的 NodeCanvas 上，任意构造 `client-object` → `proc-client-sensors` → `...` → `client.in` 的链路时，NodeCanvas 能自动高亮该 loop。
2. **序列化**：Manager 能把该 loop 序列化为 `graph+meta`，并在弹窗展示 `requiredCapabilities`。
3. **下发**：Manager 点击 Deploy 并选择某个 client 后，ManagerSDK 使用 `sendPluginControl(..., 'node-executor', 'deploy', payload)` 下发到 client。
4. **Client 接收**：Client SDK 的 `node-executor` plugin 接收到 `deploy`，做能力检查；若通过，`runtime.loadGraph()` 并 `runtime.start()` 执行。
5. **本地执行**：在 client 端，`proc-flashlight` 产生的 `cmd` 最终在 client 端被 `ClientObjectNode.onSink` 捕获并调用 `FlashlightController`，实现闪光效果（而不是向 server 发消息）。
6. **安全**：若 client 不支持能力或用户不同意授权，则拒绝并回报 manager，不 crash。
7. **回退**：Manager 能通过 `sendPluginControl(..., 'node-executor','stop', {...})` 停止 client 上的 runtime；client 端能清理资源（stop blink / clear screens 等）。

---

# 七、总结性建议与注意事项

* **不要把“任意 JS”下发**：只传数据（graph），不下发脚本；Node definitions（实现代码）必须在 client 端预先实现并被白名单管理。
* **协议兼容**：在 `packages/protocol` 中增加 `node-executor` 后要 `bump` version 或在 payload 带 `protoVersion`，以便将来回滚/兼容。
* **逐步上线**：先实现最低限度（只支持 `proc-client-sensors` + `proc-flashlight` + `client-object`），验证稳定后再扩充其它节点类型。
* **测试**：用 3 个阶段的测试：单元（检测函数）、集成（manager UI 与 SDK 调用）、e2e（manager 下发到真实 client 浏览器并观察动作）。
* **隐私/UX**：在 client 首次接收 node-executor 请求时，一定要弹出权限/能耗提示并要求用户确认（否则容易被滥用）。
* **性能**：client runtime 应该默认在 `requestAnimationFrame` 或 `setInterval(33ms)` 上运转；确保没有内存泄漏（FlashlightController.stop/destroy）。