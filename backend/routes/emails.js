/**
 * /api/emails 路由：
 *   POST   /api/emails/import         批量导入（文本或 JSON）
 *   POST   /api/emails/refresh        刷新令牌（微软 OAuth2）
 *   GET    /api/emails                分页查询
 *   GET    /api/emails/:id/messages         读取指定邮箱的收件箱（IMAP）
 *   GET    /api/emails/:id/messages/:uid    读取指定邮件的正文（IMAP + mailparser）
 *   POST   /api/emails/batch-delete         批量删除
 *   DELETE /api/emails/:id                  删除单条
 */
const express = require("express")
const axios = require("axios")
const { ImapFlow } = require("imapflow")
const { simpleParser } = require("mailparser")
const { HttpsProxyAgent } = require("https-proxy-agent")
const db = require("../db")
const { requireAuth } = require("../middleware/auth")

const router = express.Router()

// 可选上游 HTTP 代理。云厂商常封 993 IMAP 出站端口，此时用代理隧道绕开。
// 格式：UPSTREAM_PROXY=http://user:pass@host:port
const UPSTREAM_PROXY = (process.env.UPSTREAM_PROXY || "").trim()
const proxyAgent = UPSTREAM_PROXY ? new HttpsProxyAgent(UPSTREAM_PROXY) : null
if (UPSTREAM_PROXY) {
  console.log(`[emails] 使用上游代理: ${UPSTREAM_PROXY.replace(/\/\/.*@/, "//***:***@")}`)
}

// 整个 /api/emails/* 都要登录
router.use(requireAuth)

const MS_TOKEN_ENDPOINT =
  process.env.MS_TOKEN_ENDPOINT ||
  "https://login.microsoftonline.com/common/oauth2/v2.0/token"

const DEFAULT_SCOPE =
  process.env.MS_TOKEN_SCOPE ||
  "https://outlook.office.com/IMAP.AccessAsUser.All offline_access"

const IMAP_HOST = process.env.IMAP_HOST || "outlook.office365.com"
const IMAP_PORT = Number(process.env.IMAP_PORT) || 993

/* ============================================================
 * Helpers
 * ============================================================ */

/** 用 refresh_token 换 access_token。失败抛 Error，带 code=OAUTH_REFRESH_FAILED */
async function exchangeRefreshTokenForAccessToken({ clientId, refreshToken }) {
  const form = new URLSearchParams()
  form.set("grant_type", "refresh_token")
  form.set("client_id", clientId)
  form.set("refresh_token", refreshToken)
  form.set("scope", DEFAULT_SCOPE)

  const response = await axios.post(MS_TOKEN_ENDPOINT, form, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15_000,
    validateStatus: () => true,
    ...(proxyAgent ? { httpsAgent: proxyAgent, proxy: false } : {}),
  })

  if (response.status >= 200 && response.status < 300 && response.data?.access_token) {
    return {
      accessToken: response.data.access_token,
      newRefreshToken: response.data.refresh_token || refreshToken,
      expiresIn: Number(response.data.expires_in) || 3600,
    }
  }
  const detail =
    response.data?.error_description || response.data?.error || `HTTP ${response.status}`
  const err = new Error(`刷新令牌失败：${detail}`)
  err.code = "OAUTH_REFRESH_FAILED"
  throw err
}

/**
 * 解析导入时的 expire_at 字段：
 * - 空 / 非数 / 非正 → null
 * - > 1e12 视为毫秒时间戳，除 1000
 * - 其他数值视为秒级 Unix 时间戳
 */
function parseExpiry(raw) {
  if (raw === undefined || raw === null || raw === "") return null
  const n = Number(String(raw).trim())
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n)
}

/**
 * 拿到一个可用的 access_token：
 * - 如果 DB 里缓存的 access_token 非空且 token_expiry > now+60s → 直接复用
 * - 否则调 MS OAuth2 端点刷新，把新 token 回写 DB
 * @param {{ id, user_id, email, client_id, refresh_token, access_token, token_expiry }} row
 */
