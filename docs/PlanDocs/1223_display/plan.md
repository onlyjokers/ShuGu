<!--
Purpose: 新增 Display 应用（纯播放器）并支持“本机 MessagePort 优先 + Server msg 回退”的双通道控制方案；同时保证 Display 在 Manager 中可见但与 Clients UI 分离。
Owner: ShuGu / Manager + Display + Server + Protocol
Created: 2025-12-22
Status: Approved
-->

# 1223 Display：双形态播放器窗口（Local MessagePort / Server msg）详细计划

本文档给出一份**事无巨细**的执行计划，用于新增一个新的窗口/应用：`Display`。

---

# ✅ 进度记录（Checkbox）

> 说明：这里是“可勾选的总进度面板”，对应后文各 Phase/章节；你可以在实现过程中随时打勾。

- [x] Phase 0：设计冻结（动作白名单 / ready 语义 / 配对超时）
- [ ] Phase 1：Server 支持 `group=display`（连接参数写入 + 路由验证）
- [x] Phase 2：新增 `apps/display`（播放器 UI + MultimediaCore 接入 + action dispatch）
- [x] Phase 3：Server 模式 transport（Socket.io 连接 + 接收/执行 + ready 一次回传）
- [x] Phase 4：Local 模式（Manager DisplayBridge + MessagePort 配对 + 本机控制 + ready 一次回传）
- [x] Phase 5：Manager UI（DisplayPanel + 与 Clients UI 分离 + Send To Display 开关 + 过滤 selectAll）
- [x] Phase 6：Local 模式 manifest 推送（asset-manifest 可订阅 + 配对后立即推 + 更新推送）
- [ ] Phase 6.1：Node Graph Display 节点（Objects，可像 Client 一样接 command 并控制 Display）
- [ ] Phase 7：回归验证与文档（手动验证清单 + 可选 README 更新）
- [ ] 可选：9.1 全库 manifest API（非第一期）
- [ ] 可选：9.2 URL 打开也走 Local（跨 origin 发现机制，非第一期）

---

## 0. 你明确的新需求（作为硬约束）

1. Display 有 2 种形态：
   - **Local 模式（优先）**：当 Display 能与 Manager 建立同机直连（MessagePort）时，控制走本机通道（不占 WebSocket 带宽）。
   - **Server 模式（回退）**：当无法建立本机通道时，Display 走现有的 server `msg` 路由（与 client 同路径）。
2. Display 与 Manager **分离为独立 app**（结构平行于 manager/client/server）。
3. Display 当前定位为**纯播放器**（视频/图像为主），但要保留扩展接口，便于未来加入更多渲染/插件能力。
4. Display 不参与 Node Graph 的“Client 节点控制”，不回传任何实时信息；但：
   - 任何“输入给 client 的行为”（尤其媒体播放/图像显示/屏幕效果）**Display 都要能接收并执行**（能接受 ≠ 必须实现所有动作的完整语义；不相关动作可 noop）。
   - Display **只向 Manager 发送一次**消息：用于告知“预下载已完成 / Display ready”。
5. Display 与 client 有共性：启动后会从 server 提前下载 assets；但 Display 更激进：
   - 使用更高并发把 manifest 中的 assets 尽快下载完。
   - 下载完成后仅发送一次 ready（不再持续回传进度/错误）。
6. Display 既可以：
   - 由 Manager 通过按钮/操作**手动打开**；
   - 也可以用户直接通过 URL **单独打开**（此时通常会回退到 Server 模式）。
7. Display 在 Manager 中**可见**，但在 UI 层面与 Clients 不放在一起（独立面板/区域；不能出现在 ClientSelector 里）。

---

# 1. 验收标准（Acceptance Criteria）

## 1.1 功能验收

1. **启动方式**
   - Manager 内点击 “Open Display” 能打开 Display 页面（新窗口/标签均可）。
   - 直接访问 Display URL（例如 `https://localhost:5175`）也能正常工作。
2. **双通道选择**
   - 当由 Manager 打开且可配对成功时，Display 进入 Local 模式：
     - Display 不连接 Socket.io（不使用 server `msg` 通道进行控制）。
     - Manager → Display 控制通过 MessagePort 生效。
   - 当无法配对（无 opener / 超时 / origin 不允许）时，Display 自动回退 Server 模式：
     - Display 连接 server（Socket.io）并接收 manager 下发的控制消息。
3. **控制能力**
   - Display 至少支持并正确执行下列控制（与 client 行为尽量一致）：
     - `showImage / hideImage`
     - `playMedia / stopMedia`
     - `screenColor`（作为播放器场景的背景/覆盖层）
   - 对不相关的动作（例如 `flashlight/vibrate/setSensorState`）应当安全 noop，不报错、不影响播放。
4. **资产预下载**
   - Display 会接收并应用 manifest（见 2.3）。
   - Display 使用更高并发进行预下载（明显快于 client 的默认并发 4）。
