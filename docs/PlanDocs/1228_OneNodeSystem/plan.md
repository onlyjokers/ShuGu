下面给出**深入技术评估 + 设计建议 + 逐步实现计划（含给 Vibe Coding Agent 的逐步提示词）**。我把你目前仓库的关键实现读透了（摘取了 manager 的 `NodeEngine`、client 的 `NodeRuntime/NodeExecutor`、管理端的 UI 使用点等），并据此给出兼顾**解耦、向后兼容、性能、安全**的可执行方案。

---

# 一、现状总结（基于代码观察）

* **Manager 端**有一套 `NodeEngine`，它是带 UI 绑定（Svelte `writable` store）、负责图形/执行/本地回路检测/“offload” 的头部逻辑（例如 `offloadedNodeIds`、`deployedLoopIds` 等），并在 manager 的 UI 中作为单例被引用和展示（`nodeEngine`）——代码片段见 `apps/manager/src/lib/nodes/engine.ts`，其中明确存在用于“跳过在 manager 执行的节点（offloaded）”等 manager 特有逻辑：`// Nodes that are offloaded to the client runtime (skip execution + sinks on manager)` 等（参考）。
* **Client 端**在 `packages/sdk-client` 中实现了一套 `NodeRuntime` + `NodeExecutor`，`NodeRuntime` 负责编译/执行/override/watchdog 等底层 tick 逻辑；`NodeExecutor` 则负责和 SDK（socket、plugin 控制）结合、部署/开始/停止/override 等操作（参考）`packages/sdk-client/src/node-runtime.ts`、`packages/sdk-client/src/node-executor.ts`（摘录）、。
* Manager 的 UI（`NodeCanvas.svelte`）**直接依赖** manager 的 `nodeEngine` 作为来源（如 `graphState`, `localLoops`, `deployedLoops` 等）。在 NodeCanvas 中还会调用 SDK 的 `sendPluginControl(..., 'node-executor', ...)` 来与客户端协作（见 `NodeCanvas.svelte`）。
* 因此**目前确实存在两套代码**（manager 的 NodeEngine 与 client 的 NodeRuntime/NodeExecutor）实现了类似的编译与执行逻辑，且有一些行为重复（拓扑编译、Kahn 拓扑排序、tick、watchdog、override、sink 处理等）。这会引发“manager 更新 node 系统但 client 没有同步” 的问题（你提到的）——结论跟你的观察一致。

---

# 二、目标（你给出的 + 我补充的）

* **最终目标**：只有一套“Node 核心”实现（single source of truth），Manager 与 Client 在各自平台上运行各自的轻包装（manager 提供 UI/Registry/模板导入/导出、offload/local loop 管理等高阶功能；client 提供受限的、为移动端精简的执行器 + 安全/能力门控），这样 manager 更新 node 核心时 client 能同步并且避免耦合分叉。
* **设计约束**：

  1. 不破坏现在系统设计（尽量向后兼容）；
  2. 保持解耦（core 不依赖 Svelte、Socket.io 或 browser-specific API）；
  3. 高性能（保持现有的 O(N) tick / O(V+E) compile 性能），适合移动端（可配置 tick/limits/watchdog）；
  4. 安全性与能力门控（client 侧必须能拒绝不安全/无权限运行的 graph）；
  5. 最小化生产环境破坏，提供兼容适配层以平滑迁移。

---

# 三、总体设计建议（核心思想）

* **把“通用的执行/编译/重写/超时/守护”逻辑抽象为一个新的包**，命名遵循项目 style：例如 `@shugu/node-core`（放到 `packages/node-core`）。

  * `node-core` 包内包含：类型定义（`NodeInstance`, `Connection`, `GraphState`, `ProcessContext` 等），`NodeRegistry`（节点类型注册/获取），`NodeRuntime`（核心编译/执行/override/watchdog/tick），以及 node 定义相关的基础 helper（`NodeDefinition` 类型、`registerDefaultNodeDefinitions` 的通用部分，注意：UI 特有的 node 定义（带控制）应该仍放到 manager 层）。
* **让 client 与 manager 以组合（composition）方式使用 node-core**，而不是把 manager 的 engine 或 client 的 runtime 继承 core。理由：

  * 组合更清晰、解耦更强（core 纯粹只做 runtime，不包含 UI/SDK/存储）。
  * Manager 与 Client 的角色差异较大（manager 需要 Svelte stores、loop detection、offload 管理；client 需要 SDK 集成、安全门控、硬件能力判断），将这些逻辑以组合/包装的方式放在各自包内可以保持清晰的边界。
