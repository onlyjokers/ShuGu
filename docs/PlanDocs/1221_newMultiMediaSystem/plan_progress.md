<!-- Purpose: Track the execution progress, decisions, commands, and verification results for 1221_newMultiMediaSystem (Asset Service first). -->

# 1221_newMultiMediaSystem — 执行进度（Asset Service）

更新时间：2025-12-23

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

## 下一步（当前）

1) **Timeline 播放进度回传（可选）**
   - 当前 manager 里的 playhead/cursor 作为 seek 参数，不会自动跟随 client 的真实播放进度
   - 若要“Current/Playhead 自动跑”，需要新增 client->manager 的轻量 telemetry（建议 5~10Hz）

2) **All nodes connectable（未完成）**
   - 继续补齐所有节点的可接线输入口（把纯 UI 参数都变成 ports），并保持 node-core 单一真相源

3) **HTTP 真实回归（你本机）**
   - 仍建议按 curl 步骤跑一遍 GET/HEAD/Range/304，把关键 headers/状态码贴回来以便补齐边界情况（多 range、超大文件、错误码一致性等）

---

## P2.7 — Timeline 片段控制增强（Audio/Video：Reverse + Seek + Clip hash）

### ✅ 已完成：assetRef 保留 `#hash`（用于 clip 参数）

- `packages/multimedia-core/src/asset-url-resolver.ts`
  - `resolveAssetRefToUrl(...)` 现在会保留并透传 `?query` 与 `#hash`
  - 用途：`asset:<id>#t=...&loop=...&play=...&rev=...&p=...` 这类 clip hash 可稳定工作（同时不影响资源请求本体）

### ✅ 已完成：Tone.Player 支持 `rev/p`（倒放 + playhead seek）

- `packages/sdk-client/src/tone-adapter.ts`
  - `parseToneClipParams` 扩展：解析 `rev`（reverse）与 `p`（cursor seek）
  - `tone-player`：
    - `rev=1`：倒放片段（loop/非 loop 均可）
    - `p=<sec>`：seek 到指定播放位置（用于 manager timeline playhead / MIDI scrub）
    - reverse 切换时：尽量保持当前位置不突兀跳回片段起点

### ✅ 已完成：Load Video From Assets 的“精细片段控制”落到 client

- `packages/multimedia-core/src/media-engine.ts`
  - videoState 扩展：`startSec/endSec/cursorSec/reverse` + `playing`
- `apps/client/src/lib/stores/client.ts`
  - `playMedia(video)` 解析 URL clip hash（`#t/loop/play/rev/p`）并传给 MediaEngine
- `apps/client/src/lib/components/VideoPlayer.svelte`
  - 裁切播放区间（start/end）、loop 片段、play/pause、seek（cursor）、reverse（手动步进）
- `apps/client/src/lib/components/VisualCanvas.svelte`
  - 只要 `videoState.url` 存在就挂载 VideoPlayer（确保 pause 时也能保持 preload/状态）

### ✅ 已完成：模板同步更新（无需兼容旧图）

更新文件：
- `docs/PlanDocs/1221_newMultiMediaSystem/templates/02_patch_asset_player_delay_audio_out.json`
- `docs/PlanDocs/1221_newMultiMediaSystem/templates/03_load_audio_from_assets_timeline.json`
- `docs/PlanDocs/1221_newMultiMediaSystem/templates/05_media_video_play.json`
- `docs/PlanDocs/1221_newMultiMediaSystem/templates/08_midi_control_audio_clip_range.json`

关键变更：
- `load-audio-from-assets` / `load-video-from-assets`：
  - `config.range` → `config.timeline`
  - 补齐 `startSec/endSec/cursorSec/loop/play/reverse` 的 `inputValues`

### ✅ 验证记录

命令：
- `pnpm -C packages/multimedia-core run build` ✅
- `pnpm -C packages/sdk-client run build` ✅
- `pnpm -C apps/client run check` ✅


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

---

## 继续执行计划：Manifest 优先级顺序 + currentManifest 更新语义

你在 plan 里强调：client 必须“登录就预加载”，且预加载顺序要可预测，优先保证“马上要用”的资源最先到。

### ✅ Manager：高优先级 manifest 的“稳定顺序”

