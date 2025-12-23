<!--
Purpose: 记录 `docs/PlanDocs/1223_display/plan.md` 的真实执行进度（已完成/阻塞/下一步），便于回溯与协作。
Owner: ShuGu
Created: 2025-12-23
-->

# 1223 Display：执行进度（plan_progress）

> 本文件只记录“已经在代码库里落地的改动”和“当前被阻塞/待验证的项”。  
> 详细设计与完整步骤请看：`docs/PlanDocs/1223_display/plan.md`。

---

## 2025-12-23

### ✅ Phase 0：设计冻结（已完成）

- 已将 `docs/PlanDocs/1223_display/plan.md` 头部 `Status` 更新为 `Approved`，并在 Phase 0 逐项勾选完成（P0-01 ~ P0-07）。
- 冻结项包含：动作白名单、ready 语义（首次 `MultimediaCore.status === 'ready'`）、“只回传一次 ready”边界、Local 配对超时与状态机约束、默认允许 origin、Display URL 参数 schema（`server/assetReadToken/pairToken`）。

### 🟡 Phase 1：Server 支持 `group=display`（已落地代码；待本机冒烟验证）

- ✅ 代码改动已完成：
  - `apps/server/src/events/events.gateway.ts`：在 `handleConnection` 读取 `handshake.query.group`，sanitize 后写入 `ClientRegistryService.setClientGroup(clientId, group)`。
- ✅ 静态验证点（代码层面已满足）：
  - `apps/server/src/client-registry/client-registry.service.ts#getAllClients()` 已包含 `group` 字段（clientList 会透出）。
  - `apps/server/src/message-router/message-router.service.ts#resolveTargetSocketIds()` 已支持 `TargetSelector.mode === 'group'`（路由可命中）。
- ✅ 运行过的命令：
  - `pnpm --filter @shugu/server run lint`（无 errors；仓库内既有 warnings 未处理）。

#### ⛔ 阻塞：P1-06 冒烟验证（sandbox 限制）

在本次 Codex sandbox 内启动 Nest server 会报 `listen EPERM`（无法绑定端口），因此无法在这里完成“真连接”的冒烟验证。

建议你在本机执行以下最小闭环验证（完成后即可把 `plan.md` 里的 P1-06 勾上，并把 Phase 1 总项勾上）：

1) 启动 Server（任意一种）：
   - `pnpm dev:server`
   - 或 `pnpm --filter @shugu/server run dev`
2) 运行 Node 冒烟脚本（会模拟一个 manager + 一个 group=display 的 client，并打印 clientList；同时验证 group 路由能命中）：

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 node --input-type=module -e "
import { io } from 'socket.io-client';

const serverUrl = process.env.SERVER_URL ?? 'https://localhost:3001';

const manager = io(serverUrl, { query: { role: 'manager' }, transports: ['websocket'] });
manager.on('connect', () => console.log('[smoke] manager connected', manager.id));
manager.on('msg', (msg) => {
  if (msg?.type === 'system' && msg?.action === 'clientList') {
    console.log('[smoke] clientList', msg.payload?.clients);
  }
});

const client = io(serverUrl, {
  query: { role: 'client', group: 'display' },
  auth: { deviceId: 'd_display_smoke', instanceId: 'i_display_smoke' },
  transports: ['websocket'],
});
client.on('connect', () => console.log('[smoke] display-client connected', client.id));
client.on('msg', (msg) => {
  if (msg?.type === 'system' && msg?.action === 'clientRegistered') {
    console.log('[smoke] registered', msg.payload);
  }
  if (msg?.type === 'control') {
    console.log('[smoke] control received', msg.action, msg.payload);
  }
});

setTimeout(() => {
  manager.emit('msg', {
    type: 'control',
    version: 1,
    from: 'manager',
    target: { mode: 'group', groupId: 'display' },
    action: 'screenColor',
    payload: { color: '#ff00ff', opacity: 1, mode: 'solid' },
    clientTimestamp: Date.now(),
  });
}, 800);