* **兼容性策略**：

  * 让 `@shugu/node-core` 的 API 与现有 `NodeRuntime`/`NodeRegistry` 的核心 API 保持高一致性（减少更改量）。
  * 在短期内，保留现有 `packages/sdk-client` 的对外 API（例如导出 `NodeExecutor`、`NodeRuntime`），但在内部重定向到 `node-core` 的实现（即 `sdk-client` 采用 node-core 的 `NodeRuntime` 而继续实现 `NodeExecutor`）。同样 Manager 的 `NodeEngine` 将封装 `node-core` 的 runtime。这样变更可以渐进：先新增 package 并使 client/manager 依赖它，再逐步删掉重复实现。
* **抽象粒度（到底要抽象多少）**：

  * 抽象“运行时（compile + tick）”，“override 与 TTL”，“watchdog（sink burst / oscillation / tick time）”，“节点注册/定义模型/输入输出规范”，“graph 导入/导出 验证（invalid types，clientId mismatch）”这些对运行时必需的部分必须放 core 里；
  * **不要**把 manager 的 `localLoops`、Svelte `Writable` stores、UI 渲染、Rete 插件、Registry MIDI、模板导入导出等放进 core。它们属于高阶功能，应该由 Manager 的 wrapper/adapter 实现。
  * core 应提供 hooks/事件（`onTick`, `onWatchdog`, `exportGraph()` 等），供 manager/client 以自己的方式（stores、日志、监控）去接入。
* **设计模式**：使用**组合 + 事件回调**，而不是类继承深度链。核心 `NodeRuntime` 提供 API（`loadGraph()`, `start()`, `stop()`, `applyOverride()`, `exportGraph()`, `setTickIntervalMs()` 等）和回调选项（`onTick`, `onWatchdog`）供包装器使用。

---

# 四、优缺点与风险（详细）

## 优点

1. **单一权威实现（SOT）**：减少 manager/client 不一致导致的 bug（你说的 manager 更新 client 接不到的问题会被根本解决）。
2. **测试成本降低**：只需为核心写一套单元/集成测试，manager/client 各写包装器测试。
3. **维护成本降低**：fix 或性能优化在 core 做一次即可生效到两端。
4. **小体积可控**：core 保持精简、只做必须功能，client 侧仍可选择只引入必要部分以控制 bundle（树摇/按需导出）。
5. **更清晰的安全边界**：把能力门控（capability checks）留在 client 的 wrapper 中，core 不包含浏览器特有 API。

## 缺点 / 风险

1. **一次性重构风险**：把两套实现合并成一套，需要大量改动（packages、apps），如果没有完整测试会产生回归。
2. **API 语义冲突**：Manager 原先直接使用 Svelte stores；迁移到 core 需要为 manager 做接口适配，若处理不慎可能导致状态不一致。
3. **bundle/树摇问题**：若 core 包含 manager-only 功能则会导致 client bundle 膨胀；因此必须把 manager-only 功能放在 manager wrapper，而不是 core。
4. **协作边界**：some manager features (例如 `parameterRegistry`、modulation) 现有实现与 node runtime 有耦合（engine 在清除 modulation 时直接调用 parameterRegistry），需要把这类外部依赖从 core 中解耦或提供 hook（manager 在事件回调中自行处理）。否则会引入 core 对 manager 的依赖，违背设计目标。
5. **安全/资源暴露**：把通用 runtime 放到 client（移动端）时必须保证 `NodeExecutor` 的安全门控不被绕开（例如缺失 capability checks、没有 limit 导致设备负载）。因此 core 必须提供足够的 hooks 以让 client 做能力检查（如 `canRunCapability`）并且在 client wrapper 处设置合理的 limits。

---

# 五、详细实现计划（分步骤 + 每步对 Vibe Coding Agent 的提示词）

> **总体思路**：新增 `packages/node-core`，把通用 runtime/types/registry/definitions 放入；让 `packages/sdk-client` 与 `apps/manager` 以组合方式改造来依赖 `@shugu/node-core`；保持对现有 API 向后兼容并在每个阶段跑 e2e 与单元测试。

每一步都尽可能给出要改的文件、要运行的测试/检查命令、以及给自动化 agent 的精确提示词。

---

## Step 0 — 准备（小任务）

**目标**：创建空的 package skeleton（`packages/node-core`），并在 repo 的根 `pnpm-workspace.yaml` / monorepo 配置中包含该包（通常 `pnpm` 的 workspace 已是自动发现 `packages/*`）。
**操作项**：

1. 在 `packages/` 下新建 `node-core` 目录。
2. 新增 `package.json`：

```json
{
  "name": "@shugu/node-core",
  "version": "1.0.0",
  "description": "Core node graph runtime, registry and types (shared)",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "type": "module",
  "scripts": { "build": "tsc", "dev": "tsc --watch", "clean": "rm -rf dist" },
  "dependencies": {},
  "devDependencies": { "typescript": "^5.3.0" }
}
```

3. 新建 `src/` 目录并放置 `index.ts`（先空的导出），`tsconfig.json`。
4. `pnpm install` / `pnpm -w`（如有必要）保证包在 workspace 可见。

