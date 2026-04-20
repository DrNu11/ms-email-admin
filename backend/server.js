/**
 * 微软邮箱批量管理系统 - 后端入口
 * 阶段一：基础骨架（CORS + JSON 解析 + 健康检查）
 * 阶段二将在此文件上追加 /api/emails/* 路由。
 */
require("dotenv").config()

const express = require("express")
const cors = require("cors")
const db = require("./db")

const app = express()

/* ---------- 中间件 ---------- */

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
)

// JSON 请求体（批量导入等）
app.use(express.json({ limit: "4mb" }))

// 纯文本请求体（前端有时会直接粘贴文本）
app.use(express.text({ type: ["text/plain"], limit: "4mb" }))

// 简单访问日志
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`)
  next()
})

/* ---------- 路由 ---------- */

// 根路径：给直接访问 :4000 的用户一个友好提示
app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>ms-email-admin 后端</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 20px;color:#2c3e50;line-height:1.7}
code{background:#f4f4f5;padding:2px 6px;border-radius:4px;font-size:13px}
a{color:#409eff}</style></head>
<body>
<h2>✅ ms-email-admin 后端运行中</h2>
<p>这里是 API 服务，<b>前端页面不在这个端口</b>。</p>
<ul>
  <li>用户界面：<a href="http://localhost:5173">http://localhost:5173</a></li>
  <li>健康检查：<a href="/api/health">/api/health</a></li>
</ul>
<p style="color:#909399;font-size:13px">开放接口：<code>/api/auth/*</code>、<code>/api/emails/*</code></p>
</body></html>`)
})

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
  })
})

// 鉴权
app.use("/api/auth", require("./routes/auth"))

// 邮箱业务路由（内部自带 requireAuth 中间件）
app.use("/api/emails", require("./routes/emails"))

/* ---------- 404 与错误处理 ---------- */

app.use((req, res) => {
  res.status(404).json({ error: `Not Found: ${req.method} ${req.originalUrl}` })
})

app.use((err, _req, res, _next) => {
  console.error("[server error]", err)
  res.status(err.status || 500).json({ error: err.message || "Internal Server Error" })
})

/* ---------- 启动 ---------- */

const PORT = Number(process.env.PORT) || 4000

app.listen(PORT, () => {
  console.log(`🚀 Backend running at http://localhost:${PORT}`)
  console.log(`   健康检查：GET http://localhost:${PORT}/api/health`)
})