async function getUsableAccessToken(row) {
  const now = Math.floor(Date.now() / 1000)
  if (row.access_token && row.token_expiry && row.token_expiry > now + 60) {
    return { accessToken: row.access_token, fromCache: true }
  }

  const result = await exchangeRefreshTokenForAccessToken({
    clientId: row.client_id,
    refreshToken: row.refresh_token,
  })
  const tokenExpiry = Math.floor(Date.now() / 1000) + result.expiresIn
  try {
    db.prepare(
      `UPDATE emails
         SET refresh_token = ?, access_token = ?, token_expiry = ?, status = 'active'
       WHERE id = ? AND user_id = ?`,
    ).run(result.newRefreshToken, result.accessToken, tokenExpiry, row.id, row.user_id)
  } catch (_) {
    /* DB 回写失败不影响当前请求 */
  }
  return {
    accessToken: result.accessToken,
    newRefreshToken: result.newRefreshToken,
    expiresIn: result.expiresIn,
    tokenExpiry,
    fromCache: false,
  }
}

/** 用 XOAUTH2 连 IMAP，抓 INBOX 最近 top 封邮件元信息。按日期新→旧 */
async function fetchInboxMessages({ email, accessToken }, { top = 20 } = {}) {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: email, accessToken },
    logger: false,
    socketTimeout: 20_000,
    ...(UPSTREAM_PROXY ? { proxy: UPSTREAM_PROXY } : {}),
  })
  await client.connect()
  try {
    const lock = await client.getMailboxLock("INBOX")
    try {
      const status = await client.status("INBOX", { messages: true })
      const total = status.messages || 0
      if (!total) return { total: 0, messages: [] }
      const fromSeq = Math.max(1, total - top + 1)
      const out = []
      for await (const msg of client.fetch(`${fromSeq}:*`, {
        envelope: true,
        uid: true,
        internalDate: true,
        flags: true,
      })) {
        const env = msg.envelope || {}
        const fromAddrs = (env.from || []).map((a) =>
          a.name ? `${a.name} <${a.address}>` : a.address,
        )
        const flags = Array.from(msg.flags || [])
        out.push({
          uid: msg.uid,
          seq: msg.seq,
          subject: env.subject || "(无主题)",
          from: fromAddrs.join(", "),
          date: env.date || msg.internalDate,
          seen: flags.includes("\\Seen"),
        })
      }
      out.reverse() // 最新在前
      return { total, messages: out }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => { })
  }
}

/** 用 UID 拉单封邮件的原始 source，交给 mailparser 解析 */
async function fetchSingleMessage({ email, accessToken }, uid) {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: email, accessToken },
    logger: false,
    socketTimeout: 30_000,
    ...(UPSTREAM_PROXY ? { proxy: UPSTREAM_PROXY } : {}),
  })
  await client.connect()
  try {
    const lock = await client.getMailboxLock("INBOX")
    try {
      const msg = await client.fetchOne(
        String(uid),
        { source: true, envelope: true, flags: true, uid: true },
        { uid: true },
      )
      if (!msg || !msg.source) {
        const err = new Error(`未找到 UID=${uid} 对应的邮件`)
        err.code = "MESSAGE_NOT_FOUND"
        throw err
      }

      // 顺手标记为已读
      try {
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true })
      } catch (_) {
        /* 标记失败不影响读信 */
      }

      const parsed = await simpleParser(msg.source)
      const addr = (obj) => {
        if (!obj) return ""
        const arr = Array.isArray(obj.value) ? obj.value : []
        return arr
          .map((a) => (a.name ? `${a.name} <${a.address}>` : a.address))
          .join(", ")
      }

      return {
        uid: msg.uid,
        subject: parsed.subject || "(无主题)",
        from: addr(parsed.from),
        to: addr(parsed.to),
        cc: addr(parsed.cc),
        date: parsed.date || msg.envelope?.date || null,
        html: parsed.html || "",
        text: parsed.text || "",
        textAsHtml: parsed.textAsHtml || "",
        attachments: (parsed.attachments || []).map((a) => ({
          filename: a.filename || "(未命名)",
          contentType: a.contentType || "application/octet-stream",
          size: a.size || 0,
        })),
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => { })
  }
}

/* ============================================================
 * POST /api/emails/import
 * Body: text/plain  或  { text: string } / { content: string }
 * Query: ?sep=----  自定义分隔符（默认 ----）
 * 行格式：邮箱----密码----client_id----refresh_token
 * ============================================================ */
