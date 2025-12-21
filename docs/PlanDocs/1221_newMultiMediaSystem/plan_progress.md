<!-- Purpose: Track the execution progress, decisions, commands, and verification results for 1221_newMultiMediaSystem (Asset Service first). -->

# 1221_newMultiMediaSystem — 执行进度（Asset Service）

更新时间：2025-12-21

> 说明：本文件记录“我已经做了什么 / 怎么验证 / 结果是什么 / 下一步做什么”，方便你逐条复查与回归。

---

## P0 — Asset Service（已开始落地）

### ✅ 已完成：Server 侧 Asset Service（MVP）

实现范围（对齐 `Asset_Service_serve.md`）：

1. **HTTP API**
   - `POST /api/assets`：multipart 上传（去重/落盘/写索引）
   - `GET /api/assets/:id`：读取元数据（JSON）
   - `GET /api/assets/:id/content`：二进制内容（支持 Range、ETag、Cache-Control）
   - `HEAD /api/assets/:id/content`：headers-only（用于 preload/校验）

2. **存储（LocalFsStorage 语义）**
   - 内容按 `sha256` 存盘（路径：`<ASSET_DATA_DIR>/<shaPrefix>/<sha256>`）
   - 元数据索引文件（JSON）：`ASSET_DB_PATH`（默认 `<dataDir>/assets-index.json`）
   - 去重：`sha256` 唯一（同内容重复上传返回同一个 assetId）

3. **缓存/校验（HTTP 头）**
   - `ETag: "<sha256>"`
   - `Cache-Control: public, max-age=31536000, immutable`
   - `Accept-Ranges: bytes`
   - Range 请求：`206 + Content-Range`
   - `If-None-Match`：匹配则 `304`

4. **鉴权（低延迟、可迁移）**
   - 标准：`Authorization: Bearer <token>`
   - `ASSET_READ_TOKEN`：读（metadata/content/head）
   - `ASSET_WRITE_TOKEN`：写（upload）
   - 纯内存常量时间比较（不走 DB），避免引入实时交互延迟
   - 若 token 未配置：返回 `503`（明确提示服务未配置）

实现文件（主要入口）：
- `apps/server/src/assets/assets.controller.ts`
- `apps/server/src/assets/assets.service.ts`
- `apps/server/src/assets/assets.module.ts`
- `apps/server/src/assets/assets.auth.ts`
- `apps/server/src/assets/range.ts`

---

### ✅ 已完成：为本地验证修复 build 输出目录（避免 root-owned dist 阻塞）

原因：仓库里已有 `apps/server/dist*` 下的历史产物被 root 拥有，导致 `nest build`/`nest start --watch` 无法 unlink。

调整：
- `apps/server/tsconfig.json`：`outDir` -> `dist-local`
- `apps/server/tsconfig.dev.json`：`outDir` -> `dist-dev`
- `apps/server/package.json`：`start`/`start:prod` 指向 `dist-local/main.js`
- `ecosystem.config.cjs`：server script 指向 `apps/server/dist-local/main.js`

这些目录在 `.gitignore` 中已忽略，不会污染版本库。

---

## 验证记录（可复现）

### 1) TypeScript 类型检查（不需要启动端口）

命令：
- `pnpm -C apps/server exec tsc -p tsconfig.json --noEmit`

结果：
- ✅ 通过

### 2) Build（产出 dist-local）

命令：
- `pnpm -C apps/server build`

结果：
- ✅ 通过，产物在 `apps/server/dist-local/`

### 3) 离线验证（使用你提供的 `assets/` 三个文件）

由于当前执行环境不允许监听端口（`listen EPERM`），我用“离线脚本”验证 upload/dedupe/落盘/索引/Range 解析等核心逻辑：

脚本：
- `apps/server/src/scripts/verify-asset-service.ts`（编译后：`apps/server/dist-local/scripts/verify-asset-service.js`）

执行命令（示例）：
- `ASSET_READ_TOKEN=dev-read ASSET_WRITE_TOKEN=dev-write ASSET_DATA_DIR=apps/server/.tmp/asset-data ASSET_DB_PATH=apps/server/.tmp/asset-data/assets-index.json node apps/server/dist-local/scripts/verify-asset-service.js`

