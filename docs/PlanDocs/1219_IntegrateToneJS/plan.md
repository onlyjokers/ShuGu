下面是我对把 **Tone.js** 集成到你现有 `onlyjokers/ShuGu` 项目（Manager / Client 的 node-graph 系统）中的**深入可行性分析、设计方案、优缺点与风险、详细实现步骤**，并给出每一步需要交给 Vibe Coding Agent 的**精确提示词（prompt）**。内容尽量事无巨细、直接可执行，且保证**不改动现有“单一真相源”设计**、不新开传输路径、保持解耦与高性能。

我先说明结论摘要，然后逐项展开细节、代码样例、注意事项和逐步实施计划。

---

# 结论（摘要）

* **可行**：可以把 Tone.js 作为“客户端实现层”的音频执行引擎集成进来，而保持 node 定义（类型、端口、config schema）在 `@shugu/node-core`（单一真相源），并在 `@shugu/sdk-client`（客户端）**覆盖/实现**这些 node 的具体行为（使用 Tone.js 创建音频节点、Transport、Loop、实时参数更新等）。
* **关键设计**：把节点的 **接口（类型/端口/配置）放在 node-core**，Manager 与 Client 共用；把 **运行时（真实音频对象、调度、loop、实时更新）实现放在 sdk-client**，通过在客户端注册相同 `type` 的 NodeDefinition（覆盖）来实现“同一套 node 定义 + 不同实现”的模式。
* **优点**：不破坏现有架构（Manager / Client 使用相同的 graph 类型）；Manager 不需知道 Tone 内部实现；Client 可基于 Tone 的 Transport 做高精度循环与调度，且支持 Manager 下发的 JSON（config/overrides）与实时更新。
* **风险/限制**：Tone.js 包大小、iOS/Safari 的 AudioContext 恢复（必须用户手势）、移动设备性能/热量、调度时钟和 NodeRuntime tick 间的语义差异、内存泄漏（节点移除时必须 dispose Tone 对象）、音频权限和潜在安全策略。
* **实现方式**：（1）在 node-core 增加 Tone 节点的**描述（接口）**；（2）在 sdk-client 增加 `tone-adapter` 模块，动态 `import('tone')` 并在客户端注册**覆盖实现**（利用 NodeDefinition.process / onSink、context.nodeId 管理 per-node Tone 实例）；（3）把 loop 与 schedule 用 Tone.Transport/Tone.Loop/Tone.Part 管理，map Manager 时间（server time）与 Tone 时间；（4）注意音频上下文 resume、平滑参数（ramp）、移除/清理。

下面我把每个要点详细展开并给出精确代码示例与实现步骤、每一步的 Agent 提示词。

---

# 一、为什么选这种方式（设计理由）

1. **保持“单一真相源”**：`@shugu/node-core` 仍然包含节点类型/端口/配置的定义（Manager 与 Client 共用），这样 UI、序列化、Manager 的 JSON 都一致。——参考 `registerDefaultNodeDefinitions()` 的实现位置与组织方式（node-core）见：`packages/node-core/src/definitions.ts`（此处注册了 LFO、数值等基础节点）。
2. **客户端的实现必须依赖浏览器能力**（WebAudio、user gesture、Tone.js 运行），因此真实 Tone 逻辑应放在 `@shugu/sdk-client`（客户端 SDK）内，而不是 node-core（node-core 必须保持轻量、可在 manager/node 环境中运行）。这与 `@shugu/sdk-client` 的职责一致（客户端运行时/执行器）。NodeExecutor 在 sdk-client 中创建并注册默认 node 定义（见 NodeExecutor constructor）。
3. **覆盖注册机制可实现无缝替换**：`NodeRegistry.register()` 用 `definition.type` 作为 key，并允许后续 `register` 覆盖之前的 definition（见 NodeRegistry 实现）。因此我们可以在 node-core 定义节点接口后，在 sdk-client 再用 Tone.js 的客户端实现覆盖同一 type。

---

# 二、总体架构图（概念）

```
Manager UI (使用 node-core 的节点定义)  <--graph JSON-->  Server (routing)
                                                        |
                                                     Socket
                                                        |
Client SDK (NodeExecutor)  -- registry.register(default node defs from node-core)
      |-- registerToneClientDefinitions(registry)  (覆盖同一 node.type)
      |-- NodeRuntime tick -> 调用 NodeDefinition.process(context)
      |-- tone-adapter (per-node Tone instances + Tone.Transport scheduling)
         - dynamic import('tone')
         - per-node map: nodeId -> ToneObjects (Osc, Gain, Filter, Loop)
         - process() 更新 Tone 参数（频率、幅度），onSink() 处理命令（start/stop）
```

---

# 三、详细设计（关键点 + 典型节点）

下面我提出一组核心 Tone 节点（示例）与它们在 node-core（定义）与 sdk-client（实现）之间的职责分配。以 `tone-osc`（振荡器）与 `tone-filter`（滤波器）为例，再给出 `tone-loop`（loop/control）节点设计。

