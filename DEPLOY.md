# 部署指南（公网 · 多用户）

这份指南假设你是第一次部署 Node.js 应用，一步步跟着做就行。全程预计 30–60 分钟。

---

## 0. 开始前你需要准备

| 项目 | 说明 |
| --- | --- |
| **一台 Linux 服务器** | 阿里云轻量 / 腾讯云轻量 / 京东云 等，**Ubuntu 22.04** 系统。最低 1C1G；要用收件箱预览功能建议 **1C2G**（IMAP + mailparser 解析量大时容易吃内存） |
| **（可选）一个域名** | 没有也行，直接用 IP 访问；有域名才能配 HTTPS |
| **本项目代码** | 最好先 push 到 GitHub / Gitee，这样服务器上 `git clone` 就能拿到 |
| **一个终端** | Mac 自带「终端」，用 `ssh root@你的服务器IP` 连上去 |
| **允许出站的网络** | 后端需要主动访问：`login.microsoftonline.com:443`（刷新令牌）和 `outlook.office365.com:993`（IMAP）。**一些云厂商默认只开 80/443 出站，993 得手动放行** |

> **强烈建议买有域名的方案**。没有 HTTPS 的情况下，浏览器会警告，而且登录的密码是**明文**在网络上传的，不安全。域名 `.top` 一年 10 块钱左右就能搞到。

---

## 1. 连上服务器 & 装环境

```bash
# 在你 Mac 的终端里：
ssh root@你的服务器IP
# 输入密码（看云厂商的控制台重置过的那个）
```

### 1.1 装 Node.js 20（LTS）

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git nginx
node -v    # 应该输出 v20.x.x
```

### 1.2 装 pm2（让 Node 服务在后台常驻）

```bash
npm i -g pm2
```

### 1.3 验证出站端口（关系到「收件箱」能不能用）

```bash
# OAuth2（刷新 refresh_token）
nc -zv login.microsoftonline.com 443
# IMAP（拉收件箱和邮件正文）
nc -zv outlook.office365.com 993
```

两条都输出 `succeeded!` 才行。如果 993 超时：

1. 云厂商控制台 → 安全组 / 防火墙 → 出站规则 → 加一条 `TCP 993 0.0.0.0/0`
2. 服务器里：`ufw allow out 993/tcp`

不开 993 也能跟着文档部署，但前端「收件箱」按钮点开就是转圈 → `ETIMEDOUT`。

---

## 2. 拉代码 + 装依赖

```bash
# 把项目克隆到 /opt
cd /opt
git clone 你的仓库地址 ms-email-admin
cd ms-email-admin
```

### 2.1 后端

```bash
cd /opt/ms-email-admin/backend

npm install

# 生成 .env
cp .env.example .env
nano .env
```

把 `.env` 改成下面这样（**一定要改 `JWT_SECRET`！**）：

```dotenv
PORT=4000
NODE_ENV=production

# 用 openssl 自己生成一个 64 位随机字符串，不要用这里的示例！
# 在服务器上执行：openssl rand -hex 32
JWT_SECRET=请换成你自己的超长随机字符串
JWT_EXPIRES_IN=7d
```

> 快速生成 secret：`openssl rand -hex 32` 复制输出贴进去。

然后初始化数据库并启动：

```bash
node init_db.js                       # 幂等迁移：初始创表 或 补列 或 旧版 UNIQUE(email) 重建
pm2 start server.js --name ms-email-backend --update-env

# 设置开机自启
pm2 save
pm2 startup
# 它会输出一行 `sudo env PATH=... pm2 startup ...`，把那一行复制执行一次即可
```

### 2.2 前端打包

```bash
cd /opt/ms-email-admin/frontend
npm install
npm run build
# 打包产物在 frontend/dist/，nginx 待会就指向这里
```

---

## 3. 配置 nginx 对外服务

```bash
nano /etc/nginx/sites-available/ms-email
```

贴进去：

```nginx
server {
    listen 80;
    server_name 你的域名.com;            # 没有域名就写 _ （下划线）

    # 前端静态文件
    root /opt/ms-email-admin/frontend/dist;
    index index.html;

    # Vue Router 的 history 模式需要回退到 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 批量导入可能传较大 body
        client_max_body_size 10m;
    }
}
```

启用并重载：

```bash
ln -s /etc/nginx/sites-available/ms-email /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default   # 移除默认欢迎页
nginx -t                                 # 语法检查，应该输出 ok
systemctl reload nginx
```

---

## 4. 防火墙放行

```bash
# 云厂商后台（阿里云/腾讯云）→ 安全组，放行 80 端口
# 服务器里：
ufw allow 22    # SSH
ufw allow 80    # HTTP
ufw allow 443   # HTTPS（稍后加 SSL 要用）
ufw --force enable
```

现在浏览器访问 `http://你的域名.com` 或 `http://你的服务器IP` 应该已经能看到登录页了。

---

## 5. 加 HTTPS（强烈推荐）

有域名的话，Let's Encrypt 免费证书，3 分钟搞定：

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d 你的域名.com
# 按提示输入邮箱、同意条款；选 "2: Redirect HTTP to HTTPS"
```

certbot 会自动改好 nginx 配置 + 装上证书。之后 `https://你的域名.com` 就能访问，HTTP 自动跳 HTTPS。证书 90 天自动续期。

---

## 6. 验证

1. 浏览器打开你的域名，看到蓝紫渐变的登录页
2. 点 **「立即注册」**，创建第一个账号 —— **你是第一个注册的，自动成为 admin**
3. 进到 **邮箱管理**，批量导入几条测试
4. 对某一条点 **「刷新令牌」** → 「令牌 / 剩余」列应显示绿色「有效 59 分钟」（而不是「剩余 0 天」）
5. 点 **「收件箱」** → 3–8 秒内出来最近 20 封邮件列表；点任意一行 → 进入「邮件正文」详情。转圈超时 → 回看第 1.3 节，993 端口没开
6. 退出登录，点 **「游客登录·免注册体验」** → 能直接进面板（不需要输入用户名密码）
7. 再注册另一个账号 B，确认 **看不到 admin 的数据** ✅