5. **ready 回传（严格一次）**
   - Display 在本次会话中首次完成预下载后，仅发送一次 ready：
     - Local 模式：通过 MessagePort 发给 Manager；
     - Server 模式：通过 server 转发给 Manager（custom data message）。
   - 后续 manifest 更新导致再次 preload，也不再发送第二次 ready（除非你未来改需求）。
6. **Manager UI**
   - Manager 里可以看到 Display 状态（本机/远端、是否 ready、最后一次 ready 时间）。
   - Display 不出现在 ClientSelector/ClientList 的“可选 audience 客户端”列表中；`selectAll` 不包含 Display。

## 1.2 性能验收（定性 + 可观察）

1. Local 模式下，Display 控制不占用 server websocket `msg` 带宽（通过 Network 面板可见）。
2. Display preload 并发提升后，总预下载时间显著小于 client（同样 manifest）。
3. Display 播放控制延迟“体感接近即时”（本机 MessagePort 通信 + 本地渲染）。

---

# 2. 现状基于代码的关键点（用于复用/最小改动）

## 2.1 协议与消息路由（Server 模式）

- `@shugu/protocol` 已有 `ControlAction/ControlPayload`，以及 `targetGroup(groupId)` 等 helper：
  - `packages/protocol/src/types.ts`
  - `packages/protocol/src/helpers.ts`
- Server 通过 Socket.io `msg` 事件路由：
  - `apps/server/src/events/events.gateway.ts`
  - `apps/server/src/message-router/message-router.service.ts`
- `TargetSelector.mode === 'group'` 已在 router 中支持（按 `ClientInfo.group` 过滤），但**server 当前没有从连接参数写入 group**（需要补齐）。

## 2.2 资产服务与 Range（预下载可用）

- Asset Service：
  - `GET /api/assets/:id/content` 支持 `ETag` 与 `Range`，适合并发下载与缓存。
  - `apps/server/src/assets/assets.controller.ts`

## 2.3 现有 “manifest → client 预下载” 机制（可直接复用）

- Manager 会根据 Node Graph 扫描 `asset:` 引用，构造 manifest，并通过 plugin control 下发给 clients：
  - `apps/manager/src/lib/nodes/asset-manifest.ts`（`pluginId: "multimedia-core", command: "configure"`）
- Client 收到后调用 `multimediaCore.setAssetManifest(...)` 并自动 preload：
  - `apps/client/src/lib/stores/client.ts`
- `packages/multimedia-core` 是框架无关的预下载/缓存内核，可复用到 Display：
  - `packages/multimedia-core/src/multimedia-core.ts`

---

# 3. 总体方案（强推荐的工程形态）

## 3.1 新增独立应用：`apps/display`

Display 作为独立 SvelteKit app，端口建议 5175（与 manager 5173 / client 5174 对齐）：

- `apps/display/`：只做播放器 UI + 最小 runtime（不引入 node graph）
- 复用 `@shugu/multimedia-core` 做预下载与媒体播放状态管理
- 复用（或拷贝）client 的播放器组件作为起点（后续可再抽共享）

## 3.2 双通道控制：Local 优先，Server 回退

### Local 模式（MessagePort）

适用场景：由 Manager 打开 Display，或者 Display 能与 Manager 完成本机配对。

- Manager：
  1) `window.open(displayUrl)`
  2) 使用 `postMessage` 握手并把 `MessageChannel.port2` 转移给 Display
  3) 后续控制全部通过 `port1.postMessage(...)` 发送（专用通道）
- Display：
  1) 监听 `message` 事件等待配对请求
  2) 校验 `event.origin` + token
  3) 获取 `event.ports[0]` 作为专用 `MessagePort`
  4) 进入 Local 模式：不连接 Socket.io，仅接收 Port 消息执行

### Server 模式（Socket.io msg）

适用场景：Display 单独 URL 打开 / 无 opener / 配对超时 / origin 不匹配。

- Display 作为 “client” 角色连接 server：
  - `role=client`
  - `group=display`（连接 query 参数）
- Manager 控制 Display：
  - 通过 `targetGroup('display')` 下发控制/媒体/插件消息（不依赖 selection）

> 说明：这里保持 `ConnectionRole` 不变（仍是 `manager|client`），减少协议/鉴权改动；通过 `group=display` 区分 Display。

## 3.3 Display 只回传一次 ready 的路径

### Local 模式

- Display preload 完成后，通过 MessagePort 向 Manager 发送一次 `display:ready`。
- Manager 只用于 UI 展示（不作为系统运行必要条件）。

### Server 模式

- Display preload 完成后，发送一次 `SensorDataMessage`（`sensorType: 'custom'`），payload 例如：
  - `{ kind: 'display', event: 'ready', manifestId, at }`
- Server 会转发给 managers（现有 router 会把 data 消息发给所有 managers）。
- Manager 收到后更新 Display 面板状态。

---

# 4. 详细设计（协议、传输、运行时、UI）

## 4.1 Display 的“可执行动作”范围（第一期）

第一期以纯播放器为主，定义 Display 执行子集：