> 设计原则：
>
> * **接口在 node-core**：ports、configSchema、label、category 都在 `@shugu/node-core`，以便 Manager 能显示与序列化；
> * **实现放在 sdk-client**：process/onSink 执行 Tone 实例创建、更新、调度；
> * **尽量使用 data ports（非 sink）来连接控制信号**（例如 LFO -> tone-osc.frequency），因为 data ports 会纳入 compute DAG，可与现有节点自由连线；
> * **side-effects（音频对象创建/调度）在客户端实现中进行**；在 node-core 的 process 可返回基本反馈值（例如当前 amplitude），便于 Manager 仪表显示。

---

## 3.1 在 `@shugu/node-core` 中增加 node 定义（示例 `tone-osc`）

在 `packages/node-core/src/definitions.ts` 中，添加以下 “描述” 函数（仅包含接口和轻量 process）：

```ts
// packages/node-core/src/definitions.ts  (新增函数样例)
function createToneOscNode(): NodeDefinition {
  return {
    type: 'tone-osc',
    label: 'Tone Osc',
    category: 'Audio',
    inputs: [
      { id: 'frequency', label: 'Freq', type: 'number', defaultValue: 440 },
      { id: 'amplitude', label: 'Amp', type: 'number', defaultValue: 1 },
      // ...可以添加 offset 等
    ],
    outputs: [{ id: 'value', label: 'Out', type: 'number' }],
    configSchema: [
      {
        key: 'waveform',
        label: 'Waveform',
        type: 'select',
        defaultValue: 'sine',
        options: [
          { value: 'sine', label: 'Sine' },
          { value: 'square', label: 'Square' },
          { value: 'triangle', label: 'Triangle' },
          { value: 'sawtooth', label: 'Sawtooth' },
        ],
      },
      {
        key: 'enabled',
        label: 'Enabled',
        type: 'boolean',
        defaultValue: false,
      },
      {
        key: 'loop',
        label: 'Loop (pattern)',
        type: 'string',
        defaultValue: ''
      }
    ],
    process: (inputs, config, context) => {
      // node-core 实现只需要返回反馈数值，实际音频动作由客户端覆盖实现
      const amp = (inputs.amplitude as number) ?? (config.enabled ? 1 : 0);
      return { value: amp };
    }
  };
}

registry.register(createToneOscNode());
```

> 目的：让 Manager 在 UI 中能看到 `tone-osc` 节点、编辑 waveform / enabled / loop 等配置；graph JSON 可以序列化、传给 Client。

---

## 3.2 在 `@shugu/sdk-client` 中实现 Tone.js 客户端实现（核心：`tone-adapter`）

在 `packages/sdk-client/src/` 中新增一个模块 `tone-adapter.ts`，它做三件事：

1. **动态导入 `tone`**（减小初始 bundle，按需加载）；
2. **维护 per-node Map（nodeId -> Tone资源对象）**；
3. **注册覆盖实现**（`registry.register(...)`），实现 `process`（每次 tick 更新参数）和 `onSink`（处理命令、start/stop、schedule）。

关键点要实现：

* 使用 `context.nodeId` 管理每个节点的 Tone 实例；
* 在第一次 `process` 被调用时用 `import('tone')` 创建 Tone 对象（不能在 node-core 中创建，因为 node-core 不在浏览器）；
* 使用 Tone.Transport/Tone.Loop/Tone.Part 来实现高精度 loop，loop 的时间与 `ClientSDK.getServerTime()` 做对齐（参见下方同步段）；
* 在 `process` 中不要做重型创建——只做参数更新（rampTo / setValueAtTime）以保证低延迟和性能；
* 当 Node 被 remove/clear 时，清理对应 Tone 实例（dispose）。

下面给出简化版（示例性）代码：**（注：示例省略错误处理与类型细节，实际请以 TypeScript 完整实现并严格异常捕获）**

```ts
// packages/sdk-client/src/tone-adapter.ts
import type { NodeRegistry } from '@shugu/node-core';
import type { ProcessContext } from '@shugu/node-core';

type ToneLib = any; // 用 any 简化，实际用 Tone 的类型
const instances = new Map<string, { osc?: any, gain?: any, filter?: any, loop?: any }>();
let Tone: ToneLib | null = null;
let toneReady = false;

async function ensureTone() {
  if (toneReady) return;
  const mod = await import('tone'); // dynamic import
  Tone = mod.default ?? mod;
  // Optional: create a global master gain, set low CPU defaults
  toneReady = true;
}

export function registerToneClientDefinitions(registry: NodeRegistry) {
  // override tone-osc
  registry.register({
    type: 'tone-osc',
    label: 'Tone Osc (client)',
    category: 'Audio',
    inputs: [
      { id: 'frequency', label: 'Freq', type: 'number', defaultValue: 440 },
      { id: 'amplitude', label: 'Amp', type: 'number', defaultValue: 1 },
    ],
    outputs: [{ id: 'value', label: 'Amp', type: 'number' }],
    configSchema: [
      // same as node-core
    ],
    process: (inputs, config, context: ProcessContext) => {
      // be as fast as possible — lazily create Tone instance
      ensureTone().then(() => {
        let inst = instances.get(context.nodeId);
        if (!inst) {
          // create oscillator + gain, connect to Tone.Destination
          const osc = new Tone.Oscillator({
            frequency: Number(inputs.frequency ?? config.frequency ?? 440),
            type: String(config.waveform ?? 'sine')
          }).start();
          const gain = new Tone.Gain({ gain: Number(inputs.amplitude ?? 1) }).toDestination();
          osc.connect(gain);
          instances.set(context.nodeId, { osc, gain });
          inst = instances.get(context.nodeId)!;
        } else {
          // update type if changed
          const newWave = String(config.waveform ?? 'sine');
          if (inst.osc.type !== newWave) inst.osc.type = newWave;
        }
        // real-time parameter smoothing:
        const freq = Number(inputs.frequency ?? config.frequency ?? 440);
        inst.osc.frequency.rampTo(freq, 0.05); // 50ms smoothing
        const amp = Number(inputs.amplitude ?? config.amplitude ?? 1);
        inst.gain.gain.rampTo(amp, 0.05);
      }).catch((e) => console.warn('[tone] ensureTone error', e));

      return { value: Number(inputs.amplitude ?? config.amplitude ?? 0) };
    },
    onSink: (inputs, config, context) => {
      // optional: accept command-style triggers, or manager-driven commands (start/stop)
      // e.g., if inputs contains {trigger:true} array
    }
  });

  // register tone-filter, tone-delay, tone-loop 等类似实现
}
```

