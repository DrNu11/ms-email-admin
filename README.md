# MS 邮箱管家

> 一套开放注册 + **数据相互隔离** 的微软邮箱批量管理后台。
>
> 用户可以批量导入 `邮箱 / 密码 / Client ID / Refresh Token`，查看状态、刷新令牌、**直接在网页里查看 Outlook 收件箱和邮件正文**、单条或批量删除；支持**游客免注册**体验。每个账号只能看到和操作自己导入的数据。

---

## 目录

- [功能亮点](#功能亮点)
- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [本地跑起来（60 秒）](#本地跑起来60-秒)
- [使用指南](#使用指南)
- [环境变量](#环境变量)
- [数据库 Schema](#数据库-schema)
- [API 完整参考](#api-完整参考)
- [数据隔离机制](#数据隔离机制)
- [公网部署](#公网部署)
- [常用运维命令](#常用运维命令)
- [常见坑](#常见坑)
- [安全须知](#安全须知)
- [许可](#许可)

---

## 功能亮点

| 模块 | 说明 |
| --- | --- |
| **用户系统** | 开放注册 / 密码登录 / JWT 无状态鉴权；首个注册用户自动成为 `admin`；提供 **游客登录** 免注册体验共享账号 |
| **批量导入** | 按字段数智能路由：**4 字段**（基础）/ **5 字段**（加 `expire_at`）/ **6 字段**（加 `access_token + expire_at`，未过期时直接复用，跳过首次刷新）。自动识别分隔符（`----`、`\|`、`,`、`\t` 等） |
| **邮箱管理** | 列表 + 关键词搜索 + 状态过滤 + 分页；令牌剩余以**时分自适应**显示（有效 58 分钟 / 将过期 12 分钟 / 需刷新），不再出现「剩余 0 天」的误导 |
| **批量删除** | 多选 + 二次确认；单条走 popconfirm |
| **令牌刷新** | 用 `refresh_token` 调微软 OAuth2 端点换新 `access_token`，成功更新 `token_expiry` + `refresh_token`，失败自动把邮箱标记为 `invalid` |
| **收件箱读取（IMAP）** | 点「收件箱」→ 后端用 refresh_token 换 IMAP access_token → 走 `XOAUTH2` 连 `outlook.office365.com:993` → FETCH 最近 20 封 envelope → 前端表格渲染（发件人 / 主题 / 时间 / 未读圆点） |
| **邮件正文查看** | 点任意邮件行 → 切到「详情」视图 → 后端 `fetchOne(source)` + **`mailparser`** 解析 HTML / 纯文本 / 附件元信息 → 前端用**沙盒 iframe** 安全渲染 HTML（禁 JS / 禁表单 / 允许链接在新标签打开） |
| **数据隔离** | 邮箱数据全部按 `user_id` 物理隔离；别人的 id 访问直接返 404（不泄漏存在性）；游客账号共用同一个 guest 分区 |

## 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | Node.js 20+、Express 4、better-sqlite3、jsonwebtoken、bcryptjs、axios、**imapflow**（IMAP 客户端）、**mailparser**（邮件 MIME 解析） |
| 前端 | Vue 3、Vite、Element Plus、vue-router、axios |
| 数据库 | SQLite（单文件 + WAL 模式） |
| 部署 | Ubuntu 22.04 + pm2 + nginx + Let's Encrypt（详见 `DEPLOY.md`） |

## 目录结构

```text
ms-email-admin/
├── backend/                                # Express + SQLite
│   ├── server.js                           # 应用入口（CORS / 路由挂载 / 根欢迎页）
│   ├── db.js                               # better-sqlite3 连接单例
│   ├── init_db.js                          # 幂等迁移脚本：users + emails 表
│   ├── middleware/auth.js                  # JWT 签发 & 校验
│   ├── routes/
│   │   ├── auth.js                         # /api/auth/register|login|guest|me
│   │   └── emails.js                       # /api/emails/* （全部带 requireAuth，含 IMAP 收件箱/正文）
│   ├── .env.example                        # 环境变量模板
│   └── data/emails.db                      # 运行时生成，已 gitignore
│
├── frontend/                               # Vue 3 + Vite + Element Plus
│   ├── vite.config.js                      # /api → :4000 代理
│   └── src/
│       ├── api/
│       │   ├── client.js                   # axios 实例 + 拦截器（401 → /login）
│       │   └── emails.js                   # listEmails / refreshEmail / fetchInbox / fetchMessage / ...
│       ├── stores/auth.js                  # login / register / loginAsGuest / logout
│       ├── router/index.js                 # 路由守卫：未登录跳 /login
│       ├── layouts/AppLayout.vue           # 侧边栏 + 顶部用户菜单
│       ├── components/
│       │   ├── ImportDialog.vue            # 批量导入弹窗
│       │   └── InboxDialog.vue             # 收件箱 ↔ 邮件详情 双视图
│       └── views/
│           ├── Login.vue                   # 登录页（含游客登录按钮）
│           ├── Register.vue
│           ├── Dashboard.vue
│           └── MailList.vue                # 邮箱列表主页
│
├── scripts/
│   └── e2e_isolation.sh                    # 数据隔离回归测试（HTTP 层）
│
├── start.sh                                # 本地一键启动（装依赖 → 初始化 DB → 起前后端）
├── stop.sh                                 # 本地一键停止
├── DEPLOY.md                               # 公网部署完整手把手指南
└── README.md                               # 你正在读这份
```

---

## 本地跑起来（60 秒）

### 方式 A：一键脚本（推荐）

```bash
# 在项目根
bash start.sh
```

脚本会自动：安装前后端依赖 → 生成 `backend/.env` → 初始化 SQLite → 后台起后端（`:4000`）→ 后台起前端（`:5173`）；日志分别在 `/tmp/ms-email-backend.log` 和 `/tmp/ms-email-frontend.log`。

停掉：

```bash
bash stop.sh
```

### 方式 B：手动（想看清每一步）

```bash
# 1. 后端
cd backend
cp .env.example .env
npm install
npm run init-db          # 生成 data/emails.db（只需跑一次）
npm run dev              # nodemon，改代码自动重启

# 2. 前端（新开一个终端）
cd frontend
npm install
npm run dev
```

打开 **<http://localhost:5173>** → 首次访问被路由守卫踢到 `/login`，可以选：

- 右上「立即注册」注册一个账号（第一个注册用户自动是 `admin`）
- 或者直接点**游客登录·免注册体验**按钮一键进入

> **提示**：直接访问 <http://localhost:4000> 看到的是后端 API 欢迎页，不是前端。

---

## 使用指南

### 注册 / 登录 / 游客

- **注册**：用户名 3-20 位（字母/数字/下划线/中文），密码 ≥ 6 位。第一个注册成功的人自动获得 `admin` 角色。
- **登录**：凭用户名 + 密码换 JWT，token 默认 7 天有效，存在浏览器 `localStorage`。
- **游客登录**：点登录页底部 **「游客登录·免注册体验」** 按钮，后端会幂等创建/登录 `username=guest` 的共享账号。⚠️ **游客账号所有人共用**，导入的数据对其他游客可见，请勿使用真实凭证体验。
- **退出**：右上角头像菜单 → 退出登录，清空 `localStorage`。

### 批量导入

点右上 **「批量导入」** 弹出对话框。后端按**字段数自动路由**，一种解析器同时支持三种格式：

| 字段数 | 格式 | 行为 |
| --- | --- | --- |
| **4** | `邮箱----密码----client_id----refresh_token` | 基础版本。导入后「令牌 / 剩余」显示「未刷新」，点「刷新令牌」或「收件箱」时才实际调 MS 端点 |
| **5** | `邮箱----密码----client_id----refresh_token----expire_at` | 多一个 `expire_at`（Unix 秒或毫秒）。后端自动辨识秒/毫秒；仅存入 `token_expiry`，仍需首次刷新才能拿到 access_token |
| **6** | `邮箱----密码----client_id----refresh_token----access_token----expire_at` | **推荐**。后端将 access_token + expire_at 一同入库；若 `expire_at > now+60s`，点「收件箱」直接复用缓存令牌，**跳过首次 refresh**，避免为新号触发 MS 的风控模型 |

- 分隔符：默认自动识别（依次试 `-----` / `----` / `---` / `||` / `::` / `\t` / `,`），可用 `?sep=` query 参数或弹窗输入框手动指定
- 同一用户不能重复导入相同邮箱（`UNIQUE(user_id, email)`）；**不同用户之间互不影响**
- 后端返回 `{ok, separator, imported, inserted, updated, withAccessToken, skipped[]}`；`withAccessToken` 是本次导入中带有有效 access_token 的行数，用户可直观确认哪些行跳过了首次刷新
- `expire_at` 容错：> 1e12 视为毫秒自动除 1000；非数 / 负数 / 0 则当作缺省

### 令牌刷新与过期语义

列表里 **「令牌 / 剩余」** 这一列的语义有点特殊，读一下这小节避免误会：

- `token_expiry` 存的是 **access_token 过期时间**（Unix 秒）
- 微软返回的 `expires_in` 通常是 **3600 秒**（1 小时），所以刚刷过的邮箱也最多显示「有效 59 分钟」
- **不是 refresh_token 的剩余寿命**。refresh_token 无显式过期，会在每次刷新时滚动替换

显示分档：

| 状态 | 标签颜色 | 文案 |
| --- | --- | --- |
| 未刷新过（`token_expiry` 为空） | info（灰） | 未刷新 |
| 已过期 | danger（红） | 已过期 X 分钟 / X 小时 … |
| < 5 分钟 | danger（红） | 需刷新（X 分钟） |
| 5–30 分钟 | warning（黄） | 将过期 X 分钟 |
| > 30 分钟 | success（绿） | 有效 X 小时 Y 分 |

### 查看收件箱与邮件正文

#### 打开收件箱

点某行的 **「收件箱」** 按钮：

1. 前端 → `GET /api/emails/:id/messages?top=20`
2. 后端用 `refresh_token` 调 `login.microsoftonline.com` 换一个新的 `access_token`（IMAP scope）
3. 用 `imapflow + XOAUTH2` 连 `outlook.office365.com:993`
4. `mailbox.open('INBOX')` → FETCH 最近 20 封的 envelope + flags
5. 返回 `{total, messages:[{uid, subject, from, date, seen}]}`

列表视图里点任意一行会跳到详情视图。

#### 打开邮件正文

1. 前端 → `GET /api/emails/:id/messages/:uid`
2. 后端 `fetchOne(uid, {source:true}, {uid:true})` 拿到原始 RFC822 报文
3. 用 `mailparser.simpleParser` 解析出 `{subject, from, to, cc, date, html, text, attachments}`
4. 顺手 `messageFlagsAdd(["\\Seen"])` 标为已读
5. 前端把 `html` 注入**沙盒 iframe**（`sandbox="allow-popups allow-popups-to-escape-sandbox"`）渲染：
   - 不允许执行 JavaScript、不允许表单提交
   - 允许 `<a>` 链接在新标签页打开
   - 注入基础 CSS 让排版友好

#### 常见限制

- **本版只展示附件元信息（文件名 / 大小）**，不做附件下载
- **cid 内联图片**（`<img src="cid:...">`）暂不解析，会显示破图
- **所有请求走后端代理 IMAP**——前端看不到 `access_token`，不会泄漏到浏览器
- IMAP 访问要求 refresh_token 当时 consent 的 scope 包含 `IMAP.AccessAsUser.All`；如果只 consent 了 Graph 等其他 scope，会返回 502 `AUTHENTICATE failed`

---

## 环境变量

`backend/.env`（从 `.env.example` 复制后按需改）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `4000` | 后端监听端口 |
| `NODE_ENV` | `development` | 生产改成 `production` |
| `JWT_SECRET` | `dev-insecure-...` | **上线前务必改成随机 64 位**：`openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | `7d` | Token 有效期，支持 `7d` / `24h` / `3600s` |
| `MS_TOKEN_ENDPOINT` | `https://login.microsoftonline.com/common/oauth2/v2.0/token` | 微软 token 端点，一般不改 |

改 `JWT_SECRET` 后**所有已签发的 token 全部失效**，所有用户需要重新登录（这就是它叫 secret 的原因）。

---

## 数据库 Schema

SQLite 文件位于 `backend/data/emails.db`，启用 **WAL 模式**。`backend/init_db.js` 是幂等迁移脚本，多次运行安全。

### `users`

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INTEGER PK | 自增 |
| `username` | TEXT UNIQUE | 3-20 位字母/数字/下划线/中文 |
| `password_hash` | TEXT | bcrypt (cost=10) |
| `role` | TEXT | `admin` \| `user`（首个注册的人自动 admin） |
| `created_at / updated_at` | DATETIME | ISO-8601（触发器自动更新 `updated_at`） |

### `emails`

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INTEGER PK | 自增 |
| `email` | TEXT | 邮箱地址 |
| `password` | TEXT | 邮箱原始密码（明文存储，见[安全须知](#安全须知)） |
| `client_id` | TEXT | Azure 应用的 client_id |
| `refresh_token` | TEXT | 微软 OAuth2 refresh_token，每次刷新会滚动替换 |
| `access_token` | TEXT | 缓存的 access_token。导入时带入或刷新时写入；`getUsableAccessToken()` 优先读它，避免无谓 refresh |
| `token_expiry` | INTEGER | access_token 过期 Unix 秒。与 `access_token` 配合判断缓存是否有效 |
| `status` | TEXT | `active` \| `invalid` \| `disabled` |
| `user_id` | INTEGER | 归属用户（`NULL` = 历史孤儿行，不会显示给任何人） |

索引：

- `idx_emails_status` / `idx_emails_expiry` / `idx_emails_user`
- `UNIQUE(user_id, email) WHERE user_id IS NOT NULL` —— 同一用户不重复导入，但**不同用户可以各自持有同一邮箱**

### 迁移

`init_db.js` 会自动做：

1. 新增缺失列：`user_id`、`access_token`
2. 若检测到旧版全局 `UNIQUE(email)` 约束 → 重建表剥离（事务中 COPY → DROP → RENAME）
3. 确保 `UNIQUE(user_id, email)` 联合索引存在

---

## API 完整参考

- **全部请求** 基础路径：`/api`
- **除 `/api/auth/*` 与 `/api/health` 外**，所有接口都需要请求头：`Authorization: Bearer <token>`
- 请求/响应 Content-Type 默认 `application/json`

### 认证 `/api/auth`

| 方法 | 路径 | 请求体 | 说明 |
| --- | --- | --- | --- |
| POST | `/auth/register` | `{username, password}` | 注册。首个用户自动 `admin`。返回 `{ok, user, token}` |
| POST | `/auth/login` | `{username, password}` | 登录。返回 `{ok, user, token}` |
| POST | `/auth/guest` | —（空 body） | 游客登录。幂等创建/登录共享 `guest` 账号。返回 `{ok, guest:true, user, token}` |
| GET | `/auth/me` | — | 返回当前 token 对应的 `{ok, user}` |

错误示例：

- `400` → `{error: "用户名必须是 3-20 位..."}`（入参非法）
- `401` → `{error: "用户名或密码错误"}`
- `409` → `{error: "用户名已被占用"}`（注册冲突）

### 邮箱 `/api/emails`

| 方法 | 路径 | 入参 | 说明 |
| --- | --- | --- | --- |
| POST | `/emails/import` | `text/plain` 粘贴 或 `{text}` / `{content}`（query `?sep=----` 可覆盖分隔符） | 批量导入，按字段数自动识别 4/5/6 种格式。返回 `{ok, separator, imported, inserted, updated, withAccessToken, skipped:[{line, reason}]}`；`withAccessToken` 是本次导入中自带有效 access_token（`expire_at > now+60s`）的行数 |
| GET | `/emails` | `?page=&pageSize=&search=&status=` | 分页列表。返回 `{list, total, page, pageSize}` |
| POST | `/emails/refresh` | `{id}` | 刷新指定邮箱的令牌。成功 `{ok, expiresIn}`；失败自动把该邮箱置 `status=invalid` |
| GET | `/emails/:id/messages` | query `?top=20` | **拉取收件箱**（IMAP）。返回 `{ok, total, messages:[{uid, subject, from, date, seen}]}` |
| GET | `/emails/:id/messages/:uid` | — | **读取单封邮件正文**。返回 `{ok, message:{subject, from, to, cc, date, html, text, attachments:[{filename,contentType,size}]}}` |
| DELETE | `/emails/:id` | — | 删除单条 |
| POST | `/emails/batch-delete` | `{ids:number[]}` | 批量删除。返回 `{ok, deleted, requested}` |

IMAP 相关 502 错误示例：

- `{ok:false, error:"刷新令牌失败：AADSTS70008 ..."}` → refresh_token 过期 / 被吊销
- `{ok:false, error:"收件箱获取失败：AUTHENTICATE failed"}` → scope 不含 `IMAP.AccessAsUser.All`
- `{ok:false, error:"收件箱获取失败：connect ETIMEDOUT"}` → 出站 993 被防火墙挡

### 杂项

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 `{ok:true, time}` |
| GET | `/` | 后端欢迎页（HTML） |

---

## 数据隔离机制

本系统从 **数据库 → API → 前端** 三层保证用户数据隔离：

1. **数据库层**：`emails` 表带 `user_id` + 联合唯一索引 `(user_id, email)`，同一份邮箱允许不同用户各自导入一份，互不干扰
2. **API 层**：所有 `/api/emails/*` 路由都经过 `requireAuth`，SQL 全部带 `WHERE id = ? AND user_id = ?`
3. **攻击防护**：别人的 `id` 被操作时**直接返回 `404 邮箱不存在`**（而非 `403`），连"这条是别人的"这个信息都不泄漏

### 回归测试

```bash
# 后端需在跑
API=http://localhost:4000/api bash scripts/e2e_isolation.sh
```

脚本会自动：

- 注册两个新账号 A / B
- A 导入 2 条、B 导入 1 条
- B 尝试删 / 刷新 / 批删 A 的数据
- 断言：B 的攻击应全部 `HTTP 404` 且 A 的数量保持不变

看到最后一行 **`ALL GOOD — data isolation works`** 就算通过。

---

## 公网部署

> 完整手把手版本在 **[`DEPLOY.md`](./DEPLOY.md)**（从买服务器到 HTTPS 全流程，1 小时内能跑通）。下面是浓缩主线。

### 架构

```text
用户浏览器
   │ HTTPS
   ▼
[ nginx :443 ]──── 静态文件 ────▶ /opt/ms-email-admin/frontend/dist
   │
   └── /api/ 反向代理 ──▶ [ pm2: node server.js :4000 ]
                                    │
                                    ▼
                           /opt/ms-email-admin/backend/data/emails.db

          出站 ──▶ login.microsoftonline.com:443 （OAuth2 刷新令牌）
          出站 ──▶ outlook.office365.com:993    （IMAP over TLS）
```

### 主线六步

1. **服务器**：Ubuntu 22.04 最低 1C1G（有 IMAP 拉收件箱建议 1C2G）；装 `Node.js 20` + `git` + `nginx` + `pm2`
2. **拉代码**：`git clone ... /opt/ms-email-admin`
3. **后端**：

   ```bash
   cd /opt/ms-email-admin/backend
   cp .env.example .env && vim .env    # 改 JWT_SECRET / NODE_ENV=production
   npm ci --omit=dev
   node init_db.js
   pm2 start server.js --name ms-email-backend && pm2 save
   ```

4. **前端**：

   ```bash
   cd /opt/ms-email-admin/frontend
   npm ci
   npm run build                        # 产物在 frontend/dist
   ```

5. **nginx**：反代 `/api` 到 `127.0.0.1:4000`，`/` 托管 `frontend/dist`（模板在 `DEPLOY.md`）
6. **HTTPS**：`certbot --nginx -d 你的域名` 一键证书 + 自动续期

### ⚠️ 防火墙 / 安全组必须放行出站

收件箱功能需要后端能主动连外：

| 目标 | 端口 | 用途 |
| --- | --- | --- |
| `login.microsoftonline.com` | 443 | 刷新 OAuth2 令牌 |
| `outlook.office365.com` | **993** | IMAP over TLS |

若云厂商默认只放行 443/80 出站，收件箱会 `ETIMEDOUT`，解决：安全组出站规则加 993。

### 更新部署

```bash
cd /opt/ms-email-admin
git pull
cd backend  && npm ci --omit=dev && node init_db.js
cd ../frontend && npm ci && npm run build
pm2 restart ms-email-backend
```

`init_db.js` 是幂等的，不会清数据，重复跑没副作用。

---

## 常用运维命令

```bash
# 看后端日志（含 IMAP 错误栈）
pm2 logs ms-email-backend --lines 200 --nostream

# 重启后端
pm2 restart ms-email-backend

# 备份 SQLite（从 Mac 拉回来）
scp root@你的服务器IP:/opt/ms-email-admin/backend/data/emails.db \
    ~/Desktop/emails-$(date +%Y%m%d).db

# 重置用户密码（服务器端直接改 DB）
cd /opt/ms-email-admin/backend
node -e "
const db=require('./db'), bcrypt=require('bcryptjs');
db.prepare('UPDATE users SET password_hash=? WHERE username=?')
  .run(bcrypt.hashSync('新密码123', 10), 'alice');
console.log('done');"

# 清理隔离测试留下的 qa 账号
cd /opt/ms-email-admin/backend
node -e "require('./db').prepare(\"DELETE FROM users WHERE username LIKE 'qa\\_%'\").run()"

# 手动删除 guest 账号（例如游客数据被污染想清空）
cd /opt/ms-email-admin/backend
node -e "
const db=require('./db');
const u = db.prepare(\"SELECT id FROM users WHERE username='guest'\").get();
if(u){
  db.prepare('DELETE FROM emails WHERE user_id=?').run(u.id);
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  console.log('guest wiped');
} else console.log('no guest');"

# 测试 IMAP 出站连通性
nc -zv outlook.office365.com 993
```

---

## 常见坑

| 症状 | 原因 / 解决 |
| --- | --- |
| 访问 `localhost:4000` 显示 `{"error":"Not Found: GET /"}` | 你访问的是后端端口。前端在 `:5173`（根路径已有友好欢迎页） |
| 前端页面一直转圈、Network 里 `/api/*` 红 | 后端没起来：`pm2 status` / 本地看 `backend/` 终端 |
| 刚注册登录立刻被踢下线 | 服务器时间不对导致 JWT `iat` 非法：`timedatectl set-ntp true` |
| 提示 `未登录：token 无效` 但刚登录过 | 改了 `JWT_SECRET` 却没重启后端：`pm2 restart ms-email-backend` |
| 导入时有行被跳过 | 响应里 `skipped[].reason` 会写明原因（字段不足 / 分隔符识别失败） |
| 登录后刷新页面变 404 | nginx 少了 `try_files $uri $uri/ /index.html;` |
| 令牌剩余一直显示「剩余 0 天」 | 旧版本 bug，已改成分/时自适应（有效 58 分钟）。如果还看到，`git pull && npm run build` 一下前端 |
| 收件箱点开转圈 > 30 秒后报超时 | 出站 993 被封。`nc -zv outlook.office365.com 993` 验证 |
| 收件箱报 `AUTHENTICATE failed` | refresh_token 当时 consent 的 scope 不含 `IMAP.AccessAsUser.All`，无法拉 IMAP |
| 收件箱报 `invalid_grant / AADSTS70008` | refresh_token 过期 / 被吊销，该邮箱会自动置 `invalid`，需换 token 重新导入 |
| 邮件正文里图片显示破图 | 是 `cid:xxx` 内联图片，本版暂不解析内联附件 |
| 邮件里的链接点不动 | 旧版 sandbox 太严导致。已经改成 `allow-popups allow-popups-to-escape-sandbox`，点击会在新标签页打开 |
| 游客登录发现里面有别人的邮箱 | **符合预期**：游客账号所有人共用，互相能看到。需独立环境请正常注册 |

---

## 安全须知

这是"自用 / 小团队内部使用"定位的工具，上线时请自行评估下面几点：

- **邮箱密码明文存储**：`emails.password` 列不加密。因为微软 OAuth2 刷新只需要 `client_id + refresh_token`，`password` 列实际上更多是"存一份凭据记录"。如果介意，可改成空或加一层加密。
- **refresh_token 相当于长期凭据**：泄漏后可以长期冒用该邮箱读取/发送邮件。数据库文件 `backend/data/emails.db` 请务必：
  - 设置服务器文件权限 `chmod 600`
  - 备份时加密传输（`scp`、不走公网明文）
  - 不要把 DB 文件提交到 git（`.gitignore` 已经配好）
- **JWT_SECRET 必须替换**：`.env.example` 里的默认值仅用于本地开发，上线前用 `openssl rand -hex 32` 生成后写入 `.env`
- **游客账号是共享的**：`POST /api/auth/guest` 始终登录到同一个 `username=guest` 用户。如果不想要这个"特性"，可以把 `backend/routes/auth.js` 里的 `/guest` 路由整块删除
- **HTTPS 必装**：token 走 Authorization header，没有 HTTPS 就等于明文
- **邮件正文 iframe 沙箱**：HTML 邮件用 `sandbox="allow-popups allow-popups-to-escape-sandbox"` 渲染；JS 不执行、表单不能提交。若需要更严的 CSP 可在 nginx 加 `Content-Security-Policy` 响应头
- **CORS**：后端默认允许所有来源（本地开发友好），上线时建议在 `backend/server.js` 里把 `cors()` 收紧到具体域名
- **限流**：当前**未加限流**。若上线并对公网开放，建议在 nginx 层加 `limit_req` 或接入 Cloudflare WAF，避免接口被刷爆（尤其 `/api/emails/:id/messages` 每次会发起真实 IMAP 连接）

---

## 许可

仅供学习与内部使用，请勿用于违反微软服务条款的批量操作。
