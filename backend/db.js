/**
 * 数据库连接单例。server.js 以及其他路由都通过此模块使用同一个连接。
 */
const path = require("node:path")
const fs = require("node:fs")
const Database = require("better-sqlite3")

const DATA_DIR = path.join(__dirname, "data")
const DB_PATH = path.join(DATA_DIR, "emails.db")

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

const db = new Database(DB_PATH)
db.pragma("journal_mode = WAL")
db.pragma("foreign_keys = ON")

module.exports = db
