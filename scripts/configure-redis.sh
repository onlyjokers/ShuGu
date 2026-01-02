#!/bin/bash
# Redis 配置优化脚本（2GB RAM / 2 Core 服务器）
# 用法：sudo bash configure-redis.sh

set -e

echo "===== Redis 配置优化 (2GB/2Core 服务器) ====="
echo ""

# 检查是否是 root
if [ "$EUID" -ne 0 ]; then
  echo "请使用 sudo 运行此脚本"
  exit 1
fi

# 备份原配置
if [ -f /etc/redis/redis.conf ]; then
  echo "备份原配置文件..."
  cp /etc/redis/redis.conf /etc/redis/redis.conf.backup.$(date +%Y%m%d_%H%M%S)
  echo "✓ 备份完成"
else
  echo "⚠️ 未找到 /etc/redis/redis.conf，可能需要先安装 Redis"
  exit 1
fi

# 应用核心优化配置
echo ""
echo "应用优化配置..."

cat > /etc/redis/redis.conf << 'EOF'
# ===== Socket.io Redis Adapter 优化配置 =====
# 服务器: 2GB RAM / 2 Core CPU
# 优化目标: 低内存占用 + 高性能消息传递

# 网络
bind 127.0.0.1 ::1
port 6379
protected-mode yes
tcp-backlog 128
timeout 0
tcp-keepalive 300

# 内存管理（关键优化）
maxmemory 128mb
maxmemory-policy allkeys-lru
maxmemory-samples 5

# 完全禁用持久化（提升性能）
save ""
appendonly no
stop-writes-on-bgsave-error no
rdbcompression no
rdbchecksum no

# 性能
maxclients 1000
databases 1

# 日志
loglevel notice
logfile /var/log/redis/redis-server.log

# 监控
slowlog-log-slower-than 10000
slowlog-max-len 128
latency-monitor-threshold 100
EOF

echo "✓ 配置已更新"

# 确保日志目录存在
mkdir -p /var/log/redis
chown redis:redis /var/log/redis

# 重启 Redis
echo ""
echo "重启 Redis 服务..."
systemctl restart redis-server

# 等待启动
sleep 2

# 验证 Redis 运行
echo ""
echo "验证 Redis 状态..."
if redis-cli ping > /dev/null 2>&1; then
  echo "✓ Redis 运行正常"
else
  echo "✗ Redis 启动失败，请检查日志："
  echo "  sudo journalctl -u redis-server -n 50"
  exit 1
fi

# 显示内存配置
echo ""
echo "===== Redis 配置摘要 ====="
redis-cli config get maxmemory
redis-cli config get maxmemory-policy
redis-cli info memory | grep "used_memory_human\|maxmemory_human"

echo ""
echo "✅ 优化完成！"
echo ""
echo "监控命令："
echo "  redis-cli info memory        # 内存使用"
echo "  redis-cli info stats         # 统计信息"
echo "  redis-cli info clients       # 客户端连接"
echo "  redis-cli monitor            # 实时查看命令"
EOF