---

## 日常维护速查

### 更新代码（后续你改了代码想重新部署）

```bash
cd /opt/ms-email-admin
git pull

cd backend
npm install                    # 新版可能加了依赖（如 imapflow / mailparser）
node init_db.js                # 幂等迁移，自动补列 / 升级索引
rm -f data/emails.db-journal   # 万一有重建表留下的旧 journal
pm2 restart ms-email-backend

cd ../frontend && npm install && npm run build
# nginx 不用重启，直接加载新的 dist
```

> `init_db.js` 是幂等的，不会清数据，每次都请跑一下以防新版有加列或加索引。

### 查看后端日志

```bash
pm2 logs ms-email-backend          # 实时日志
pm2 logs ms-email-backend --lines 200 --nostream   # 最近 200 行
```

### 重启后端

```bash
pm2 restart ms-email-backend
```

### 数据库备份（SQLite 文件）

```bash
# 一行命令备份到你 Mac（在 Mac 上执行）
scp root@你的服务器IP:/opt/ms-email-admin/backend/data/emails.db ~/Desktop/emails-$(date +%Y%m%d).db
```

建议设成 crontab 每天跑一次。

### 如果忘记账号了

连到服务器直接改数据库：

```bash
cd /opt/ms-email-admin/backend
node -e "
const db = require('./db');
const bcrypt = require('bcryptjs');
const newPassword = '新密码123';
const hash = bcrypt.hashSync(newPassword, 10);
db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, 'alice');
console.log('已重置 alice 密码为', newPassword);
"
```

---

## 常见坑

| 症状 | 原因 / 解决 |
| --- | --- |
| 访问域名显示 nginx 默认欢迎页 | 你没删 `/etc/nginx/sites-enabled/default` |
| 访问页面一直转圈，Network 里 /api 是 502 | 后端没起来，`pm2 status` 看状态，`pm2 logs` 看错误 |
| 登录后刷新页面跳 404 | nginx 配置里 `try_files ... /index.html` 写错 |
| 刚注册 / 登录后立刻掉线 | 服务器时钟不对，导致 JWT `iat` 非法。`timedatectl set-ntp true` |
| 接口报 `未登录：token 无效` 但我明明刚登录 | 上次改了 `JWT_SECRET` 没重启后端。`pm2 restart ms-email-backend` |
| 收件箱转圈 20 秒后报 `ETIMEDOUT` | 出站 993 没开，回看第 1.3 节 |
| 收件箱报 `AUTHENTICATE failed` | refresh_token consent 时的 scope 不包含 `IMAP.AccessAsUser.All`，该邮箱无法用 IMAP |
| 收件箱报 `AADSTS70008 / invalid_grant` | refresh_token 过期或被吊销，后端已自动把该邮箱标成 `invalid`，重新导入新 token 即可 |
| 邮件正文里链接点不动 | 旧版 iframe sandbox 太严。升级到最新代码后重构即可，链接会在新标签页打开 |
| 邮件正文图片显示破图 | HTML 邮件中的 `cid:` 内联图片本版未解析（属于已知限制） |
| 游客账号里看到别人的邮箱 | **符合预期**：guest 账号所有游客共用。要彻底关闭，把 `backend/routes/auth.js` 里的 `/guest` 路由整块删掉 + 重启后端 |

---

## 安全清单（部署后检查）

- [ ] `.env` 里的 `JWT_SECRET` 是随机 64 字符，不是默认值
- [ ] `/opt/ms-email-admin/backend/.env` 权限 `chmod 600`（只有 root 能看）
- [ ] `/opt/ms-email-admin/backend/data/emails.db` 权限 `chmod 600`（DB 里存了 refresh_token！）
- [ ] 服务器入站防火墙只开放 22 / 80 / 443
- [ ] 服务器出站放行 443 + **993**（IMAP）
- [ ] 域名已上 HTTPS（token 走 Authorization header，没 HTTPS 等于明文）
- [ ] SSH 用 key 登录、禁用 root 密码登录（可选但推荐）
- [ ] SQLite 数据库定时备份（crontab 每日 scp）
- [ ] 运行一次 `bash scripts/e2e_isolation.sh`，输出 **ALL GOOD — data isolation works**
- [ ] 如果对公网开放：上 nginx `limit_req` 限流或者套 Cloudflare，防止 `/api/emails/:id/messages` 被刷爆（每次调用会发起真实 IMAP 连接）
- [ ] 游客登录的定位清楚：`guest` 账号共享。如需完全隐私环境请删除 `POST /auth/guest` 路由

做完以上，你的系统就可以对外开放让其他人注册使用了。

---

## 验证数据隔离（回归测试）

仓库自带一个端到端脚本，模拟两个真实用户注册 → 导入 → 相互尝试删除/刷新 → 校验彼此看不到也改不到对方数据。

```bash
# 在服务器上（后端已通过 pm2 跑在 :4000）
cd /opt/ms-email-admin
API=http://localhost:4000/api bash scripts/e2e_isolation.sh
```

成功时最后一行输出：

```text
ALL GOOD — data isolation works
```

脚本跑完留下的测试账号叫 `qa_a_<时间戳>` / `qa_b_<时间戳>`，可以从数据库清掉：

```bash
cd /opt/ms-email-admin/backend
node -e "require('./db').prepare(\"DELETE FROM users WHERE username LIKE 'qa\\_%'\").run()"
```