实现：`apps/manager/src/lib/nodes/asset-manifest.ts`
- 不再简单按 nodes 列表扫描；改为 **从 `client-object`（sink）出发，沿连接上游做确定性的 DFS**。
- 遍历顺序稳定（按 `targetPortId/sourcePortId/sourceNodeId` 排序），遇到 `asset:` 立即 append，去重保持首次出现顺序。

效果：
- 同一个 graph 在不同机器/不同刷新下推送的 assets 顺序保持一致。
- 更贴近你要的 Max/MSP 思路（从输出端往上游推导依赖）。

### ✅ Client：manifestId 相同不重复触发

实现：`packages/multimedia-core/src/multimedia-core.ts`
- `setAssetManifest(...)` 如果 `manifestId` 没变直接 return，避免重复重启 preload。

### ✅ Plan 勾选更新
- `docs/PlanDocs/1221_newMultiMediaSystem/plan.md` 已把以下项标记为完成：
  - Phase 2：Manager `currentAssetManifest` + 高优先级下载顺序
  - Phase 3：Resolver 输出统一为 `/api/assets/:id/content`；socket 接收 currentManifest；readiness 上报渠道

---

## ✅ 增加旧项目迁移工具：DataURL -> Asset Service -> `asset:<id>`

旧项目里可能还存在 `data:*;base64,...` 这种超长字符串写在 graph 里（历史遗留）。你要求提供迁移工具把它们上传到 Asset Service，然后把 graph 里的字段替换成 `asset:<id>`。

已实现（Manager UI）：
- `🗂️ Assets Manager` 页面新增按钮：`Migrate DataURLs`
- 会扫描当前 Node Graph 中所有 node 的 `config` / `inputValues`：
  - 找到 DataURL（只处理 `;base64`）
  - 逐个上传到 `POST /api/assets`（写 token 鉴权，服务端 sha256 自动去重）
  - 用返回的 assetId 替换成 `asset:<id>`
  - 最后自动 `saveLocalProject('dataurl-migration')`，避免刷新丢失
  - 页面会显示迁移日志（scan/upload/replace/save）

涉及文件：
- `apps/manager/src/lib/assets/migrate-dataurls.ts`
- `apps/manager/src/lib/components/AssetsManager.svelte`

---

## ✅ UI Socket 规则：audio 只能连 audio（避免“数字线连到音频线”）

你在 Phase 2.5 明确要求：`audio` 端口必须独立语义，不能再被 `any` 或其它端口类型“误连”，否则就会出现你之前吐槽的“明明是 Tone 音频节点但输出看起来像数字、连上也不一定有声”的混乱体验。

已实现两层保护：
- UI 层（连接兼容判断）：`apps/manager/src/lib/components/nodes/node-canvas/rete/rete-builder.ts`
  - `isCompatible(...)` 对 `audio` 做硬限制：仅允许 `audio -> audio`
- 引擎层（最终校验）：`apps/manager/src/lib/nodes/engine.ts`
  - `addConnection(...)` 增加 `audioMismatch` 校验：只要任一端是 `audio`，另一端也必须是 `audio`（不允许 `audio -> any`）

效果：
- manager 端会直接拒绝错误连接，并在错误提示里明确写出原因。

---

## ✅ tone-adapter：优先用端口类型 `audio` 来识别音频连接（减少硬编码）

你在 Phase 2.5 里希望 Tone 的“音频连线识别”不要再依赖硬编码端口表（`AUDIO_INPUT_PORTS/AUDIO_OUTPUT_PORTS`），而是尽量从单一真相源（node-core 定义里的端口类型）推导。

已实现：`packages/sdk-client/src/tone-adapter.ts`
- `isAudioConnection(...)` 现在优先读取 `registry.get(nodeType)` 的 inputs/outputs：
  - 只有当 `sourcePort.type === 'audio' && targetPort.type === 'audio'` 才视为音频连接
- 兼容旧图：如果 registry 中取不到端口信息，则回退到原先的端口 allowlist（保留旧行为）

对应勾选已更新：
- `docs/PlanDocs/1221_newMultiMediaSystem/plan.md`：Phase 2.5 的 “下一步：优先用端口类型 audio…” 已标记完成

---

## ✅ 一致性校验规则：ETag 必须匹配 sha256（避免缓存“假命中”）

你要求 client 的缓存必须“跨刷新/重进生效”，同时要能发现“服务器内容变了但文件名没变”的情况（否则会一直不重新下载）。

