# 服务器性能优化建议

## 当前瓶颈分析

### 为什么 200 人就感觉慢？

**核心问题**：不是连接数，而是**广播频率 × 连接数**

```
普通聊天应用：  10 msg/s × 200 = 2,000 socket.emit()/s
你的 MIDI 控制： 100 msg/s × 200 = 20,000 socket.emit()/s  (10倍差异！)
```

### Socket.io 广播的真实开销

每次 `server.to(socketIds).emit('msg', message)` 执行：

1. **JSON 序列化** × 200次（虽然 Socket.io 有优化，但仍有开销）
2. **内存复制** × 200次（每个 socket 的发送缓冲区）
3. **TCP 写入** × 200次（触发内核调用）

对于 1KB 消息 × 100 msg/s × 200 clients = **每秒 20MB 数据**

---

## 已实施的优化（✅ 完成）

### 1. Manager SDK 节流（45fps）
- 限制高频消息为 ~45 msg/s
- 自动合并同一 tick 内的更新
- 对少于 10 个 client 不启用节流

### 2. Server 端优化
- Volatile emit：缓冲区满时丢弃而不是排队
- 速率限制：超过 50 clients 时限制为 ~120Hz
- 区分关键消息（playMedia）和高频更新（modulateSoundUpdate）

---

## 🚀 进一步优化方案

### 方案 1：启用 Socket.io Adapter（推荐！）

**问题**：默认的 Socket.io 在广播时，每个 socket 都要独立序列化

**方案**：使用 `@socket.io/redis-adapter` 或自定义 adapter

```bash
cd apps/server
pnpm add @socket.io/redis-adapter redis
```

```typescript
// apps/server/src/events/events.gateway.ts
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

async afterInit(server: Server) {
    const pubClient = createClient({ url: 'redis://localhost:6379' });
    const subClient = pubClient.duplicate();
    
    await Promise.all([pubClient.connect(), subClient.connect()]);
    
    server.adapter(createAdapter(pubClient, subClient));
    
    console.log('[Gateway] Redis adapter enabled');
    this.messageRouter.setServer(server);
}
```

**优势**：
- 消息只序列化**一次**（而不是 200 次）
- 支持横向扩展（多个服务器实例）
- 大幅减少 CPU 和内存占用

---

### 方案 2：消息压缩

启用 Socket.io 的 perMessageDeflate：

```typescript
// apps/server/src/events/events.gateway.ts
@WebSocketGateway({
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
    perMessageDeflate: {
        threshold: 1024, // 大于 1KB 才压缩
        zlibDeflateOptions: {
            chunkSize: 1024,
            memLevel: 7,
            level: 3, // 压缩级别 1-9（3 是速度与压缩率平衡点）
        },
    },
})
```

**优势**：
- 减少网络带宽 60-80%
- 对大 payload（如 batch 消息）特别有效

---

### 方案 3：Binary编码（高级）

如果对性能要求极高，可以用 MessagePack 或 Protobuf 替代 JSON：

```typescript
import * as msgpack from '@msgpack/msgpack';

// 发送时
const binary = msgpack.encode(message);
socket.emit('msg', binary);

// 接收时
socket.on('msg', (data) => {
    const message = msgpack.decode(data);
});
```

**优势**：
- 减少消息大小 30-50%
- 序列化速度快 2-3 倍

---

### 方案 4：批处理延迟发送

对于非实时关键的更新，可以在服务器端做更激进的批处理：

```typescript
// message-router.service.ts
private batchPending: Map<string, Message[]> = new Map();
private batchTimer: NodeJS.Timeout | null = null;

private routeControlMessage(message: ControlMessage): void {
    if (VOLATILE_ACTIONS.has(message.action)) {
        // 批量发送
        this.queueBatch(message);
    } else {
        // 立即发送
        this.emitToSockets(socketIds, message);
    }
}

private queueBatch(message: Message): void {
    const key = 'batch';
    const batch = this.batchPending.get(key) ?? [];
    batch.push(message);
    this.batchPending.set(key, batch);
    
    if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => {
            this.flushBatch();
        }, 20); // 每 20ms 发送一批
    }
}
```

---

## 📊 性能对比预测

| 优化方案 | 延迟改善 | CPU 节省 | 实施难度 |
|---------|---------|---------|---------|
| 当前（节流）| 60% | 40% | ✅ 已完成 |
| + Redis Adapter | 80% | 70% | 🟡 中等 (需要 Redis) |
| + 消息压缩 | 85% | 75% | 🟢 简单 |
| + Binary 编码 | 90% | 85% | 🔴 复杂 |

---

## 🎯 推荐实施顺序

1. **立即尝试**：启用消息压缩（5分钟）
2. **短期**：部署 Redis Adapter（1-2小时）
3. **长期**：考虑 Binary 编码（如果还不够快）

---

## 🔍 诊断工具

添加性能监控：

```typescript
// message-router.service.ts
private broadcastCount = 0;
private broadcastBytes = 0;

setInterval(() => {
    console.log('[Perf]', {
        broadcasts: this.broadcastCount,
        bytesPerSec: (this.broadcastBytes / 1024 / 1024).toFixed(2) + ' MB/s',
        avgSize: Math.round(this.broadcastBytes / this.broadcastCount) + ' bytes',
    });
    this.broadcastCount = 0;
    this.broadcastBytes = 0;
}, 1000);
```

这样你就能看到真实的吞吐量了！