**要点：**

* `process` 用 `context.nodeId` 管理 per-node 资源；
* `rampTo` 或 `setTargetAtTime` 用于平滑参数变化，避免点击噪声；
* `ensureTone()` 使用动态 import，减少首包体积；
* 对于 loop（pattern）应该使用 Tone.Transport 的 Loop/Part，见下节。

---

## 3.3 Loop / Transport 的实现（关键）

Manager 要求：**能实现 Loop 循环，且在 loop 运行时还能实时更新（config/overrides/inputs）**。

实现建议：

1. 在客户端创建一个全局 `AudioEngine`（或存在于 `tone-adapter` 内）来管理 Tone.Transport、masterGain、并提供 `createLoop(nodeId, pattern, tempo, startAtServerTime?)`、`updateLoop(nodeId, newPattern)`、`disposeLoop(nodeId)` 等 API。
2. 当 node 配置 `loop` 字段被设定（例如 node-core config: `{ loop: "0,1,0,0,1" }` 或更复杂 JSON），客户端 `process`/`onSink` 会检测到 `config.loop`，并调用 `AudioEngine.createOrUpdateLoop()` 建立或更新 Tone.Part/Tone.Loop，Tone.Part 的 callback 里可以触发 oscillator 的 `start`/`stop`，或触发 gain envelopes。
3. **对齐 server time 与 Tone 时间**：ClientSDK 提供了 NTP 风格的 time sync（`ClientSDK.getServerTime()`，`scheduleAt` 等），用于把 Manager 的 `executeAt`（server timestamp）换算为本地延迟；在 Tone 中可以通过 `Tone.now()`（audio time）加上偏移做对齐。简单策略：在创建 loop / schedule 时，把 server-time 转换为 `Tone.Transport` 时间（seconds），调用 `Tone.Transport.schedule()` 或 `Tone.Transport.start(startAt)`。
   `ClientSDK` 中已经有时间同步与 schedule API（参见 `client-sdk.ts` 的相关函数：`getServerTime()`, `scheduleAt` 等），可以直接利用来把 Manager 的 executeAt 与 Tone.Transport 对齐。

**示例伪代码：**

```ts
// 在 tone-adapter.ts 中
async function createOrUpdateLoop(nodeId: string, pattern: any, ctx) {
  await ensureTone();
  const inst = instances.get(nodeId);
  if (!inst) return;
  if (inst.loop) {
     inst.loop.dispose();
     inst.loop = null;
  }
  // pattern: array of steps, each step may contain {timeOffsetMs, velocity}
  const part = new Tone.Part((time, step) => {
    // time 是 Tone 的时间（seconds），在这里触发 oscillator/gain
    inst.osc.frequency.setValueAtTime(step.freq, time);
    inst.gain.gain.setValueAtTime(step.amp, time);
    // 如果需要 trigger / envelope
  }, pattern.map(...));
  part.start(0);
  inst.loop = part;
}
```

**注意**：

* Tone.Transport 必须 `start()` 才能驱动 Part/Loop；
* Tone.Transport.start 的启动时间应考虑 `ClientSDK` 的 server time 同步结果（确保 Manager 的 executeAt 能被精确执行）。

---

# 四、如何让 Manager 发送 JSON 并实时更新（与现有 override 机制结合）

`NodeExecutor` 已经提供了 `override-set` 与 `override-remove` 命令（Manager -> Client），并最终在 `NodeExecutor` 中调用 `runtime.applyOverride(nodeId, kind, key, value, ttlMs)`，而 `NodeRuntime` 在 tick 时会把 overrides 合并到 `getEffectiveConfig` 中并传给 `process`。因此，我们只需保证 **客户端 Tone 实现会在每次 process 中读取 `config` 与 `inputs` 并及时更新 Tone 实例参数**。`NodeRuntime.process` 每个 tick 会调用 NodeDefinition.process 并传入 `context`（包含 `time` 与 `nodeId`），这就允许我们做到“实时更新”——只要 `process` 在每次调用时把 inputs/config 更新到 Tone 实例上即可。相关逻辑在 `NodeRuntime` 与 `NodeDefinition` 的类型中体现：`process(inputs, config, context)`。

