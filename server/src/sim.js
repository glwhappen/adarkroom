// 离线惰性结算：把客户端逐秒跑的时间类逻辑原样搬到服务端。
// 移植自 script/state_manager.js collectIncome、script/room.js coolFire/adjustTemp、
// script/outside.js increasePopulation。规则：改客户端这些逻辑时必须同步这里。
//
// 不在结算范围内（刻意）：
// - 随机事件（Events）：离线不触发，玩家在线才掷骰
// - 陷阱收获 checkTraps：手动点击行为
// - 战斗 / 探索 / 太空：实时交互

export const MAX_OFFLINE_SECONDS = 7 * 24 * 3600; // 离线最多结算 7 天

const FIRE_COOL_DELAY = 5 * 60;      // room.js _FIRE_COOL_DELAY
const ROOM_WARM_DELAY = 30;          // room.js _ROOM_WARM_DELAY
const POP_DELAY = [0.5, 3];          // outside.js _POP_DELAY（分钟）
const HUT_ROOM = 4;                  // outside.js _HUT_ROOM
const BUILDER_STOKE_LEVEL = 3;       // builder.level > 3 时帮添柴
const FIRE_FLICKERING = 2;           // coolFire 里 builder 干预的阈值（<= Flickering(1) 用 < FLICKERING 表示）

const get = (state, path, dflt) => {
  let cur = state;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return dflt;
    cur = cur[key];
  }
  return cur === undefined ? dflt : cur;
};

const set = (state, path, value) => {
  let cur = state;
  for (let i = 0; i < path.length - 1; i++) {
    if (cur[path[i]] == null || typeof cur[path[i]] !== 'object') cur[path[i]] = {};
    cur = cur[path[i]];
  }
  cur[path[path.length - 1]] = value;
};

// $SM.collectIncome 的一次“收账”（客户端每秒 timeLeft--，<=0 时结算并复位）
function collectIncomeTick(state) {
  const income = get(state, ['income']);
  if (!income || typeof income !== 'object') return;
  const stores = get(state, ['stores'], {});

  for (const source of Object.keys(income)) {
    const inc = income[source];
    if (typeof inc.timeLeft !== 'number') inc.timeLeft = 0;
    inc.timeLeft--;
    if (inc.timeLeft > 0) continue;

    if (source === 'thieves') {
      // addStolen：记录被偷量（以实际扣到 0 为止）
      for (const [k, v] of Object.entries(inc.stores || {})) {
        const have = stores[k] ?? 0;
        const short = have + v;
        const stolen = short < 0 ? -v + short : -v;
        set(state, ['game', 'stolen', k], (get(state, ['game', 'stolen', k], 0)) + stolen);
      }
      for (const [k, v] of Object.entries(inc.stores || {})) {
        // 原版 $SM.add 不截断：库存可以被小偷偷成负数（addStolen 已记账）
        stores[k] = (stores[k] ?? 0) + v;
      }
    } else {
      // 非 thieves：任一项会扣成负数就整笔跳过（但 timeLeft 照样复位）
      let ok = true;
      for (const [k, v] of Object.entries(inc.stores || {})) {
        if ((stores[k] ?? 0) + v < 0) { ok = false; break; }
      }
      if (ok) {
        for (const [k, v] of Object.entries(inc.stores || {})) {
          stores[k] = (stores[k] ?? 0) + v;
        }
      }
    }
    if (typeof inc.delay === 'number') inc.timeLeft = inc.delay;
  }
}

// Room.coolFire（每 5 分钟）：builder 够高级会先帮忙添柴，然后火势降一档
function coolFireTick(state) {
  const game = get(state, ['game'], {});
  const stores = get(state, ['stores'], {});
  const fire = game.fire?.value ?? 0;
  const builderLevel = game.builder?.level ?? 0;
  const wood = stores.wood ?? 0;

  if (fire < FIRE_FLICKERING && builderLevel > BUILDER_STOKE_LEVEL && wood > 0) {
    stores.wood = wood - 1;
    set(state, ['game', 'fire'], { value: fire + 1, text: '' });
  }
  const cur = get(state, ['game', 'fire', 'value'], 0);
  if (cur > 0) set(state, ['game', 'fire'], { value: cur - 1, text: '' });
}

// Room.adjustTemp（每 30 秒）：室温向火势靠拢一档，范围 [0,4]
function adjustTempTick(state) {
  const game = get(state, ['game'], {});
  const temp = game.temperature?.value ?? 0;
  const fire = game.fire?.value ?? 0;
  if (temp > 0 && temp > fire) set(state, ['game', 'temperature'], { value: temp - 1, text: '' });
  else if (temp < 4 && temp < fire) set(state, ['game', 'temperature'], { value: temp + 1, text: '' });
}

// Outside.increasePopulation：随机间隔（0.5~2.5 分钟）来人，人数 = [space/2, space)
function popTick(state) {
  const game = get(state, ['game'], {});
  const maxPop = (game.buildings?.hut ?? 0) * HUT_ROOM;
  const space = maxPop - (game.population ?? 0);
  if (space <= 0) return;
  let num = Math.floor(Math.random() * (space / 2) + space / 2);
  if (num === 0) num = 1;
  set(state, ['game', 'population'], (game.population ?? 0) + num);
}

/**
 * 把 state 从 lastTick 推进 seconds 秒（就地修改并返回）。
 * 返回 { state, appliedSeconds } —— appliedSeconds 可能被 7 天上限截断。
 */
export function advance(state, seconds) {
  const applied = Math.min(Math.max(0, Math.floor(seconds)), MAX_OFFLINE_SECONDS);
  if (applied === 0 || !state || typeof state !== 'object') return { state, appliedSeconds: 0 };

  let fireCooldown = FIRE_COOL_DELAY;   // 简化：离线起点视为刚重置过计时
  let tempCooldown = ROOM_WARM_DELAY;
  let popCooldown = (Math.floor(Math.random() * (POP_DELAY[1] - POP_DELAY[0])) + POP_DELAY[0]) * 60;

  for (let t = 0; t < applied; t++) {
    collectIncomeTick(state);
    if (--fireCooldown <= 0) { coolFireTick(state); fireCooldown = FIRE_COOL_DELAY; }
    if (--tempCooldown <= 0) { adjustTempTick(state); tempCooldown = ROOM_WARM_DELAY; }
    if (--popCooldown <= 0) {
      popTick(state);
      popCooldown = (Math.floor(Math.random() * (POP_DELAY[1] - POP_DELAY[0])) + POP_DELAY[0]) * 60;
    }
  }
  return { state, appliedSeconds: applied };
}