- 必做：
  - `showImage`（支持 `asset:` 或 URL）
  - `hideImage`
  - `playMedia`（以视频为主；音频可先 noop 或 muted 播放）
  - `stopMedia`
  - `screenColor`（作为背景层/覆盖层）
- 可选（看你是否要和 client 一致）：
  - `playSound/stopSound`（如果 Display 完全不需要音频，可先实现为 noop）
  - `asciiMode/asciiResolution/visualScenes`（未来扩展点；第一期可 noop）
- 明确 noop（必须安全无副作用）：
  - `flashlight/vibrate/setSensorState/setDataReportingRate/shutdown/...`

实现策略：Display runtime 对 action 做白名单 dispatch；未知/不支持 action 仅 `console.info` 并返回。

## 4.2 本机配对（Local 模式）细节

### 4.2.1 配对触发

两种入口都要支持：

1) Manager 打开（推荐路径）
   - Manager 生成 `pairToken`（一次性随机字符串，仅内存保存）
   - 打开 URL：`https://localhost:5175/?pairToken=...&server=...&assetReadToken=...`
2) 直接 URL 打开（非推荐）
   - Display 没有 opener，配对一定失败 → 自动进入 Server 模式
   - 若你未来希望“URL 打开也能本机发现 Manager”，需要额外机制（见 9.2 可选增强）

### 4.2.2 握手消息（建议 schema）

- Manager → Display（window.postMessage）
  - `{ type: 'shugu:display:pair', token, managerOrigin, serverUrl, assetReadToken? }`
  - transfer: `[channel.port2]`

安全校验：

- Display 必须校验：
  - `event.origin` 是否在允许列表（默认只允许 Manager origin，例如 `https://localhost:5173`）
  - `token` 是否与 query param `pairToken` 一致
- Manager 不要求 Display 发送任何“已配对”回包（满足你“只回传一次 ready”的约束）：
  - Manager 只在本地维护 `pairing` 超时；
  - 配对是否成功以“后续能否收到 ready（或能否正常发送控制并看到效果）”作为唯一判定依据。

### 4.2.3 Local 模式下的控制消息 schema

为了复用现有 protocol 结构，建议本机消息仍沿用 `ControlAction/ControlPayload` 概念：

- `display:control`
  - `{ type: 'shugu:display:control', action, payload, executeAtLocal?: number }`
- `display:plugin`
  - `{ type: 'shugu:display:plugin', pluginId, command, payload }`
  - 目前只需要 `pluginId:'multimedia-core', command:'configure'`
- `display:ready`（一次）
  - `{ type: 'shugu:display:ready', manifestId, at }`

## 4.3 Server 模式：把 Display 作为 group=display 的 client

### 4.3.1 Server 端 group 写入（必要改动）

在 `apps/server/src/events/events.gateway.ts` 的 `handleConnection`：

- 从 `client.handshake.query.group` 读取 group（字符串，长度限制、字符集限制）
- `registerConnection` 返回 `clientId` 后：
  - `clientRegistry.setClientGroup(clientId, group)`

这样 `clientList` 的 `ClientInfo.group` 就会包含 `display`，`targetGroup('display')` 的路由也能命中。

### 4.3.2 Display 端连接参数

- Display 在 Server 模式连接时，socket.io client 连接使用：
  - `query: { role: 'client', group: 'display' }`
  - auth identity：可以复用 client 的 identity 逻辑，但建议固定前缀 `d_`，避免与 audience client 混淆。

## 4.4 资产预下载：Display 的“更激进”实现方式

### 4.4.1 基本策略（第一期）

- Display 复用 `MultimediaCore`，但用更高并发：
  - Client 默认 `concurrency: 4`（现状）
  - Display 建议 `concurrency: 16`（或 24/32；需在现场网络/磁盘测一下）
- Display 接到 manifest 后立刻 `setAssetManifest`，并开始 preload。
- ready 判断：第一次进入 `status === 'ready'` 即触发一次 ready。

### 4.4.2 manifest 的来源（两种模式都要覆盖）

- Server 模式：
  - 复用 manager 的 `asset-manifest.ts` 推送机制
  - Display 会收到 `multimedia-core:configure`（因为它也是 server 上的“client”连接）
- Local 模式：
  - Display 不连 socket，因此 manager 需要通过 MessagePort 把最新 manifest 发过来
  - 需要把 `asset-manifest.ts` 的最新 manifest 变为可读取/可订阅的源（见 6.2）

### 4.4.3 “全部下载”语义澄清（避免隐性误解）

第一期默认解释为：**把 manifest 中列出的 assets 全部下载**（并发更大）。

如果你未来的“全部下载”是指“asset service 里所有 assets（不依赖 graph）”，则需要新增 read-auth 的 assets 列表/manifest API（见 9.1 可选增强）。

## 4.5 Manager UI：Display 可见但与 Clients 分离

### 4.5.1 UI 结构建议

在 Manager Dashboard（或新增一个 Tab）加入 “Display” 卡片/面板：

