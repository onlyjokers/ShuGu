# Redis Adapter 部署指南

## 概述

Redis Adapter 可以显著提升 Socket.io 广播性能：
- **消息只序列化一次**（而不是每个 socket 都序列化）
- **支持多服务器实例**（水平扩展）
- **减少 CPU 和内存使用**

## 部署步骤

### 步骤 1：在服务器上安装 Redis

连接到你的服务器：
```bash
ssh your-user@fluffycore.xyz
```

安装 Redis（Ubuntu/Debian）：
```bash
sudo apt update
sudo apt install redis-server -y
```

启动并启用 Redis 服务：
```bash
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

验证 Redis 运行：
```bash
redis-cli ping
# 应该返回: PONG
```

### 步骤 2：配置 Redis（可选但推荐）

编辑 Redis 配置：
```bash
sudo nano /etc/redis/redis.conf
```

推荐修改：
```conf
# 只允许本地连接（安全）
bind 127.0.0.1

# 设置最大内存（根据你的服务器调整）
maxmemory 256mb
maxmemory-policy allkeys-lru

# 禁用持久化（我们只用作消息传递，不需要持久化）
save ""
appendonly no
```

重启 Redis 使配置生效：
```bash
sudo systemctl restart redis-server
```

### 步骤 3：配置环境变量

在服务器上编辑你的环境配置。根据你的 PM2 配置位置：

**方法 A：使用 secrets/server.env 文件**
```bash
cd /path/to/ShuGu
echo 'REDIS_URL=redis://127.0.0.1:6379' >> secrets/server.env
```

**方法 B：在 ecosystem.config.cjs 中添加**
```javascript
module.exports = {
  apps: [
    {
      name: 'shugu-server',
      script: 'apps/server/dist-out/main.js',
      env: {
        PORT: 3001,
        REDIS_URL: 'redis://127.0.0.1:6379',  // 添加这行
      },
    },
    // ... 其他应用
  ],
};
```

### 步骤 4：重新构建和部署

在本地构建：
```bash
cd /path/to/ShuGu
pnpm build:all
```

上传到服务器（根据你的部署方式）：
```bash
# 使用 git
git add .
git commit -m "feat: add Redis adapter for broadcast optimization"
git push

# 在服务器上
cd /path/to/ShuGu
git pull
pnpm install
pnpm build:all
```

### 步骤 5：重启服务器

```bash
pm2 restart shugu-server
# 或重启所有
pm2 restart all
```

### 步骤 6：验证 Redis Adapter 工作

查看服务器日志：
```bash
pm2 logs shugu-server --lines 20
```

你应该看到：
```
[Gateway] WebSocket server initialized
[Gateway] Connecting to Redis adapter...
[Gateway] ✅ Redis adapter enabled - broadcasts optimized
```

如果 Redis 连接失败，会看到：
```
[Gateway] ⚠️ Redis adapter failed, using default adapter: [错误信息]
```

---

## Nginx 配置

**你的 Nginx 配置不需要修改！** Redis Adapter 是服务器内部优化，不影响外部通信。

当前配置已经正确处理 WebSocket：
```nginx
location /socket.io/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

---

## 可选：增加 WebSocket 超时

如果你发现连接不稳定，可以在 Nginx 中增加超时：

```nginx
location /socket.io/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    
    # 可选：增加超时
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
}
```

---

## 监控 Redis

检查 Redis 状态：
```bash
redis-cli info | grep -E 'connected_clients|used_memory_human|total_commands_processed'
```

监控 Redis 实时命令：
```bash
redis-cli monitor
```

---

## 故障排除

### Redis 无法连接

检查 Redis 服务状态：
```bash
sudo systemctl status redis-server
```

检查 Redis 日志：
```bash
sudo tail -50 /var/log/redis/redis-server.log
```

### 性能没有改善

确认 Redis adapter 已启用：
```bash
pm2 logs shugu-server | grep -i redis
```

检查消息是否通过 Redis：
```bash
redis-cli monitor | head -100
```

### 内存使用过高

调整 Redis 最大内存：
```bash
redis-cli config set maxmemory 128mb
redis-cli config set maxmemory-policy allkeys-lru
```

---

## 性能对比预测

| 场景 | 无 Redis | 有 Redis |
|------|---------|----------|
| 200 clients, 50 msg/s | 延迟累积 | 稳定 |
| 500 clients, 50 msg/s | 严重延迟 | 轻微延迟 |
| 1000 clients, 50 msg/s | 不可用 | 可用 |

---

## 完整 PM2 配置示例

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'shugu-server',
      script: 'apps/server/dist-out/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        REDIS_URL: 'redis://127.0.0.1:6379',
      },
      error_file: 'logs/server-error.log',
      out_file: 'logs/server-out.log',
      time: true,
    },
    // ... 其他应用保持不变
  ],
};
```
