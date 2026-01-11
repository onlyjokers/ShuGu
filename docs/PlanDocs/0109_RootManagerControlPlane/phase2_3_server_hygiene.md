<!--
Purpose: Phase 2.3 cleanup plan to make server semantics “protocol-conformant + minimally authenticated + presence/grace-ready” before Phase 3/4.
Owner: ShuGu / System Architecture
Created: 2026-01-11
Status: Draft (actionable checklist)
-->

# Phase 2.3 Server 语义收敛清单（Protocol / Auth / Presence）

目标：在不新增“演出能力”的前提下，把 Server 端的三类历史混乱清掉，为 Phase 3/4/5（Root/Manager + ControlPlane + client controller）提供一个**干净、可扩展、可验证**的底座：

1) Server 下发消息的 **协议形态不一致**（未来做 schema 校验会爆雷）  
2) `role/权限` 模型过松（公网下可伪造 manager）  
3) 连接态语义与未来的 `5s grace / ownership 回溯 / 重启恢复` 不对齐

执行规则（沿用 Phase 2）：

- 不新增功能；只做语义收敛/硬化/对齐。
- 任何破坏性变更必须同时更新对应 SDK/协议，并完成 Phase 1 回归。
- 每完成一批：`pnpm guard:deps` + `pnpm lint` +（推荐）`pnpm build:all` + `phase1_regression_playbook.md` 手动回归。

---

## 2.3-1 协议形态收敛：Server 只发送 Protocol Message

现状（证据）：

- `apps/server/src/events/events.gateway.ts` 存在直接 `emit('msg', { type:'control', id/timestamp/source... })` 的“非协议形态”消息。
- `packages/protocol/src/helpers.ts#isValidMessage` 目前只做 `type/version` 弱校验，因此这类消息“现在能跑”，但一旦引入 schema 校验 / Protocol v2 / scope 字段，必然成为硬雷。

目标组织：

- Server 端所有对外 `SOCKET_EVENTS.MSG` 下发，必须严格是 `@shugu/protocol` 的 `Message` 形状（包含 `version`、`serverTimestamp`、以及对应 message 的必填字段）。
- 禁止 ad-hoc 字段（例如 `id/timestamp/source`）混入运行时主路径。
- “Server 自己触发的控制类指令”（例如 sensor start/stop）必须有明确来源语义（可先以最小变更落地，细化语义留给 Phase 4 的 `scopeGroupId="__system__"`）。

可执行步骤：

1. 增加 server 侧统一的消息构造/发送入口（例如 `apps/server/src/protocol/server-messages.ts`）：
   - 统一使用 `create*Message(...)` + `addServerTimestamp(...)`；
   - 统一通过 `SOCKET_EVENTS.MSG` 发送；
   - 允许 server 侧生成“基础控制消息”（用于现有系统的传感器 gating），但必须满足协议形态。
2. 替换 `events.gateway.ts` 里所有 ad-hoc `emit('msg', {...})`，改为调用上述入口。
3. 添加 repo-level 探针（lint/rg gate）：
   - 禁止在 server 运行时代码中出现 `emit('msg', { type: 'control'` 这类对象字面量下发（强制走统一入口）。

验收：

- `rg -n \"emit\\('msg', \\{\\s*type: 'control'\" apps/server/src` 无命中。
- `pnpm --filter @shugu/server run lint` ✅（0 errors）。
- Phase 1 回归中与 sensor gating 相关流程仍正常（client connect 默认 inactive；manager select 后 active；deselect 后 stop）。

状态：未开始

---

## 2.3-2 Role/权限收口：不再信任 query.role（最小认证）

现状（证据）：

- `apps/server/src/events/events.gateway.ts` 使用 `client.handshake.query.role` 作为角色来源；
- `handleMessage` 对 `control/media/plugin` 的鉴权仅依赖 `clientRegistry.isManager(socketId)`，而 manager 身份本身也来自 query；
- 公网环境下任何人都能伪造 `role=manager` 并发送控制（即使未来加 ControlPlane，也会被“入口伪装”绕过）。

目标组织：

- 角色判定必须以“可验证的凭据”为准，而不是 URL query。
- 最小认证（Phase 2.3 范围内）：只解决“外网伪造 manager”问题，不引入复杂账号体系。

可执行步骤（推荐方案：server-side secret + SDK 注入）：

1. Server：新增环境变量（例如 `SHUGU_MANAGER_KEY`，可选 `SHUGU_ROOT_KEY` 预留）。
2. Server：连接时将 query.role 视为 *requested role*，仅当 `handshake.auth` 中携带正确 key 才授予 `manager`（否则降级为 `client`）。
3. `packages/sdk-manager`：在 `ManagerSDKConfig` 增加 `managerKey`（或从 env 注入），连接时写入 `auth`。
4. （可选）Server：对“认证失败但请求 manager”的连接打印安全日志（包含 socketId/userAgent/ip），便于排查。

验收：

- 无 key 的连接即使传 `?role=manager`，也不会获得 manager 权限（无法发送 `control/media/plugin`）。
- manager UI 在提供 key 时仍可正常控制（Phase 1 回归全绿）。
- client 连接不受影响（deviceId/instanceId 逻辑保持）。

状态：未开始

---

## 2.3-3 Presence 语义对齐：为 5s grace 与 ControlPlane 打底

现状（证据）：

- `ClientRegistryService.unregisterBySocketId(...)` 断线即删除连接记录；
- 这与计划中的 `5s grace`（短断线自动恢复）和“断线驱动 ownerStack 回溯”不匹配；
- server 重启恢复（Redis 可选）在 Phase 4 才做，但 Phase 2.3 应先把“presence 信号源”整理干净。

目标组织：

- Registry 不只是一张“在线 map”，而是最小的 presence 状态机：`connected / disconnected(grace) / expired`。
- 断线事件具备稳定语义（何时算真正离线），可直接被 Phase 4 ControlPlane 订阅使用。
- Client 列表对 manager 展示的“在线状态”准确（避免 grace 期间 UI/选择逻辑混乱）。

可执行步骤（最小可落地）：

1. `ClientRegistryService`：引入 `disconnectedAt`/`lastSeenAt` 与 grace timer：
   - 断线时标记为 disconnected，但在 grace 内保留记录；
   - grace 超时才真正 purge（触发 clientLeft）。
2. `SystemMessage: clientList` payload 扩展（协议层 `ClientInfo` 增加可选字段）：
   - `connected: boolean`
   - （可选）`lastSeenAt: number`
3. `MessageRouterService`：
   - `resolveTargetSocketIds` 只返回当前 connected 的 socket；
   - selection/state 更新在 disconnected 客户端上不再做“直接下发”。
4. 回归点：manager 侧 client list / selection 在短断线时不产生“幽灵客户端”或重复 id。

验收：

- 断线 < 5s：同一 clientId 重连后不会在 manager 列表里出现重复；并且 connected 状态正确。
- 断线 > 5s：触发 `clientLeft`；列表移除；选择状态一致。
- `pnpm lint` ✅，`pnpm guard:deps` ✅；Phase 1 回归全绿。

状态：未开始

---

## 建议执行顺序（Phase 2.3）

1. 2.3-1 协议形态收敛（先清掉未来 schema 校验的硬雷）  
2. 2.3-2 最小认证收口（先止血公网伪造 manager）  
3. 2.3-3 Presence/grace 语义对齐（为 Phase 4/5 准备信号源）

