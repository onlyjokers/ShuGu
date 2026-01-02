# Redis Adapter 完整部署流程

## 📋 部署清单

- [ ] 本地：构建代码
- [ ] 服务器：安装 Redis
- [ ] 服务器：优化系统配置
- [ ] 服务器：部署代码
- [ ] 服务器：重启服务
- [ ] 验证：确认 Redis Adapter 工作

---

## 🔧 步骤 1：本地准备（在你的 Mac 上）

### 1.1 确认代码已推送到 Git

```bash
cd /Users/ziqi/Desktop/ShuGu

# 检查当前状态
git status

# 添加所有更改
git add .

# 提交
git commit -m "feat: add Redis adapter and performance optimizations"

# 推送到远程仓库
git push origin master
```

### 1.2 （可选）本地测试编译

```bash
# 确保所有依赖已安装
pnpm install

# 构建所有项目
pnpm build:all

# 检查 server 构建产物
ls -lh apps/server/dist-out/
```

---

## 🚀 步骤 2：服务器端部署

### 2.1 SSH 登录服务器

```bash
ssh your-username@fluffycore.xyz
```

### 2.2 安装 Redis

```bash
# 更新软件包列表
sudo apt update

# 安装 Redis
sudo apt install redis-server -y

# 启动 Redis 服务
sudo systemctl start redis-server

# 设置开机自启
sudo systemctl enable redis-server

# 验证安装
redis-cli ping
# 应该返回: PONG
```

### 2.3 优化系统配置（重要！）

#### 增加文件描述符限制（支持 500+ 连接）

```bash
# 编辑系统限制配置
sudo nano /etc/security/limits.conf
```

在文件末尾添加：
```conf
# 支持大量 Socket.io 连接
*  soft  nofile  10000
*  hard  nofile  10000
```

保存并退出（Ctrl+X, Y, Enter）

#### 应用 Sysctl 优化（可选但推荐）

```bash
sudo nano /etc/sysctl.conf
```

添加以下优化：
```conf
# TCP 优化（支持大量并发连接）
net.core.somaxconn = 1024
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.ip_local_port_range = 10000 65535

# 文件系统优化
fs.file-max = 100000
```

应用配置：
```bash
sudo sysctl -p
```

**重要**：重新登录使文件限制生效
```bash
exit
ssh your-username@fluffycore.xyz
```

验证：
```bash
ulimit -n
# 应该显示: 10000
```

### 2.4 配置 Redis

使用自动化脚本（推荐）或手动配置。

#### 方法 A：自动化脚本（快速）⚡

```bash
cd /path/to/ShuGu

# 拉取最新代码（包含配置脚本）
git pull

# 运行配置脚本
sudo bash scripts/configure-redis.sh
```

脚本会自动：
- ✅ 备份原配置
- ✅ 应用优化设置（128MB 内存，禁用持久化）
- ✅ 重启 Redis
- ✅ 验证状态

#### 方法 B：手动配置

```bash
# 1. 备份原配置
sudo cp /etc/redis/redis.conf /etc/redis/redis.conf.backup

# 2. 编辑配置
sudo nano /etc/redis/redis.conf
```

找到并修改以下配置：

```conf
# 内存限制
maxmemory 128mb
maxmemory-policy allkeys-lru

# 禁用持久化
save ""
appendonly no

# 连接限制
maxclients 1000

# 网络安全
bind 127.0.0.1 ::1
protected-mode yes
```

```bash
# 3. 重启 Redis
sudo systemctl restart redis-server

# 4. 验证
redis-cli ping
redis-cli info memory
```

### 2.5 部署代码

```bash
cd /path/to/ShuGu

# 拉取最新代码
git pull origin master

# 安装依赖（包括 Redis adapter）
pnpm install

# 构建所有项目
pnpm build:all
```

### 2.6 重启 PM2 服务

```bash
# 重启 server（会自动读取 REDIS_URL）
pm2 restart shugu-server

# 或重启所有服务
pm2 restart all

# 查看日志确认 Redis adapter 加载
pm2 logs shugu-server --lines 30
```

---

## ✅ 步骤 3：验证部署

### 3.1 检查 Redis Adapter 是否启用

查看服务器日志：
```bash
pm2 logs shugu-server --lines 50 | grep -i redis
```

**成功标志**：
```
[Gateway] Connecting to Redis adapter...
[Gateway] ✅ Redis adapter enabled - broadcasts optimized
```

**失败标志**（如果看到这个，需要排查）：
```
[Gateway] ⚠️ Redis adapter failed, using default adapter: [错误信息]
```

### 3.2 检查 Redis 连接