**Vibe Agent 提示词（Step0）**：

```
在仓库根目录下创建 packages/node-core 包骨架，包含 package.json、tsconfig.json、src/index.ts。package.json 按 monorepo 规范写（name: @shugu/node-core）。确保 pnpm workspace 可以识别新包。提交一个初始 PR，只包含包骨架文件。
```

---

## Step 1 — 抽取 types + registry（最低侵入）

**目标**：把共有的类型和节点注册器抽到 `node-core`，并让 `sdk-client` 与 `apps/manager` 暂时同时继续使用原实现（以便逐步替换）。
**为什么先做这步**：types 与 registry 是最基础且相对独立的一部分，抽离后能开始合并 runtime 的实现并最小化接口不一致问题。

**实现细节**：

1. 在 `packages/node-core/src/` 新建：

   * `types.ts`：导出 `NodeInstance`, `NodePort`, `PortType`, `NodeDefinition`, `Connection`, `GraphState`, `ProcessContext` 等类型（参照现有 `apps/manager/src/lib/nodes/types` 与 `packages/sdk-client/src/node-types.js`）。
   * `registry.ts`：实现 `NodeRegistry` 类（API：`register(type, def)`, `get(type)`, `list()`），按现有项目风格（名字、注释）。此实现应与 `sdk-client` 中 `NodeRegistry` 行为一致。
   * `index.ts`：`export * from './types'; export { NodeRegistry } from './registry';`

2. 修改 `packages/sdk-client` 和 `apps/manager`（临时）：

   * 在它们的源码中，把原来局部的 `node-types` / `node-registry` 的导入改为优先从 `@shugu/node-core` 引入（先做替换导入语句，保留原实现直到替换完整）。
   * 例如 `packages/sdk-client/src/node-registry.js` 可以暂时保留，但其对外的 `export` 由 `node-core` 提供（迁移后删除重复实现）。

**兼容保证**：

* 保持导出的类型/方法签名与原实现完全一致（尤其是 `NodeRegistry.get()` 等）。
* 保留旧文件但在构建注释 TODO，这样可以回退。

**Vibe Agent 提示词（Step1）**：

```
在 packages/node-core/src 中实现 types.ts（包含 NodeInstance, NodePort, Connection, GraphState, ProcessContext, NodeDefinition 等类型）和 registry.ts（实现 NodeRegistry 类，API: register/get/list）。然后修改 packages/sdk-client 和 apps/manager 的 import，把 node-registry 与 node-types 的导入改为从 @shugu/node-core 引入。确保 TypeScript 编译无错误并运行 `pnpm -w -r build` 以验证。
```

---

## Step 2 — 把 client 的 `NodeRuntime` 移入 core（以 client 的实现为主）

**目标**：以 `packages/sdk-client/src/node-runtime.ts` 作为 canonical runtime（该实现已经包含 watchdog、override、oscillation、compile/kahn、tick 等成熟逻辑），把它移动到 `@shugu/node-core` 的 `runtime.ts`，并保持 API 一致。
**为什么选择 client 的实现为基础**：client 的 `NodeRuntime` 在设计上已更通用（有 override、oscillation、watchdog、TTL），且与 manager 的 `NodeEngine` 功能高度重叠；把 client 的 runtime 设为 core 的 canonical 实现能减少变更量（manager 在 wrapper 层做额外行为）。

**实现细节**：

1. 把 `packages/sdk-client/src/node-runtime.ts` 的内容**复制并稍作调整**到 `packages/node-core/src/runtime.ts`。必要调整：

   * 将 `import` 改为 `@shugu/node-core` 内部的 `NodeRegistry` / `types`。
   * 保持 `NodeRuntime` 的构造参数与选项（`tickIntervalMs`, `onTick`, `onWatchdog`, `watchdog`）一致。
   * 暴露 API：`loadGraph`, `exportGraph`, `start`, `stop`, `clear`, `setTickIntervalMs`, `applyOverride`, `removeOverride`, `clearOverrides` 等。
2. 在 `packages/node-core/src/index.ts` 导出 `NodeRuntime`。
3. 在 `packages/sdk-client` 中，把原 `node-runtime.ts` 改为重新导出：`export { NodeRuntime } from '@shugu/node-core';`（以确保对外 API 不变）。然后删除或注释掉原实现（先保留，验证无误再删）。

**注意点**：

* `NodeRuntime` 中引用了 `NodeRegistry.get(node.type)` 的逻辑，确保 `node-core` 的 registry 与 runtime 引用的是同一个实现。
* `NodeRuntime` 不应包含任何 Svelte / socket / DOM 依赖。原 client 的实现已经满足这一点。

**Vibe Agent 提示词（Step2）**：

