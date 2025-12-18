# node-core（Node 系统单一事实源）

`@shugu/node-core` 是本仓库 Node 系统的 **single source of truth**：它提供平台无关的图类型、节点注册表，以及运行时（compile + tick + overrides + watchdog）。

本仓库的使用方式是 **core + wrapper（组合）**：

- **Core**：`@shugu/node-core`（纯计算 + 纯运行时；不依赖 Svelte / Socket / DOM）
- **Manager wrapper**：`apps/manager/src/lib/nodes/engine.ts`（Svelte stores、local loop/offload 管理、UI 绑定）
- **Client wrapper**：`packages/sdk-client/src/node-executor.ts`（SDK 集成、capability gating、资源限制、状态回传）

---

## 1) 核心内容

### 1.1 Graph / types

定义了 `GraphState` / `NodeInstance` / `Connection` / `NodePort` 等共享类型：

- `packages/node-core/src/types.ts`

### 1.2 NodeRegistry

用于注册/查询节点定义（`NodeDefinition`）：

- `packages/node-core/src/registry.ts`

### 1.3 NodeRuntime

负责：

- compile：拓扑排序（Kahn）+ cycle detection
- tick：计算 outputs、派发 sinks
- overrides：input/config 覆盖 + TTL 自动失效
- watchdog：slow tick / sink burst / oscillation

实现位置：

- `packages/node-core/src/runtime.ts`

---

## 2) Node definitions 的分层

Node definitions 分为两类：

1. **Core-safe**（平台无关）：放在 `@shugu/node-core`，由各端复用实现。
2. **Platform-specific**（依赖 DOM / navigator / device API / manager-only 依赖）：保留在各自端的注册层。

当前 shared 的默认 definitions 入口：

- `packages/node-core/src/definitions.ts`

Manager 的 JSON spec 节点在运行时会复用 core-safe 的实现（减少 manager/client 分叉）：

- `apps/manager/src/lib/nodes/specs/register.ts`

---

## 3) 兼容策略（sdk-client re-export）

为减少迁移成本，`@shugu/sdk-client` 继续对外导出历史 API，但内部使用 `@shugu/node-core`：

- `packages/sdk-client/src/node-runtime.ts`（re-export）
- `packages/sdk-client/src/node-registry.ts`（re-export）
- `packages/sdk-client/src/node-types.ts`（re-export）

这样 manager/client 都使用同一套 runtime/type/registry，实现“修改一次，两端同步”。

---

## 4) 验证（Tests / E2E）

- `@shugu/node-core` 单测：`packages/node-core/test/runtime.test.mjs`
- Playwright E2E（dev servers + browser）：`pnpm e2e:node-executor`
- 离线验证（无 dev servers / 无 Playwright）：`pnpm e2e:node-executor:offline`