已实现：`packages/multimedia-core/src/multimedia-core.ts`
- `ensureCached(...)` 会先拉 `GET /api/assets/:id` 拿到 `sha256`（公开读，不增加鉴权复杂度；若未来启用读 token，也会带 `?token=`）。
- 然后对比 `HEAD /content` 返回的 `ETag`：
  - 若 `sha256` 与 `ETag` 都存在且不一致，会把缓存视为不可信，强制重新 `GET /content` 写入 Cache Storage，并更新 IndexedDB 记录。
  - 若一致且本地 Cache + IndexedDB 命中，则直接复用缓存，不重新下载。
- IndexedDB 记录结构扩展为可选字段 `sha256`（并把 DB 版本升级到 2，向后兼容旧记录）。

对应勾选已更新：
- `docs/PlanDocs/1221_newMultiMediaSystem/plan.md`：Phase 3 的“一致性校验规则/目标”已标记完成

---

## ✅ preload 策略 + console 进度日志（不做 UI）

你在 Phase 3 要求：
- 音频/图片：用 GET 触发 Cache Storage 写入（跨刷新复用）
- 视频：至少 HEAD 校验 + 可选预热首段（避免预加载就把大视频整文件拉爆）
- 并发限制（避免影响实时交互）
- 全程只打 console 日志，不影响 UI

已实现：`packages/multimedia-core/src/multimedia-core.ts`
- preload 并发仍由 `concurrency` 控制（默认 4，范围 1~8）。
- 音频/图片（及非 video 的资源）：`GET /content` 并写入 Cache Storage。
- 视频：`HEAD /content` 后额外做一次 `Range: bytes=0-65535` 的小预热请求（不缓存整文件）。
- console 日志：
  - 开始：`[asset] preload start manifest=... total=...`
  - 进度：每个资源完成后输出 `preload progress x/y asset:<id> bytes~...`（非 asset 也会 log skip）
  - 完成：`[asset] preload ready manifest=... total=...`
  - 失败：保持原有 `preload error ...`

对应勾选已更新：
- `docs/PlanDocs/1221_newMultiMediaSystem/plan.md`：Phase 3 的 “preload 策略/console 进度规范” 已标记完成

---

## ✅ Phase 4（部分）：ToneAudioEngine 统一入口（Tone.start 只在 Start 手势里调用）

你要求消除“多套音频系统/多次 Tone.start”的混乱，并且把 Tone 的启用严格绑定到用户手势（移动端要求）。

已实现：
- `packages/multimedia-core/src/tone-audio-engine.ts`
  - 新增 `ToneAudioEngine` + 单例 `toneAudioEngine`
  - 负责：lazy import Tone、`Tone.start()`、以及 `loaded/enabled/error` 状态
- `apps/client/src/lib/stores/client.ts`
  - `enableAudio()` 改为调用 `toneAudioEngine.start()`（Start 按钮触发）

对应勾选已更新：
- `docs/PlanDocs/1221_newMultiMediaSystem/plan.md`：Phase 4 的前两项已标记完成

待继续：
- `packages/sdk-client/src/tone-adapter.ts` 还未完全迁移到 ToneAudioEngine（目前仍存在自己的 Tone load/start 路径，后续会收敛掉）

---

## ✅ Phase 4：tone-adapter 完全收敛到 ToneAudioEngine（移除重复 Tone 状态）

已实现：`packages/sdk-client/src/tone-adapter.ts`
- 移除 tone-adapter 内部的 `import('tone')` / `Tone.start()` / `AudioContext state` 判断逻辑
- 全部改为依赖 `@shugu/multimedia-core` 的单例 `toneAudioEngine`：
  - `enableToneAudio()` → `toneAudioEngine.start()`
  - “是否可跑音频”的判断统一走 `toneAudioEngine.isEnabled()`
  - Tone 模块加载统一走 `toneAudioEngine.ensureLoaded()`

对应勾选已更新：
- `docs/PlanDocs/1221_newMultiMediaSystem/plan.md`：Phase 4 的第三项已标记完成

---

## ✅ Phase 5：Synth(update) 迁移到 Tone（ToneModulatedSoundPlayer）

你指出目前 client 端存在“2 套音频系统”的问题，并要求 Synth(update) 必须迁移到 Tone.js（且保留现有特性）。