结果（摘要）：
- ✅ 三类文件均成功“模拟上传”并写入 index
- ✅ 同一文件二次上传返回 `deduped=true` 且 assetId 不变
- ✅ 生成了 sha256 / sizeBytes，并按 shaPrefix 目录落盘
- ✅ Range 解析符合预期（非法 range 返回 null）

离线验证输出示例（你的机器上可得到类似结构；id/sha 会不同）：
- audio.wav：size≈7.7MB，sha256 已计算
- img.jpg：size≈86KB，sha256 已计算
- video.mp4：size≈32MB，sha256 已计算

落盘位置（本次离线验证）：
- `apps/server/.tmp/asset-data/`
  - `assets-index.json`
  - `<shaPrefix>/<sha256>`（内容文件）

---

## 环境限制说明（重要）

在当前 Codex CLI 的运行环境中，启动 Nest 并监听端口会报错：
- `listen EPERM: operation not permitted 0.0.0.0:<port>`

因此我无法在这里直接用 `curl` 对 `GET/HEAD/Range/304` 做真实 HTTP 回归。

你本机可复现的“真实 HTTP 验证步骤”我已写在下面（推荐你按步骤跑一遍）。

---

## 你本机的 HTTP 回归验证步骤（推荐）

1) 启动 server（任选一种）：
- `ASSET_READ_TOKEN=dev-read ASSET_WRITE_TOKEN=dev-write ASSET_DATA_DIR=./data/assets ASSET_DB_PATH=./data/assets/assets-index.json pnpm -C apps/server dev`
- 或先 build 再 start：
  - `pnpm -C apps/server build`
  - `ASSET_READ_TOKEN=dev-read ASSET_WRITE_TOKEN=dev-write ASSET_DATA_DIR=./data/assets ASSET_DB_PATH=./data/assets/assets-index.json pnpm -C apps/server start`

2) 上传（用你已准备好的 `assets/` 目录文件）：
- `curl -k -H "Authorization: Bearer dev-write" -F "file=@assets/audio.wav" https://localhost:3001/api/assets`
- `curl -k -H "Authorization: Bearer dev-write" -F "file=@assets/img.jpg" https://localhost:3001/api/assets`
- `curl -k -H "Authorization: Bearer dev-write" -F "file=@assets/video.mp4" https://localhost:3001/api/assets`

3) 元数据 GET：
- `curl -k -H "Authorization: Bearer dev-read" https://localhost:3001/api/assets/<assetId>`

4) HEAD（校验 headers 是否齐全）：
- `curl -k -I -H "Authorization: Bearer dev-read" https://localhost:3001/api/assets/<assetId>/content`
  - 重点检查：`ETag`、`Accept-Ranges`、`Content-Length`、`Cache-Control`、`Content-Type`

5) Range（检查 206/Content-Range）：
- `curl -k -H "Authorization: Bearer dev-read" -H "Range: bytes=0-1023" -D - -o /dev/null https://localhost:3001/api/assets/<assetId>/content`
  - 重点检查：`HTTP/1.1 206`、`Content-Range: bytes 0-1023/<size>`

6) 304（If-None-Match）：
- `curl -k -I -H "Authorization: Bearer dev-read" -H "If-None-Match: \"<sha256>\"" https://localhost:3001/api/assets/<assetId>/content`
  - 期待：`HTTP/1.1 304`

---

## 下一步（紧接着要做）

1) **Manager/Client 接入 token**
   - Manager 上传：`POST /api/assets` 携带 `ASSET_WRITE_TOKEN`
   - Client 预加载/播放：`GET/HEAD /content` 携带 `ASSET_READ_TOKEN`
2) **把资源引用真正接进 graph**
   - file 控件从 DataURL 改为 `asset:<uuid>`（并 push manifest）
3) **将 HTTP 回归结果补充到本文件**
   - 你跑完上面的 curl 后，把关键 headers/状态码贴一下，我可以继续把边界情况补齐（例如多 range、超大文件、错误码一致性等）。

---

## P0.5 — 基础设施修复（为后续 Phase 2/3 铺路）

### ✅ 已完成：Manager file-picker 改为 Asset Service 上传（禁止 DataURL 入图）

变更点：
- `apps/manager/src/lib/components/nodes/node-canvas/rete/ReteControl.svelte`：
  - 选择文件后直接 `POST /api/assets`（FormData）上传
  - 成功后写入 `asset:<id>` 到 node config（不再写 base64 DataURL）
  - 失败时在控件下方显示错误文本；上传时显示 `Uploading…`