**因此实现路径**：

* Manager：编辑节点 config 或通过 override 发送新的 config.json（例如更改 loop pattern 或 waveform）；
* Manager: 发出 `override-set`（NodeExecutor.handlePluginControl 中已有实现） -> Client NodeRuntime.applyOverride -> next tick NodeDefinition.process 读取新的 config 并更新 Tone 实例（或在 onSink 中对命令做即时响应）。
* 如果需要精确按 server 时间执行某些事件（比如 loop 在 manager 指定的 server 时间开始），在 manager 下发包含 `executeAt` 的命令（PluginControlMessage/override 或 node 的 command），客户端使用 `ClientSDK.scheduleAt` 将 Tone.Transport.start 或 Tone.Part.start 安排到正确的本地时间。

---

# 五、实现细节（保证不破坏现有系统、性能与解耦）

我把关键实现与实现细节列成 checklist / 要点，保证系统特性满足你的 6 点注意事项：

### 5.1 不改变现有 manager-client 数据路径

* **不新增额外的“音频信号传输路径”**。所有控制 / 配置 都走现有的 node graph / override / PluginControl 消息（NodeExecutor 已有）。Client 上实现 Tone 时直接在 NodeDefinition.process/onSink 内做 side-effect，不需引入特殊新通路（符合第 5 条要求）。

### 5.2 Manager / Client 共用 node 定义（单一真相源）

* **将 node 的 interface（type/ports/config）放在 node-core**，在 sdk-client 通过 `registry.register()` 覆盖实现（type 相同），Manager 仍然看到相同节点（符合第 6 条）。NodeRegistry 的 `register()` 会覆盖定义（见实现）。

### 5.3 实时更新与 Loop

* NodeRuntime tick（默认 33ms）会带来 30Hz 更新；**对于控制参数（LFO -> freq、amplitude）这通常够用**（你已有 LFO 以每 tick 计算值）。
* 但**音频事件 / Loop / 精确调度**应使用 Tone.Transport（音频线程时间），并在客户端把 Manager 的 executeAt（server time）映射到 Tone.now()，以实现高精度、低抖动的循环与事件触发。
* Config/Override 更新通过 NodeRuntime.applyOverride 生效，客户端 Tone 实现每 tick 读取并 apply，或在 onSink 中实现即时变更（当 Manager 下发命令需要即时响应时）。

### 5.4 保证不破坏解耦

* node-core 定义只包含 interface；sdk-client 的 tone-adapter 只依赖 NodeRegistry 与 NodeDefinition API（不改 node-core），因此解耦性良好。
* tone-adapter 模块与 Tone.js 的使用完全在客户端，且通过动态导入减少主包体积。

### 5.5 性能和安全（watchdog）

* NodeExecutor 已经实现 tick 超时 watchdog、max nodes 等限制（见 NodeExecutor constructor limits）——我们需要利用这些限制（例如 `requiredCapabilities` 包含 sound）来 gate 音频功能。比如 NodeExecutor 使用 `canRunCapability('sound')` 检测 audioContext 可用。
* Tone 实例应被池化/共享（避免每 tick 都创建），并在节点卸载时 `dispose()`。要测试手机上内存/CPU。

### 5.6 iOS / Safari 音频限制

* **必须在用户手势下 resume audio context / Tone.start()**。提供一个触发点（比如 Client 页面“进入体验 / Start”按钮）来调用 `await Tone.start()` 或 `audioContext.resume()`。这是不可避免的浏览器限制（iOS/Safari）。见 README 的兼容性说明（Mobile browser compatibility）。

---

# 六、潜在风险与应对（事无巨细）

我把主要风险列出，并给出缓解措施：

1. **包体积（Tone.js）过大**

   * 缓解：采用 dynamic import (`import('tone')`)，仅在需要音频功能时才加载；并在 bundler 中开启 Tree-shaking / 使用 Tone 的 modular build（如果可行）。
   * 另：可考虑仅引入必要的子模块或用原生 WebAudio 做轻量实现（如果仅实现少数效果器，原生或小库更小）。

2. **调度 Drift / 同步问题**

   * 缓解：使用 ClientSDK 的 time sync（NTP style）把 server executeAt 转为本地时间，基于 Tone.Transport schedule。`ClientSDK.getServerTime()` 与 `scheduleAt` 是现成工具。请务必校验延迟与 drift，并在必要时用 periodic re-sync 修正。

3. **内存泄漏 / 节点 remove 后未释放 Tone 实例**

   * 缓解：在 `tone-adapter` 中实现 `onNodeRemoved` 或在 `NodeRuntime.loadGraph`/clear 时通过监听或在 `process` 检测到 node 已不存在来 `dispose()` 对应实例。具体：在 sdk-client，当 NodeExecutor 调用 `runtime.clear()` 或 `runtime.loadGraph()` 时向 tone-adapter 发出通知，或在 NodeDefinition.process 中检测 `context.nodeId` 是否仍存在（更明确：在 NodeRuntime/NodeExecutor 中暴露钩子给 adapter）。