- Local Display
  - 状态：`disconnected | pairing | connected | ready`
  - 按钮：`Open`、`Reconnect`、`Close`
- Remote Display（Server 模式，group=display）
  - 列表：显示所有 group=display 的连接（通常 0 或 1）
  - 状态：`connected` + `ready?`（ready 来自一次性消息）

### 4.5.2 Clients UI 必须排除 Display

- `ClientSelector/ClientList` 只展示 `group !== 'display'` 的连接
- `selectAll` 只选择非 display
- 任何“对选中 clients”发送的控制，不会意外发到 Display

### 4.5.3 “输入给 client 的行为 Display 也可接受”如何落到 UX

建议加入一个全局开关（默认 on/off 由你定）：

- `Send To Display`（当 Display 存在时启用）
  - on：所有控制（不含 node graph 部署类）同时发往 Display
  - off：只发 clients

实现层面：

- clients 仍走 `sdk-manager`（server）
- display 走：
  - local：MessagePort
  - server：`targetGroup('display')`

---

# 5. 仓库改动清单（文件/模块级别，便于落地）

## 5.1 新增：`apps/display/`

建议包含：

- `apps/display/src/routes/+page.svelte`
  - 播放器主 UI（全屏）
  - 读取 query（serverUrl / assetReadToken / pairToken）
  - 负责启动 transport 选择逻辑
- `apps/display/src/lib/stores/display.ts`
  - Display runtime 状态（transport、readySent、multimediaCore、videoState/imageState）
  - 处理 control/plugin 消息并调用 MultimediaCore
- `apps/display/src/lib/runtime/extensions.ts`
  - `registerDisplayExtension()` 等扩展点（第一期可以只定义接口与默认空实现）
- 组件（初期可直接复用 client 的实现逻辑）：
  - `VideoPlayer.svelte`、`ImageDisplay.svelte`

## 5.2 新增：`packages/sdk-display/`（建议）

目的：把“Local/Server 两套 transport + 统一 send API”封装起来，避免散落在 Svelte store。

建议导出：

- `DisplayTransport` interface
  - `mode: 'local' | 'server'`
  - `connect()` / `disconnect()`
  - `sendControl(action, payload, executeAtLocal?)`
  - `sendPlugin(pluginId, command, payload)`
  - `sendReadyOnce(payload)`
- `createLocalDisplayTransport(...)`（MessagePort）
- `createServerDisplayTransport(...)`（Socket.io msg）

注意：Server transport 可以复用 `@shugu/sdk-client` 的部分代码，但不要引入 Sensors/NodeExecutor；保持轻量。

## 5.3 修改：Server 支持 group=display

改动点：

- `apps/server/src/events/events.gateway.ts`
  - 在 `handleConnection` 读取 `handshake.query.group` 并写入 registry：`setClientGroup(clientId, group)`
  - group 需要 sanitize（长度、字符集）

## 5.4 修改：Manager 区分 Display 与 Clients

改动点：

- `apps/manager/src/lib/stores/manager.ts`
  - 新增 derived store：`displayClients`（`clients.filter(c.group === 'display')`）
  - 修改 `selectAllClients()` 排除 display
  - 新增 display ready 状态 store（本机 + 远端两套）
- 新增组件：
  - `apps/manager/src/lib/components/DisplayPanel.svelte`（独立面板）
- `apps/manager/src/routes/+page.svelte`
  - 引入 DisplayPanel，并保证其 UI 不与 client selector 混杂

## 5.5 修改：Manager 侧本机 DisplayBridge

新增文件建议：

- `apps/manager/src/lib/display/display-bridge.ts`
  - `openDisplay()` / `closeDisplay()` / `pair()` / `sendControl()` / `sendManifest()` / `onReadyOnce(cb)`
  - 内部处理 token、origin 校验、超时、端口生命周期

## 5.6 修改：`asset-manifest` 对 Local Display 可用

当前 `apps/manager/src/lib/nodes/asset-manifest.ts` 的 `latestManifest` 是内部变量。

建议改为：

- 导出 `assetManifestStore` 或 `getLatestManifest()` + `subscribeLatestManifest(cb)`
  - 这样 `display-bridge.ts` 在配对完成时：
    - 立刻发送当前 manifest
    - 之后 manifest 更新也推一次（Display 会继续下载，但不会再次 ready）

## 5.7 根脚本与 workspace

需要新增：

- `apps/display/package.json`（与其他 apps 一致）
- 根 `package.json` scripts：
  - `dev:display`
  - `dev:all` 已是 `pnpm -r --parallel run dev`，Display 加入 workspace 后会自动被覆盖（但要确保 Display 的 `dev` script 存在）。

---

# 6. 实施步骤（按最短闭环 + 可回滚）

## Phase 0：设计冻结

> 说明：本章节**每一个小项都是 checkbox**，用于非常细的进度追踪；建议严格按 Phase 顺序推进，做到每个 Phase 都可独立回滚。