```
把 packages/sdk-client/src/node-runtime.ts 的实现迁移到 packages/node-core/src/runtime.ts，调整导入以使用 node-core 的 types/registry。确保导出的 NodeRuntime API 与原来一致。然后在 packages/sdk-client 中把 node-runtime 的导出改为 re-export（export { NodeRuntime } from '@shugu/node-core'）。运行 `pnpm -w build` 与 client 的单元测试（如有）来验证无回归。
```

---

## Step 3 — 让 `NodeExecutor` 在 `sdk-client` 中依赖 core 的 runtime（小改造）

**目标**：`packages/sdk-client/src/node-executor.ts` 继续保留 `NodeExecutor` 的行为（与 SDK / plugin 控制绑定），但内部使用 `@shugu/node-core` 导出的 `NodeRuntime`。这一步主要是把 client 的执行器“适配”到新的 core。
**实施细节**：

1. 在 `packages/sdk-client/src/node-executor.ts` 中，把 `import { NodeRuntime } from './node-runtime.js'` 改为 `import { NodeRuntime } from '@shugu/node-core'`。
2. 验证 `NodeExecutor` 与 `NodeRuntime` 的方法签名兼容（`setTickIntervalMs`, `loadGraph`, `applyOverride` 等）。
3. 运行 client 端的 e2e（`pnpm e2e:node-executor`）或至少 run dev 并手工验证 NodeExecutor 的 deploy/start/stop/remove/override 路径。

**兼容点**：

* `NodeExecutor` 仍然提供同样的 `handlePluginControl`、`deploy`、`start`、`stop`、`remove` 等逻辑；只是底层 runtime 变成了 core 的实现。

**Vibe Agent 提示词（Step3）**：

```
修改 packages/sdk-client/src/node-executor.ts 的 NodeRuntime import 为从 @shugu/node-core 导入。检查 NodeExecutor 与新的 NodeRuntime 的 API 是否一致（setTickIntervalMs, loadGraph, applyOverride 等）。运行 e2e node-executor 测试脚本（pnpm e2e:node-executor）并记录结果；修正可能的签名差异。
```

---

## Step 4 — 在 Manager 侧做包装：`NodeEngine` 改为由 core runtime 组合实现（保留 Manager 特有逻辑）

**目标**：重构 `apps/manager/src/lib/nodes/engine.ts`，让它内部**组合** `@shugu/node-core` 的 `NodeRuntime`，而不是使用 manager 本身独立的逻辑。Manager 需要保留或重实现：Svelte stores、local loop detection、offloaded node handling、graphState 的同步（但这些都应在 wrapper 中实现）。
**实施细节**：

1. 在 `apps/manager/src/lib/nodes/` 新建 `engine-core-adapter.ts`（或在原 `engine.ts` 中逐步重写），`NodeEngineClass` 内部持有 `const runtime = new NodeRuntime(registry, { onTick, onWatchdog, ... })`。`registry` 使用 `@shugu/node-core` 的 `NodeRegistry`（或 manager 在原 registry 基础上调用 core 的 registry）。
2. 把 manager 原先的 Svelte stores（`graphState`, `isRunning`, `lastError`, `tickTime` 等）继续保留，但由 wrapper（NodeEngine）在 runtime 事件触发时更新这些 stores（例如 `runtime.onTick -> tickTime.set(now)`，`syncGraphState()` 可调用 `runtime.exportGraph()`）。
3. Manager 的 `offloadedNodeIds`、`updateLocalLoops()`、`deployedLoopIds` 等高阶行为继续由 manager wrapper 负责（这些逻辑使用 runtime 的 `exportGraph()`、`loadGraph()` 与 runtime 状态做组合）。
4. 注意：manager 原先使用 `parameterRegistry.clearModulation` 的逻辑（见 `removeNode`）应保留。但要把 `parameterRegistry` 作为 manager 层的外部依赖（core 不应直接调用它），这样 manager wrapper 在 `removeNode` 的过程中负责调用 `parameterRegistry` 来清理 modulation。**也就是说，把 manager 针对 parameterRegistry 的语句保留在 wrapper，而不放进 core。**

**兼容点**：

* 对外 `nodeEngine` 的 API 提供给 UI 的方法（`addNode`, `removeNode`, `addConnection`, `removeConnection`, `start`, `stop`, `deployLoop`, `offload` 等）应保持现有签名，内部委托给 `NodeRuntime`。
* UI/NodeCanvas 不需要做大量改动（除了 import 来自 node-core 或保持原导出名）。

**Vibe Agent 提示词（Step4）**：