已实现：
- `packages/sdk-client/src/action-executors.ts`
  - 新增 `ToneModulatedSoundPlayer`（play/update/stop）
  - 只依赖 `@shugu/multimedia-core` 的 `toneAudioEngine`，不会创建新的 `AudioContext`
  - 功能对齐：
    - `attack/release/duration`
    - `frequency/waveform/volume`
    - `modDepth/modFrequency`（通过 Tone.LFO 调制频率）
    - `durationMs` 兼容（update 时可改持续时间）
- `apps/client/src/lib/stores/client.ts`
  - `modulateSound` / `modulateSoundUpdate` 已改为调用 `ToneModulatedSoundPlayer`

对应勾选已更新：
- `docs/PlanDocs/1221_newMultiMediaSystem/plan.md`：Phase 5 的 1) 与 2) 已标记完成

---

## ✅ Phase 6（部分）：Image/Video 迁入 MultimediaCore.MediaEngine（解耦 apps/client）

你要求 client 的 “Multimedia Runtime” 不只管 Tone 音频，还要把图片/视频播放后端统一到 MultimediaCore（apps/client 只做渲染映射，未来便于再加“另一类被 manager 控制的对象”）。

已实现：
- `packages/multimedia-core/src/media-engine.ts`
  - 新增 `MediaEngine`（纯状态机，无 DOM）：
    - `showImage/hideImage`
    - `playVideo/stopVideo/stopAllMedia`
  - 支持注入 URL resolver（用于 `asset:`）
- `packages/multimedia-core/src/multimedia-core.ts`
  - `MultimediaCore` 新增 `media: MediaEngine`（默认 resolveUrl 走 `resolveAssetRef`）
- `apps/client/src/lib/stores/client.ts`
  - 初始化时订阅 `multimediaCore.media.subscribeState(...)`，把 state 映射到 Svelte store：`videoState/imageState`
  - `showImage/hideImage/playMedia(video)/stopMedia` 的执行路径改为调用 `multimediaCore.media.*`

结果：
- apps/client 的业务逻辑（媒体控制）从 store 中抽离出来，未来可复用/扩展到其它 runtime。

---

## ✅ Phase 6（部分）：Audio 迁移到 ToneSoundPlayer（保留 fallback）

你在 Phase 6 的目标是：音频播放后端统一到 Tone（和节点化 Tone 链路共用同一个音频上下文），同时保留一个在 Tone 未启用/失败时的退路。

已实现：
- `packages/sdk-client/src/action-executors.ts`
  - 新增 `ToneSoundPlayer`：
    - 主路径：Tone.Player + Tone.Gain（支持 `volume/loop/fadeIn`，并支持 update）
    - fallback：HTMLAudioElement +（best-effort）MediaElementSource 接入 Tone 的 raw AudioContext destination
- `apps/client/src/lib/stores/client.ts`
  - `playSound` / `playMedia(audio)` 优先走 `ToneSoundPlayer`（仅在 `toneAudioEngine.isEnabled()` 时）
  - Tone 未启用时回退到原 `SoundPlayer` 逻辑
  - `stopSound/stopMedia` 会停止 ToneSoundPlayer + 旧 SoundPlayer

对应勾选已更新：
- `docs/PlanDocs/1221_newMultiMediaSystem/plan.md`：Phase 6 的 Audio 三项已标记完成

---

## ✅ Phase 7（部分）：Patch 导出 + Patch 部署（替代 loop 依赖，Max/MSP 路径）

你要求在 manager 的 Node Graph 上以 `audio-out` 为 root（Max/MSP 语义）导出 patch 子图，并部署到指定 client，让音频稳定发声，同时能够实时调参（override）。

已实现：
- `apps/manager/src/lib/nodes/patch-export.ts`
  - 新增 patch 子图导出：从 `audio-out` 反向追溯依赖节点/连线，并收集 `asset:` refs（用于后续 preload/验收）
- `apps/manager/src/lib/nodes/engine.ts`
  - 新增 `nodeEngine.exportGraphForPatch()`：
    - 导出 `audio-out` 子图
    - whitelist 校验（拒绝不可部署节点类型）
    - 计算 `patch:<rootId>:<hash>` 作为 `meta.loopId`（复用 node-executor 协议字段）
- `apps/manager/src/lib/components/nodes/node-canvas/controllers/patch-controller.ts`
  - 新增 patch-controller：
    - Deploy：向目标 client 发送 `node-executor deploy + start`
    - Stop/Remove：向目标 client 发送 `node-executor stop/remove`
    - 维护 `{clientId -> {patchId,nodeIds}}` 映射，供 override 路由使用