- [x] P0-01 冻结第一期 Display 支持动作白名单（见 4.1），并确认“不支持动作”的行为：必须安全 noop、不能报错。
- [x] P0-02 冻结 ready 的语义：以 `MultimediaCore.status === 'ready'` **首次到达**作为 ready（见 4.4.1）。
- [x] P0-03 冻结 “只回传一次 ready” 的边界：
  - [x] 仅首次 ready 回传（后续 manifest 更新导致再次 preload：不再回传）
  - [x] Server 模式与 Local 模式都遵循同一条规则
- [x] P0-04 冻结 Local 配对超时与状态机（见 4.2）：
  - [x] 超时建议值（800ms–1500ms，是否需要可配置）
  - [x] 超时后是否允许“晚到的配对消息”把 Server 模式切回 Local（推荐：不切回；只接受首次判定）
- [x] P0-05 冻结允许配对的 origin 列表（默认仅 `https://localhost:5173`；见 4.2.2）。
- [x] P0-06 确认 Display URL 参数 schema（沿用 client 的 `server` 命名，见 `apps/client/src/routes/+page.svelte`）：
  - [x] `server`（serverUrl）
  - [x] `assetReadToken`（可选；本机开发可为空）
  - [x] `pairToken`（仅 Manager 打开时携带）
- [x] P0-07 文档状态更新：把头部 `Status: Draft` 改为 `Approved`（或在文末追加“冻结决策记录”）。

## Phase 1：Server group 支持

- [x] P1-01 定位改动点：`apps/server/src/events/events.gateway.ts` 的 `handleConnection` 目前只读取 `query.role`，未写入 group。
- [x] P1-02 解析 `client.handshake.query.group`（string）并做 sanitize（建议与 `ClientRegistryService` 的 `sanitizeId` 规则一致：长度限制 + 字符集限制）。
- [x] P1-03 在 `registerConnection(...)` 返回 `clientId` 后写入 group：
  - [x] `clientRegistry.setClientGroup(clientId, group)`
  - [x] 仅对 `role === 'client'` 生效（manager 不需要 group）
- [x] P1-04 透出验证：`apps/server/src/client-registry/client-registry.service.ts#getAllClients()` 已包含 `group` 字段（确认连通即可，无需额外改动）。
- [x] P1-05 路由验证：`apps/server/src/message-router/message-router.service.ts#resolveTargetSocketIds()` 已支持 `target.mode === 'group'`（确认连通即可）。
- [ ] P1-06 冒烟验证（最小闭环）：用任意 socket.io client 以 `query: { role:'client', group:'display' }` 连接，Manager 端能在 `clientList` 看到 `group:'display'`。
  - 说明：当前 sandbox 无法 `listen` 端口（`listen EPERM`），本机需手动跑一次（见 `docs/PlanDocs/1223_display/plan_progress.md`）。

## Phase 2：新增 Display app

- [x] P2-01 创建 `apps/display/`（推荐直接以 `apps/client/` 为模板复制一份，再删掉不需要的功能，保证 SvelteKit/SSL/cacheDir 约定一致）。
- [x] P2-02 `apps/display/package.json`：
  - [x] `dev` 端口固定为 5175（对齐 manager 5173 / client 5174）
  - [x] 依赖最小集合：`@shugu/multimedia-core`、`@shugu/protocol`、`@shugu/ui-kit`、`socket.io-client`（仅 Server 模式需要）
- [x] P2-03 `apps/display/vite.config.ts`：复制 `apps/client/vite.config.ts`，仅修改端口为 5175（保留 `basicSsl()` 与 `cacheDir` 规则）。
- [x] P2-04 `apps/display/src/routes/+page.svelte`（纯播放器 UI）：
  - [x] 解析 query：`server` / `assetReadToken` / `pairToken`（参考 `apps/client/src/routes/+page.svelte` 的解析逻辑）
  - [x] 全屏渲染：Video + Image + ScreenColor overlay（不引入 node graph）
  - [x] 在 UI 上提供最小 debug 信息（当前模式 local/server、ready 状态、manifestId）
- [x] P2-05 `apps/display/src/lib/stores/display.ts`（运行时核心）：
  - [x] 初始化 `MultimediaCore`（参考 `apps/client/src/lib/stores/client.ts` 的初始化段落），并把 `concurrency` 调大（建议 16）
  - [x] 订阅 `multimediaCore.media.subscribeState(...)` 驱动 `VideoPlayer` / `ImageDisplay`（参考 `apps/client/src/lib/stores/client.ts`）
  - [x] 实现 ready 判定与“只发一次”门闩（`readySent`）
- [x] P2-06 复用播放器组件（第一期最快路径：拷贝，不做抽包）：
  - [x] `apps/client/src/lib/components/VideoPlayer.svelte` → `apps/display/src/lib/components/VideoPlayer.svelte`
  - [x] `apps/client/src/lib/components/ImageDisplay.svelte` → `apps/display/src/lib/components/ImageDisplay.svelte`