```
重构 apps/manager/src/lib/nodes/engine.ts，使其内部组合 @shugu/node-core 的 NodeRuntime（通过 new NodeRuntime(registry, { onTick, onWatchdog })）。保留 manager 的 Svelte stores，并在 runtime 的回调里同步这些 stores（tick, isRunning, lastError, graphState 等)。确保 manager 特有的 updateLocalLoops/offloadedNodeIds/deploy 管理逻辑仍在 Wrapper 内实现（不要把它们移动到 core）。运行 manager 本地 dev 并手工验证 Node Graph 的 deploy/stop/redeploy/remove 流程（参照 e2e 脚本的动作）。
```

---

## Step 5 — 迁移 Node Definitions（分层）

**目标**：node 定义（例如 `proc-screen-color`, `proc-client-sensors` 等）分为两类：

* **Core-safe definitions**（真正只关乎计算/数据处理、与平台无关）应放入 `@shugu/node-core` 的 `definitions.ts`（比如数学、信号处理类节点）。
* **Platform-specific definitions**（需要 DOM、navigator、Camera、Three.js、MIDI 等）应留在各自平台（manager 或 client 的包中），并在运行时注册到 `NodeRegistry`（通过 `registerDefaultNodeDefinitions()` 的模式）。

**实施细节**：

1. 读取 `packages/sdk-client/src/node-definitions.ts` 与 manager 的 `specs/register` 等（`apps/manager/src/lib/nodes/specs/register`），决定哪些 definition 是 platform-agnostic。
2. 在 `node-core/src/definitions.ts` 放置 platform-agnostic 的默认实现（并提供 `registerDefaultNodeDefinitions(registry, ctx)` 的函数接口来注入 platform-specific 回调，例如 `getClientId`, `getLatestSensor`, `executeCommand`）。（`sdk-client` 目前即使用该注册模式，保留这种风格）。
3. Manager / Client 各自实现自己的 `registerDefaultNodeDefinitions`（或调用 core 的通用注册函数并做额外注册）。

**Vibe Agent 提示词（Step5）**：

```
把纯计算/无平台依赖的节点定义迁移到 packages/node-core/src/definitions.ts 并在 node-core 提供 registerDefaultNodeDefinitions(registry, ctx) 函数（ctx 用于注入 platform callback，比如 getClientId/getLatestSensor/executeCommand）。把需要访问浏览器 API（navigator, document, Media APIs）的节点定义保留到 packages/sdk-client 或 apps/manager 中各自的注册文件里。
```

---

## Step 6 — 迁移测试 & e2e（验证）

**目标**：在完成上面迁移后，运行并修复所有测试与 e2e，保证 manager 与 client 行为一致。
**关键测试**：

* `pnpm e2e:node-executor`（之前存在的 node-executor e2e 脚本）应全部通过（它验证了 deploy/stop/redeploy/remove 等流程）；此脚本在 repo 中 `scripts/e2e/node-executor.mjs`，需要确保 manager 和 client 使用了新的 core 且行为无误（你之前的 e2e 脚本就是基于 manager/client 本地运行的）。
* 单元测试：为 `node-core` 写单测：compile (Kahn)、cycle detection、overrides TTL、watchdog（模拟慢 tick）、sink-burst/oscillation 检测等。
* CI：确保 `pnpm -w build` 和 lint 型检查通过。

**Vibe Agent 提示词（Step6）**：

```
编写 node-core 的单元测试覆盖：compile（Kahn 算法）、cycle detection、override TTL、watchdog 触发、sink-burst、oscillation。运行 pnpm -w build && pnpm -w test 并修复失败。执行 e2e:node-executor，记录错误并逐一修复。最后打开 manager UI、创建本地 loop、部署到 client 并验证 client 接收到命令与 stop/redeploy/remove 行为一致（手工或自动化脚本）。
```

---

## Step 7 — 清理与回退（收尾）

**目标**：当 `node-core` 被 manager 和 client 稳定使用后，删除重复的 runtime/type/registry 代码，更新导出与文档。
**操作**：

1. 从 `packages/sdk-client` 与 `apps/manager` 删除旧的 `node-runtime.ts` / `node-registry.ts`（或把它们替换为对 `node-core` 的 re-export），以避免重复维护。
2. 在 `README` / docs 中补充新架构说明（`@shugu/node-core` 的 API、如何在 manager/client 注册平台特定节点、如何做能力门控）。
3. 在 PR 合并时小心：分阶段合并（先 core + client adapt，再 manager adapt），而不是一次性改动全部。

**Vibe Agent 提示词（Step7）**：

```
在确认所有测试与 e2e 通过后，删除 packages/sdk-client 与 apps/manager 中重复的 node-runtime/node-registry 实现，改为 re-export 或直接 import @shugu/node-core。更新项目 README，写 1-2 页的设计文档说明 core 的 API 与 manager/client 的 wrapper 模式。最后发起合并 PR，并在 PR description 中列出回归测试清单（e2e, lint, build, unit tests）。
```

---

# 六、实现细节建议（代码级别要点）

