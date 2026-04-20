#!/usr/bin/env bash
# 停止 MS 邮箱管家
# 用法：bash stop.sh

echo "🛑 停止 MS 邮箱管家 ..."

BACKEND_PID=$(lsof -tiTCP:4000 -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$BACKEND_PID" ]; then
  kill "$BACKEND_PID" 2>/dev/null && echo "   ✅ 后端已停止（PID $BACKEND_PID）"
else
  echo "   ℹ️  后端未在运行"
fi

FRONTEND_PID=$(lsof -tiTCP:5173 -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$FRONTEND_PID" ]; then
  kill "$FRONTEND_PID" 2>/dev/null && echo "   ✅ 前端已停止（PID $FRONTEND_PID）"
else
  echo "   ℹ️  前端未在运行"
fi

echo ""
