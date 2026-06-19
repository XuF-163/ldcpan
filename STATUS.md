# 工作状态（STATUS）

> 记录当前项目的运行状态、近期变更与验证结果。供接手开发或回顾进度时快速对齐。
> 最后更新：2026-06-19

---

## 一、当前运行状态：✅ 生产可用

- **生产域名**：`https://<你的域名>`（Cloudflare 自定义域名 / workers.dev）
- **最近部署**：见 `wrangler deploy` 输出的 Version ID
- **管理员账号**：由 `ADMIN_USERNAMES` 配置（你的 LINUX DO 用户名，小写）
- **登录**：LINUX DO Connect OAuth2（PKCE）已跑通
- **付费下载**：LINUX DO Credit（EasyPay）已跑通
- **分享链接**：管理员创建、密码/有效期/次数限制、访客匿名下载/付费，全闭环

> 说明：本文档不记录任何具体的部署域名 / 账号 / ID。部署到自己的环境后，将真实值填入 `wrangler.toml`（非敏感）与 `wrangler secret put`（敏感）即可。

### 生产密钥（均通过 secret 注入，**不写入代码/配置文件**）
| secret | 用途 |
|---|---|
| `LDC_CLIENT_SECRET` | Connect OAuth2 client secret |
| `CREDIT_KEY` | Credit EasyPay 商户密钥 |
| `SESSION_SECRET` | 会话 cookie / state 签名密钥 |

---

## 二、功能清单

### ✅ 已完成并验证
| 模块 | 说明 |
|---|---|
| 登录 | LINUX DO Connect OAuth2 + PKCE(S256)，state HMAC 签名防 CSRF |
| 会话 | KV 存储，HttpOnly+Secure+SameSite=Lax Cookie，7 天 TTL |
| 文件浏览 | 列表、分类筛选、搜索 |
| 上传 | **仅管理员**，支持单文件定价/分类/描述 |
| 定价 | 双模型：文件单独定价（`null`=默认价，`0`=免费，`>0`=自定价）+ 站点默认价兜底 |
| 下载 | R2 流式 + 一次性短时令牌（10 分钟），支持 HTTP Range（大文件/续传） |
| 付费下载 | EasyPay 协议：下单表单 → 用户扣分 → 异步 notify 验签发货 → 结果页 → 下载 |
| **支付结果页** | 支付完成后**先到结果页**（展示文件名/订单号 + 下载按钮），3 秒倒计时后自动下载，期间可手动点按钮立即下载 |
| 收益 | 全部积分转入站点单一商户号 |
| 管理 | 改价 / 隐藏 / 删除（管理员） |
| 分享链接 | 管理员为任意文件生成公开链接 `/s/:id`；支持密码/有效期/次数限制；访客无需登录 |
| 分享付费 | 访客匿名付费，积分归站点，下载走结果页 |
| 防盗链 | 令牌一次性 + 时效；share 吊销/过期/耗尽自动 410 |

---

## 三、近期重要变更（2026-06-19）

### 1. 支付协议：从误用的 OAuth2 回退到正确的 EasyPay
**背景**：早期支付报 `签名验证失败`，曾一度误判为"协议用错"，把支付层重写成 OAuth2（导致 `credit.linux.do/oauth2/authorize` 返回 `Page Not Found`）。核实官方文档（https://credit.linux.do/docs/api）后确认 **Credit 是 EasyPay 协议，不是 OAuth2**。

**根因**：金额 `money` 在签名时用的是原始数字（如 `10`），平台按规范化字符串校验，二者不一致 → 签名失败。

**修复**：
- 新增 `formatMoney()` 把积分统一格式化为 `"N.00"`（如 `"3.00"`），保证**签名串、提交表单、回调返回值三者完全一致**
- 删除错误的 `src/payment/credit.ts`（OAuth2 实现）
- `src/payment/epay.ts` 新增 `buildSubmitFormHtml()`（EasyPay 要求 POST 提交，返回自动 submit 的表单页）、`name` 截断到 64 字符
- `src/routes/pay.ts` 回退到 EasyPay：`/create`（提交表单）+ `/notify`（GET/POST 异步验签，回 `success`）+ `/return`（等待页）+ `/done`（发货）+ `/status`（轮询）
- `src/routes/share.ts` `/:id/pay` 回退到 `buildOrderParams`
- `mock-server.mjs` 回退到 EasyPay：`submit.php` 验签 + 异步 notify + `api.php` 查单
- `.dev.vars` 回退到 EasyPay 配置（`CREDIT_BASE` 带 `/epay` 前缀）

