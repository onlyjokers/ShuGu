# node-executor（客户端自循环执行器）

本仓库的 **Node Graph** 支持把“包含 `Client` + `Client Sensors` 的自循环链路”下发到对应的 client，让 client 在本地自行 tick 运行，从而：

- 避免 `client → server → manager → server → client` 的高频闭环分发
- 减少网络带宽占用与 manager CPU 占用
- manager 只在“参数/图更新”时下发更新，client 端持续运行本地循环

---

## 1. 触发条件：什么是“可下发循环”

Manager 端 `NodeEngine` 会做 SCC（强连通分量）检测（**包含 sink 边**），满足以下条件的 SCC 会被识别为可下发 loop：

1. SCC 中 **恰好有 1 个** `client-object`（Client 节点）
2. SCC 中 **包含** `proc-client-sensors`（Client Sensors 节点）

匹配后 UI 会：

- 为 loop 内的 node/edge 标记 `local-loop`（高亮）
- 允许在顶部工具栏选择 loop，并进行 Deploy/Stop/Remove
- Deploy 成功后标记 `deployed-loop`（高亮 + manager 端自动 offload 该 loop 子图）

实现位置：`apps/manager/src/lib/nodes/engine.ts`（`detectLocalClientLoops()`）

---

## 2. 下发协议：PluginControlMessage（node-executor）

Manager → Client 通过 `PluginControlMessage` 下发：

- `pluginId`: `node-executor`
- `command`: `deploy | start | stop | remove`

### 2.1 deploy payload

Manager 侧导出：

```ts
nodeEngine.exportGraphForLoop(loopId); // => { graph, meta }
```

结构（简化）：

```json
{
  "graph": {
    "nodes": [],
    "connections": []
  },
  "meta": {
    "loopId": "loop:...",
    "requiredCapabilities": ["sensors", "screen"],
    "tickIntervalMs": 33,
    "protocolVersion": 1,
    "executorVersion": "..."
  }
}
```

Client 收到 `deploy` 后：

1. 校验 `requiredCapabilities`（不满足则 `rejected`）
2. 校验图（白名单节点、最大节点数、tickInterval clamp、无效连线等）
3. `runtime.loadGraph(graph)` 并 `runtime.start()`
4. 上报 `deployed`

### 2.2 start/stop/remove payload

```json
{ "loopId": "loop:..." }
```

---

## 3. Capabilities（能力 / 权限）

Manager 在 Deploy 前会展示 `requiredCapabilities`，Client 端会根据自身权限/能力决定是否执行。

当前使用的能力字符串（示例）：

- `sensors`：依赖 motion/mic（取决于 client 侧 `permissions` store）
- `flashlight`：依赖 camera 权限
- `screen`：屏幕特效（通常默认允许）
- `sound`：AudioContext（通常默认允许）
- `vibrate`：震动（通常默认允许）
- `visual`：视觉相关（通常默认允许）

Client 侧 gating 逻辑：`apps/client/src/lib/stores/client.ts`（`NodeExecutor` 构造参数 `canRunCapability`）

---

## 4. 监控与状态回传（Client → Manager）

Client 端 `NodeExecutor` 会通过 `SensorDataMessage` 上报状态（避免额外协议）：

- `sensorType: 'custom'`
- `payload.kind: 'node-executor'`

常见 event：

- `deployed | started | stopped | removed`
- `rejected`（capability 不满足 / 校验失败）
- `error`（执行器内部异常）
- `stopped` + `reason: 'watchdog'`（tick 超预算自动停止）

Manager UI 会展示：

- `exec: running/stopped/unknown` badge
- 最近事件 `lastEvent`
- Logs 面板（最近 30 条）

实现位置：`apps/manager/src/lib/components/nodes/NodeCanvas.svelte`

---

## 5. 回滚 / 恢复策略（Manager）

- **Stop Loop**：向 client 发送 `stop`，并在 manager 端取消 offload（manager 会恢复执行该 loop）
- **Remove**：向 client 发送 `remove` 清理 runtime，并在 manager 端取消 offload
- 重新 Deploy：会覆盖 client 端旧图（`runtime.clear()` + `loadGraph()`）

---

## 6. End-to-end 测试（Playwright）

仓库提供一个最小 E2E，用于验证：

- manager 创建 loop（通过 dev hook 注入 graph）
- UI 高亮
- Deploy 到 client 并产生本地执行（断言 client 执行了 `screenColor`）
- Stop / 更新图后重新 Deploy / Remove

### 6.1 准备

1. 安装 Playwright 浏览器（只需一次）：

```bash
pnpm exec playwright install chromium
```

2. 确保 server 有 HTTPS 证书（本仓库使用 `secrets/cert.pem` + `secrets/key.pem` 或 `secrets/privkey.pem`）。

### 6.2 运行

```bash
pnpm e2e:node-executor
```

该脚本会启动 `dev:server/dev:manager/dev:client` 并运行 headless Chromium：`scripts/e2e/node-executor.mjs`。

---

## 7. Dev hooks（仅 DEV）

为便于 E2E 与调试：

- Manager Node Graph 在 DEV 模式下暴露 `window.__shuguNodeEngine`
- Client 在 `?e2e=1` 时会自动连接并发送合成 accel 数据；执行的 control 会记录到：
  - `window.__SHUGU_E2E_COMMANDS`
  - `window.__SHUGU_E2E_LAST_COMMAND`
