import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 5,
});

// 建/更新用户，返回用户行
export async function upsertUser(sub, username, displayName) {
  const { rows } = await pool.query(
    `INSERT INTO adr.users (sub, username, display_name, last_seen)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (sub) DO UPDATE
       SET username = EXCLUDED.username,
           display_name = EXCLUDED.display_name,
           last_seen = now()
     RETURNING *`,
    [sub, username, displayName],
  );
  return rows[0];
}

// 读存档（不存在返回 null）
export async function getSave(sub) {
  const { rows } = await pool.query(
    'SELECT state, last_tick, updated_at FROM adr.saves WHERE sub = $1',
    [sub],
  );
  return rows[0] || null;
}

// 写存档（整体覆盖；last_tick 由调用方决定，默认现在）
export async function putSave(sub, state, lastTick = new Date()) {
  await pool.query(
    `INSERT INTO adr.saves (sub, state, last_tick, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (sub) DO UPDATE
       SET state = EXCLUDED.state,
           last_tick = EXCLUDED.last_tick,
           updated_at = now()`,
    [sub, JSON.stringify(state), lastTick],
  );
}