- token 来源：manager 登录页输入，存储在 localStorage `shugu-asset-write-token`（不会写入 graph）。

验证建议（HTTP 真实路径）：
- 打开 Manager -> Node Graph -> `Load Media Sound` -> 选择一个文件
- 观察 Network：应有 `POST https://<server>/api/assets`（带 `Authorization: Bearer <writeToken>`）
- Graph JSON 不应出现 `data:audio/...;base64,` 字符串，应只出现 `asset:<uuid>`

---

### ✅ 已完成：Manager 自动生成并推送 Asset Manifest（按首次出现顺序）

实现：
- `apps/manager/src/lib/nodes/asset-manifest.ts`：
  - 扫描当前 graph 的 `config` 与 `inputValues`，收集 `asset:`/`shugu://asset/` 引用
  - 去重且保持 **首次出现顺序**（符合你要求的优先级规则）
  - debounce 250ms
  - 通过 plugin control 下发：`pluginId="multimedia-core"`, `command="configure"`
- `apps/manager/src/lib/nodes/index.ts`：import 该模块使其生效

备注：目前是“全图扫描”而不是 “audio-out root 逆向推导”，这是 Phase 7 的 patch 语义落地后再收敛。

---

## P0.6 — Client 侧预加载与 readiness（MultimediaCore MVP）

### ✅ 已完成：新增 `@shugu/multimedia-core`（解耦 apps/client）

新增包：
- `packages/multimedia-core/…`
  - `asset-url-resolver.ts`：支持 `asset:`/`shugu://asset/` → `/api/assets/:id/content`
  - `indexeddb.ts`：存储 `etag + content-length` 的轻量验证记录
  - `multimedia-core.ts`：manifest 驱动的 preload（Cache Storage + HEAD 校验）

核心行为：
- client 启动即读取 `lastManifest` 并开始 preload（不显示 UI，仅 console 日志）
- 接收到 manager 推送 manifest 后切换/增量下载（MVP：重新按顺序 ensureCached）
- 缓存：Cache Storage + IndexedDB（跨刷新生效）
- 校验：HEAD 的 `ETag/Content-Length` 与本地记录一致则跳过下载

### ✅ 已完成：read token 的媒体元素兼容策略（query param）

原因：`<audio>/<video>/<img>` 不能设置 `Authorization` header。

实现：
- server 允许 `GET/HEAD` 通过 `?token=` 或 `?access_token=` 传入 `ASSET_READ_TOKEN`（仍走常量时间比较）
- resolver 会把 read token append 到 content URL：`...?token=<ASSET_READ_TOKEN>`

---

### ✅ 已完成：Client 上报 readiness（驱动 manager dot 黄->绿）

实现：
- `apps/client/src/lib/stores/client.ts`：
  - 初始化 `MultimediaCore` 并订阅 state
  - 通过 `sdk.sendSensorData('custom', { kind:'multimedia-core', event:'asset-preload', ... })` 上报
  - 收到 `pluginId="multimedia-core" configure` 时更新 manifest
- `apps/manager/src/lib/stores/manager.ts`：解析该 custom sensor 事件并维护 `clientReadiness` store
- `apps/manager/src/lib/components/ClientList.svelte` 与 `apps/manager/src/lib/components/nodes/node-canvas/rete/ReteControl.svelte`：根据 readiness 渲染 dot 颜色
  - 黄：connected/loading
  - 绿：assets-ready
  - 红：assets-error

---

## 构建/验证状态（重要）

本次为了修复多个 workspace package 的历史 `dist/` 目录权限（root-owned 导致 tsc 写入失败），已把部分包的 outDir/exports 迁移到 `dist-out`（例如 `@shugu/ui-kit`）。

但在当前执行环境中，`pnpm install` 会因为 DNS 解析失败（`ENOTFOUND registry.npmjs.org`）而无法重新拉取依赖，导致无法完成全量 `pnpm -r run build` 的回归。

你的本机环境应可正常联网；建议你在本机执行：
- `pnpm install`
- `pnpm -r run build`

我接下来会继续推进 Phase 2.5/Phase 3/Phase 7 的代码落地，但短期内无法在此环境做完整 build 回归（会持续把“如何验证”的步骤写在此文档中）。

---

## 运行修复：`dev:all` 报 `tsc/nest: command not found`

你贴的报错本质有两类：