setTimeout(() => {
  manager.disconnect();
  client.disconnect();
  process.exit(0);
}, 1800);
"
```

预期结果：
- `clientList` 中出现 `group: 'display'` 的连接项
- `display-client` 能收到一条 `control`（`target.mode === 'group'` 路由生效）

### ✅ Phase 2：新增 `apps/display`（已完成）

- ✅ 新增 Display SvelteKit app：
  - `apps/display/package.json`（端口 5175；依赖 `@shugu/multimedia-core` / `@shugu/protocol` / `@shugu/ui-kit` / `socket.io-client`）
  - `apps/display/vite.config.ts`（`basicSsl()` + cacheDir 规则，与其他 app 一致）
  - `apps/display/svelte.config.js`、`apps/display/tsconfig.json`、`apps/display/src/app.html`
  - `apps/display/src/routes/+page.ts`（`ssr=false`）
  - `apps/display/src/routes/+page.svelte`（全屏播放器 + debug 面板；可手动触发 showImage/playMedia/screenColor）
- ✅ 运行时核心（MultimediaCore bridge + action dispatch）：
  - `apps/display/src/lib/stores/display.ts`
    - `MultimediaCore(concurrency: 16, autoStart: true)`
    - 订阅 `multimediaCore.media` 驱动 `VideoPlayer`/`ImageDisplay`
    - action 白名单：`showImage/hideImage/playMedia/stopMedia/screenColor`；其他 action 安全 noop
    - ready 门闩：`readyOnce`（仅记录首次 ready，Phase 3/4 再接入回传）
- ✅ 复用播放器组件（拷贝 client 实现）：
  - `apps/display/src/lib/components/VideoPlayer.svelte`
  - `apps/display/src/lib/components/ImageDisplay.svelte`
- ✅ 为支持 Display 的更高并发预下载，放宽 `MultimediaCore` 并发上限：
  - `packages/multimedia-core/src/multimedia-core.ts`：`concurrency` clamp 上限从 8 提升到 32（client 仍用默认 4，不受影响）
- ✅ 运行过的命令：
  - `pnpm --filter @shugu/display run lint`
  - `pnpm install --prefer-frozen-lockfile`
  - `pnpm --filter @shugu/display run check`

### ✅ Phase 3：Server 模式 transport（已完成；待本机 E2E 验证）

- ✅ `ClientSDK` 支持追加 Socket.io query（用于 `group=display`）：
  - `packages/sdk-client/src/client-sdk.ts`：`ClientSDKConfig` 增加 `query?: Record<string, string>`，连接时 `query: { ...(config.query ?? {}), role: 'client' }`。
  - `packages/sdk-client/package.json`：新增 subpath export `@shugu/sdk-client/client-sdk`，避免 Display 引入 SDK barrel 造成 bundle 过重。
- ✅ Display Server 模式连接与执行：
  - `apps/display/src/lib/stores/display.ts`
    - Server 模式（无 `pairToken`）使用 `ClientSDK` 连接，`query: { group: 'display' }`
    - identity：`d_`/`i_` 前缀 + `localStorage/sessionStorage` 持久化（避免与 audience client 混淆）
    - `onControl`：按 `executeAt - offset` 换算为本地时间后调用 `executeControl(...)`
    - `onPluginControl`：仅处理 `multimedia-core:configure` 并调用 `multimediaCore.setAssetManifest(...)`
    - `onMedia`：把 `MediaMetaMessage` 映射为 `playMedia`（视频强制 `muted: true`）
    - ready 一次回传：`MultimediaCore` 首次 `ready` 后记录门闩；如早于 `connected+clientId`，则在 SDK 就绪后补发一次（仍严格一次）
  - `apps/display/src/routes/+page.svelte`：debug 信息补充 `ws status` 与 `clientId`
- ✅ 运行过的命令：
  - `pnpm --filter @shugu/sdk-client run build`
  - `pnpm --filter @shugu/display run lint`
  - `pnpm --filter @shugu/display run check`
- ⛔ sandbox 限制：本环境无法启动 Nest server 做真连接冒烟（`listen EPERM`），因此 Phase 3 的“端到端收发”需要你在本机跑 `pnpm dev:all` 再验证。

### ✅ Phase 4：Local 模式（MessagePort）+ Manager Bridge（已完成；待本机浏览器验证）

- ✅ Manager 侧 DisplayBridge：
  - `apps/manager/src/lib/display/display-bridge.ts`
    - `openDisplay()`：生成 `pairToken`，拼接 `pairToken/server/assetReadToken` 打开 Display URL
    - `pairDisplay()`：`postMessage({ type:'shugu:display:pair', token, managerOrigin, ... }, displayOrigin, [port2])`
    - `sendControl/sendPlugin/sendManifest`：按 4.2.3 的本机消息 schema 发送
    - 生命周期：轮询检测窗口关闭 + 端口 teardown（为 Phase 5 的 UI 状态做准备）
- ✅ Display 侧 Local transport：
  - `apps/display/src/lib/stores/display.ts`
    - `pairToken` 存在时进入 `local-pending`，监听 `{ type:'shugu:display:pair' }`
    - 安全校验：`event.origin` 白名单（默认允许 `https://localhost:5173` / 同 host 的 `:5173`）+ `token === pairToken`
    - 成功后进入 `local`：用 `MessagePort` 接收 `shugu:display:control/plugin` 并执行（仅 `multimedia-core:configure`）
    - ready 严格一次：Local 模式通过 `port.postMessage({ type:'shugu:display:ready', manifestId, at })` 回传
    - 回退：配对超时（1200ms）后进入 Server 模式并建立 Socket.io 连接；超时后不再接受“晚到”的配对消息
  - `apps/display/src/routes/+page.svelte`：debug 信息补充 `reportedLocal`