router.post("/import", (req, res, next) => {
  try {
    let raw
    if (typeof req.body === "string") {
      raw = req.body
    } else if (typeof req.body?.text === "string") {
      raw = req.body.text
    } else if (typeof req.body?.content === "string") {
      raw = req.body.content
    } else {
      return res
        .status(400)
        .json({ error: "请求体需要 text/plain 或 JSON { text }/{ content }" })
    }

    const requestedSep = (req.query.sep || req.body?.separator || "").toString()

    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    // 自动识别分隔符：如果前端没指定，按候选顺序挑出现频率最高的
    function detectSeparator(sampleLines) {
      const candidates = ["-----", "----", "---", "||", "::", "\t", ","]
      let best = "----"
      let bestScore = 0
      for (const candidate of candidates) {
        // 取前 3 行，看用此分隔符切后 parts>=4 的行数
        const hits = sampleLines.slice(0, 5).filter((line) => {
          const parts = line.split(candidate)
          return parts.length >= 4 && parts[0].includes("@")
        }).length
        if (hits > bestScore) {
          best = candidate
          bestScore = hits
        }
      }
      return best
    }

    const separator = requestedSep || detectSeparator(lines)

    const seen = new Set()
    const rows = []
    const skipped = []

    for (const line of lines) {
      const parts = line.split(separator).map((value) => value.trim())
      if (parts.length < 4) {
        skipped.push({
          line,
          reason: "字段不足 4 个（至少需要：邮箱<sep>密码<sep>client_id<sep>refresh_token）",
        })
        continue
      }

      // 按字段数智能路由：
      //   4 字段  email / password / client_id / refresh_token
      //   5 字段  email / password / client_id / refresh_token / expire_at
      //   6+ 字段 email / password / client_id / refresh_token / access_token / expire_at (多余字段忽略)
      const email = parts[0]
      const password = parts[1]
      const clientId = parts[2]
      const refreshToken = parts[3]

      let accessToken = ""
      let tokenExpiry = null
      if (parts.length >= 6) {
        accessToken = parts[4] || ""
        tokenExpiry = parseExpiry(parts[5])
      } else if (parts.length === 5) {
        tokenExpiry = parseExpiry(parts[4])
      }

      if (!email || !email.includes("@")) {
        skipped.push({ line, reason: "邮箱格式不合法" })
        continue
      }
      const key = email.toLowerCase()
      if (seen.has(key)) {
        skipped.push({ line, reason: "文件内重复" })
        continue
      }
      seen.add(key)

      rows.push({ email, password, clientId, refreshToken, accessToken, tokenExpiry })
    }

    const userId = req.user.id
    const existsStmt = db.prepare(
      "SELECT id FROM emails WHERE email = ? AND user_id = ?",
    )
    const insertStmt = db.prepare(`
      INSERT INTO emails (email, password, client_id, refresh_token, access_token, token_expiry, status, user_id)
      VALUES (@email, @password, @clientId, @refreshToken, @accessToken, @tokenExpiry, 'active', @userId)
    `)
    const updateStmt = db.prepare(`
      UPDATE emails SET
        password      = @password,
        client_id     = @clientId,
        refresh_token = @refreshToken,
        access_token  = CASE WHEN @accessToken <> '' THEN @accessToken ELSE access_token END,
        token_expiry  = COALESCE(@tokenExpiry, token_expiry),
        status        = 'active'
      WHERE email = @email AND user_id = @userId
    `)

    const runBatch = db.transaction((list) => {
      let inserted = 0
      let updated = 0
      for (const row of list) {
        const params = { ...row, userId }
        const exists = existsStmt.get(row.email, userId)
        if (exists) {
          updateStmt.run(params)
          updated += 1
        } else {
          insertStmt.run(params)
          inserted += 1
        }
      }
      return { inserted, updated }
    })

    const { inserted, updated } = runBatch(rows)

    const now = Math.floor(Date.now() / 1000)
    const withAccessToken = rows.filter((r) => r.accessToken && r.tokenExpiry && r.tokenExpiry > now + 60).length

    res.json({
      ok: true,
      separator,
      received: lines.length,
      imported: rows.length,
      inserted,
      updated,
      withAccessToken,               // 本次导入中带有有效 access_token 的行数
      skipped,
    })
  } catch (error) {
    next(error)
  }
})