1) **node_modules 缺失**：pnpm 明确提示 `Local package.json exists, but node_modules missing`。
2) **在 sudo 环境下运行 pnpm**：`sudo pnpm dev:all` 可能导致 PATH/PNPM_HOME 不一致，并且容易产生 root-owned 产物，进一步把本地 dev 环境搞坏。

### ✅ 已落地的代码级修复（降低对 PATH/sudo 的敏感性）

我把所有 workspace 包里 `tsc/nest` 的调用改成 `pnpm exec`（确保用的是本项目 node_modules 里的二进制）：
- `apps/server/package.json`：`build/dev` -> `pnpm exec nest ...`
- `packages/*/package.json`：`build/dev` -> `pnpm exec tsc ...`

这样就算你的 shell PATH 没有把 `.bin` 放进去，也能正常执行（前提是 node_modules 存在）。

### 你本机的恢复步骤（推荐按顺序执行）

1) 不要用 sudo 跑 pnpm：
- 以后统一用 `pnpm dev:all`（不要 `sudo pnpm ...`）

2) 如果你之前用 sudo 跑过并生成了 root-owned 文件，先修权限（只在需要时执行）：
- `sudo chown -R $(whoami):staff node_modules apps/*/node_modules packages/*/node_modules || true`

3) 重新安装依赖：
- `pnpm install`

4) 再启动：
- `pnpm dev:all`

验收：
- 不再出现 `tsc: command not found` / `nest: command not found`
- `apps/server` 能正常启动（Nest watch）

---

## 修复回归：Node Graph 的 Client 节点功能消失

你反馈的现象（Client 节点功能消失、无法在节点里选择 client）原因是我之前为了执行“Single Source of Truth”，在 manager 端禁止了 JSON specs 覆盖 node-core 的节点定义。

但旧的 `client-object.json` 里包含了很多“manager 扩展能力”（Index/Range/Random 选择多个 client、indexOut 输出、client-picker config 字段）。
`@shugu/node-core` 的 `client-object` 当时还是最简版，所以 UI/端口/控件看起来就“全没了”。

### ✅ 已完成：把 Client 节点能力迁移进 node-core（恢复功能 + 保持单一真相源）

实现：
- `packages/node-core/src/definitions.ts`
  - `client-object` 新增 inputs：`index/range/random`，输出 `indexOut`
  - 新增 config：`clientId`（client-picker）
  - 新增 deps：`getAllClientIds/getSelectedClientIds`，用于 manager 多 client 选择与 fallback
  - `onSink` 会把 command 发给选中的多个 client（不再只发一个）
- `apps/manager/src/lib/nodes/specs/register.ts`：把 manager 的 client list/selectedIds 注入到 node-core deps
- `packages/sdk-client/src/node-executor.ts`：client 侧注入 `[selfClientId]` 的简化 deps（保持兼容）

验收：
- Node Graph 里 `Client` 节点重新出现：client-picker + Index/Range/Random + indexOut
- 在 Client 节点里选择不同 clientId 后，后续 `proc-client-sensors`/command sink 等行为能正确路由到对应 client

---

## 修复：Manager 一直黄灯（client 已 preload ready 但 readiness 没上报）

现象：
- client console 里能看到：`[asset] preload ready ... total=0`，以及 `Plugin control: multimedia-core configure`
- 但 manager 端仍显示“未准备好”（黄灯）

根因：
- readiness 上报逻辑里用 `lastReported` 做去重；但第一次 `preload ready` 可能发生在 socket `connected/clientId` 之前，`sdk.sendSensorData(...)` 实际不会发出去
- 由于当时仍然把 `lastReported` 更新了，导致后续同样的 ready 状态不会再次上报

修复：
- `apps/client/src/lib/stores/client.ts`
  - 只有在 `sdk` 已 `connected` 且 `clientId` 存在时，才会更新 `lastReported`
  - 并在 `sdk.onStateChange` 进入 `connected` 时强制补发一次当前 MultimediaCore 状态（兜底）

验收：
- 刷新 client 页面后，manager 对应 client dot 能从黄变绿（当 manifest total=0 时也应变绿）

---

## 需求变更：写鉴权、读公开（所有 client 可读资源）

你要求“防止公网乱上传，但所有打开 client 的人都可以读资源”。我已把 Asset Service 的鉴权策略改为：