- `apps/manager/src/lib/components/nodes/node-canvas/ui/NodeCanvasToolbar.svelte`
  - Toolbar 新增 Patch controls：选择 client + Deploy/Stop/Remove（MVP）
- `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`
  - override 路由增强：如果 node 不在 deployed loop 中，则尝试按 patch-controller 的 nodeId 映射路由到对应 client/patch
- `packages/sdk-client/src/tone-adapter.ts`
  - 新增 `audio-out` sink 支持：当目标节点为 `audio-out` 时，将音频连接到 master/destination，避免出现 “接了 audio-out 反而无声” 的情况

当前状态：
- Patch 的 Deploy/Stop/Remove 已可用（不依赖 loop 检测）。
- Patch “状态/日志面板” 与 “自动重部署 debounce” 仍未实现（plan.md 保持未勾）。

---

## ✅ Phase 7（继续）：Patch 状态/日志 + 自动重部署 + commit 语义

为了让 Patch 部署真正像 Max/MSP 一样可用（“部署→调参→松手保持”），我把 Phase 7 的剩余三块补齐了：

已实现：
- Patch 状态/日志（Manager UI）
  - `apps/manager/src/lib/components/nodes/node-canvas/ui/NodeCanvasToolbar.svelte`
    - Patch 控件增加：`Logs` 按钮、状态 badge（running/stopped + lastEvent + error）
    - `Auto`（自动重部署开关）
  - `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`
    - Patch 的 Logs 复用现有 `ExecutorLogsPanel`（打开后会显示该 client 的 node-executor 事件流）

- 自动重部署（debounce，可开关）
  - `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`
    - 当目标 client 已有 patch 部署且 `Auto` 开启时，graphState 变化会触发 `exportGraphForPatch()` 签名更新，并在 650ms debounce 后自动 `deployPatch(...)`

- commit 语义（确保参数持久）
  - `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`
    - 仍然保留“滑动/拖动时”发送带 TTL 的 transient override（手感更顺滑）
    - 同时对同一 `(clientId, patchId/loopId, nodeId, kind, portId)` 做 420ms 的 commit debounce：无操作后发送不带 TTL 的 override，达到“松手后保持”的效果

对应勾选已更新：
- `docs/PlanDocs/1221_newMultiMediaSystem/plan.md`：Phase 7 的 UI/auto redeploy/commit 三项已标记完成

补充（关于你遇到的 `pnpm dev:all` 报错 `nest not found`）：
- 该错误通常意味着 workspace `node_modules` 未安装/不完整（`@nestjs/cli` 未被安装到 `apps/server`）。
- 已在 `apps/server/package.json` 增加 `dev:dlx` 作为临时兜底（需要能访问 npm registry）；主路径仍推荐 `pnpm install` 后使用 `pnpm dev:all`。

---

## ✅ Phase 8：清理与长期维护（Audio 单一引擎 + 部署文档 + 健康检查）

你在 DoD 里明确要求 “Client 上所有发声都通过 ToneAudioEngine（无第二套 AudioContext）”，并且希望部署/迁移更稳。

已完成：
- 删除/退役旧 AudioContext 创建路径（只保留 ToneAudioEngine）
  - `apps/client/src/lib/stores/client.ts`
    - 移除 `SoundPlayer` / `ModulatedSoundPlayer` 的创建与调用（统一走 `ToneSoundPlayer` / `ToneModulatedSoundPlayer`）
    - `requestPermissions()` 内改为调用 `enableAudio()`（Tone.start）
  - `apps/client/src/lib/components/VisualCanvas.svelte`
    - 音频特征提取不再创建新的 `AudioContext`，改为复用 Tone 的 `rawContext`（避免第二套 context）
  - `packages/sdk-client/src/action-executors.ts`
    - `SoundPlayer` 改为纯 HTMLAudio 兜底（不再创建 AudioContext）
    - `ModulatedSoundPlayer` 禁止在无 sharedContext 时创建 AudioContext（提示 deprecated）

- 部署文档补齐 Asset Service 存储与备份策略
  - `DEPLOY.md` 新增 “Asset Service (Storage & Env)” 小节：默认存储路径、env 配置、以及备份建议

