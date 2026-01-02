#!/bin/bash
# Redis Adapter 一键部署脚本
# 在服务器上执行此脚本完成完整部署
# 
# 用法：
#   wget https://raw.githubusercontent.com/.../deploy-redis.sh
#   chmod +x deploy-redis.sh
#   sudo ./deploy-redis.sh

set -e

echo "==========================================="
echo " Redis Adapter 自动部署"
echo " ShuGu Performance Optimization"
echo "==========================================="
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查是否是 root
if [ "$EUID" -eq 0 ]; then
  echo -e "${RED}请不要使用 root 用户运行此脚本${NC}"
  echo "使用普通用户 + sudo"
  exit 1
fi

echo "步骤 1/6: 安装 Redis..."
if command -v redis-cli &> /dev/null; then
    echo -e "${GREEN}✓ Redis 已安装${NC}"
else
    echo "正在安装 Redis..."
    sudo apt update
    sudo apt install redis-server -y
    sudo systemctl start redis-server
    sudo systemctl enable redis-server
    echo -e "${GREEN}✓ Redis 安装完成${NC}"
fi

# 验证 Redis
if redis-cli ping &> /dev/null; then
    echo -e "${GREEN}✓ Redis 运行正常${NC}"
else
    echo -e "${RED}✗ Redis 未运行，请检查${NC}"
    exit 1
fi

echo ""
echo "步骤 2/6: 优化系统配置..."

# 文件描述符限制
if grep -q "nofile.*10000" /etc/security/limits.conf 2>/dev/null; then
    echo -e "${GREEN}✓ 文件描述符限制已配置${NC}"
else
    echo "配置文件描述符限制..."
    sudo bash -c 'cat >> /etc/security/limits.conf << EOF

# ShuGu - 支持大量并发连接
*  soft  nofile  10000
*  hard  nofile  10000
EOF'
    echo -e "${YELLOW}⚠ 需要重新登录使配置生效${NC}"
fi

# Sysctl 优化
if grep -q "net.core.somaxconn.*1024" /etc/sysctl.conf 2>/dev/null; then
    echo -e "${GREEN}✓ 网络参数已优化${NC}"
else
    echo "优化网络参数..."
    sudo bash -c 'cat >> /etc/sysctl.conf << EOF

# ShuGu - TCP 优化
net.core.somaxconn = 1024
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.ip_local_port_range = 10000 65535
fs.file-max = 100000
EOF'
    sudo sysctl -p > /dev/null
    echo -e "${GREEN}✓ 网络参数已优化${NC}"
fi

echo ""
echo "步骤 3/6: 配置 Redis..."

# 备份原配置
if [ ! -f /etc/redis/redis.conf.backup ]; then
    sudo cp /etc/redis/redis.conf /etc/redis/redis.conf.backup
    echo -e "${GREEN}✓ 原配置已备份${NC}"
fi

# 应用优化配置
sudo bash -c 'cat > /etc/redis/redis.conf << "EOF"
# ShuGu Redis Adapter 优化配置
bind 127.0.0.1 ::1
port 6379
protected-mode yes
tcp-backlog 128
timeout 0
tcp-keepalive 300

maxmemory 128mb
maxmemory-policy allkeys-lru
maxmemory-samples 5

save ""
appendonly no
stop-writes-on-bgsave-error no
rdbcompression no
rdbchecksum no

maxclients 1000
databases 1

loglevel notice
logfile /var/log/redis/redis-server.log

slowlog-log-slower-than 10000
slowlog-max-len 128
latency-monitor-threshold 100
EOF'

sudo mkdir -p /var/log/redis
sudo chown redis:redis /var/log/redis
sudo systemctl restart redis-server
sleep 2

if redis-cli ping &> /dev/null; then
    echo -e "${GREEN}✓ Redis 配置已更新${NC}"
else
    echo -e "${RED}✗ Redis 重启失败${NC}"
    exit 1
fi

echo ""
echo "步骤 4/6: 拉取最新代码..."
if [ -d "$HOME/ShuGu" ]; then
    cd "$HOME/ShuGu"
elif [ -d "/opt/ShuGu" ]; then
    cd "/opt/ShuGu"
else
    echo -e "${RED}✗ 未找到 ShuGu 项目目录${NC}"
    echo "请手动指定项目路径"
    exit 1
fi

git pull origin master
echo -e "${GREEN}✓ 代码已更新${NC}"

echo ""
echo "步骤 5/6: 构建项目..."
pnpm install
pnpm build:all
echo -e "${GREEN}✓ 构建完成${NC}"

echo ""
echo "步骤 6/6: 重启服务..."
pm2 restart shugu-server
sleep 3
echo -e "${GREEN}✓ 服务已重启${NC}"

echo ""
echo "==========================================="
echo " 部署完成！正在验证..."
echo "==========================================="
echo ""

# 验证 Redis Adapter
echo "检查 Redis Adapter 状态..."
sleep 2
if pm2 logs shugu-server --lines 30 --nostream 2>&1 | grep -q "Redis adapter enabled"; then
    echo -e "${GREEN}✅ Redis Adapter 已启用${NC}"
else
    echo -e "${YELLOW}⚠ 未检测到 Redis Adapter 日志，请手动检查：${NC}"
    echo "  pm2 logs shugu-server"
fi

# Redis 连接数
REDIS_CLIENTS=$(redis-cli info clients | grep "connected_clients" | cut -d: -f2 | tr -d '\r')
echo "Redis 客户端连接数: $REDIS_CLIENTS"

# 内存使用
REDIS_MEM=$(redis-cli info memory | grep "used_memory_human" | cut -d: -f2 | tr -d '\r')
echo "Redis 内存使用: $REDIS_MEM"

echo ""
echo "==========================================="
echo -e "${GREEN}✅ 部署成功！${NC}"
echo "==========================================="
echo ""
echo "下一步："
echo "1. 访问 https://fluffycore.xyz/manager 测试"
echo "2. 监控日志: pm2 logs shugu-server"
echo "3. 监控 Redis: redis-cli monitor"
echo ""
echo "如果看到性能改善，部署成功！"
echo ""
