<!--
Purpose: docs/ARCHITECTURE.md 的中文版本
（仓库架构地图：模块职责、依赖护栏、关键数据流、入口索引与热点）。
-->

# ShuGu 架构速查（Architecture Map）

本文档是一个**高信噪比索引**，用于在重构（Phase 1.5+）过程中快速定位代码，
并非完整规格说明。

## 仓库地图（模块与职责）

### Apps（`apps/*`）

- `apps/server/`：NestJS + Socket.io 服务端（路由、客户端注册表、时间同步中继、资产 API、
  本地媒体）
- `apps/manager/`：SvelteKit 控制 UI（ControlPanel、NodeGraph 编辑器、选择/分组、场景切换）
- `apps/client/`：SvelteKit 体验端（VisualCanvas、设备传感器、音频采集/执行、视觉效果）
- `apps/display/`：SvelteKit Display 播放器（视频/图片播放），支持**本地桥接** + **服务端兜底**

### Packages（`packages/*`）

- `packages/protocol/`：共享消息类型 + helpers（`@shugu/protocol`）——**最底层**
- `packages/node-core/`：NodeGraph 运行时 + 节点定义（`@shugu/node-core`）
- `packages/sdk-manager/`：Manager Socket.io SDK（`@shugu/sdk-manager`）
- `packages/sdk-client/`：Client Socket.io SDK + executors（`@shugu/sdk-client`）
- `packages/multimedia-core/`：Client/Display 共用的音视频工具（`@shugu/multimedia-core`）
- `packages/audio-plugins/`：音频特征提取 / DSP helpers（`@shugu/audio-plugins`）
- `packages/visual-plugins/`：Three.js 视觉插件（`@shugu/visual-plugins`）
- `packages/ui-kit/`：共享 UI 组件/样式（`@shugu/ui-kit`）

## 依赖规则（护栏）

仓库使用 `pnpm guard:deps`（见 `scripts/guard-deps.mjs`）来防止：

- 对 `@shugu/*` 包的**深层导入**（只允许 `package.json#exports` 中声明的子路径）
- **分层违规**（当前已强制）：
  - `@shugu/protocol` 不能依赖其他 `@shugu/*`
  - `@shugu/node-core` 只能依赖 `@shugu/protocol`

## 关键数据流（谁在和谁说话）

### 1）控制链路（Manager ⇄ Server ⇄ Clients）

- `apps/manager` 使用 `@shugu/sdk-manager` 连接 `apps/server`（Socket.io）
- `apps/client` 使用 `@shugu/sdk-client` 连接 `apps/server`（Socket.io）
- Manager 发送 `ControlMessage` / `PluginControlMessage` 到 Server；Server 负责路由到目标客户端/分组
- Clients 上报 `SensorDataMessage` / 系统事件；Manager 侧观察客户端列表 + 遥测
- 时间同步：Manager/Client SDK 周期性 ping/pong，计算 server time 以支持调度

### 2）资产（Manager → Server → Client/Display）

- Manager 上传/管理资产；Server 持久化到 `apps/server/data/assets/*`
- Client/Display 通过 Server 的 HTTP API 拉取资产内容
- Server 需要对 header 中的非 ASCII 文件名保持健壮（见 `apps/server/src/assets/assets.controller.ts`）

### 3）Display 传输（本地桥接 + 服务端兜底）

两种模式共享同一个 UX 目标：“让 Display 稳定接收控制/媒体更新”。

- **本地桥接（同机优先）**：
  - Manager 通过 query params 打开 Display 窗口（pair token / server URL / asset read token）
  - 通过 `window.postMessage` 配对，并转移专用 `MessagePort`
  - Manager 通过 MessagePort 发送 control/plugin/manifest
  - Display 回传一次性 `shugu:display:ready`
  - 配对入口：`apps/manager/src/lib/display/display-bridge.ts`
  - 发送入口：`apps/manager/src/lib/display/display-transport.ts`
- **服务端兜底（远程或本地桥不可用）**：
  - Display 通过 `@shugu/sdk-client` 连接 Server
  - 通过常规 socket 路由接收 control/plugin/media
  - 入口：`apps/display/src/lib/stores/display.ts`

### 4）NodeGraph 编辑/部署（Manager → Clients）