- 健康检查增强（包含 Asset Service）
  - `apps/server/src/assets/assets.service.ts`
    - 新增 `healthCheck()`：检查 dataDir/dbPath 读写、返回磁盘容量（statfs）、以及告警（low-disk / write-auth-not-configured）
  - `apps/server/src/app.controller.ts`
    - `/health` 返回 `assets` 详细健康信息；当 asset 健康失败时整体 status 变为 `degraded`

对应勾选已更新：
- `docs/PlanDocs/1221_newMultiMediaSystem/plan.md`：Phase 8 三项已标记完成

补充：
- `docs/PlanDocs/1221_newMultiMediaSystem/plan.md` 目前已无未勾选项（`- [ ]`），整份执行清单已完成。
- 如果你之前用 `sudo pnpm ...` 跑过 server build，可能会把 `apps/server/dist-server` 生成成 root-owned 导致后续 `pnpm -C apps/server build` 报 `EACCES`；一次性清理可用：`sudo rm -rf apps/server/dist-server`，之后尽量不要用 sudo 跑 pnpm。

---

## ✅ Phase 7（修订）：Graph 驱动 Patch 部署（移除 toolbar patch-controls）

你明确要求「Patch 的路由/目标必须在 Node Graph 里完成，不能有独立的 patch-controls UI」。因此我把 Phase 7 的 Patch 部署方式做了结构性调整：

已实现：
- Patch 目标选择回归 Node Graph（Max/MSP 风格）
  - `packages/node-core/src/definitions.ts`
    - `audio-out` 新增 `client` 输入端口（type=`client`）。
    - 在图里直接连：`client-object(out) → audio-out(client)`，即表示“把这个 audio-out patch 部署到该 client”。

- Patch 自动部署/停止（无需 Toolbar 按钮）
  - `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`
    - 当 NodeEngine `Start` 且 `audio-out` 有目标时：自动 `deploy + start`（debounce 320ms）。
      - 推荐连法：`audio-out(Deploy) → client-object(In)`
      - 兼容旧连法：`client-object(out) → audio-out(client)`
    - 当断开连接或 NodeEngine `Stop` 时：自动 `stop + remove`。
    - 结构变化（节点/连线变化）触发 redeploy；参数变化仍走 override-set + commit，不会 redeploy。

- Patch 导出与预加载扫描同步修复（避免 manifest=0）
  - `apps/manager/src/lib/nodes/patch-export.ts`
    - 导出 patch 时会忽略 `client/command` 端口连接，避免把 `client-object` 一起打包进 patch。
    - assetRefs 额外识别 `asset-picker` 字段里存的“裸 assetId”（自动转成 `asset:<id>`）。
  - `apps/manager/src/lib/nodes/asset-manifest.ts`
    - manifest root 现在包含 `audio-out`（优先）+ `client-object`，并跳过 `client/command` 端口连线。
    - 同样支持 `asset-picker` 裸 assetId 的识别，确保 client 登录后能预加载到正确资产。

- Templates 更新（解决你指出的“没有 client 节点无法指定播放目标”）
  - `docs/PlanDocs/1221_newMultiMediaSystem/templates/01_patch_osc_delay_audio_out.json`
  - `docs/PlanDocs/1221_newMultiMediaSystem/templates/02_patch_asset_player_delay_audio_out.json`
  - `docs/PlanDocs/1221_newMultiMediaSystem/templates/03_load_audio_from_assets_timeline.json`
    - 都已内置 `client-object`，并使用 `audio-out(Deploy) → client-object(In)`，导入后即可直接指定 client 播放。

对应勾选已更新：
- `docs/PlanDocs/1221_newMultiMediaSystem/plan.md`：Phase 7 的“Patch 目标与部署（Graph 驱动）”已替换旧 patch-controls 描述并保持完成状态。

---

## ✅ Patch 修复：Tone Patch 支持 MIDI 控制（不再报 `midi-map` 非可部署）

你遇到的报错 `Patch contains non-deployable node type: midi-map` 的原因：
- Patch 会部署到 client 的 `node-executor` 执行；但 `midi-*` 节点依赖 WebMIDI/manager 侧状态（属于 manager-only），client 侧并没有这些节点定义与输入源。

本次修复做法：
- Patch 导出阶段**自动排除 `midi-*` 节点**（它们不再进入 client patch 图），避免触发“不可部署节点”错误。
- Manager 运行时会把 `midi-* → patch-node` 的连线当成“桥接线”：在每个 tick 把 MIDI 节点输出转成 `override-set` 发给目标 client（并在断开连线时 `override-remove` 清理）。

