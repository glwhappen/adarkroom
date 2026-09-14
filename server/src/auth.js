// Authentik OIDC 登录 + HMAC 签名 session cookie
// 流程：/auth/login → Authentik 授权页 → /auth/callback → 换 token → 建 session → 回首页
import crypto from 'node:crypto';
import { config } from './config.js';
import { upsertUser } from './db.js';

const COOKIE_NAME = 'adr_session';

let _discovery = null;
async function discovery() {
  if (_discovery) return _discovery;
  const res = await fetch(`${config.oidc.issuer}.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery 失败: ${res.status}`);
  _discovery = await res.json();
  return _discovery;
}

// ---- session cookie（base64url(payload).hmac）----
function sign(payload) {
  return crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
}

export function createSession(data) {
  const payload = Buffer.from(
    JSON.stringify({ ...data, exp: Math.floor(Date.now() / 1000) + config.sessionTtlSec }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function readSession(cookieHeader) {
  const raw = cookieHeader?.split(';').map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expect = sign(payload);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp < Date.now() / 1000) return null;
    return data; // { sub, username, displayName, exp }
  } catch {
    return null;
  }
}

export function sessionCookie(value, maxAge = config.sessionTtlSec) {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

// ---- 路由 ----
export async function authRoutes(app) {
  const d = await discovery();

  app.get('/auth/login', async (req, reply) => {
    const state = crypto.randomBytes(16).toString('hex');
    const params = new URLSearchParams({
      client_id: config.oidc.clientId,
      redirect_uri: config.oidc.redirectUri,
      response_type: 'code',
      scope: 'openid profile',
      state,
    });
    reply
      .header('set-cookie', sessionCookie(`oauth_state.${state}`, 600))
      .redirect(`${d.authorization_endpoint}?${params}`);
  });

  app.get('/auth/callback', async (req, reply) => {
    const { code, state } = req.query;
    if (!code || !state) return reply.code(400).send('缺少 code/state');
    // 换 token
    const tokenRes = await fetch(d.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.oidc.clientId,
        client_secret: config.oidc.clientSecret,
        redirect_uri: config.oidc.redirectUri,
        code,
      }),
    });
    if (!tokenRes.ok) return reply.code(502).send(`token 交换失败: ${await tokenRes.text()}`);
    const tokens = await tokenRes.json();

    // 取用户信息
    const infoRes = await fetch(d.userinfo_endpoint, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    if (!infoRes.ok) return reply.code(502).send('userinfo 失败');
    const info = await infoRes.json();
    if (!info.sub) return reply.code(502).send('userinfo 缺少 sub');

    // 显示名：优先 nickname / preferred_username，绝不回退到真名 name
    const username = info.preferred_username || info.nickname || info.sub;
    const displayName = info.nickname || info.preferred_username || null;

    await upsertUser(info.sub, username, displayName);

    reply
      .header('set-cookie', sessionCookie(createSession({ sub: info.sub, username, displayName })))
      .redirect('/');
  });

  app.get('/auth/logout', async (req, reply) => {
    reply.header('set-cookie', sessionCookie('', 0)).redirect('/');
  });

  // 当前登录状态（客户端启动时探一次）
  app.get('/api/me', async (req) => {
    const sess = readSession(req.headers.cookie);
    if (!sess) return { loggedIn: false };
    return { loggedIn: true, username: sess.username, displayName: sess.displayName };
  });
}

// 保护 API 的小钩子：没登录一律 401
export function requireSession(req, reply) {
  const sess = readSession(req.headers.cookie);
  if (!sess) {
    reply.code(401).send({ error: 'not_logged_in' });
    return null;
  }
  return sess;
}
