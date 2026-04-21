/**
 * SQLite 数据库初始化脚本
 * 运行：npm run init-db
 * 幂等：可重复执行，已有表不会被清空。
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

db.exec(`
  ---------- users 表 ----------
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER  PRIMARY KEY AUTOINCREMENT,
    username       TEXT     NOT NULL UNIQUE,
    password_hash  TEXT     NOT NULL,
    role           TEXT     NOT NULL DEFAULT 'user',   -- 'admin' | 'user'
    created_at     DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at     DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
  AFTER UPDATE ON users
  FOR EACH ROW
  BEGIN
    UPDATE users
       SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = OLD.id;
  END;

  ---------- emails 表 ----------
  CREATE TABLE IF NOT EXISTS emails (
    id             INTEGER  PRIMARY KEY AUTOINCREMENT,
    email          TEXT     NOT NULL,
    password       TEXT     NOT NULL DEFAULT '',
    client_id      TEXT     NOT NULL DEFAULT '',
    refresh_token  TEXT     NOT NULL DEFAULT '',
    access_token   TEXT     NOT NULL DEFAULT '',        -- 缓存的 access_token，配合 token_expiry 验证时效
    token_expiry   INTEGER,                            -- Unix 秒时间戳
    status         TEXT     NOT NULL DEFAULT 'active', -- active | invalid | disabled
    user_id        INTEGER,                            -- 归属用户（NULL = 旧数据/孤儿）
    created_at     DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at     DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_emails_status  ON emails(status);
  CREATE INDEX IF NOT EXISTS idx_emails_expiry  ON emails(token_expiry);

  CREATE TRIGGER IF NOT EXISTS trg_emails_updated_at
  AFTER UPDATE ON emails
  FOR EACH ROW
  BEGIN
    UPDATE emails
       SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = OLD.id;
  END;
`)

// ---------- 幂等迁移：追加缺失字段 ----------
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.find((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
    console.log(`  ↳ 已为 ${table} 追加列 ${column}`)
  }
}
ensureColumn("emails", "user_id", "user_id INTEGER")
ensureColumn("emails", "access_token", "access_token TEXT NOT NULL DEFAULT ''")

// ---------- 幂等迁移：剥离旧版 UNIQUE(email) 全局约束 ----------
// 旧版 CREATE TABLE emails 里写的是 `email TEXT NOT NULL UNIQUE`，
// 导致多个用户无法导入同一个邮箱。SQLite 不支持直接 DROP 这种约束，
// 只能重建表（copy → drop → rename）。
const legacySql =
  db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'emails'")
    .get()?.sql || ""
const hasLegacyUnique = /email\s+TEXT\s+NOT NULL\s+UNIQUE/i.test(legacySql)

if (hasLegacyUnique) {
  console.log("  ↳ 检测到旧版 UNIQUE(email)，正在重建 emails 表 ...")
  db.transaction(() => {
    db.exec(`
      CREATE TABLE emails_new (
        id             INTEGER  PRIMARY KEY AUTOINCREMENT,
        email          TEXT     NOT NULL,
        password       TEXT     NOT NULL DEFAULT '',
        client_id      TEXT     NOT NULL DEFAULT '',
        refresh_token  TEXT     NOT NULL DEFAULT '',
        access_token   TEXT     NOT NULL DEFAULT '',
        token_expiry   INTEGER,
        status         TEXT     NOT NULL DEFAULT 'active',
        user_id        INTEGER,
        created_at     DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at     DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      INSERT INTO emails_new
        (id, email, password, client_id, refresh_token, access_token, token_expiry, status, user_id, created_at, updated_at)
      SELECT
        id, email, password, client_id, refresh_token, access_token,
        token_expiry, status, user_id, created_at, updated_at
      FROM emails;
      DROP TABLE emails;
      ALTER TABLE emails_new RENAME TO emails;
      CREATE INDEX idx_emails_status ON emails(status);
      CREATE INDEX idx_emails_expiry ON emails(token_expiry);
      CREATE INDEX idx_emails_user   ON emails(user_id);
      CREATE TRIGGER trg_emails_updated_at
      AFTER UPDATE ON emails
      FOR EACH ROW
      BEGIN
        UPDATE emails SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
      END;
    `)
  })()
  console.log("  ↳ emails 表已升级")
}

// 现在 user_id 列肯定存在了，再创建相关索引
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_emails_user ON emails(user_id);

  -- 联合唯一索引：同一用户内邮箱唯一；user_id 为 NULL 的孤儿行不占用
  CREATE UNIQUE INDEX IF NOT EXISTS uq_emails_user_email
    ON emails(user_id, email)
    WHERE user_id IS NOT NULL;
`)

const emailCount = db.prepare("SELECT COUNT(*) AS c FROM emails").get().c
const userCount = db.prepare("SELECT COUNT(*) AS c FROM users").get().c
const orphanCount = db.prepare("SELECT COUNT(*) AS c FROM emails WHERE user_id IS NULL").get().c

console.log(`✓ SQLite 数据库就绪：${DB_PATH}`)
console.log(`  users     : ${userCount}`)
console.log(`  emails    : ${emailCount} （孤儿 ${orphanCount} 条，不会显示给任何用户）`)

db.close()
