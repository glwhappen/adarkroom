// 服务端配置（全部走环境变量，见 server/.env.example）
const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}（参考 server/.env.example）`);
  return v;
};

export const config = {
  port: Number(process.env.PORT || 4401),
  host: process.env.HOST || '0.0.0.0',
  // 游戏静态文件根目录（fork 仓库根目录，index.html 所在处）
  staticRoot: process.env.STATIC_ROOT || new URL('../../', import.meta.url).pathname,
  databaseUrl: required('DATABASE_URL'), // postgres://postgres:***@supabase-db:54322/postgres
  oidc: {
    issuer: required('AUTHENTIK_ISSUER'), // https://auth.hsfp.cn/application/o/adarkroom/
    clientId: required('OIDC_CLIENT_ID'),
    clientSecret: required('OIDC_CLIENT_SECRET'),
    redirectUri: required('OIDC_REDIRECT_URI'), // https://game.hsfp.cn/auth/callback
  },
  sessionSecret: required('SESSION_SECRET'), // openssl rand -hex 32
  sessionTtlSec: Number(process.env.SESSION_TTL_SEC || 60 * 60 * 24 * 30), // 30 天
  cookieSecure: process.env.COOKIE_SECURE !== 'false', // 反代后 https 置 true
};