- **写（upload）必须鉴权**：仍然要求 `ASSET_WRITE_TOKEN`
- **读（GET/HEAD meta/content）默认公开**：当 `ASSET_READ_TOKEN` 未配置时，读请求不需要 token
- （可选）如果未来你想“读也要鉴权”：配置 `ASSET_READ_TOKEN` 后，读请求会校验 token；同时保留 query token 兼容媒体元素

对应改动：
- `apps/server/src/assets/assets.auth.ts`：`requireAssetReadAuth` 在 `ASSET_READ_TOKEN` 缺失时直接放行（不再 503）
- `packages/multimedia-core/src/multimedia-core.ts`：不再因为缺少 `shugu-asset-read-token` 而报错（preload 按公开读流程走）
- `docs/PlanDocs/1221_newMultiMediaSystem/Asset_Service_serve.md`：更新鉴权说明为“写保护、读公开（默认）”

你现在的使用方式：
- **线上部署**：只设置 `ASSET_WRITE_TOKEN`（读 token 留空/不设置），client 打开即可读
- Manager 连接页仍需要填写 `Asset Write Token` 才能上传

---

## ✅ 移除 Auto UI，新增 Assets Manager 管理页

你反馈 Auto UI “没用”，我已在 manager 里把它整个删除，并换成一个真正的资产管理系统页面。

### 新增能力
- **Assets Manager 页面（Manager）**：资产列表 / 上传 / 删除 / 搜索 / 按类型过滤（audio/image/video）。
- **服务端管理接口（Server）**：
  - `GET /api/assets`：列出资产（需要写 token）
  - `DELETE /api/assets/:id`：删除资产（需要写 token）

### 涉及文件
- `apps/manager/src/routes/+page.svelte`：移除 `Auto UI` tab，新增 `Assets Manager` tab。
- `apps/manager/src/lib/components/AssetsManager.svelte`：新增资产管理页面组件。
- `apps/manager/src/lib/components/AutoControlPanel.svelte`：已删除（无引用）。
- `apps/server/src/assets/assets.controller.ts`：新增 list/delete endpoints。
- `apps/server/src/assets/assets.service.ts`：新增 list/delete 实现。

### 使用方式（你现在怎么用）
1. 先启动 server/client/manager（或 `pnpm dev:all`）。
2. 打开 manager 连接页，填好 `Server URL` 和 `Asset Write Token`，点击 Connect。
3. 进入 `🗂️ Assets Manager`：
   - Upload：上传音频/图片/视频（返回后会出现在列表里）
   - Copy ref：复制 `asset:<id>`，可贴到 NodeGraph 里相关节点的 URL 输入框
   - Delete：删除资产（注意会影响引用它的 graph/scene）

---

## 修复：Assets Manager 上传时报 503（ASSET_WRITE_TOKEN 未配置）

你遇到的 `HTTP 503: asset service auth is not configured (ASSET_WRITE_TOKEN)` 是因为：
- Manager 里填的 token 只是“请求 header”，服务端还需要有一个“期望 token”做比对
- 也就是 server 进程必须配置 `ASSET_WRITE_TOKEN`（否则写接口直接 503，防止误上线成“无鉴权写”）

为了解决你这个开发体验问题，我做了两件事：
1) Server 启动时会自动读取可选 env 文件（不新增第三方依赖）：
   - `secrets/server.env`（推荐，避免提交）
   - 或 `apps/server/secrets/server.env`
   - 或 `apps/server/.env`
2) Server 日志提示更准确：只有 `ASSET_WRITE_TOKEN` 缺失才警告（读 token 可选）。

补充：我们也修复了 server build outDir 的权限坑：
- `apps/server/tsconfig.json` 的 `outDir` 改为 `dist-server`，避免历史上 `dist-local` 被 root 写入导致后续 `nest build` EACCES。

---

## 新增节点：Load Audio From Assets（直接从资产库拿 assetRef）

你要求一个节点能直接从 “Assets Manager/资产库” 里选现有音频，不再上传文件，并且点击/选择后直接拿到 `asset:<id>` 引用。

已实现：
- 新节点：`load-audio-from-assets`
  - config：`Audio Asset`（资产选择器，只列出 audio）
  - output：`assetRef`（字符串，值为 `asset:<id>`）
- Manager 侧资产列表改为共享 store：Node 控件与 `Assets Manager` 页面使用同一份 `GET /api/assets` 数据（单一真相源）
