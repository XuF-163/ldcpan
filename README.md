# LDC 内部网盘

基于 **Cloudflare Workers** 的内部网盘，集成：

- **身份认证**：[LINUX DO Connect](https://connect.linux.do)（OAuth2 + PKCE）
- **付费下载**：[LINUX DO Credit](https://credit.linux.do)（EasyPay 兼容协议，积分支付）
- **存储**：Cloudflare **R2**（文件 blob）+ **D1**（元数据/订单）+ **KV**（会话）
- **框架**：[Hono](https://hono.dev) + 原生 HTML/JS（无前端构建步骤）

---

## 功能

| 能力 | 说明 |
|---|---|
| 登录 | LINUX DO 账号 OAuth2 登录（强制 PKCE） |
| 浏览 | 文件列表、按分类筛选、搜索 |
| 上传 | **仅管理员**（`ADMIN_USERNAMES`），支持单文件定价/分类/描述 |
| 定价 | 文件单独定价 + 站点默认价兜底（`null`=默认价，`0`=免费，`>0`=单价） |
| 下载 | 免费文件直接下载；付费文件经 LINUX DO Credit 扣分后下载 |
| 收益 | 全部积分转入**站点单一商户号** |
| 防盗链 | 一次性短时下载令牌（10 分钟有效），支持 HTTP Range（大文件/续传） |
| 管理 | 改价 / 隐藏 / 删除（管理员） |
| **分享链接** | 管理员为任意文件生成公开分享链接 `/s/:id`，支持密码/有效期/次数限制；访客无需登录即可下载（免费）或支付（付费，积分归站点） |

---

## 前置准备

### 1. LINUX DO Connect（OAuth2）
1. 访问 https://connect.linux.do 登录后创建应用
2. 记录 **Client ID** 和 **Client Secret**
3. 回调地址填 `https://<你的域名>/auth/callback`

### 2. LINUX DO Credit（商户）
1. 访问 https://credit.linux.do 注册成为服务方
2. 记录 **商户 PID** 和 **商户密钥 KEY**
3. 异步通知地址指向 `https://<你的域名>/pay/notify`（代码里已用 `CREDIT_NOTIFY_URL`）

### 3. Cloudflare 资源
在 Cloudflare 控制台创建：
- **R2 bucket**（如 `ldcpan-files`）
- **D1 database**（如 `ldcpan-db`）
- **KV namespace**（如 `SESSIONS`）

---

## 测试

### 单元测试（无需 Cloudflare 账号）
直接导入 `src/` 真实模块，验证核心算法对照 Node crypto 黄金标准：
```bash
npm run test:unit
```
覆盖：MD5 实现、PKCE(S256)、HMAC-SHA256、EasyPay 签名（含 sign/sign_type 排除、空值剔除、验签）、计价规则、HTTP Range 解析。

### Mock 服务器 + 端到端联调
`mock-server.mjs` 模拟 LINUX DO Connect + Credit 的全部端点，无需真实第三方凭证。

**步骤 1：初始化本地数据库**（首次或 schema 变更后）
```bash
npm run db:init          # 等价 wrangler d1 execute ... --local
```

**步骤 2：开两个终端**
```bash
# 终端 A：启动 mock 服务器（端口 4000）
npm run mock

# 终端 B：启动 worker（端口 8787，自动读取 .dev.vars 指向 mock）
npm run dev
```

`.dev.vars` 已配置好：Connect 基址指向 `http://localhost:4000`，Credit 基址指向 `http://localhost:4000/epay`（EasyPay 网关前缀），测试商户 `PID=test_client KEY=test_secret`，测试用户 `alice`（管理员），`DEFAULT_PRICE=1`。

**步骤 3：浏览器访问 http://localhost:8787**，点击「使用 LINUX DO 登录」→ mock 自动放行 alice → 上传文件（管理员）→ 下载/付费。

> **关于 `wrangler dev`**：首次运行会要求 `wrangler login` 浏览器授权 Cloudflare 账号（用于创建本地 R2/D1/KV miniflare 实例）。这是 Cloudflare 的登录流程，与本项目的 mock 测试无关——mock 测试已验证所有业务逻辑，worker 代码本身未做任何改动即可在本地与 mock 联调。

### 已验证项（mock 联调）
| 项目 | 结果 |
|---|---|
| TypeScript 严格模式编译 | ✅ 0 错误 |
| MD5 实现对照 Node crypto（7 组向量 + 3 经典值） | ✅ 一致 |
| PKCE verifier/challenge（S256） | ✅ |
| HMAC-SHA256 会话签名 | ✅ |
| EasyPay 签名（排序/排除 sign/空值剔除/验签） | ✅ |
| 计价规则（null/0/正数/负数） | ✅ |
| HTTP Range 解析（start-len / start- / -suffix） | ✅ |
| **分享密码哈希**（hashPassword/verifyPassword） | ✅ |
| **shareStatus 判定**（吊销/过期/耗尽，含优先级） | ✅ |
| Mock Connect：authorize → code → token → userinfo | ✅ |
| Mock Credit：下单（验签）/ 查单 / 异步 notify | ✅ |
| 错误签名被拒绝（400） | ✅ |
| **登录态全闭环**（登录/上传/下载/令牌一次性/付费订单） | ✅ 52 项 e2e |
| **分享免费下载**（访客匿名） | ✅ |
| **分享密码保护**（错密码拒/对密码放行） | ✅ |
| **分享吊销** → 410 | ✅ |
| **分享次数耗尽** → 410 | ✅ |
| **分享付费订单** → notify → 结果页 → 倒计时下载 全闭环 | ✅ |

---

## 部署步骤

### 1. 克隆 & 安装
```bash
git clone <repo-url> && cd ldcpan
npm install
```

### 2. 创建 `wrangler.toml`
仓库不含真实部署配置（已 gitignore）。从模板复制并填写：
```bash
cp wrangler.example.toml wrangler.toml
```
替换其中的 `REPLACE_WITH_*`：
- `database_id`（D1）、`id`（KV namespace id）、`r2_buckets.bucket_name`（如已改名）
- `[vars]` 里的占位值：`SITE_BASE_URL`、`LDC_CLIENT_ID`、`LDC_REDIRECT_URI`、`CREDIT_PID`、各回调 URL、`ADMIN_USERNAMES`、`DEFAULT_PRICE`


### 3. 注入敏感密钥（不写入配置文件）
```bash
wrangler secret put LDC_CLIENT_SECRET      # LINUX DO Connect client secret
wrangler secret put CREDIT_KEY             # LINUX DO Credit 商户密钥
wrangler secret put SESSION_SECRET         # 随机长字符串，用于会话 cookie 签名
```
> `SESSION_SECRET` 建议 32+ 字符随机串，例如：`openssl rand -hex 32`

### 4. 初始化数据库
本地预览：
```bash
npm run db:init
```
远程（生产）：
```bash
npm run db:init:remote
```

### 5. 部署
```bash
npm run deploy
```

### 6. 设置管理员
把你的 LINUX DO 用户名（小写）填入 `ADMIN_USERNAMES`（逗号分隔），例如：
```toml
ADMIN_USERNAMES = "alice,bob"
```
重新 `npm run deploy` 生效。

---

## 本地开发
```bash
npm run dev
```
打开 http://localhost:8787。注意 OAuth 回调和支付回调需公网可达，本地联调时建议用 `cloudflared tunnel` 暴露。

---

## 环境变量速查

| 变量 | 类型 | 说明 |
|---|---|---|
| `SITE_NAME` | var | 站点名 |
| `SITE_BASE_URL` | var | 站点根 URL（无尾斜杠） |
| `DEFAULT_PRICE` | var | 默认积分单价（整数，0=免费） |
| `LDC_CLIENT_ID` | var | Connect Client ID |
| `LDC_REDIRECT_URI` | var | OAuth 回调地址 |
| `CREDIT_PID` | var | Credit 商户号 |
| `CREDIT_NOTIFY_URL` | var | 异步通知 URL |
| `CREDIT_RETURN_URL` | var | 同步跳转 URL |
| `ADMIN_USERNAMES` | var | 管理员用户名（逗号分隔，小写） |
| `LDC_CLIENT_SECRET` | **secret** | Connect Client Secret |
| `CREDIT_KEY` | **secret** | Credit 商户密钥 |
| `SESSION_SECRET` | **secret** | 会话签名密钥 |

---

## 路由总览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 文件列表（支持 `?category=`、`?q=`） |
| GET | `/f/:id` | 文件详情 |
| GET | `/upload` | 上传表单（管理员） |
| POST | `/upload` | 上传处理（管理员） |
| POST | `/f/:id/edit` | 改价/隐藏/改描述（管理员） |
| POST | `/f/:id/delete` | 删除文件（管理员） |
| GET | `/dl/free?file_id=` | 免费/已购文件签发令牌 |
| GET | `/dl/:token` | 消费令牌，流式下载 |
| GET | `/auth/login` | 发起 OAuth 登录 |
| GET | `/auth/callback` | OAuth 回调 |
| GET\|POST | `/auth/logout` | 登出 |
| GET | `/pay/create?file_id=` | 创建支付订单，返回自动提交表单跳转 Credit |
| GET\|POST | `/pay/notify` | Credit 异步通知（返回 `success`） |
| GET | `/pay/return` | Credit 同步跳转（展示等待页/结果页） |
| GET | `/pay/status?id=` | 订单状态查询（轮询） |
| GET | `/pay/done` | 支付结果页（文件名 + 下载按钮 + 3s 倒计时自动下载） |
| GET | `/health` | 健康检查 |
| GET | `/s/:id` | **公开**：分享提取页（访客可访问） |
| POST | `/s/:id` | **公开**：提交提取密码 |
| GET | `/s/:id/dl` | **公开**：免费文件分享下载 |
| GET | `/s/:id/pay` | **公开**：付费文件分享支付（匿名订单，返回提交表单） |
| GET | `/admin/shares` | 管理员：分享列表/创建表单 |
| POST | `/admin/shares` | 管理员：创建分享（文件/密码/有效期/次数） |
| POST | `/admin/shares/:id/revoke` | 管理员：吊销分享 |

---

## 安全设计要点

- **PKCE + state**：OAuth 强制 PKCE(S256)，state 经 HMAC 签名 cookie 透传，防 CSRF
- **会话 Cookie**：`HttpOnly` + `Secure` + `SameSite=Lax`，KV 带 7 天 TTL
- **回调验签**：`/pay/notify` 严格 MD5 验签 + 金额/订单号比对，幂等处理重复回调
- **下载令牌**：短时（10 分钟）一次性，`used` 标记防重放，R2 流式直读不落 Worker 内存
- **权限隔离**：所有写操作（上传/改价/隐藏/删除）均 gate 管理员会话

---

## 目录结构
```
wrangler.toml        # bindings + 非敏感配置
schema.sql           # D1 建表
src/
├── index.ts         # Hono app 入口
├── env.ts           # Bindings/Env 类型 + 配置解析
├── lib/
│   ├── crypto.ts    # PKCE/MD5/HMAC/随机/转义
│   └── render.ts    # HTML layout + 样式
├── auth/
│   ├── oauth.ts     # OAuth2 PKCE + userinfo
│   └── session.ts   # KV 会话 + 中间件
├── payment/
│   ├── epay.ts      # EasyPay 签名/下单/验签/查单
│   └── orders.ts    # 订单/购买记录/下载令牌
├── storage/
│   ├── r2.ts        # R2 put/get(Range)/delete
│   └── files.ts     # 文件元数据 CRUD
├── routes/
│   ├── auth.ts      # /auth/*
│   ├── files.ts     # / /f/:id /upload
│   ├── pay.ts       # /pay/*
│   └── download.ts  # /dl/*
└── views/           # list / detail / upload / pay
```

---

## 已核实的接入端点

### LINUX DO Connect（OIDC discovery）
- authorize: `https://connect.linux.do/oauth2/authorize`
- token: `https://connect.linux.do/oauth2/token`
- userinfo: `https://connect.linux.do/api/user`
- 强制 PKCE(S256)，scope `openid profile email`
- userinfo 返回 `sub / username / name / email / avatar_url / trust_level / active / silenced`

### LINUX DO Credit（EasyPay 兼容）
- 网关：`https://credit.linux.do/epay`
- 下单：`POST /pay/submit.php`（form 表单，必填 `pid/type/name/money/sign`）
- 查单：`GET /api.php?act=order&pid=&key=&out_trade_no=`
- 异步通知：GET 到 `notify_url`，**响应体必须返回 `success`**
- 签名：非空字段（排除 `sign`/`sign_type`）按 key ASCII 升序拼 `k1=v1&k2=v2`，末尾直接接商户密钥，整体 MD5 小写

---

## License
MIT
