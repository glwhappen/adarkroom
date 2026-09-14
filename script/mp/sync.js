/**
 * 多人服务器版 · 客户端同步层
 *
 * 只做猴补丁，不改原版逻辑，便于跟上游合并：
 * 1. 拦住 Engine.init，先确认登录（未登录跳 /auth/login）再取服务端存档
 *    - 服务端有档 → 用它初始化（离线期间的产出已在服务端结算好）
 *    - 服务端没档但本地有档 → 当作首次迁移，用本地档并立即上传
 *    - 服务器不可达 → 退回本地存档继续玩（不卡死）
 * 2. Engine.saveGame → 仍写 localStorage（本地缓存 + 导出功能要用），
 *    另外节流同步到服务器（最短 10 秒一次；关页/切后台用 sendBeacon 立即补交）
 * 3. Engine.deleteSave → 同时删服务端存档（否则重开又回来了）
 * 4. Engine.import64 → 导入的存档也要上传服务端，再重启
 */
(function () {
  'use strict';
  if (!window.Engine || !window.$) return;

  var SYNC_MIN_INTERVAL = 10000;   // 两次 PUT 的最小间隔
  var _lastSync = 0;
  var _timer = null;
  var _pending = false;
  var _user = null;

  function api(method, path, body, keepalive) {
    return fetch(path, {
      method: method,
      credentials: 'same-origin',
      keepalive: !!keepalive,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  function pushState(immediate) {
    if (window.State == null || !_user) return;
    if (_pending) return;
    var now = Date.now();
    if (!immediate && now - _lastSync < SYNC_MIN_INTERVAL) {
      // 攒到间隔到了再发，避免每改一次状态就一个请求
      if (_timer) clearTimeout(_timer);
      _timer = setTimeout(function () { pushState(true); }, SYNC_MIN_INTERVAL - (now - _lastSync));
      return;
    }
    _pending = true;
    if (_timer) { clearTimeout(_timer); _timer = null; }

    api('PUT', '/api/state', { state: window.State }, immediate)
      .then(function (r) {
        _pending = false;
        if (r.ok) {
          _lastSync = Date.now();
          setStatus('已保存');
        } else {
          setStatus('保存失败，稍后重试');
        }
      })
      .catch(function () {
        _pending = false;
        setStatus('离线中，暂存本地');
      });
  }

  // 关页 / 切后台：用 sendBeacon 或 keepalive 请求把最后状态交上去
  function flush() {
    if (window.State == null || !_user) return;
    var payload = JSON.stringify({ state: window.State });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/state', new Blob([payload], { type: 'application/json' }));
      } else {
        api('PUT', '/api/state', { state: window.State }, true);
      }
    } catch (e) { /* 关页阶段失败就算了，本地还有 */ }
  }

  function setStatus(text) {
    var el = document.getElementById('cloudStatus');
    if (!el) return;
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(setStatus._t);
    setStatus._t = setTimeout(function () { el.style.opacity = '0'; }, 2500);
  }

  function mountStatusBar() {
    var menu = document.querySelector('.menu');
    if (!menu || document.getElementById('cloudStatus')) return;
    var wrap = document.createElement('span');
    wrap.id = 'cloudBox';
    wrap.style.cssText = 'float:left;margin-left:16px;opacity:0.7;font-size:13px;';
    if (window.__adrUser) {
      wrap.textContent = (window.__adrUser.displayName || window.__adrUser.username || '') + ' · 云端';
    }
    var st = document.createElement('span');
    st.id = 'cloudStatus';
    st.style.cssText = 'margin-left:8px;opacity:0;transition:opacity .4s;';
    st.textContent = '';
    wrap.appendChild(st);
    menu.appendChild(wrap);
  }

  // ---- 1) 拦 init ----
  var origInit = Engine.init;
  Engine.init = function (options) {
    var opts = options || {};
    fetch('/api/me', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (me) {
        if (!me || !me.loggedIn) { window.location.href = '/auth/login'; return null; }
        _user = me;
        window.__adrUser = me;
        return fetch('/api/state', { credentials: 'same-origin' }).then(function (r) { return r.json(); });
      })
      .then(function (res) {
        if (res === null) return; // 正在跳转登录
        if (res && res.state && Object.keys(res.state).length) {
          opts.state = res.state;
          window.__adrOffline = res.appliedSeconds || 0;
        } else {
          // 服务端无档：把浏览器里的老存档迁上去（老玩家无损）
          try {
            var local = localStorage.gameState && JSON.parse(localStorage.gameState);
            if (local && Object.keys(local).length) {
              opts.state = local;
              window.__adrMigrated = true;
            }
          } catch (e) { /* 本地档坏了就当新档 */ }
        }
        origInit.call(Engine, opts);
        mountStatusBar();
        afterInit();
      })
      .catch(function () {
        // 服务端不可达：退回本地存档，游戏照常能玩
        origInit.call(Engine, opts);
        mountStatusBar();
        setStatus('离线模式（连不上服务器）');
      });
  };

  function afterInit() {
    // 离线结算提示（服务器替你把村子推进到了现在）
    var secs = window.__adrOffline;
    if (secs && secs > 60) {
      var mins = Math.round(secs / 60);
      var text = mins >= 60
        ? '你不在的时候，火一直在烧：已结算 ' + (mins / 60).toFixed(1) + ' 小时'
        : '你不在的时候，火一直在烧：已结算 ' + mins + ' 分钟';
      setTimeout(function () {
        if (window.Notifications && Notifications.notify) Notifications.notify(null, text);
      }, 2500);
    }
    if (window.__adrMigrated) {
      setTimeout(function () { pushState(true); }, 1000);   // 首次迁移：立刻上传
    }
  }

  // ---- 2) 存盘时同步 ----
  var origSave = Engine.saveGame;
  Engine.saveGame = function () {
    origSave.apply(this, arguments);   // 原逻辑：写 localStorage + 提示
    pushState(false);
  };

  // ---- 3) 清档时同步删服务端 ----
  var origDelete = Engine.deleteSave;
  Engine.deleteSave = function (noReload) {
    var self = this;
    // 只清本地（不刷新）的那部分交给原逻辑
    var wipeLocal = function () { return origDelete.call(self, true); };

    if (noReload) {
      // 太空结局那条路径：不刷新，异步删服务端即可
      wipeLocal();
      api('DELETE', '/api/state').catch(function () {});
      return;
    }

    // 重开：必须等 DELETE 真的完成再 reload，
    // 否则刷新会把还没删掉的旧档又拉回来（原逻辑是同步 reload，请求会被掐断）
    return api('DELETE', '/api/state')
      .catch(function () { /* 删不掉也得能重开，本地已清 */ })
      .then(function () {
        wipeLocal();
        window.location.reload();
      });
  };

  // ---- 4) 导入存档也要上传 ----
  var origImport = Engine.import64;
  Engine.import64 = function (string64) {
    try {
      var decoded = Base64.decode(String(string64).replace(/\s/g, '').replace(/\./g, ''));
      var parsed = JSON.parse(decoded);
      if (parsed && typeof parsed === 'object') {
        window.State = parsed;
        pushState(true);
      }
    } catch (e) { /* 解析失败就交给原逻辑报错 */ }
    return origImport.apply(this, arguments);
  };

  // ---- 页面生命周期 ----
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });
})();