---

# 七、分步实现计划（逐步，含测试、回滚点与Agent prompt）

下面是一份逐步、细化到每一步要做什么、向 Vibe Coding Agent 的 precise prompt（非常明确），每一步都包含预期代码文件修改点、测试方法和验收标准。

> **重要**：所有改动要走 feature 分支（例如 `feature/tone-integration`），并配合 CI（单元 & e2e）和手动手机浏览器测试（iOS Safari）。

---

## Step 0 — 前置准备（设定目标与依赖）

**目标**：在不破坏现有 runtime 的前提下，使客户端能支持 Tone.js 驱动的 `tone-osc` 节点（最小 PoC），并能在 Manager 改变 config / override 时实时更新，且能做 loop。

**Agent prompt（Step 0）**：

```
创建一个 feature 分支 feature/tone-integration。列出需要修改的文件和新增文件：
1. packages/node-core/src/definitions.ts — 新增 createToneOscNode (type='tone-osc')，仅定义接口/ports/config/process（轻量）。
2. packages/sdk-client/src/tone-adapter.ts — 新增模块（动态 import('tone')，管理 per-node Tone 实例并注册客户端实现）。
3. packages/sdk-client/src/node-executor.ts — 在 constructor 中 registerDefaultNodeDefinitions 之后调用 registerToneClientDefinitions(this.registry).
4. 在 apps/client 的体验入口页面 (确定文件路径) 增加一个“启用音频” 按钮，触发 Tone.start()（或 AudioContext resume）。
请创建提交模板和 PR 描述，并在 PR 中说明手动测试用例。
```

---

## Step 1 — 在 node-core 中添加 tone-osc 定义

**目标**：把 tone-osc 的接口加入 node-core，保证 Manager 能看到节点并序列化。

**变更文件**：`packages/node-core/src/definitions.ts`

**Agent prompt（Step 1）**：

```
在 packages/node-core/src/definitions.ts 中新增函数 createToneOscNode()，并在 registerDefaultNodeDefinitions 中注册它。NodeDefinition 要包含：
- type: 'tone-osc'
- inputs: frequency:number(default 440), amplitude:number(default 1)
- outputs: value:number
- configSchema: waveform(select: sine,square,triangle,sawtooth default sine), enabled:boolean default false, loop:string default ''
- process: 快速返回 { value: amplitude }（这是 node-core 的轻量实现）
格式、注释与现有风格一致。
请确保编译通过（pnpm -w build 或 packages/node-core 的 tsc）。
```

**验收**：

* `pnpm -w build` 成功；
* Manager 的节点库中显示 `Tone Osc` 节点（可在 Manager UI 打开 nodes catalog 查看）。

---

## Step 2 — 在 sdk-client 添加 tone-adapter（客户端实现）

**目标**：实现 Tone.js 客户端行为（创建 Oscillator、Gain，参数更新、loop 支持骨架）。

**变更文件**：新增 `packages/sdk-client/src/tone-adapter.ts`，并在 `packages/sdk-client/src/node-executor.ts` 的 constructor 注册 `registerToneClientDefinitions(this.registry)`（在 `registerDefaultNodeDefinitions` 之后）。

**Agent prompt（Step 2）**：

```
在 packages/sdk-client/src/ 下新增 tone-adapter.ts，功能如下：
1. export async function registerToneClientDefinitions(registry: NodeRegistry): void
2. 内部维护 Map<string, Instance> instances（key=nodeId），Instance 至少包含 osc/gain/loop/volume。
3. 实现 ensureTone(): dynamic import('tone') 并赋 Tone 变量；
4. 注册一个 NodeDefinition 覆盖 type='tone-osc'：
   - process(inputs, config, context): 
       - 确保 Tone 已加载（调用 ensureTone）
       - 如果 instances 不存在，创建 Tone.Oscillator 和 Tone.Gain 并 connect 到 Tone.Destination（或 Tone.getDestination()）
       - 更新 osc.frequency.rampTo(frequency, 0.05) 和 gain.gain.rampTo(amplitude, 0.05)
       - 如果 config.loop 存在且与实例不同，调用 createOrUpdateLoop (在此模块实现)
       - 返回 { value: currentAmp }
   - onSink: 可实现对 start/stop/trig 等命令的响应
5. createOrUpdateLoop(nodeId, loopPattern, tempo?) 使用 Tone.Part 或 Tone.Loop 实现基本 loop，并用 Tone.Transport 驱动。
6. 在 module 顶部实现 disposeNode(nodeId) 在 Node 移除或 runtime.clear 时释放资源（inst.osc.dispose() inst.gain.dispose() inst.loop.dispose()）
7. 在 NodeExecutor constructor 初始化后调用 registerToneClientDefinitions(this.registry)
请写清楚 TypeScript 类型并处理动态 import 的异常。
```

**验收**：