- ✅ 运行过的命令：
  - `pnpm --filter @shugu/display run lint`
  - `pnpm --filter @shugu/display run check`
  - `pnpm --filter @shugu/manager run lint`（仓库内既有 warnings 未处理）
- ⛔ sandbox 限制：本环境无法打开真实浏览器窗口做 MessagePort 配对验证；需你在本机跑 `pnpm dev:manager` + `pnpm dev:display` 手动验证 Local 配对与 ready 一次回传。

### ✅ Phase 5：Manager UI（已完成；待本机 UI 验证）

- ✅ Client 选择与 selectAll 过滤（Display 与 audience 分离）：
  - `apps/manager/src/lib/stores/manager.ts`
    - `displayClients / audienceClients` 派生数据（Display 不再混入 audience 选择 UI）
    - `selectAllClients()` 改为 `sdk.selectClients(audienceClients.map(...))`（不再调用 `sdk.selectAll()`）
    - `selectClients()` 入口过滤：传入的 ids 会被裁剪为 audience clients（避免意外选中 display）
  - `apps/manager/src/lib/components/ClientList.svelte`：改用 `audienceClients` 渲染列表
- ✅ DisplayPanel（独立面板）+ Send To Display 开关：
  - `apps/manager/src/lib/components/DisplayPanel.svelte`
    - Local Display：展示 bridge 状态与 ready 信息，提供 `Open / Reconnect / Close`
    - Remote Display：展示 `group=display` 列表与 ready/manifest 信息
    - `Send To Display` toggle：仅在存在 local 或 remote display 时出现
  - `apps/manager/src/routes/+page.svelte`：Dashboard 接入 `DisplayPanel`（与 ClientSelector 分区）
  - `apps/manager/src/lib/stores/manager.ts`：新增 `sendToDisplayEnabled`（localStorage 持久化）
- ✅ 控制镜像（Display 也可接受）
  - `apps/manager/src/lib/stores/manager.ts`：新增 `maybeMirrorToDisplay(...)`
    - local 优先：bridge 已连接 → 走 `display-bridge.ts#sendControl`
    - server 回退：`sdk.sendControl(targetGroup('display'), ...)`
    - 仅镜像动作子集：`showImage/hideImage/playMedia/stopMedia/screenColor`
    - 对 audience 发送路径：即便点 “All”，也只会发给 audience clients（避免 Display 被默认包含）
  - Display ready（Server 模式）在 Manager 可见：`apps/manager/src/lib/stores/manager.ts` 解析 `custom` → `{ kind:'display', event:'ready' }` 并标记为 `assets-ready`
- ✅ 运行过的命令：
  - `pnpm --filter @shugu/manager exec tsc -p tsconfig.json --noEmit`
  - `pnpm --filter @shugu/manager run lint`（仓库内既有 warnings 未处理）
- ⛔ sandbox 限制：本环境无法打开浏览器窗口完成 UI/`window.open`/MessagePort 的交互验证；需你在本机跑 `pnpm dev:manager` + `pnpm dev:display`（如需 server 回退再加 `pnpm dev:server`）手动验证。

### ✅ Phase 6：Local 模式 manifest 推送（已完成；待本机浏览器验证）