/* ============================================================
 * POST /api/emails/refresh
 * Body: { id }
 * 失败时会把该邮箱 status 置为 'invalid'
 * ============================================================ */
router.post("/refresh", async (req, res, next) => {
  const id = Number(req.body?.id ?? req.query.id)
  if (!id) {
    return res.status(400).json({ error: "缺少必填字段 id" })
  }

  let row
  try {
    row = db
      .prepare(
        `SELECT id, email, client_id, refresh_token, access_token, token_expiry, user_id
         FROM emails WHERE id = ? AND user_id = ?`,
      )
      .get(id, req.user.id)
  } catch (error) {
    return next(error)
  }

  if (!row) {
    return res.status(404).json({ error: `邮箱不存在：id=${id}` })
  }
  if (!row.client_id || !row.refresh_token) {
    return res.status(400).json({ error: "该邮箱缺少 client_id 或 refresh_token" })
  }

  // 手动刷新总是强制调 MS 端点（而不用缓存），绕开 getUsableAccessToken 的复用逻辑
  try {
    const result = await exchangeRefreshTokenForAccessToken({
      clientId: row.client_id,
      refreshToken: row.refresh_token,
    })
    const tokenExpiry = Math.floor(Date.now() / 1000) + result.expiresIn

    db.prepare(
      `UPDATE emails
         SET refresh_token = ?, access_token = ?, token_expiry = ?, status = 'active'
       WHERE id = ? AND user_id = ?`,
    ).run(result.newRefreshToken, result.accessToken, tokenExpiry, id, req.user.id)

    return res.json({
      ok: true,
      id,
      email: row.email,
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      tokenExpiry,
    })
  } catch (error) {
    const detail = error?.message || String(error)
    try {
      db.prepare(
        `UPDATE emails SET status = 'invalid' WHERE id = ? AND user_id = ?`,
      ).run(id, req.user.id)
    } catch (_) {
      /* ignore */
    }
    return res.status(502).json({
      ok: false,
      id,
      email: row?.email,
      error: detail,
    })
  }
})

/* ============================================================
 * GET /api/emails?page=1&pageSize=20&search=&status=
 * ============================================================ */
router.get("/", (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 20))
    const search = String(req.query.search || "").trim()
    const status = String(req.query.status || "").trim()

    const where = ["user_id = @userId"]
    const params = {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      userId: req.user.id,
    }
    if (search) {
      where.push("email LIKE @q")
      params.q = `%${search}%`
    }
    if (status) {
      where.push("status = @status")
      params.status = status
    }
    const whereSql = `WHERE ${where.join(" AND ")}`

    const countRow = db.prepare(`SELECT COUNT(*) AS c FROM emails ${whereSql}`).get(params)
    const list = db
      .prepare(
        `SELECT id, email, password, client_id, refresh_token, token_expiry, status, created_at, updated_at
           FROM emails
           ${whereSql}
           ORDER BY id DESC
           LIMIT @limit OFFSET @offset`,
      )
      .all(params)

    res.json({
      ok: true,
      total: countRow.c,
      page,
      pageSize,
      list,
    })
  } catch (error) {
    next(error)
  }
})

/* ============================================================
 * GET /api/emails/:id/messages?top=20
 * 读取指定邮箱的 INBOX（XOAUTH2 + IMAP）
 * ============================================================ */