- NodeGraph 在 Manager 中编辑（基于 Rete UI），在 Clients 上执行
- 核心运行时/定义在 `@shugu/node-core`
- Manager NodeGraph 编辑器热点：`apps/manager/src/lib/components/nodes/NodeCanvas.svelte`
- 相关文档：`docs/node-core.md`、`docs/node-executor.md`

## 入口索引（快速导航）

### `apps/server/`

- 入口：`apps/server/src/main.ts`
- 核心路由：`apps/server/src/message-router/*`
- 资产 API：`apps/server/src/assets/*`
- 客户端注册表：`apps/server/src/client-registry/*`

### `apps/manager/`

- 路由入口：`apps/manager/src/routes/+page.svelte`
- 核心 store：`apps/manager/src/lib/stores/manager.ts`
- NodeGraph 编辑器：`apps/manager/src/lib/components/nodes/NodeCanvas.svelte`
- Display bridge：`apps/manager/src/lib/display/display-bridge.ts`
- Display transport：`apps/manager/src/lib/display/display-transport.ts`

### `apps/client/`

- 路由入口：`apps/client/src/routes/+page.svelte`
- 核心 store：`apps/client/src/lib/stores/client.ts`
- 主画布：`apps/client/src/lib/components/VisualCanvas.svelte`

### `apps/display/`

- 路由入口：`apps/display/src/routes/+page.svelte`
- 核心 store：`apps/display/src/lib/stores/display.ts`
- 播放器组件：`apps/display/src/lib/components/VideoPlayer.svelte`

## 热点（已知技术债）

### 超过 1000 行的文件（仅 source）

这些文件改动风险高，也是 Phase 2/3 清理的高 ROI 区域：

- `apps/manager/src/lib/components/nodes/node-canvas/rete/ReteControl.svelte`（~2662）
- `apps/manager/src/lib/components/nodes/node-canvas/controllers/group-controller.ts`（~1667）
- `apps/manager/src/lib/nodes/specs/register.ts`（~1608）
- `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`（~1573）
- `packages/sdk-client/src/action-executors.ts`（~1545）
- `packages/sdk-client/src/tone-adapter/register.ts`（~1461）
- `apps/manager/src/lib/components/nodes/node-canvas/runtime/patch-runtime.ts`（~1345）
- `apps/manager/src/lib/nodes/engine.ts`（~1241）
- `packages/sdk-client/src/tone-adapter/nodes.ts`（~1232）
- `apps/display/src/lib/stores/display.ts`（~1157）
- `apps/manager/src/lib/components/nodes/node-canvas/rete/ReteNode.svelte`（~1008）

### `@ts-nocheck`（需要持续跟踪）

- `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`
- `apps/manager/src/lib/components/nodes/node-canvas/ui/NodePickerOverlay.svelte`
- `apps/manager/src/lib/components/nodes/node-canvas/ui/NodeCanvasMinimap.svelte`
- `apps/manager/src/lib/components/nodes/node-canvas/ui/panels/ExecutorLogsPanel.svelte`
- `apps/manager/src/lib/components/nodes/node-canvas/ui/overlays/GroupFramesOverlay.svelte`
- `apps/manager/src/lib/components/nodes/node-canvas/ui/overlays/MarqueeOverlay.svelte`
- `apps/manager/src/lib/components/nodes/node-canvas/ui/overlays/LoopFramesOverlay.svelte`

### 拆分策略（Phase 2/3 方向）

- NodeGraph UI：保持 “Rete adapter” 独立；把 “runtime patch/app integration” 收敛到一个小 facade
  后面。
- Display：`display-transport` 已经存在（Phase 0），用于统一
  “local MessagePort” 与 “server fallback”（`apps/manager/src/lib/display/display-transport.ts`）。
- SDK client audio：把 Tone adapter 拆成更小的功能模块（init、nodes registry、scheduling、teardown）。

## 本地构建产物（哪些可以安全删除）

本地生成（可删除，不应提交）：

- SvelteKit：`.svelte-kit*`、`build/`
- TypeScript/Nest：`dist*`、`dist-out/`、`dist-dev*`
- 工具缓存：`.turbo/`、`coverage/`、`out/`

建议使用 `pnpm clean:artifacts`（Phase 1.5.D 添加）替代手动删除。

注意：如果 `pnpm clean:artifacts` 报 `EACCES/EPERM`，通常是某些产物由 `root` 创建（例如用 `sudo`
运行 `pnpm`）。
一次性修复：改回目录所有权（例如 `sudo chown -R $(whoami) <path>`），并避免后续用 `sudo`
构建。