- [x] P2-07 实现 action 白名单 dispatch（参考 `apps/client/src/lib/stores/client.ts#executeControl`，只保留子集）：
  - [x] `showImage` / `hideImage`（走 `multimediaCore.media.showImage/hideImage`，并支持 `asset:`）
  - [x] `playMedia` / `stopMedia`（走 `multimediaCore.media.playVideo/stopVideo`，并支持 clip 参数解析策略）
  - [x] `screenColor`（第一期允许简单 solid 覆盖层即可；后续再补全 pulse/cycle）
  - [x] 其他 action：安全 noop（仅 `console.info`）

## Phase 3：Server 模式 transport

- [x] P3-01 选择实现路径（推荐优先复用现有 SDK，避免自己实现 time-sync/schedule）：
  - [x] 方案 A（推荐）：Display 复用 `@shugu/sdk-client` 的 `ClientSDK`，并给它加可选 query 扩展（见下一条）
  - [ ] 方案 B：Display 自己用 `socket.io-client` 直连（需要自己处理 `executeAt` 调度与 time sync，工作量更大）
- [x] P3-02（方案 A）改造 `packages/sdk-client/src/client-sdk.ts`：
  - [x] `ClientSDKConfig` 增加 `query?: Record<string, string>`（或显式 `group?: string`）
  - [x] `io(..., { query: { ...(config.query ?? {}), role:'client' } })`（默认不传时行为不变）
- [x] P3-03 Display Server 模式连接参数：
  - [x] `query: { group:'display' }`（role 仍由 SDK 固定为 client）
  - [x] identity：可复用 client 的 identity 逻辑，但建议前缀 `d_`（避免与 audience client 混淆）
- [x] P3-04 Display 接收消息并执行（复用 client 的处理方式）：
  - [x] `onControl` → action dispatch（P2-07）
  - [x] `onPluginControl` → 仅处理 `pluginId:'multimedia-core', command:'configure'`（参考 `apps/client/src/lib/stores/client.ts#handlePluginControlMessage`）
  - [x] （可选）`onMedia`：如果未来使用 `MediaMetaMessage`，在这里接入
- [x] P3-05 Server 模式 ready 回传一次（严格一次）：
  - [x] 触发点：`MultimediaCore` 首次进入 `ready`
  - [x] 发送：`sdk.sendSensorData('custom', { kind:'display', event:'ready', manifestId, at }, { trackLatest:false })`
  - [x] 处理竞态：如果 `MultimediaCore` ready 早于 SDK `connected+clientId`，需在 SDK 连接后补发一次（但仍保证只发一次）

## Phase 4：Local 模式 transport + Manager Bridge

- [x] P4-01 新增 `apps/manager/src/lib/display/display-bridge.ts`（Manager 侧）：
  - [x] `openDisplay()`：`window.open(displayUrl)`（带 `pairToken/server/assetReadToken` query）
  - [x] `pair()`：`postMessage({ type:'shugu:display:pair', token, serverUrl, assetReadToken }, displayOrigin, [port2])`
  - [x] `sendControl/sendPlugin/sendManifest`：统一封装本机消息 schema（见 4.2.3）
  - [x] 生命周期：超时、窗口关闭、port 断开后的清理
- [x] P4-02 Display 侧配对监听（建议放在 `apps/display/src/lib/stores/display.ts`）：
  - [x] `window.addEventListener('message', ...)` 等待 `{ type:'shugu:display:pair' }`
  - [x] 校验 `event.origin` 在白名单 + `token === pairToken`
  - [x] 取 `event.ports[0]` 作为专用 `MessagePort`，并绑定 `port.onmessage`
- [x] P4-03 Local 模式下的消息接入：
  - [x] `shugu:display:control` → action dispatch（P2-07）
  - [x] `shugu:display:plugin` → 仅处理 `multimedia-core:configure`（P2-06 / Phase 6 会用到）
- [x] P4-04 Local 模式 ready 回传一次：
  - [x] `port.postMessage({ type:'shugu:display:ready', manifestId, at })`
  - [x] 仍受 `readySent` 门闩约束（不重复）
- [x] P4-05 Local 优先 + Server 回退联动（和 P0-04 冻结的状态机一致）：
  - [x] 在 Display 侧启动配对超时计时器；超时后进入 Server 模式（Phase 3）
  - [x] 配对成功后：取消超时，并保证不再建立 socket 连接

## Phase 5：Manager UI

- [x] P5-01 Manager store 增加 Display 专用派生数据（按 5.4 约定）：
  - [x] `displayClients = clients.filter(c.group === 'display')`
  - [x] `audienceClients = clients.filter(c.group !== 'display')`（给 ClientSelector/ClientList 使用）
- [x] P5-02 修改 `apps/manager/src/lib/components/ClientList.svelte` 使用 `audienceClients`，确保 Display 不出现在可选列表。
- [x] P5-03 修改 `apps/manager/src/lib/stores/manager.ts#selectAllClients()`：
  - [x] 不再调用 `sdk.selectAll()`（会包含 display）
  - [x] 改为 `sdk.selectClients(audienceClients.map(c => c.clientId))`