下面列出一些实施时非常关键且容易出错的技术点，以及我建议的具体实现方法。

### 1) `NodeRuntime` 的公共 API（建议）

将 core 导出以下接口/方法（与现有 sdk-client 的 runtime 相似）：

```ts
class NodeRuntime {
  constructor(registry: NodeRegistry, options?: {
    tickIntervalMs?: number,
    onTick?: (info:{durationMs:number,time:number}) => void,
    onWatchdog?: (info:NodeRuntimeWatchdogInfo) => void,
    watchdog?: {...}
  });

  setTickIntervalMs(ms:number): void;
  loadGraph(state: Pick<GraphState,'nodes'|'connections'>): void;
  exportGraph(): GraphState;
  start(): void;
  stop(): void;
  clear(): void;

  applyOverride(nodeId:string, kind:'input'|'config', key:string, value:unknown, ttlMs?:number): void;
  removeOverride(nodeId:string, kind:'input'|'config', key:string): void;
  clearOverrides(): void;
}
```

该 API 与 `packages/sdk-client` 现有实现基本相同（减少迁移工作），并提供 `onTick/onWatchdog` 回调以便 manager wrapper 更新 stores 与监控。

**引用**：`NodeRuntime` 中已有类似实现（见 sdk-client 的 `node-runtime.ts`）。

### 2) `NodeRegistry` 与 `NodeDefinition` 的设计

`NodeDefinition` 应约定如下字段（与现有实现一致）：

```ts
type NodeDefinition = {
  id: string;
  inputs: Array<{ id:string, type?:PortType, kind?:'value'|'sink', defaultValue?:unknown }>;
  outputs: Array<{ id:string, type?:PortType }>;
  process(inputs:Record<string,unknown>, config:Record<string,unknown>, ctx:ProcessContext): Record<string,unknown>;
  onSink?(sinkInputs:Record<string,unknown>, config:Record<string,unknown>, ctx:ProcessContext): void;
};
```

Manager 的 UI 节点控制（Rete 控件）应作为 UI 层的东西，不放入 core。

### 3) Offloading 与 LocalLoop

Manager 需要“标记节点为 offloaded”（意为这些节点在 client 上运行，manager 跳过计算并只作为 sink 接收）。**核心 runtime** 可以提供一个 `setOffloadedNodeIds(set)` / `addOffloadedNodeId(id)` 方法（runtime 在 tick 时依据 offloaded set 跳过执行），也可以让 wrapper 在执行时过滤 `executionOrder`。目前 manager 的 engine 维持了 `offloadedNodeIds`（见 `engine.ts`）。建议把这一功能放成 runtime 的可选 feature（runtime 内部有 `offloadedNodeIds`），但 manager wrapper 管理该集合。这样 client 端 runtime 也能使用（client 端在部署时会决定哪些节点由 client 自己执行）。

### 4) parameterRegistry / modulation

Manager 的 `parameterRegistry` 与 modulation 清除逻辑在 `removeNode()` 时执行（见 `engine.ts`）——不要把 parameterRegistry 放进 core。相反提供 events/hook：在 manager 的 wrapper `removeNode` 时，wrapper 可以在调用 `runtime` 的 `removeNode` 或 `loadGraph` 前后执行 `parameterRegistry` 的清理逻辑，以避免 core 与 manager 的耦合。**（必须做）**。 参考：`removeNode` 中 `parameterRegistry.list().forEach((param) => param.clearModulation?.(sourceId, 'NODE'));`（见）。

### 5) 安全性 / 能力校验（client）

`NodeExecutor.deploy()` 已包含 `canRunCapability` 与 `limits` 检查（见 NodeExecutor 代码）——这应保留于 `packages/sdk-client` 的执行器层，**而不是** core。core 只做最少的验证（graph 合法性、cycle、node types 存在）。Client 的 `NodeExecutor` 继续接受 options `{ canRunCapability, limits }` 并在 deploy 前拒绝或 report reject（NodeExecutor 现有逻辑已实现，见）。

### 6) 版本/协议兼容提示

`NodeExecutor` / manager 在 deploy 时会检查 `meta.protocolVersion` 与 `PROTOCOL_VERSION`（见 NodeExecutor），并做 best-effort 警告。core 不应尝试做任何 network/transport 层面的版本迁移，但应该暴露 `validateMeta(meta)` 的 helper 以便 wrapper 做策略判断（fallback/reject）。（参考 `NodeExecutor` 的协议版本检查）。

---

# 七、迁移执行计划（时间线式、可切分 PR）

建议把上面的步骤拆成几个小的 PR：

