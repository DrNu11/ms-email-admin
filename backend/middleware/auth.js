/**
 * JWT 鉴权中间件。
 * - 从 Authorization: Bearer <token> 取出 JWT
 * - 校验通过后，把 { id, username, role } 挂到 req.user
 * - 校验失败统一返回 401
 */
const jwt = require("jsonwebtoken")

const JWT_SECRET = process.env.JWT_SECRET || "dev-insecure-please-override-in-production"
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d"

if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  console.warn(
    "[auth] ⚠️  生产环境未设置 JWT_SECRET，正在使用不安全的开发默认值，请立即在 .env 中设置！",
  )
}

function sign(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  )
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || ""
  const token = header.startsWith("Bearer ") ? header.slice(7) : null
  if (!token) {
    return res.status(401).json({ error: "未登录：缺少 Authorization 头" })
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    req.user = { id: payload.id, username: payload.username, role: payload.role }
    next()
  } catch (error) {
    const reason =
      error.name === "TokenExpiredError"
        ? "登录已过期，请重新登录"
        : "未登录：token 无效"
    return res.status(401).json({ error: reason })
  }
}

module.exports = { sign, requireAuth, JWT_SECRET, JWT_EXPIRES_IN }
