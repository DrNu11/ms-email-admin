/**
 * /api/auth 路由：
 *   POST /api/auth/register    开放注册（用户名 + 密码）
 *   POST /api/auth/login       登录换 JWT
 *   POST /api/auth/guest       游客登录（幂等进入共享 guest 账号）
 *   GET  /api/auth/me          带上 Authorization 返回当前用户
 */
const express = require("express")
const bcrypt = require("bcryptjs")
const db = require("../db")
const { sign, requireAuth } = require("../middleware/auth")

const router = express.Router()

const USERNAME_REGEX = /^[a-zA-Z0-9_\u4e00-\u9fa5]{3,20}$/ // 3-20 位字母数字下划线或中文
const PASSWORD_MIN_LENGTH = 6

/** 校验用户名 & 密码的基本格式 */
function validateCredentials(username, password) {
  if (!username || typeof username !== "string") return "用户名不能为空"
  if (!USERNAME_REGEX.test(username)) return "用户名必须是 3-20 位字母/数字/下划线/中文"
  if (!password || typeof password !== "string") return "密码不能为空"
  if (password.length < PASSWORD_MIN_LENGTH) return `密码至少 ${PASSWORD_MIN_LENGTH} 位`
  if (password.length > 128) return "密码过长（最多 128 位）"
  return null
}

/* ============================================================
 * POST /api/auth/register  { username, password }
 * ============================================================ */
router.post("/register", async (req, res, next) => {
  try {
    const { username, password } = req.body || {}
    const err = validateCredentials(username, password)
    if (err) return res.status(400).json({ error: err })

    const exists = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)
    if (exists) {
      return res.status(409).json({ error: "用户名已被占用" })
    }

    const passwordHash = await bcrypt.hash(password, 10)

    // 第一个注册的人自动成为 admin，其余为 user
    const total = db.prepare("SELECT COUNT(*) AS c FROM users").get().c
    const role = total === 0 ? "admin" : "user"

    const info = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
      .run(username, passwordHash, role)

    const user = { id: info.lastInsertRowid, username, role }
    const token = sign(user)
    res.status(201).json({ ok: true, user, token })
  } catch (error) {
    next(error)
  }
})

/* ============================================================
 * POST /api/auth/login  { username, password }
 * ============================================================ */
router.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body || {}
    if (!username || !password) {
      return res.status(400).json({ error: "请输入用户名和密码" })
    }

    const row = db
      .prepare("SELECT id, username, password_hash, role FROM users WHERE username = ?")
      .get(username)

    if (!row) {
      return res.status(401).json({ error: "用户名或密码错误" })
    }

    const ok = await bcrypt.compare(password, row.password_hash)
    if (!ok) {
      return res.status(401).json({ error: "用户名或密码错误" })
    }

    const user = { id: row.id, username: row.username, role: row.role }
    const token = sign(user)
    res.json({ ok: true, user, token })
  } catch (error) {
    next(error)
  }
})

/* ============================================================
 * POST /api/auth/guest
 * 免注册体验：首次调用会创建共享 guest 账号，之后幂等登录。
 * guest 账号与其他用户之间仍走 user_id 隔离，但多个游客访问会共享同一份数据。
 * ============================================================ */
const GUEST_USERNAME = "guest"

router.post("/guest", async (req, res, next) => {
  try {
    let row = db
      .prepare("SELECT id, username, password_hash, role FROM users WHERE username = ?")
      .get(GUEST_USERNAME)

    if (!row) {
      // 生成一个随机密码，只为占位（没人需要用密码登陆 guest）
      const randomPassword = [...Array(24)]
        .map(() => Math.random().toString(36).slice(2, 3))
        .join("")
      const passwordHash = await bcrypt.hash(randomPassword, 10)
      const info = db
        .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
        .run(GUEST_USERNAME, passwordHash, "user")
      row = { id: info.lastInsertRowid, username: GUEST_USERNAME, role: "user" }
    }

    const user = { id: row.id, username: row.username, role: row.role }
    const token = sign(user)
    res.json({ ok: true, guest: true, user, token })
  } catch (error) {
    next(error)
  }
})

/* ============================================================
 * GET /api/auth/me
 * ============================================================ */
router.get("/me", requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user })
})

module.exports = router
