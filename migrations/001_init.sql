-- A Dark Room 多人版 · 初始迁移
-- 用法：docker exec -i supabase-db psql -U postgres -d postgres -p 54322 < migrations/001_init.sql
-- 注意：自建 Supabase 的 supabase-db 容器 PGPORT=54322，不是 5432

CREATE SCHEMA IF NOT EXISTS adr;

-- 用户（sub 是 Authentik OIDC 的稳定主体标识）
CREATE TABLE IF NOT EXISTS adr.users (
  sub          text PRIMARY KEY,
  username     text NOT NULL,
  display_name text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now()
);

-- 存档：整包 State JSON + 上次结算时刻（离线惰性结算的起点）
CREATE TABLE IF NOT EXISTS adr.saves (
  sub        text PRIMARY KEY REFERENCES adr.users(sub) ON DELETE CASCADE,
  state      jsonb NOT NULL,
  last_tick  timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