1. **PR1**：新增 `packages/node-core` 骨架 + types + registry；在 `sdk-client` 与 manager 中切换 imports（回滚安全）。（Step0 + Step1）
2. **PR2**：把 `NodeRuntime` 从 `sdk-client` 迁移到 `node-core`，并在 `sdk-client` 做 re-export（Step2）。
3. **PR3**：适配 `NodeExecutor` 使用 `node-core`（Step3），并跑 e2e。
4. **PR4**：改造 manager 的 `NodeEngine` 为 wrapper，组合 `node-core` 的 runtime（Step4）。
5. **PR5**：nodes definitions 分层 & 参数 registry 重构（Step5）。
6. **PR6**：测试覆盖补充、清理冗余文件、文档（Step6+7）。

每个 PR 都应包含：`pnpm -w build`、`pnpm -w lint`、相关单测和 e2e 的运行结果截图或日志。

---

# 八、给 Vibe Coding Agent 的**逐步**、**事无巨细**提示模版（你可以直接 copy-paste）

下面是每个 PR 的**完整提示词模版**（尽量详尽 — 包含命令、需要修改的文件、验证项）。

### PR1 提示词（新增 node-core + types/registry）

```
任务：在 monorepo 中添加 @shugu/node-core（packages/node-core），实现 types.ts 和 registry.ts，并把 packages/sdk-client 与 apps/manager 中对 node-registry / node-types 的 import 指向新包。

步骤：
1. 在 packages/node-core 中创建 package.json, tsconfig.json, src/index.ts, src/types.ts, src/registry.ts。
2. src/types.ts: 复制并整理当前 apps/manager/src/lib/nodes/types.ts 与 packages/sdk-client/src/node-types.js 中与运行时相关的类型，确保导出：
   - NodeInstance, NodePort, PortType, NodeDefinition, Connection, GraphState, ProcessContext, ProcessContext 等。
3. src/registry.ts: 实现 NodeRegistry 类：
   - methods: register(type: string, def: NodeDefinition), get(type: string): NodeDefinition | undefined, list(): string[]。
   - 添加注释说明并保持与现有实现行为一致。
4. src/index.ts: 导出 types 与 NodeRegistry。
5. 修改 packages/sdk-client/src/index.ts 等处，将原来的相对导入（node-types/node-registry）替换为 `@shugu/node-core`。
6. 运行命令：
   - pnpm -w build
   - pnpm -w lint
7. 验证：
   - 确保 TypeScript 编译通过。
   - 手工运行 manager / client 的 dev 命令，确认没有因为类型/导入变更导致错误。
8. 提交 PR 并在 PR 描述中说明变更（新包、哪些 import 改动）。

注意：
- 不要移除原来文件（先保留直到后续 PR）以便回滚。
```

### PR2 提示词（迁移 NodeRuntime 到 node-core）

```
任务：复制 packages/sdk-client/src/node-runtime.ts 到 packages/node-core/src/runtime.ts，并在 sdk-client 中 re-export。保持 API 行为与现有一致。

步骤：
1. 在 packages/node-core/src 添加 runtime.ts，把 packages/sdk-client/src/node-runtime.ts 的逻辑复制过来。
2. 调整 imports：使用 node-core 的 NodeRegistry/types（packages/node-core/src/types.ts / registry.ts）。
3. 暴露 NodeRuntime：在 packages/node-core/src/index.ts 中 `export { NodeRuntime } from './runtime';`
4. 在 packages/sdk-client/src/index.ts 或原 node-runtime.ts 处改为：`export { NodeRuntime } from '@shugu/node-core';`
5. 运行：
   - pnpm -w build
   - pnpm -w lint
6. 验证：
   - client 的 build 与 lint 无误。
   - 运行一个简单 scenario：在 client 初始化时 create NodeRuntime 并 loadGraph、start/stop 等（手工或单测）。
7. 提交 PR。

注意：
- 保证 NodeRuntime 的方法签名不变（loadGraph/exportGraph/applyOverride 等）。
- 如果发现签名不兼容，优先改 node-core 的实现，使其对外兼容。
```

### PR3 提示词（适配 NodeExecutor）

```
任务：让 packages/sdk-client/src/node-executor.ts 使用 @shugu/node-core 的 NodeRuntime（而不是本地实现），确保 NodeExecutor 的功能不变。

步骤：
1. 修改 node-executor.ts 的 import：`import { NodeRuntime } from '@shugu/node-core';`
2. 保留 NodeExecutor 的其他逻辑（部署、start/stop/remove/override 等）。
3. 运行：
   - pnpm -w build
   - pnpm -w lint
4. 运行 e2e: `pnpm e2e:node-executor` 或至少手动部署一个 small graph 来验证 NodeExecutor 的行为（deploy/start/stop/remove/override 报告/stopwatch/watchdog）。
5. 修复发现的任何不兼容问题。
6. 提交 PR。

验证要点：
- 部署 graph 到 client 成功并 client 执行（在 dev 环境或 e2e 中验证）。
- 如果 NodeExecutor 内部期望 runtime 某些细节（例如 `setTickIntervalMs`），请调整 node-core 的 runtime 确保存在。
```