* 客户端 bundle 不会在首次加载时包含 Tone（使用 dynamic import），且当创建/部署包含 `tone-osc` 的 graph 时，浏览器会 fetch Tone bundle；
* 在客户端 console 能看到 tone-adapter 的日志（例如 Tone.js 加载成功）；
* Manager 可以部署一个包含 `tone-osc` 的简单 graph 到 client，client 执行并能听到声音（在桌面/模拟器初步测试）。

---

## Step 3 — 集成 loop 与 server-time 对齐

**目标**：让 Manager 可以在 node config 或通过 override 指定 loop pattern 与 start 时间（server time），Client 基于 Tone.Transport 精确执行 loop，并在运行时支持即时更新 pattern。

**Agent prompt（Step 3）**：

```
在 tone-adapter.ts 中新增以下：
1. AudioEngine 管理 Tone.Transport、masterGain。提供：
   - startTransportAt(serverTimeMs): 计算本地 Delay = clientSDK.getDelayUntil(serverTimeMs) -> 调用 setTimeout(() => Tone.Transport.start()) 或使用 Tone.now() + offset
   - createOrUpdateLoop(nodeId, patternJson, startAtServerTimeMs?, loopLengthMs?)
   - removeLoop(nodeId)
2. 在 process 或 onSink 中，如果 detect config.loop 或 inputs.control 指示 start，调用 createOrUpdateLoop。
3. 使用 ClientSDK 的 scheduleAt 或 getServerTime（通过注入 ClientSDK 或通过 NodeExecutor 的依赖暴露）来把 serverTime 映射为本地时间，然后把 Tone.Transport 的事件 schedule 到 Tone 的时间基准（Tone.now() + delta）。
4. 提供 API 以在 Manager 更改 pattern（override-set）时立即调用 createOrUpdateLoop 更新 Tone.Part，而不是销毁并重建所有东西（以减少断裂）。
5. 增加基础测试：Manager 下发一个 loop pattern，client 在正确时间开始播放；中途改变 pattern ，pattern 被即时更新。
```

**验收**：

* 手动测试：Manager 在 5 秒后发出 Start 指令（executeAt），client 在约定时间启动 loop；
* 中途 Manager 修改 loop pattern，client 的 loop 无缝更新（无明显断裂或大量延迟）。

---

## Step 4 — 用户手势与 capability gating（iOS/Safari）

**目标**：处理 iOS 的 audio resume 啊问题，并把 NodeExecutor 的 capability gating 与 UI 结合。

**Agent prompt（Step 4）**：

```
1. 调用 await ensureTone(); await Tone.start(); 并记录 audioEnabled 状态（localStorage/session），同时触发 NodeExecutor 允许 sound 所需操作或启用音频相关 nodes。
2. 在 NodeExecutor.deploy 或 constructor 中，已经有 canRunCapability('sound') 检测，确保当音频未启用时，部署带有 requiredCapabilities ['sound'] 的 graph 会被拒绝。若部署的 graph 未包含 sound requirement，但节点库有 tone nodes，则在触发播放时给出提示（例如 UI 提示需要启用音频）。
```

**验收**：

* iOS Safari 上点击 “启用音频” 后 Tone.start() 成功并且后续部署能发声；
* 没有用户手势时，部署不会产生异常，且系统能展示友好提示。

---

## Step 5 — 清理/回收、edge case、性能优化

**目标**：处理节点删除、runtime.clear 等情况下的资源释放，避免内存泄漏；优化动态导入和 Tone 对象复用。

**Agent prompt（Step 5）**：

```
1. 在 tone-adapter 实现 disposeNode(nodeId) 并在 NodeRuntime/NodeExecutor 的 clear/loadGraph/removed 分支适当调用：
   - NodeExecutor 在 remove/deploy/remove override 等事件之后调用 tone-adapter 的清理钩子（在 NodeExecutor 类中增加一个 optional hook 注册点）。
2. 优化：避免为每个音色都创建独立 Tone.Destination 连接，使用单一 masterGain，减少 context nodes。
3. 性能：在 process 中避免阻塞（ensureTone 应该只在第一次做动态导入），参数更新用 rampTo（0.02~0.1s），避免每 tick 创建对象。
4. 写 e2e 测试脚本，自动化检查多次 add/remove node 不会导致内存增长（基础 smoke test）。
```

**验收**：

* 通过内存剖面证明多次 add/remove 不会泄漏 Tone 对象；
* NodeExecutor.clear() 调用后 instances Map 为空，Tone.Transport 停止（若没有其他 loop）。

---

# 八、优缺点对比（为何选 Tone.js）

**优点**：

* Tone.js 提供成熟的高层 API（Oscillator、Transport、Part、Loop、envelope、effects），能快速实现复杂的音频行为与精确调度；
* Transport/Part 可用于精确 loop 与 schedule；
* 社区活跃、文档完善。

**缺点**：

* 包体积较大（需 dynamic import & tree-shaking 减少影响）；
* 在低端手机上可能占用较多 CPU，需优化对象复用与参数平滑；
* iOS 权限 / user gesture 必须处理；
* 需要注意内存管理与 dispose。

**替代**：

