#!/usr/bin/env bash
# -------------------------------------------------------
# MS 邮箱管家 - 一键启动脚本（macOS / Linux）
# 用法：在项目根目录执行  bash start.sh
# -------------------------------------------------------

set -e

ROOT=$(cd "$(dirname "$0")" && pwd)
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

echo ""
echo "🚀 启动 MS 邮箱管家 ..."
echo ""

# ---------- 检查 Node.js ----------
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 没检测到 Node.js，请先安装（推荐 v20+）：https://nodejs.org/"
  exit 1
fi
echo "   Node.js 版本：$(node -v)"

# ---------- 后端 ----------
cd "$BACKEND"

if [ ! -d node_modules ]; then
  echo "📦 首次运行，安装后端依赖 ..."
  npm install
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "   已生成 backend/.env"
fi

if [ ! -f data/emails.db ]; then
  echo "📚 初始化数据库 ..."
  npm run init-db
fi

# 杀掉旧的 4000 端口进程（如果有）
OLD_PID=$(lsof -tiTCP:4000 -sTCP:LISTEN 2>/dev/null || true)
[ -n "$OLD_PID" ] && kill "$OLD_PID" 2>/dev/null && echo "   已关闭旧的后端进程 ($OLD_PID)"

nohup npm run dev > /tmp/ms-email-backend.log 2>&1 &
echo "✅ 后端已启动 → http://localhost:4000"

# ---------- 前端 ----------
cd "$FRONTEND"

if [ ! -d node_modules ]; then
  echo "📦 首次运行，安装前端依赖 ..."
  npm install
fi

OLD_PID=$(lsof -tiTCP:5173 -sTCP:LISTEN 2>/dev/null || true)
[ -n "$OLD_PID" ] && kill "$OLD_PID" 2>/dev/null && echo "   已关闭旧的前端进程 ($OLD_PID)"

nohup npm run dev > /tmp/ms-email-frontend.log 2>&1 &
echo "✅ 前端已启动 → http://localhost:5173"

echo ""
echo "🎉 启动完成！"
echo "   打开浏览器访问：http://localhost:5173"
echo "   想停止服务：    bash stop.sh"
echo "   查看后端日志：  tail -f /tmp/ms-email-backend.log"
echo "   查看前端日志：  tail -f /tmp/ms-email-frontend.log"
echo ""