关键实现位置：
- `apps/manager/src/lib/nodes/patch-export.ts`: MIDI 节点排除（manager-only control sources）。
- `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`: MIDI → Patch 的 override bridge（set/remove + 去抖/去重）。

补充模板（便于你直接导入验证）：
- `docs/PlanDocs/1221_newMultiMediaSystem/templates/07_patch_midi_map_delay_time.json`
  - `midi-fuzzy → midi-map → tone-delay(time)`（桥接 override）+ `tone-osc → tone-delay → audio-out`
  - 通过 `audio-out(Deploy) → client-object(In)` 指定目标 client（并兼容旧连法）

---

## ✅ Phase 2.6：Load Audio From Assets（Timeline/Loop/Play）+ 取消 Load Media* 节点

你要求「Load Audio From Assets 必须有 Timeline（双游标）+ Loop + Play/Pause，并且 Start/End 可接 MIDI 数字口」。本阶段完成了完整链路：

### 新增能力

1) **Load Audio From Assets 变为“Audio Clip Ref”**
   - `packages/node-core/src/definitions.ts`
     - `load-audio-from-assets` 增加输入：`startSec/endSec/loop/play`
     - 增加配置：`range`（`time-range` 控件，双游标 + Start/End 精确输入）
     - 输出 `ref` 扩展为：`asset:<id>#t=start,end&loop=0|1&play=0|1`

2) **Manager 新增 time-range UI 控件**
   - `apps/manager/src/lib/components/nodes/node-canvas/rete/rete-controls.ts`
   - `apps/manager/src/lib/components/nodes/node-canvas/rete/rete-builder.ts`
   - `apps/manager/src/lib/components/nodes/node-canvas/rete/ReteControl.svelte`
   - 表现：Timeline 双游标 slider + Start/End 数值输入；End 为空表示“到结尾”（内部用 `-1` 表示）

3) **Client Tone.Player 支持片段播放/Loop/Play(Pause)（不重新加载）**
   - `packages/sdk-client/src/tone-adapter.ts`
     - 解析 `#t/loop/play`
     - `play=false` 会暂停并记录 offset；`play=true` 恢复
     - 片段范围变化不会触发重新加载（只在 base URL 变化时 load）

4) **AssetRef 解析兼容 hash/query（避免 `asset:<id>#...` 失效）**
   - `packages/multimedia-core/src/asset-url-resolver.ts`
   - `apps/manager/src/lib/nodes/asset-manifest.ts`
   - `apps/manager/src/lib/nodes/patch-export.ts`

5) **取消 Load Media Sound/Image/Video（NodeGraph 不再上传）**
   - `packages/node-core/src/definitions.ts`
     - 移除 `load-media-sound/load-media-image/load-media-video` 节点注册与实现
     - 新增 `load-image-from-assets/load-video-from-assets`（与 audio 同一套 asset-picker 语义）
   - `apps/manager/src/lib/nodes/specs/register.ts`
     - 移除 `load-media-sound` runtime kind 与 core runtime pick
   - 删除：`apps/manager/src/lib/nodes/specs/load-media-sound.json`

6) **Templates 更新（可直接导入验证）**
   - `docs/PlanDocs/1221_newMultiMediaSystem/templates/02_patch_asset_player_delay_audio_out.json`
   - `docs/PlanDocs/1221_newMultiMediaSystem/templates/03_load_audio_from_assets_timeline.json`
   - `docs/PlanDocs/1221_newMultiMediaSystem/templates/04_media_image_show.json`
   - `docs/PlanDocs/1221_newMultiMediaSystem/templates/05_media_video_play.json`
   - 新增：`docs/PlanDocs/1221_newMultiMediaSystem/templates/08_midi_control_audio_clip_range.json`
   - `docs/PlanDocs/1221_newMultiMediaSystem/templates/README.md` 同步更新

---

### 你如何验证（推荐按顺序）

1) **Timeline/Loop/Play 基础验证**
   - 导入：`docs/PlanDocs/1221_newMultiMediaSystem/templates/03_load_audio_from_assets_timeline.json`
   - Assets Manager 先上传音频 → Load Audio From Assets 选择它
   - 拖动 Timeline 双游标（或输入 Start/End 秒）
   - 切换 `Loop` / `Play`：client 端应立即反映（Play=false 暂停，true 恢复）