```bash
# 查看 Redis 客户端连接数
redis-cli client list

# 应该看到 2 个连接（pub + sub）
redis-cli info clients | grep connected_clients
# 显示: connected_clients:2
```

### 3.3 检查内存使用

```bash
redis-cli info memory | grep -E "used_memory_human|maxmemory_human"
```

应该显示类似：
```
used_memory_human:1.50M
maxmemory_human:128.00M
```

### 3.4 功能测试

在浏览器中访问：
1. 打开 Manager: `https://fluffycore.xyz/manager`
2. 打开多个 Client 标签页（建议 10-20 个测试）
3. 在 Manager 中快速拉动 MIDI 控制器

**预期行为**：
- ✅ 所有 client 响应流畅
- ✅ 没有明显延迟累积
- ✅ CPU 使用率稳定

### 3.5 性能监控

```bash
# 实时监控 Redis 命令（会看到大量 PUBLISH 命令）
redis-cli monitor

# 查看统计信息
redis-cli info stats

# 查看慢查询（应该很少或没有）
redis-cli slowlog get 10
```

---

## 📊 步骤 4：性能测试（可选）

使用负载测试脚本验证优化效果：

```bash
# 在本地运行（连接到生产服务器）
cd /Users/ziqi/Desktop/ShuGu/tests/load

# 测试广播性能（250 clients，1KB 消息）
npx tsx 2-broadcast-test-1k-2k.ts --server-url=https://fluffycore.xyz
```

对比优化前后的 p95/p99 延迟。

---

## 🔍 故障排除

### 问题 1：Redis 连接失败

**日志**：`[Gateway] ⚠️ Redis adapter failed`

**解决**：
```bash
# 检查 Redis 状态
sudo systemctl status redis-server

# 检查 Redis 日志
sudo tail -50 /var/log/redis/redis-server.log

# 检查环境变量
pm2 describe shugu-server | grep REDIS_URL
```

### 问题 2：文件描述符不足

**症状**：超过几百个连接后无法建立新连接

**解决**：
```bash
# 检查当前限制
ulimit -n

# 如果小于 10000，重新配置 /etc/security/limits.conf
# 然后重新登录
```

### 问题 3：Redis 内存不足

**症状**：Redis 日志显示 OOM

**解决**：
```bash
# 增加内存限制
redis-cli config set maxmemory 256mb
redis-cli config rewrite

# 或编辑配置文件
sudo nano /etc/redis/redis.conf
# 修改: maxmemory 256mb
sudo systemctl restart redis-server
```

### 问题 4：性能没有改善

**排查步骤**：

1. 确认 Redis adapter 已启用：
```bash
pm2 logs shugu-server | grep "Redis adapter enabled"
```

2. 确认 Manager SDK 节流生效：
```bash
# 在 Manager 控制台中检查
# 应该看到消息发送频率被限制
```

3. 检查服务器 CPU/内存：
```bash
top
htop  # 如果安装了
```

---

## 📝 回滚计划（如果出问题）

### 快速回滚到优化前版本

```bash
cd /path/to/ShuGu

# 回滚到上一个 commit
git reset --hard HEAD~1
git push -f origin master

# 重新构建和部署
pnpm install
pnpm build:all
pm2 restart all
```

### 禁用 Redis Adapter（保留 Redis）

```bash
# 移除环境变量
pm2 delete shugu-server
pm2 start ecosystem.config.cjs

# 或编辑 ecosystem.config.cjs，注释掉 REDIS_URL
# 然后 pm2 restart shugu-server
```

---

## 🎯 部署后检查清单

- [ ] Redis 服务运行正常（`redis-cli ping` 返回 PONG）
- [ ] Redis adapter 已启用（日志显示 ✅）
- [ ] 文件描述符限制 ≥ 10000（`ulimit -n`）
- [ ] PM2 服务正常运行（`pm2 status`）
- [ ] Manager 可以连接
- [ ] 多个 Client 可以连接
- [ ] MIDI 控制响应流畅
- [ ] Redis 内存使用 < 128MB（`redis-cli info memory`）

---

## 📞 需要帮助？

如果部署过程中遇到问题，检查：

1. **PM2 日志**：`pm2 logs shugu-server`
2. **Redis 日志**：`sudo tail -100 /var/log/redis/redis-server.log`
3. **系统日志**：`sudo journalctl -u redis-server -n 50`
4. **Nginx 日志**：`sudo tail -100 /var/log/nginx/error.log`

---

## 🚀 部署完成！

预期改进：
- ✅ 支持 500+ 并发连接
- ✅ 广播延迟降低 70%+
- ✅ CPU 使用降低 50%+
- ✅ 消息不再堆积
