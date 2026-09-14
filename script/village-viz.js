/**
 * 村庄一角 · 右下角实时小动画
 *
 * 读全局 State（不改它），把游戏状态画成像素小景：
 * - 篝火：火势 0~4 档，火焰高度/宽度随之变化（4 档约等于 1.3 倍小屋高，不喧宾夺主）；
 *   火堆里始终有一小堆柴；没开火时飘一缕烟
 * - 小屋：按 game.buildings.hut 排一排（最多画 5 座）
 * - 村民：按 game.population 画小人，呼吸般起伏（最多 10 个）
 * - 开局（还没有 game.fire）：只画一个人守着冷火堆，呼应「苏醒，生火吧」
 *
 * 纯 canvas 自绘，无 jQuery 依赖；pointer-events:none 永不挡点击。
 * 比例基准（改动时一起看）：小屋 12×14px、村民 3×12px、地面线 y=BH-10、
 * 火堆底座 y=BH-13，火焰高度 5+3.5×档位（1 档 ≈8px，4 档 ≈19px）。
 */
(function () {
  'use strict';

  // 低分辨率画布 + pixelated 放大 = 像素风
  var BW = 176, BH = 60;           // 内部缓冲分辨率（扁一点，别让上方留大片空白）
  var SCALE = 2;                   // 显示放大倍数
  var INK = '#3a3a3a';             // 主墨色（贴合正文的深灰）
  var INK_SOFT = 'rgba(58,58,58,0.45)';

  var GROUND = BH - 10;            // 地面线
  var FIRE_X = 92;                 // 火堆中轴
  var FIRE_BASE = BH - 13;         // 火焰底部

  var canvas = document.createElement('canvas');
  canvas.id = 'villageViz';
  canvas.width = BW;
  canvas.height = BH;
  canvas.style.cssText =
    'position:fixed;right:10px;bottom:44px;' +   // 抬高避开底部菜单栏
    'width:' + BW * SCALE + 'px;height:' + BH * SCALE + 'px;' +
    'image-rendering:pixelated;pointer-events:none;z-index:40;';
  var ctx = canvas.getContext('2d');

  function px(x, y, w, h, color) {
    ctx.fillStyle = color || INK;
    ctx.fillRect(x | 0, y | 0, w || 1, h || 1);
  }

  // ---- 读取游戏状态（防御性：State 可能是空对象）----
  function readState() {
    var s = (typeof window.State === 'object' && window.State) || {};
    var game = s.game || {};
    var b = game.buildings || {};
    return {
      started: !!(game.fire && typeof game.fire.value === 'number'),
      fire: (game.fire && game.fire.value) || 0,
      huts: Math.min(b.hut || 0, 5),
      pop: Math.min(game.population || 0, 10),
    };
  }

  // ---- 火星余烬粒子（火焰上方的飘散点）----
  var embers = [];
  function spawnEmbers(level) {
    var want = level * 2;
    while (embers.length < want) {
      embers.push({ x: FIRE_X, y: FIRE_BASE - 6, life: 1, seed: Math.random() * 10 });
    }
    if (embers.length > want) embers.length = want;
  }

  var smoke = [];
  function spawnSmoke() {
    if (smoke.length < 4 && Math.random() < 0.06) {
      smoke.push({ x: FIRE_X, y: FIRE_BASE - 2, vy: 0.15, life: 1 });
    }
  }

  // ---- 造型 ----
  // 火堆本身：一小堆柴（3 根，粗一点，未点火时也看得见「柴就在那儿」）
  function drawLogs(level) {
    px(FIRE_X - 8, FIRE_BASE - 1, 17, 2);     // 底下一根横柴
    px(FIRE_X - 6, FIRE_BASE - 3, 13, 2);     // 压在上面的一根
    px(FIRE_X + 4, FIRE_BASE - 6, 3, 4);      // 斜靠着的一根
    if (level > 0) px(FIRE_X - 5, FIRE_BASE - 4, 11, 1, INK_SOFT);  // 烧红的一点底火
  }

  // 火焰剪影：逐行堆叠，底部宽顶部尖，边缘随时间抖动
  function drawFlame(t, level) {
    var h = Math.round(5 + level * 3.5);      // 1 档 8px ~ 4 档 19px（小屋高 14px）
    var baseHalf = 2 + level * 0.8;           // 底部半宽 2.8 ~ 5.2
    for (var row = 0; row < h; row++) {
      var frac = row / h;                     // 0=底 1=顶
      var half = Math.max(1, Math.round(baseHalf * (1 - Math.pow(frac, 1.6))));
      // 边缘摇曳：行越高抖得越厉害
      var jitter = Math.round(Math.sin(t / 130 + row * 0.9) * frac * 1.2);
      var flick = (Math.sin(t / 70 + row * 2.3) > 0.6 && frac > 0.5) ? 1 : 0;
      px(FIRE_X - half + jitter, FIRE_BASE - 4 - row, half * 2 + 1 - flick, 1,
         frac > 0.65 ? INK_SOFT : INK);       // 顶部变淡
    }

    // 余烬上飘
    spawnEmbers(level);
    for (var i = 0; i < embers.length; i++) {
      var e = embers[i];
      e.y -= 0.35; e.life -= 0.018;            // 约 0.9s 的短命火星，别飘得离火太远
      e.x += Math.sin(e.y / 5 + e.seed) * 0.25;
      if (e.life <= 0) { e.x = FIRE_X + (Math.random() * 4 - 2); e.y = FIRE_BASE - 6 - h; e.life = 1; }
      px(e.x, e.y, 1, 1, 'rgba(58,58,58,' + (0.5 * e.life) + ')');
    }
  }

  function drawSmoke() {
    for (var i = 0; i < smoke.length; i++) {
      var s = smoke[i];
      s.y -= s.vy;
      s.x += Math.sin(s.y / 6) * 0.15;
      s.life -= 0.008;
      if (s.life <= 0) { smoke.splice(i, 1); i--; continue; }
      px(s.x, s.y, 1, 1, 'rgba(58,58,58,' + (0.35 * s.life) + ')');
    }
  }

  function drawHut(x) {
    var base = GROUND - 2;                    // 墙脚贴着地面
    px(x + 2, base - 14, 8, 1);               // 屋顶（三层收拢成三角形）
    px(x + 1, base - 13, 10, 1);
    px(x, base - 12, 12, 1);
    px(x + 1, base - 11, 10, 9);              // 墙身
    px(x + 5, base - 6, 3, 4, '#fff');        // 门（镂空）
  }

  function drawVillager(x, t, phase) {
    var bob = Math.sin(t / 300 + phase) > 0 ? 0 : 1;
    var y = GROUND - 2 - bob;                 // 脚踩在地面线上
    px(x, y - 8, 3, 3);                       // 头（比身子宽，轮廓才读得出是人）
    px(x, y - 5, 2, 4);                       // 身子
    px(x, y - 1, 1, 3);                       // 左腿
    px(x + 2, y - 1, 1, 3);                   // 右腿（中间留 1px，两条腿才分得开）
  }

  // ---- 主循环 ----
  var last = readState();
  function frame(t) {
    var st = readState();
    last = st;
    ctx.clearRect(0, 0, BW, BH);

    px(4, GROUND, BW - 8, 1, INK_SOFT);       // 地面

    for (var h = 0; h < st.huts; h++) drawHut(4 + h * 14);   // 小屋（左侧一排）

    // 火堆：柴始终在，火按档位长
    drawLogs(st.started ? st.fire : 0);
    if (!st.started || st.fire === 0) {
      spawnSmoke();
      drawSmoke();
    } else {
      drawFlame(t, st.fire);
    }

    // 村民围着火堆（右侧散开）；没村民时画一个孤独的人守着火
    if (st.pop > 0) {
      for (var v = 0; v < st.pop; v++) drawVillager(104 + v * 7 + (v % 2), t, v * 1.7);
    } else {
      drawVillager(104, t, 0);
    }

    requestAnimationFrame(frame);
  }
  // 本脚本与其它游戏脚本一样在 <head> 里加载，此时 body 还不存在
  function boot() {
    document.body.appendChild(canvas);
    requestAnimationFrame(frame);
  }
  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