* 原生 WebAudio + 自己实现 Transport（精力大）；或更小的第三方库（例如 Tone 的 modular build、orchestra-lite，但功能受限）。如果对包体积极度敏感，可以考虑只用 WebAudio 实现几个核心节点（osc、filter、delay）并手工实现简单 Transport 调度。

---

# 九、代码片段（整合示例）

我把关键代码片段整理成一步可直接拷贝的示例（脱离项目可能需小改）。**这是高层示例，真实提交时请按项目 lint/tsconfig/导出方式完善**。

**node-core: createToneOscNode（摘录）**：
（已经在上文给出示例，放在 `packages/node-core/src/definitions.ts` 并注册）

**sdk-client: tone-adapter（核心伪代码）**：

```ts
// packages/sdk-client/src/tone-adapter.ts
import { NodeRegistry } from '@shugu/node-core';
import type { ProcessContext } from '@shugu/node-core';
import { ClientSDK } from './client-sdk'; // 用于 getServerTime/scheduleAt

let Tone: any = null;
const instances = new Map<string, any>();
let toneLoaded = false;

async function ensureTone() {
  if (toneLoaded) return;
  const mod = await import('tone');
  Tone = mod.default ?? mod;
  toneLoaded = true;
}

// create or update instance
async function ensureInstance(nodeId: string, inputs: any, config: any) {
  await ensureTone();
  let inst = instances.get(nodeId);
  if (!inst) {
    const osc = new Tone.Oscillator({ type: config.waveform ?? 'sine', frequency: inputs.frequency ?? 440 }).start();
    const gain = new Tone.Gain({gain: inputs.amplitude ?? 1}).toDestination();
    osc.connect(gain);
    inst = { osc, gain, loop: null };
    instances.set(nodeId, inst);
  }
  return inst;
}

export async function registerToneClientDefinitions(registry: NodeRegistry, clientSdk?: ClientSDK) {
  registry.register({
    type: 'tone-osc',
    label: 'Tone Osc (client)',
    category: 'Audio',
    inputs: [
      { id: 'frequency', label: 'Freq', type: 'number', defaultValue: 440 },
      { id: 'amplitude', label: 'Amp', type: 'number', defaultValue: 1 },
    ],
    outputs: [{ id: 'value', label: 'Amp', type: 'number' }],
    configSchema: [
      // mirror node-core schema
    ],
    process: (inputs, config, context: ProcessContext) => {
      // asynchronous ensureInstance but do not await (fire-and-forget)
      ensureInstance(context.nodeId, inputs, config).then(inst => {
        // update params smoothly
        const freq = Number(inputs.frequency ?? config.frequency ?? 440);
        const amp = Number(inputs.amplitude ?? config.amplitude ?? 1);
        if (inst.osc && inst.osc.frequency) inst.osc.frequency.rampTo(freq, 0.05);
        if (inst.gain && inst.gain.gain) inst.gain.gain.rampTo(amp, 0.05);
        // if config.loop present -> createOrUpdateLoop(inst, config.loop)
      }).catch(e => console.warn('[tone-adapter] error', e));

      // return immediate feedback
      return { value: Number(inputs.amplitude ?? config.amplitude ?? 0) };
    },
    onSink: (inputs, config, context) => {
      // handle commands: start/stop, or pattern triggers
      // e.g., if inputs['cmd'] === 'start' -> Tone.Transport.start()
    }
  });
}
```

---

# 十、测试建议（手工 + 自动）

1. **单元测试**：node-core 新增 tone node 定义的单元（Schema 正确）；NodeRegistry 能列出节点；`registerToneClientDefinitions` 注册成功（mock registry）。
2. **集成/端到端（PC 浏览器）**：

   * Manager 创建简单 graph： `number(440) -> tone-osc.frequency` + `number(0.4) -> tone-osc.amplitude`，部署到 client。点击 Client 的 “启用音频” 后，能听到 440Hz 声音，改变 manager 上的数值可以立即改变声音。
   * Manager 配置 loop pattern（例如 4 steps），send start at server time，client 在期望时间开始循环；在 loop 运行时 manager 修改 pattern，client 立即更新。
3. **手机浏览器测试（iOS Safari）**：验证 user gesture -> Tone.start()，并验证性能（CPU、内存、温度）。
4. **压力测试**：尝试 10-20 个 tone 节点，测量 tick 时长（NodeExecutor 会在 watchDog 超时停止），保证不超预算。

---

# 十一、给 Vibe Coding Agent 的完整工作流 prompt（把每步整合成可直接执行的任务）

下面把之前分步的 prompt 合并成一组可直接给 coding agent 的任务（**每个任务都非常具体**：文件、函数、行为、测试点）。你可以把这些 prompt 逐一交给 Agent。

### Task A — 新增 `tone-osc` node 定义（node-core）

````
任务：在 'packages/node-core/src/definitions.ts' 中添加 createToneOscNode(), 并在 registerDefaultNodeDefinitions 中注册它。
要求：
- type='tone-osc'，label='Tone Osc'，category='Audio'
- inputs: frequency:number(默认440), amplitude:number(默认1)
- outputs: value:number
- configSchema:
   - waveform(select: sine,square,triangle,sawtooth, default sine)
   - enabled (boolean default false)
   - loop (string default '')