### PR4 提示词（Manager wrapper）

```
任务：重构 apps/manager/src/lib/nodes/engine.ts，使用 @shugu/node-core 的 NodeRuntime 进行组合。保留 manager 的 Svelte stores、local loops、offload 管理逻辑。

步骤：
1. 在 engine.ts 中改为：
   - import { NodeRuntime, NodeRegistry } from '@shugu/node-core';
   - const runtime = new NodeRuntime(registry, { onTick:..., onWatchdog:... });
2. 把原 engine 的编译/运行逻辑替换为对 runtime 的调用（例如 start/stop/loadGraph/exportGraph）。保留 manager 专有逻辑：
   - offloadedNodeIds 集合及管理；
   - local loop 检测（updateLocalLoops）；
   - syncGraphState()：可以使用 runtime.exportGraph() 填充 graphState store；
   - parameterRegistry 的 modulation 清除仍留在 removeNode wrapper 中；
3. 运行 manager dev 环境并打开 UI：
   - 验证 Node Graph 页面能够 load graph、render nodes、deploy 到 client 并观察 client 收到命令（如 screenColor）。
4. 运行 e2e node-executor 脚本（scripts/e2e/node-executor.mjs）。
5. 提交 PR。

关键点：
- manager 的 stores 应该由 wrapper 主动更新（不要在 runtime 内依赖 Svelte）。
- 确认 manager 任何对 runtime 私有实现细节的调用（例如直接访问 private fields）都已改为使用 runtime 的公共 API。
```

### PR5 & PR6 提示词（definitions 分层、测试、清理）

```
任务：把可复用的 node 定义放到 node-core 的 definitions.ts；把浏览器/平台相关的定义留在 client/manager；补充测试，并删除重复实现。

步骤：
1. 在 node-core/src/definitions.ts 放置 platform-agnostic node definitions，并 export registerDefaultNodeDefinitions(registry, ctx)；
2. 在 packages/sdk-client 与 apps/manager 中调用 core 的注册接口并补充各自平台特有节点；
3. 为 node-core 编写单测（compile, cycle detection, override TTL, watchdog 的触发路径，sink-burst, oscillation 检测等），放在 packages/node-core/test；
4. 运行完整测试集：pnpm -w build && pnpm -w test && pnpm e2e:node-executor；
5. 一旦通过，删除 packages/sdk-client 与 apps/manager 中重复代码（node-runtime/node-registry 的旧实现），并改为 re-export 或移除；
6. 更新 README/DEV 文档，记录 core 的 API 与 manager/client wrapper 的使用方法。
7. 提交 PR。

验证：
- 所有单测与 e2e 通过。
- manager UI、client UI 运行正常，部署/stop/override 已验证。
```

---

# 九、可能的危险与缓解措施（细化）

1. **API 不兼容 / 回归**：缓解方式：分 PR、每步都运行 e2e；在 merge 前保证已有的 e2e（`e2e:node-executor`）通过。
2. **性能回退（core 实现比原 manager 实现慢）**：缓解方式：优先采用 client 的 runtime 作为 canonical（它已有 guard/watchdog），在 core 中保留 manager 的编译优化（例如避免频繁 graphState 同步，使用 `exportGraph()`），并运行基准（benchmark）对比。
3. **bundle 体积膨胀**：确保 `node-core` 不引入 DOM / svelte / socket 等平台依赖。并通过 rollup/vite 的 tree-shaking 确保 client 最终 bundle 只含必要代码。
4. **安全问题（client 端能跑任意代码）**：完全由 client 的 `NodeExecutor` 来做能力校验 `canRunCapability`、nodes 数量限制、tick 时间限制等（已在现有 `NodeExecutor` 中实现），务必测试这些检查逻辑。
5. **Manager 的 parameterRegistry 依赖**：不要把 parameterRegistry 的调用放到 core；manager wrapper 在做节点删除时显式调用清理逻辑。

---

# 十、结论（简短）

* 你观察到的问题（manager 与 client 两套 node 系统导致不同步）确实存在，且原因是**重复实现**。
* 最优雅且可维护的解决方案是**新增 `@shugu/node-core`**，把 runtime/types/registry/通用定义放到 core，再让 `sdk-client`（client）与 `apps/manager`（manager）**以组合方式**使用 core。
* 采用 client 的 `NodeRuntime` 实现为 canonical（原因：功能完备），manager 的 engine 做 wrapper（Svelte stores、offload/local loop）。这样既保持性能与现有特性，又实现单一实现（SOT）。
* 我给出了**逐步的实现计划**、每步的具体改动点、需要运行的测试、以及给 Vibe Coding Agent 的完整提示词。按此计划逐步实施并在每个 PR 做全面测试与 review，能把风险控制在可接受范围之内。