- ✅ 把最新 manifest 暴露为可订阅数据源：
  - `apps/manager/src/lib/nodes/asset-manifest-store.ts`：新增 `assetManifestStore` + `getLatestManifest()` + `subscribeLatestManifest(cb)`
  - `apps/manager/src/lib/nodes/asset-manifest.ts`：在 graph 扫描生成新 manifest 时同步写入 store，并 re-export `getLatestManifest/subscribeLatestManifest`
- ✅ 配对成功后立即推送 + 后续更新推送到 Local Display：
  - `apps/manager/src/lib/display/display-bridge.ts`
    - `pairDisplay()` 成功后 `startManifestSync()`：立即 `sendManifest(getLatestManifest())`
    - `subscribeLatestManifest`：manifest 更新时再次 `sendManifest(...)`（Display 继续 preload，但 ready 仍严格一次）
    - teardown 时会自动取消订阅，避免泄漏/重复推送
- ✅ Display 侧处理仍沿用 Phase 4 Local transport：
  - `apps/display/src/lib/stores/display.ts`：`shugu:display:plugin`（`multimedia-core:configure`）→ `multimediaCore.setAssetManifest(...)`
- ✅ 运行过的命令：
  - `pnpm --filter @shugu/manager exec tsc -p tsconfig.json --noEmit`
- ⛔ sandbox 限制：本环境无法打开真实浏览器窗口验证 MessagePort 与 manifest 推送；需你在本机跑 `pnpm dev:manager` + `pnpm dev:display`，打开 Display 后观察：
  - Display debug `core=loading/ready`、`manifest=<id>` 会变化
  - 修改 Node Graph 或更换资产后，Display 会重新 preload，但 **不会** 再次发送第二次 ready（readyOnce 仍为第一次）

### 🟡 Phase 6.1：Node Graph “Objects/Display” 节点（已落地代码；待本机 UI 验证）

- ✅ 新增 Display 节点（可像 Client 一样接 command 并控制 Display）：
  - `apps/manager/src/lib/nodes/specs/display-object.json`：新增 manager-only node spec（Objects/Display）。
  - `apps/manager/src/lib/nodes/specs/register.ts`：新增 `runtime.kind: 'display-object'` 的安全实现：
    - `onSink` 接收 `command`（`{ action, payload, executeAt? }`）
    - local 优先：若 DisplayBridge 已连接 → 走 `display-bridge.ts#sendControl(action, payload, executeAtLocal)`
    - server 回退：否则走 `sdk.sendControl(targetGroup('display'), ...)`
    - `executeAt` 为 server time：本机通道会转换为 local time（`executeAtLocal = executeAt - timeSync.offset`）
- ✅ Patch 部署也支持 Display（解决 “audio-out 连 Display 没声音” 的根因）：
  - `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`：patch deploy 路由从只支持 `client-object` 扩展为也支持 `display-object`：
    - `audio-out(cmd) -> display-object(in)` 会把 node-executor patch 部署到 Display
    - local DisplayBridge 已连接时走 MessagePort（不依赖 websocket）
    - remote display clients 存在时走 websocket（按 `group=display` 的 clientId 列表）
- ✅ Display 端支持 node-executor：
  - `apps/display/src/lib/stores/display.ts`：在 server/local 两条通道都接受 `pluginId:'node-executor'` 并 `handlePluginControl(...)`
  - `apps/display/src/routes/+page.svelte`：增加 `Enable Audio`（Tone.start）按钮/点击启用，便于 `tone-player` patch 正常发声
- ✅ 防误选：NodeGraph 的 `client-picker` 控件已过滤 display group（避免在 Client 节点里误选 Display）：
  - `apps/manager/src/lib/components/nodes/node-canvas/rete/ReteControl.svelte`
- ✅ 运行过的命令：
  - `pnpm validate:node-specs`
  - `pnpm --filter @shugu/manager exec tsc -p tsconfig.json --noEmit`
  - `pnpm --filter @shugu/display run check`
- ⛔ sandbox 限制：无法在本环境打开浏览器验证 NodeGraph UI；需你按 `plan.md` 的 **7.4** 做一次手动验证后，再把 `plan.md` 的 `P6.1-04` 勾上。

---

## 下一步（建议）

- Phase 1：按上面的 Node 脚本完成 P1-06 冒烟验证（验证 clientList 透出 group + group 路由命中），然后把 `plan.md` 的 Phase 1 总项勾上。
- Phase 7：补齐根脚本 `dev:display` + 跑 `pnpm lint` / `pnpm build:all`，并按手动验证清单逐条回归。
