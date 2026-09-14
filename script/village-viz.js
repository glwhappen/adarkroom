/**
 * 村庄一角 · 右下角实时小动画
 *
 * 读全局 State（不改它），把游戏状态画成像素小景：
 * - 篝火：火势 0~4 档，火焰高度/密度随之变化；没开火时飘一缕烟
 * - 小屋：按 game.buildings.hut 排一排（最多画 6 座）
 * - 村民：按 game.population 画小人，呼吸般起伏（最多画 10 个）
 * - 开局（还没有 game.fire）：只画一个人蹲在冷火堆旁，呼应「苏醒，生火吧」
 *
 * 纯 canvas 自绘，无 jQuery 依赖；pointer-events:none 永不挡点击。
 */
(function () {
  'use strict';

  // 低分辨率画布 + pixelated 放大 = 像素风
  var BW = 160, BH = 92;           // 内部缓冲分辨率
  var SCALE = 2;                   // 显示放大倍数
  var INK = '#3a3a3a';             // 主墨色（贴合正文的深灰）
  var INK_SOFT = 'rgba(58,58,58,0.45)';

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
      huts: Math.min(b.hut || 0, 6),
      pop: Math.min(game.population || 0, 10),
    };
  }

  // ---- 火星余烬粒子（火焰上方的飘散点）----
  var embers = [];
  function spawnEmbers(level) {
    var want = level * 2;
    while (embers.length < want) {
      embers.push({ x: 80, y: BH - 20, life: 1, seed: Math.random() * 10 });
    }
    if (embers.length > want) embers.length = want;
  }

  var smoke = [];
  function spawnSmoke() {
    if (smoke.length < 4 && Math.random() < 0.06) {
      smoke.push({ x: 80, y: BH - 16, vy: 0.15, life: 1 });
    }
  }

  // ---- 造型 ----
  function drawFirePit(t, level) {
    // 两根交叉的木柴
    px(75, BH - 11, 10, 2);
    px(76, BH - 13, 8, 2);
    if (level <= 0) return;

    // 火焰剪影：逐行堆叠，底部宽顶部尖，边缘随时间抖动
    var h = 8 + level * 7;              // 总高：1 档 15px ~ 4 档 36px
    var baseW = 4 + level * 3;          // 底部半宽
    for (var row = 0; row < h; row++) {
      var frac = row / h;               // 0=底 1=顶
      var half = Math.max(0, Math.round(baseW * (1 - frac * frac)));
      // 边缘摇曳：行越高抖得越厉害
      var jitter = Math.round(Math.sin(t / 130 + row * 0.9) * frac * 1.6);
      var flick = (Math.sin(t / 70 + row * 2.3) > 0.6 && frac > 0.5) ? 1 : 0;
      px(80 - half + jitter, BH - 15 - row, half * 2 + 1 - flick, 1,
         frac > 0.65 ? INK_SOFT : INK);  // 顶部变淡
    }

    // 余烬上飘
    spawnEmbers(level);
    for (var i = 0; i < embers.length; i++) {
      var e = embers[i];
      e.y -= 0.35; e.life -= 0.006;
      e.x += Math.sin(e.y / 5 + e.seed) * 0.25;
      if (e.life <= 0) { e.x = 80 + (Math.random() * 4 - 2); e.y = BH - 15 - h; e.life = 1; }
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
    // 屋顶
    px(x + 2, BH - 26, 8, 1); px(x + 1, BH - 25, 10, 1); px(x, BH - 24, 12, 1);
    // 墙身
    px(x + 1, BH - 23, 10, 11);
    // 门（镂空）
    px(x + 5, BH - 17, 3, 5, '#fff');
  }

  function drawVillager(x, t, phase) {
    var bob = Math.sin(t / 300 + phase) > 0 ? 0 : 1;
    var y = BH - 12 - bob;
    px(x - 1, y - 7, 3, 3);      // 头（比身子宽，轮廓才读得出是人）
    px(x, y - 4, 2, 5);          // 身子
    px(x, y + 1, 1, 3);          // 左腿
    px(x + 1, y + 1, 1, 3);      // 右腿
  }

  // ---- 主循环 ----
  var last = readState();
  function frame(t) {
    var st = readState();
    last = st;
    ctx.clearRect(0, 0, BW, BH);

    // 地面
    px(6, BH - 10, BW - 12, 1, INK_SOFT);

    // 小屋（左侧一排）
    for (var h = 0; h < st.huts; h++) drawHut(10 + h * 15);

    // 火堆
    if (!st.started || st.fire === 0) {
      spawnSmoke();
      drawFirePit(t, 0);
      drawSmoke();
    } else {
      drawFirePit(t, st.fire);
    }

    // 村民围着火堆（右侧散开）；没村民且未开局时画一个孤独的人
    if (st.pop > 0) {
      for (var v = 0; v < st.pop; v++) {
        drawVillager(100 + v * 6 + (v % 3), t, v * 1.7);
      }
    } else {
      drawVillager(96, t, 0);
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