### 2. 支付结果页优化（本次会话）
**需求**：支付完成后不要直接跳下载，而是**先回到网盘结果页，再开始下载**。

**实现**：
- `src/views/pay.ts` `renderResult` 升级：展示文件名/订单号 + 「立即下载」按钮 + 3 秒倒计时自动下载，返回按钮按场景回到文件列表（登录用户）或分享提取页（访客）
- `src/routes/pay.ts` `/done` 统一两条路径：登录用户订单和分享访客订单**都走结果页**（此前访客是直接 302 跳 `/dl/`，无中间页面）；`finalize` 简化为统一跳 `/pay/done`

---

## 四、测试与验证

### 测试脚本（`package.json`）
| 命令 | 说明 |
|---|---|
| `npm run test:unit` | 纯逻辑单元测试（tsx 运行，无需 wrangler） |
| `npm run test:local` | 端到端（需先起 mock + wrangler dev） |
| `npm run test:share` | 分享付费专项（需先起 mock + wrangler dev） |
| `npm run typecheck` | `tsc --noEmit` |

### 当前结果（2026-06-19）
| 项目 | 结果 |
|---|---|
| TypeScript 严格模式 | ✅ 0 错误 |
| 单元测试 | ✅ **58 通过 / 0 失败** |
| 端到端 e2e | ✅ **52 通过 / 0 失败** |
| 分享付费专项 | ✅ **5 通过 / 0 失败** |
| 生产付费下载 | ✅ 用户实测可用 |

### 单元测试覆盖
MD5 对照 Node crypto（黄金标准）、base64url、PKCE(S256)、HMAC-SHA256、timingSafeEqual、**EasyPay sign/verifySign/formatMoney**（含黄金向量对照 Node MD5、篡改/错误密钥检测）、计价规则、HTTP Range 解析、分享密码哈希、shareStatus 判定。

### e2e 测试覆盖（T1–T11）
健康检查、登录全闭环、管理员上传、免费下载、令牌一次性、付费订单（EasyPay 异步 notify）、结果页展示、分享免费下载/密码/吊销/次数限制。

### 本地联调方式
```bash
# 终端 A
npm run mock          # mock server :4000（Connect + EasyPay Credit）

# 终端 B（首次需 wrangler login）
npm run db:init       # 初始化本地 D1
npm run dev           # wrangler dev :8787，自动读 .dev.vars 指向 mock
```
mock 用户 `alice`（管理员），测试商户 `PID=test_client KEY=test_secret`。

---

## 五、接入端点（已核实）

### LINUX DO Connect（OIDC）
- authorize: `https://connect.linux.do/oauth2/authorize`
- token: `https://connect.linux.do/oauth2/token`
- userinfo: `https://connect.linux.do/api/user`
- 强制 PKCE(S256)，scope `openid profile email`

### LINUX DO Credit（EasyPay 兼容）
- 网关：`https://credit.linux.do/epay`
- 下单：`POST /pay/submit.php`（form 表单，必填 `pid/type/name/money/sign`）
- 查单：`GET /api.php?act=order&pid=&key=&out_trade_no=`
- 异步通知：GET 到 `notify_url`，**响应体必须返回 `success`**
- 签名：非空字段（排除 `sign`/`sign_type`）按 key ASCII 升序拼 `k1=v1&k2=v2`，末尾直接接商户密钥，整体 MD5 小写
- **money 格式**：统一 `"N.00"`（小数 2 位），签名/提交/回调必须一致

---

## 六、已知问题 / 待办

- 无已知阻断性问题
- 本机 `curl` 直连生产域名超时（exit 28/35），疑似本机代理问题，不影响生产访问与第三方回调
- 远程 D1 schema 若已存在旧表，需用 `migrations/002_shares.sql` 增量迁移 shares 表（首次部署则直接用 `schema.sql`）

---

## 七、目录结构速览
```
wrangler.toml           # bindings + 非敏感配置（生产值已填）
.dev.vars               # 本地联调配置（指向 mock，勿部署）
schema.sql              # D1 建表（首次部署）
migrations/             # 增量迁移（如 002_shares.sql）
mock-server.mjs         # Connect + EasyPay Credit mock
src/
├── index.ts            # Hono app 入口
├── env.ts              # Bindings 类型 + 配置解析
├── lib/{crypto,render}.ts
├── auth/{oauth,session}.ts
├── payment/{epay,orders}.ts
├── storage/{r2,files,shares}.ts
├── routes/{auth,files,pay,download,share}.ts
└── views/{list,detail,upload,pay,share}.ts
test/{unit-logic.ts, local-flow.mjs, share-paid.mjs}
```