router.get("/:id/messages", async (req, res, next) => {
  const id = Number(req.params.id)
  if (!id) return res.status(400).json({ error: "id 非法" })
  const top = Math.min(50, Math.max(1, Number(req.query.top) || 20))

  const row = db
    .prepare(
      `SELECT id, email, client_id, refresh_token, access_token, token_expiry, user_id
       FROM emails WHERE id = ? AND user_id = ?`,
    )
    .get(id, req.user.id)
  if (!row) return res.status(404).json({ error: `邮箱不存在：id=${id}` })
  if (!row.client_id || !row.refresh_token) {
    return res
      .status(400)
      .json({ error: "该邮箱缺少 client_id 或 refresh_token，无法访问收件箱" })
  }

  try {
    // 优先用缓存的 access_token，过期才去刷新
    const { accessToken } = await getUsableAccessToken(row)

    const { total, messages } = await fetchInboxMessages(
      { email: row.email, accessToken },
      { top },
    )
    return res.json({
      ok: true,
      id,
      email: row.email,
      total,
      count: messages.length,
      messages,
    })
  } catch (error) {
    if (error?.code === "OAUTH_REFRESH_FAILED") {
      try {
        db.prepare(
          `UPDATE emails SET status = 'invalid' WHERE id = ? AND user_id = ?`,
        ).run(id, req.user.id)
      } catch (_) {
        /* ignore */
      }
      return res
        .status(502)
        .json({ ok: false, id, email: row.email, error: error.message })
    }
    const detail =
      error?.response?.data?.error_description ||
      error?.responseText ||
      error?.message ||
      String(error)
    return res.status(502).json({
      ok: false,
      id,
      email: row.email,
      error: `收件箱获取失败：${detail}`,
    })
  }
})

/* ============================================================
 * GET /api/emails/:id/messages/:uid
 * 读取单封邮件的完整正文
 * ============================================================ */
router.get("/:id/messages/:uid", async (req, res, next) => {
  const id = Number(req.params.id)
  const uid = Number(req.params.uid)
  if (!id) return res.status(400).json({ error: "id 非法" })
  if (!uid) return res.status(400).json({ error: "uid 非法" })

  const row = db
    .prepare(
      `SELECT id, email, client_id, refresh_token, access_token, token_expiry, user_id
       FROM emails WHERE id = ? AND user_id = ?`,
    )
    .get(id, req.user.id)
  if (!row) return res.status(404).json({ error: `邮箱不存在：id=${id}` })
  if (!row.client_id || !row.refresh_token) {
    return res
      .status(400)
      .json({ error: "该邮箱缺少 client_id 或 refresh_token，无法读取邮件" })
  }

  try {
    const { accessToken } = await getUsableAccessToken(row)

    const message = await fetchSingleMessage(
      { email: row.email, accessToken },
      uid,
    )
    return res.json({ ok: true, id, email: row.email, message })
  } catch (error) {
    if (error?.code === "OAUTH_REFRESH_FAILED") {
      try {
        db.prepare(
          `UPDATE emails SET status = 'invalid' WHERE id = ? AND user_id = ?`,
        ).run(id, req.user.id)
      } catch (_) {
        /* ignore */
      }
      return res
        .status(502)
        .json({ ok: false, id, email: row.email, error: error.message })
    }
    if (error?.code === "MESSAGE_NOT_FOUND") {
      return res
        .status(404)
        .json({ ok: false, id, email: row.email, error: error.message })
    }
    const detail =
      error?.response?.data?.error_description ||
      error?.message ||
      String(error)
    return res.status(502).json({
      ok: false,
      id,
      email: row.email,
      error: `读取邮件失败：${detail}`,
    })
  }
})

/* ============================================================
 * POST /api/emails/batch-delete
 * Body: { ids: number[] }
 * ============================================================ */
router.post("/batch-delete", (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : []
    const numericIds = ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    if (!numericIds.length) {
      return res.status(400).json({ error: "参数 ids 为空或非法" })
    }

    const placeholders = numericIds.map(() => "?").join(",")
    const info = db
      .prepare(
        `DELETE FROM emails WHERE user_id = ? AND id IN (${placeholders})`,
      )
      .run(req.user.id, ...numericIds)

    res.json({ ok: true, requested: numericIds.length, deleted: info.changes })
  } catch (error) {
    next(error)
  }
})

/* ============================================================
 * DELETE /api/emails/:id
 * ============================================================ */
router.delete("/:id", (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!id) return res.status(400).json({ error: "id 非法" })
    const info = db
      .prepare("DELETE FROM emails WHERE id = ? AND user_id = ?")
      .run(id, req.user.id)
    if (!info.changes) return res.status(404).json({ error: `邮箱不存在：id=${id}` })
    res.json({ ok: true, id })
  } catch (error) {
    next(error)
  }
})

module.exports = router
