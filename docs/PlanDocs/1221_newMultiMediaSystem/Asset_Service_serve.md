<!-- Purpose: Asset Service 的对外 API 与行为规范说明（便于未来迁移到 S3/R2/CDN 或二次开发时保持兼容）。 -->

# Asset Service (Serve) — API & 兼容规范

更新时间：2025-12-21

> 本文档描述 ShuGu 的 Asset Service 对外行为（HTTP API、缓存、校验、Range/CORS 等）。  
> 目标：尽量贴近常见对象存储/静态资源分发标准，方便未来迁移到第三方存储或 CDN。

---

## 1. 设计目标

1. **标准 HTTP**：Client 以访问普通静态资源的方式拉取（GET/HEAD、Range、ETag、Cache-Control）。
2. **可迁移**：未来换存储/域名/托管方，不需要改 graph/协议，只改 `AssetUrlResolver`（或服务端返回 302/重定向）。
3. **内容不可变（强烈建议）**：一旦创建 asset，内容不可被覆盖；若内容不同必须生成新 assetId（或至少 ETag/sha256 必须变化）。
4. **可校验**：服务端提供 sha256（元数据）；内容接口 ETag 推荐直接等于 sha256，便于客户端跨会话校验。

---

## 2. 术语与数据模型

### 2.1 AssetKind

- `audio` / `image` / `video`

### 2.2 AssetRecord（元数据）

```ts
type AssetRecord = {
  id: string;          // 主流方案：UUIDv4（内容一致性/去重通过 sha256/ETag 保障）
  kind: 'audio' | 'image' | 'video';
  mimeType: string;
  sizeBytes: number;
  sha256: string;      // hex
  originalName: string;
  createdAt: number;   // epoch ms
  updatedAt: number;   // epoch ms
  durationMs?: number;
  width?: number;
  height?: number;
};
```

### 2.3 AssetRef（graph/协议中的引用）

- 推荐 `asset:<id>`（最短、兼容性好）
- 可同时支持 `shugu://asset/<id>`

Resolver 规则：
- `asset:<id>` → `https://{server}/api/assets/<id>/content`

---

## 3. HTTP API（建议最终稳定为 v1）

统一前缀：
- `/api/assets`

> 可选：未来如需版本化，可升级为 `/api/v1/assets` 并在旧路径做兼容转发。

### 3.0 鉴权（必须，低延迟 & 易迁移）

你明确要求“服务器在网上不会被人乱上传东西”，同时“所有打开 client 的人都可以读资源”。  
因此这里采用 **主流、最小开销、可迁移** 的方案：

- 统一使用 `Authorization: Bearer <token>`（HTTP 标准，兼容反向代理/CDN/网关）。
- 服务端鉴权必须是 **纯内存校验**（不做 DB round-trip），保证单次请求开销可忽略。

默认策略（符合“写保护、读公开”的常见模式）：
- **写（upload）必须鉴权**：需要 `ASSET_WRITE_TOKEN`
- **读（GET/HEAD content/meta）默认公开**：当 `ASSET_READ_TOKEN` 未配置时，读请求不需要任何 token

可选加固（未来若你需要“读也要鉴权”）：
- 配置 `ASSET_READ_TOKEN` 后，读请求需要 token
- 兼容 `<img>/<video>/<audio>` 等无法自定义 headers 的场景：读请求也允许 query token：
  - `?token=<ASSET_READ_TOKEN>`（推荐）
  - `?access_token=<ASSET_READ_TOKEN>`（兼容常见命名）

MVP 推荐（足够主流、实现简单、性能最好）：
- `ASSET_WRITE_TOKEN`：写权限（manager 上传/删除/管理）
- 校验方式：常量时间字符串比较（避免计时攻击；实现也很快）

迁移兼容（面向未来更大服务器/对象存储）：
- 保留同样的 Bearer header 语义，未来可以把 token 替换为：
  - JWT（HS256/RS256）/ OAuth2 access token
  - 或者由 resolver 下发 pre-signed URL（下载不再需要 header auth）

### 3.1 上传

`POST /api/assets`

Headers：
- `Content-Type: multipart/form-data`
- `Authorization: Bearer <ASSET_WRITE_TOKEN>`

Form fields：
- `file`（必填）
- `kind`（可选；不传则由服务端从 mime 推断）
- `originalName`（可选；不传则从 file filename 推断）

行为：
- 服务端计算 sha256。
- 如果 sha256 已存在（dedupe），返回已存在的 asset（可返回 `deduped: true`）。
- 必须限制上传大小（例如 100MB/500MB 可配置），超限返回 413。
- 不允许覆盖已有 asset 内容（append-only）。

成功响应（JSON）：
```json
{
  "asset": {
    "id": "…",
    "kind": "audio",
    "mimeType": "audio/mpeg",
    "sizeBytes": 123456,
    "sha256": "…",
    "originalName": "foo.mp3",
    "createdAt": 1734740000000,
    "updatedAt": 1734740000000
  },
  "contentUrl": "https://host/api/assets/<id>/content",
  "deduped": false
}
```

错误：
- `400`：缺少 file / 参数非法
- `413`：文件过大
- `415`：不支持的 mime（可选限制）

### 3.2 读取元数据

`GET /api/assets/:id`