- [x] P5-04 新增 `apps/manager/src/lib/components/DisplayPanel.svelte`：
  - [x] Local Display：显示 bridge 状态（disconnected/pairing/connected/ready）、按钮（Open/Reconnect/Close）
  - [x] Remote Display：显示 `displayClients` 列表（通常 0/1）与 ready 状态
- [x] P5-05 将 `DisplayPanel` 接入 `apps/manager/src/routes/+page.svelte`（与 Clients 面板分区，不放在 ClientSelector 旁边）。
- [x] P5-06 新增 “Send To Display” 全局开关（参考 4.5.3）：
  - [x] UI：在 Dashboard 放置 toggle（仅当存在 local 或 remote display 时可用）
  - [x] 状态：建议落在 `apps/manager/src/lib/stores/manager.ts`（可选 localStorage 持久化）
- [x] P5-07 接入发送路径（做到“输入给 client 的行为 Display 也可接受”）：
  - [x] 在 `apps/manager/src/lib/stores/manager.ts` 中抽一个内部方法：`maybeMirrorToDisplay(action, payload, executeAt)`
  - [x] local 优先：若 bridge 已连接 → 走 `display-bridge.ts` 的 `sendControl`
  - [x] 否则 server 回退：`sdk.sendControl(targetGroup('display'), action, payload, executeAt)`
  - [x] 仅镜像控制子集（4.1）与必要的 manifest（Phase 6），不转发 node-executor 等部署类插件消息

## Phase 6：manifest 对 local display 推送

- [x] P6-01 改造 `apps/manager/src/lib/nodes/asset-manifest.ts`：把 `latestManifest` 变为可消费的输出：
  - [x] 导出 `getLatestManifest(): AssetManifest | null`
  - [x] 导出 `subscribeLatestManifest(cb): () => void`（或直接导出一个 Svelte store）
- [x] P6-02 `apps/manager/src/lib/display/display-bridge.ts` 在配对成功后：
  - [x] 立刻 `sendManifest(getLatestManifest())`
  - [x] `subscribeLatestManifest`：后续更新再推送一次（Display 会继续下载但不会再次 ready）
- [x] P6-03 Display 侧处理 `shugu:display:plugin`（`multimedia-core:configure`）：
  - [x] `multimediaCore.setAssetManifest({ manifestId, assets, updatedAt })`
  - [x] 触发 preload（由 MultimediaCore 自己管理）
- [x] P6-04 ready “严格一次”回归验证：manifest 更新导致第二次 preload 时，Display 仍不会发第二次 ready（`readySent` 必须挡住）。

## Phase 6.1：Node Graph Display 节点（Objects）

- [x] P6.1-01 新增 manager-only node spec：`apps/manager/src/lib/nodes/specs/display-object.json`（Objects/Display）。
- [x] P6.1-02 `apps/manager/src/lib/nodes/specs/register.ts` 支持 `runtime.kind: 'display-object'`：
  - [x] `onSink` 执行命令：local bridge 优先，否则 `targetGroup('display')` 回退。
  - [x] `executeAt` 在 local bridge 下会从 server time 转换为 local time（`executeAtLocal = executeAt - offset`）。
- [x] P6.1-03 NodeGraph 的 `client-picker` UI 过滤 display group（避免在 Client 节点里误选 Display）。
- [ ] P6.1-04 手动验证（见 7.4）：在 Manager Node Graph 中新增 Display 节点并连接 `proc-screen-color` / `play-media`，Display 生效。
- [x] P6.1-05 Patch 部署路由支持 Display：`audio-out(cmd) -> display-object(in)` 也会触发 patch deploy（Local bridge 优先，其次 remote display clients）。
- [x] P6.1-06 Display 支持 `node-executor` 插件（Server + Local）：接收 `pluginId:'node-executor'` 的 `deploy/start/stop/remove/override-*` 并执行。
- [x] P6.1-07 Display 增加一键启用音频（Tone.start）入口：用于 `tone-player` 等音频 patch 正常发声。
- [ ] P6.1-08 手动验证音频 patch（见 7.4）：把 `Audio Patch to Client(Deploy)` 直接连到 `Objects/Display(In)`，并在 Display 点击 `Enable Audio` 后应有声音。

## Phase 7：回归验证与文档

- [ ] P7-01 根脚本补齐：根 `package.json` 增加 `dev:display`（与 5.7 对齐）。
- [ ] P7-02 完成手动验证清单：逐条跑完 7.1 / 7.2 / 7.3（建议边跑边截图/录屏，便于回溯）。
- [ ] P7-03 回归确认：ClientSelector/ClientList/`selectAll` 不包含 Display，但 asset manifest 仍会推到 Server 模式 Display（因为它仍在 `state.clients` 里）。
- [ ] P7-04 执行质量门槛：`pnpm lint`（必要）+ `pnpm build:all`（推荐）。
- [ ] P7-05 文档更新（可选）：README 增加 `pnpm dev:display`、打开 URL、Local/Server 模式判定说明。

---

