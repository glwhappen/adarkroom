# adarkroom-server —— 多人服务器版服务端

在原版 A Dark Room 之上加的「云端大脑」：OIDC 登录、存档入 Postgres、离线惰性结算。

## 架构

- **Fastify** 静态托管整个游戏（仓库根目录），同时提供 `/auth/*` 与 `/api/*`
- **Authentik OIDC**：授权码流程，session 是 HMAC 签名 cookie（30 天）
- **Postgres**：自建 Supabase 实例（`supabase-db:54322`），独立 `adr` schema
  - `adr.users`：sub / username / display_name
  - `adr.saves`：整包 State JSON + `last_tick`（上次结算时刻）
- **离线结算**（`src/sim.js`）：不跑常驻定时器。读档时按 `now - last_tick` 逐秒重放
  `collectIncome` / 火势衰减 / 室温 / 人口增长，上限 7 天。移植自客户端同名逻辑，
  **改客户端 `state_manager.js` / `room.js` / `outside.js` 的时间类逻辑时必须同步这里**。
  离线期间不掷随机事件、不收陷阱、不打仗（这些都是在线交互）。

## 本地跑

```bash
cp .env.example .env   # 填好 OIDC 与 DATABASE_URL
npm install
npm run dev
```

前置：Authentik 里新建 Provider + Application（slug `adarkroom`，回调
`https://game.hsfp.cn/auth/callback`），并执行迁移：

```bash
docker exec -i supabase-db psql -U postgres -d postgres -p 54322 < ../migrations/001_init.sql
```

## API

| 路由 | 说明 |
|---|---|
| `GET /auth/login` `/auth/callback` `/auth/logout` | OIDC 登录闭环 |
| `GET /api/me` | 当前登录状态 |
| `GET /api/state` | 读档（先惰性结算到当前时刻） |
| `PUT /api/state` | 存档（body: `{state}`，上限 512KB） |
| `GET /api/health` | 存活 + DB 连通 |