2) **MIDI 控制 Start/End 验证**
   - 导入：`docs/PlanDocs/1221_newMultiMediaSystem/templates/08_midi_control_audio_clip_range.json`
   - 分别 Learn 两个 MIDI 控制（Start/End）
   - 转动 MIDI：StartSec/EndSec 会通过 override bridge 写入 client patch，片段范围实时变化

---

## ✅ Phase 2.8：All Nodes Connectable（所有参数可接线）

你要求「所有 node 都可以接对应的输入口（不再只能手动填值）」。本阶段把“config-only 参数”系统性补齐为 inputs，并修正 Manager UI 的写入路径，确保连线/调制是单一语义。

### 变更摘要

1) **node-core：补齐缺失 inputs（SOT）**
   - `packages/node-core/src/definitions.ts`
     - `math`：新增输入 `operation`（string）
     - `lfo`：新增输入 `waveform`（string）
     - `number`：新增输入 `value`（number；行为变成“number box / 可被上游驱动”）
     - `number-stabilizer`：新增输入 `smoothing`（number）
     - `proc-scene-switch`：新增输入 `sceneId`（string）
     - Tone：补齐 `bus/order/enabled` 等 inputs；`tone-granular` 增加 `url/loop` 输入；`tone-player` 增加 `loop/autostart/enabled/bus` 输入

2) **sdk-client：Tone 节点同步 inputs，并从 inputs 读取（优先）**
   - `packages/sdk-client/src/tone-adapter.ts`
     - effects：`bus/order/enabled` 支持接线（inputs 优先，fallback config）
     - osc：`waveform/bus/enabled/loop` 支持接线
     - granular：`url/loop/enabled/bus` 支持接线（允许从 Assets 输出 ref 直接驱动）
     - player：`enabled/loop/autostart/bus` 支持接线；`url` hash 中的 `play/loop` 仍然优先（保证 clip 节点控制语义不被破坏）

3) **manager：Select/Color inline control 写 inputValues（而不是写 config）**
   - `apps/manager/src/lib/components/nodes/node-canvas/rete/rete-builder.ts`
     - select 输入与 color 输入现在写 `node.inputValues[...]` 并发送 override kind=`input`
     - 兼容旧图：若旧图把 select/color 存在 config，仍会作为初始值展示

4) **manager-only specs：补齐 MIDI/参数节点缺失 inputs，并在 runtime 中 inputs 优先**
   - JSON specs：
     - `apps/manager/src/lib/nodes/specs/midi-boolean.json`：新增 `threshold` input
     - `apps/manager/src/lib/nodes/specs/midi-map.json`：新增 `min/max/integer` inputs
     - `apps/manager/src/lib/nodes/specs/midi-color-map.json`：新增 `from/to/invert` inputs
     - `apps/manager/src/lib/nodes/specs/midi-select-map.json`：新增 `invert` input
     - `apps/manager/src/lib/nodes/specs/param-set.json`：新增 `mode` input（select → string）
   - runtime：
     - `apps/manager/src/lib/nodes/specs/register.ts`：对应节点实现改为 `inputs[...]` 优先，fallback config

### 你如何验证（推荐）

- 在 Manager 的 Node Graph：
  1) 新建 `Math` 或 `LFO`，确认 `Operation/Waveform` 是一个“输入口上的 Select 控件”，并且可被连线覆盖。
  2) 新建 `Number`：确认它有 `Value` 输入口（可手动改，也可从上游连线驱动）。
  3) 新建 `Tone Delay`：确认 `Bus/Order/Enabled` 现在也是输入口（可接线/可被 MIDI 控制）。
  4) 新建 `midi-map`：确认 `Min/Max/Integer` 也能被连线控制（不必再写死在 config）。
  5) 直接导入模板：`docs/PlanDocs/1221_newMultiMediaSystem/templates/09_midi_select_waveform_tone_osc.json`
     - MIDI → Select → Tone Osc(Waveform)，验证 select 参数可被 MIDI 实时调制（manager-only → override bridge）。

### ✅ 验证记录

- `pnpm -C packages/node-core run build` ✅
- `pnpm -C packages/sdk-client run build` ✅
- `pnpm -C apps/manager run check` ✅（仅有 svelte unused CSS 警告）
- `pnpm -C apps/client run check` ✅
- 缺口扫描脚本：node-core / manager-json 的 `configSchema(number/boolean/string/select)` 均有对应输入口 ✅（missing=0）