# 7. 手动验证清单（建议逐条勾选）

## 7.1 Local 模式（Manager 打开）

1) `pnpm dev:all`（应包含 server/manager/client/display）。  
2) 打开 Manager：`https://localhost:5173`。  
3) 登录并连接 server。  
4) 点击 DisplayPanel 的 `Open Display`。  
5) Display 页面显示 mode=local（可在角落 debug 显示，或 console）。  
6) Manager 执行：
   - showImage（asset / url）→ Display 显示
   - playMedia（asset / url）→ Display 播放
   - stopMedia → 停止
7) 检查 Network：Display 不应建立 Socket.io 连接（或至少不使用 `msg` 控制）。  
8) Display preload 完成后，Manager 面板收到一次 ready（仅一次）。  

## 7.2 Server 模式（URL 直接打开）

1) 直接打开 Display：`https://localhost:5175?server=https://localhost:3001`。  
2) Display 进入 server 模式，并连接 server（role=client, group=display）。  
3) Manager 面板应显示 Remote Display 连接出现（但不在 client selector）。  
4) Manager 通过 “Send To Display” 下发 showImage/playMedia 生效。  
5) Display preload 完成后，Manager 收到一次 ready（仅一次）。  

## 7.3 防回归：Clients 不受影响

1) client 仍可正常连接/选择/接收控制。  
2) `selectAll` 不包含 display（不会误发）。  
3) node graph 的 client 节点逻辑不因 display 的存在改变（display 不参与 selection）。

## 7.4 Node Graph：Display 节点（Objects）

1) 打开 Manager：`https://localhost:5173`，进入 Node Graph。
2) 新增节点：`Objects/Display` + `Processors/Screen Color`。
3) 连接：`Screen Color(cmd)` → `Display(In)`。
4) 调整 Screen Color 的参数，Display 背景/覆盖层应变化。
5) 可选：再用 `Audio/Play Media(cmd)` → `Display(In)` 验证 `showImage/playMedia/stopMedia` 生效（可用 `asset:` 或 URL）。
6) 音频 patch（让 Display 像 client 一样跑 node-executor）：
   - 连接：`Audio Patch to Client(Deploy)` → `Display(In)`（注意这里是 Deploy 端口）。
   - Display 页面点一次 `Enable Audio`（或随便点一下页面触发启用）。
   - 预期：Display 能播放 `tone-player` / `tone-osc` 等音频节点输出（有声音）。

---

# 8. 风险与边界（提前说明，避免现场踩雷）

1) **Local 配对只能覆盖“由 Manager 打开”这一强场景**：URL 直接打开通常无 opener，因此会回退 Server 模式（满足需求）。  
2) **浏览器策略限制**：
   - 自动全屏/自动播放可能需要用户手势；Display 需要提供一个显式 “Enter / Unmute” 按钮（即使你不需要音频，也可能影响 video autoplay）。
3) **并发过高的副作用**：
   - 高并发会抢占带宽/磁盘 IO，可能影响同机的 server/manager；
   - 建议把 Display 并发做成可配置项（query 或 localStorage），默认 16，现场再调。
4) **manifest 更新频繁**：
   - `asset-manifest.ts` 会在 graph 改动时推送；Display 可能频繁重启 preload。
   - 建议 Display 侧对同 manifestId 去重（MultimediaCore 已对同 manifestId return，但仍要确认）。

---

# 9. 可选增强（不纳入第一期，但计划里预留）

## 9.1 “真正全量下载（asset service 全库）”

如果你要的是 “下载服务器所有 assets（不依赖 graph）”，需要 server 新增 read-auth 的列表 API，例如：

- `GET /api/assets/manifest`（require read token）
  - 返回 `{ manifestId, assets: ['asset:xxx', ...], updatedAt }`

Display 在无 manager 推送时也能拉到全库并 preload。

## 9.2 “URL 打开也能本机发现 Manager 并走 Local”

要实现“Display 直接 URL 打开，但如果 Manager 同机存在则仍走 Local”，需要额外的本机发现机制：

- 同 origin：`BroadcastChannel` 可做（但 Manager/Display 分端口时不同 origin，默认不行）
- 跨 origin：需要一层本地 broker（例如 server 提供一个纯本机 HTTP pairing endpoint，或使用 ServiceWorker/Native wrapper）

鉴于你当前明确“回退到 server 老路也可”，第一期不做。

---

# 10. 参考项目/资料（强相关，可借鉴但不照搬）

> 说明：下面链接用于启发架构形态与通信范式；第一期实现不依赖这些项目的代码。

- reveal.js 的跨窗口控制（postMessage）：`https://revealjs.com/postmessage/`
- MDN MessagePort/MessageChannel：`https://developer.mozilla.org/en-US/docs/Web/API/MessagePort`
- NodeCG（dashboard/graphics 分离的成熟形态）：`https://github.com/nodecg/nodecg`
- SPX-GC（控制面板 + HTML 输出 + 扩展/模板化）：`https://github.com/TuomoKu/SPX-GC`