- process(inputs, config, context) 返回 { value: amplitude }（轻量实现）
- 确保 ts 编译通过
请提交 PR，包含单元测试（若已有测试体系，写最小测试用例）。```

### Task B — 新增 `tone-adapter`（sdk-client）
````

任务：在 'packages/sdk-client/src' 新增 'tone-adapter.ts'，并在 'packages/sdk-client/src/node-executor.ts' 的 constructor 中，在 registerDefaultNodeDefinitions(...) 之后调用 registerToneClientDefinitions(this.registry)。
tone-adapter 需求：

* 动态导入 Tone: ensureTone() -> import('tone').
* instances Map 管理 nodeId -> {osc, gain, loop}
* register tone-osc 的 NodeDefinition 覆盖（type='tone-osc'):

  * process: lazily create osc/gain on first run，使用 osc.frequency.rampTo(freq, 0.05) 及 gain.gain.rampTo(amp, 0.05)
  * onSink: 接受命令（start/stop/trig）并在必要时调用 Tone.Transport
* 实现 disposeNode(nodeId) 以释放 Tone 资源
* TypeScript 风格一致，错误捕获、日志记录
  请包含本地手动测试步骤说明（如何在本地 manager->client 流程中验证）。

```

### Task C — Loop 与 transport 对齐（sdk-client）
```

任务：在 tone-adapter 中实现 createOrUpdateLoop(nodeId, loopPattern, startAtServerTimeMs?) 功能：

* 使用 Tone.Part / Tone.Loop 来实现 loop
* 使用 ClientSDK 的 scheduleAt/getDelayUntil（或 getServerTime）将 server executeAt 映射到 Tone 时间
* 支持在运行时更新 pattern（不 destroy 全部实例以避免断裂）
* 当 Manager 通过 override 更改 config.loop 时，应立即调用更新函数
  请提供 e2e 测试步骤（manager 下发 start at server time, client 在正确时刻开始播放; 中途更新 pattern, client 更新）。

```

### Task D — 用户手势与 capability gating（apps/client）
```

任务：在客户端体验入口增加“启用音频”按钮：

* 点击后调用 await ensureTone(); await Tone.start(); 并标记 audioEnabled 状态
* NodeExecutor 的 canRunCapability('sound') 已存在；在 Manager 部署带 requiredCapabilities: ['sound'] 的 graph 时 NodeExecutor 会阻止/检查。请把 UI 的“启用音频”与 capability gating 结合（如果未启用，显示提示）
  请在 PR 中说明 iOS 真实设备测试步骤。

```

### Task E — 清理与回收、性能优化
```

任务：

* 实现在 NodeExecutor.remove/clear/loadGraph 时调用 tone-adapter.disposeNode(nodeId)，或在 NodeExecutor 中提供 hook 给 adapter 以便在 graph 改变时清理不再存在的 nodeId。
* 避免为每个 node 创建独立 destination，请使用单一 masterGain/ destination
* 在 process 中使用 rampTo 而非直接 set，避免点击（建议 20-100ms）
* 添加基本的内存漏测（手工说明或简单脚本）并在 PR 中展示结果

```

---

# 十二、最后总结与建议时间线（粗略）
- **Week 1**：完成 node-core 的节点定义（tone-osc），并在 Manager UI 上确认可见。编写单元测试。
- **Week 2**：实现 sdk-client 的 `tone-adapter`，支持基础 Osc+Gain，动态 import，参数更新。集成到 NodeExecutor。做桌面浏览器 PoC。
- **Week 3**：实现 loop/Part/Transport, server-time 对齐、start/stop、pattern 更新。做 mobile Safari 测试（需 user gesture）。
- **Week 4**：清理/回收、性能调优、e2e 测试（多节点压力测试）、PR review 与 merge。

> 如果你需要，我可以把上面每一步的 Agent prompt 调整得更细，甚至输出可以直接粘贴到 Vibe Coding Agent 的 JSON /任务格式里（包括文件内容模板、测试用例与 PR 模板）。

---

# 十三、补充说明与引用（部分源码位置）
- `registerDefaultNodeDefinitions`（node-core） 的实现（说明 node-core 中注册了 LFO / number 等基础节点）：`packages/node-core/src/definitions.ts` 。:contentReference[oaicite:11]{index=11}  
- `NodeRegistry` 的 register/get 实现（允许覆盖）：`packages/node-core/src/registry.ts`。:contentReference[oaicite:12]{index=12}  
- `NodeExecutor` 的构造器中调用 `registerDefaultNodeDefinitions`（sdk-client），以及 capability gating（sound）的实现处：`packages/sdk-client/src/node-executor.ts`。:contentReference[oaicite:13]{index=13}  
- `NodeRuntime` 的执行模型（process/context/overrides/tick）说明：`packages/node-core/src/runtime.ts` 与类型 `ProcessContext`：`packages/node-core/src/types.ts`（context 中含 nodeId/time/deltaTime，适合管理 per-node 实例）。:contentReference[oaicite:14]{index=14} :contentReference[oaicite:15]{index=15}
