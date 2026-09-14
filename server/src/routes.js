// 存档 API：GET 返回惰性结算后的最新 State；PUT 接收客户端定期同步
import { getSave, putSave } from './db.js';
import { requireSession } from './auth.js';
import { advance } from './sim.js';

// State 体积上限（防恶意塞爆数据库；正常通关存档 < 100KB）
const MAX_STATE_BYTES = 512 * 1024;

export async function stateRoutes(app) {
  // 读档：先做离线惰性结算，再返回（此时 last_tick 也一并推到当前）
  app.get('/api/state', async (req, reply) => {
    const sess = requireSession(req, reply);
    if (!sess) return;

    const save = await getSave(sess.sub);
    if (!save) return { state: null, appliedSeconds: 0 };

    const elapsed = (Date.now() - new Date(save.last_tick).getTime()) / 1000;
    const { state, appliedSeconds } = advance(save.state, elapsed);
    if (appliedSeconds > 0) await putSave(sess.sub, state);
    return { state, appliedSeconds };
  });

  // 存档：客户端定时 PUT。入库前把 last_tick 到 now 的间隔也结算掉，
  // 但以客户端报上来的 state 为准（在线期间客户端是实时权威），
  // 只把 last_tick 对齐到 now，避免下次读档重复结算。
  app.put('/api/state', async (req, reply) => {
    const sess = requireSession(req, reply);
    if (!sess) return;

    const body = req.body;
    if (!body || typeof body.state !== 'object' || body.state === null) {
      return reply.code(400).send({ error: 'bad_state' });
    }
    const bytes = Buffer.byteLength(JSON.stringify(body.state));
    if (bytes > MAX_STATE_BYTES) return reply.code(413).send({ error: 'state_too_large' });

    await putSave(sess.sub, body.state);
    return { ok: true, savedAt: new Date().toISOString() };
  });

  app.get('/api/health', async () => {
    try {
      await getSave('__healthcheck__');
      return { ok: true, db: 'up' };
    } catch (e) {
      return { ok: false, db: 'down', error: String(e.message || e) };
    }
  });
}