响应：
- `200` + `AssetRecord`（JSON）
- `404`：不存在

Headers（建议）：
- `Authorization: Bearer <ASSET_READ_TOKEN>`

### 3.3 下载内容（核心）

`GET /api/assets/:id/content`

必须支持：
- `Range: bytes=...`（206）
- `Accept-Ranges: bytes`
- `Content-Range`（当 Range 请求时）
- `ETag`（强烈建议：`ETag = "<sha256>"`）
- `If-None-Match`（304）
- `Content-Type`（准确）
- `Content-Length`

强烈建议：
- `Cache-Control: public, max-age=31536000, immutable`（当内容不可变时）
- `Content-Disposition: inline; filename="<originalName>"`（便于调试/下载）

Headers（建议）：
- （公开读时）无需鉴权 headers
- （若开启读鉴权）`Authorization: Bearer <ASSET_READ_TOKEN>` 或 `?token=<ASSET_READ_TOKEN>`

响应码：
- `200`：完整内容
- `206`：Range 内容
- `304`：缓存命中（If-None-Match）
- `404`：不存在
- `416`：Range 不合法

### 3.4 HEAD（用于预加载/快速校验）

`HEAD /api/assets/:id/content`

返回：
- 与 `GET content` 相同的关键 headers（`ETag` / `Content-Length` / `Accept-Ranges` / `Content-Type`）
- 无 body

Headers（建议）：
- `Authorization: Bearer <ASSET_READ_TOKEN>`

---

### 3.5 列表（管理用）

`GET /api/assets`

用途：
- Manager 的 “Assets Manager” 页面列出所有资产（用于搜索/复制 assetRef/删除）。

鉴权：
- **需要写 token**：`Authorization: Bearer <ASSET_WRITE_TOKEN>`

响应（JSON）：
```json
{
  "assets": [
    {
      "id": "…",
      "kind": "audio",
      "mimeType": "audio/mpeg",
      "sizeBytes": 123456,
      "sha256": "…",
      "originalName": "foo.mp3",
      "createdAt": 1734740000000,
      "updatedAt": 1734740000000
    }
  ]
}
```

### 3.6 删除（管理用）

`DELETE /api/assets/:id`

鉴权：
- **需要写 token**：`Authorization: Bearer <ASSET_WRITE_TOKEN>`

响应（JSON）：
```json
{ "ok": true }
```

---

## 4. CORS（必须）

如果 Manager/Client 可能跨域访问（常见于部署场景），必须：

- `Access-Control-Allow-Origin: <allowed-origins>`
- `Access-Control-Allow-Methods: GET,HEAD,POST,OPTIONS`
- `Access-Control-Allow-Headers: Range, If-None-Match, Content-Type`
- `Access-Control-Expose-Headers: Content-Range, Accept-Ranges, ETag, Content-Length, Content-Type`

> 注意：如果需要带 cookie/credentials，不能用 `*`。

---

## 5. 客户端缓存与校验（约定）

客户端（MultimediaCore.ResourceStore）建议：

1. 预加载时先拉 `GET /api/assets/:id` 获取 `sha256/sizeBytes/mimeType`（元数据）
2. 对内容做持久化缓存：
   - Cache Storage：缓存 `GET content` Response
   - IndexedDB：缓存 `assetId -> { sha256, etag, sizeBytes, verifiedAt }`
3. 首次下载后做一致性校验：
   - 基线（推荐，MVP 足够）：要求 `ETag === meta.sha256`，以 headers 校验为主
   - 可选加固：对小文件再用 WebCrypto 计算 sha256 复核（避免对超大视频做整文件 hash）
4. 后续启动做快速校验：
   - `HEAD content`：比较 `ETag/Content-Length` 与本地记录
   - 不一致时才重新下载并重新 hash

---

## 6. 迁移指南（S3/R2/CDN）

迁移策略目标：graph/协议仍然只存 `asset:<id>`，不改业务层。

推荐路线：

1. **保持同一路径（反向代理）**
   - 仍提供 `/api/assets/:id/content`，内部 proxy 到 S3/R2/CDN
   - client 不改

2. **返回 302/307 到 CDN（可选）**
   - `GET content` 返回重定向到真实静态 URL
   - 注意：Range + CORS + 缓存 headers 需要 CDN 正确支持

3. **Resolver 改为预签名 URL（可选）**
   - manager/client 通过 API 拿到一次性 URL（带签名/过期时间）
   - graph 中仍存 `asset:<id>`，只在运行时解析

无论哪种，建议维持：
- `sha256` 作为一致性基准
- `ETag == sha256`（或至少可从 headers 获取稳定的一致性标识）

---

## 7. 安全与运维建议（MVP 也要考虑）

- 上传鉴权：至少限制来源（manager 登录态/token），避免公网被刷爆（可延后但要在计划里）
- 大小限制：`ASSET_MAX_BYTES`
- 目录可写：`ASSET_DATA_DIR`
- 索引位置（MVP JSON 索引 / 未来可换 DB）：`ASSET_DB_PATH`
- 对外 URL（可选，用于反向代理/CDN 场景）：`ASSET_PUBLIC_BASE_URL`
- 备份策略：定期备份 `ASSET_DB_PATH` + `ASSET_DATA_DIR`
- 监控：磁盘空间与上传错误率
