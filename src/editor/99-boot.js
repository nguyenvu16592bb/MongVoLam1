/* Map Editor — 99-boot.js (worker A)
   Khởi tạo theo thứ tự: ED.Core -> Viewport -> UI -> module khác (nếu đã load).
   Tạo project mẫu (terrain phẳng + 1 nhà, 1 cây, 1 đèn) nếu chưa có project. */
var ED = ED || {};

ED.Boot = (function () {
  var _started = false;

  function _callInit(mod, arg) {
    if (ED[mod] && typeof ED[mod].init === 'function') {
      try { ED[mod].init(arg); } catch (e) {
        if (ED.UI) ED.UI.log('Lỗi init ' + mod + ': ' + (e && e.message ? e.message : e));
      }
    }
  }

  function _sampleProject() {
    ED.Core.newProject('Biện Kinh Thành');
    ED.Core.addObject({
      type: 'house', category: 'Buildings', name: 'Nhà gỗ',
      pos: [-6, 0, -4], rot: [0, 0.4, 0], scale: [1, 1, 1], color: '#8a6a42'
    });
    ED.Core.addObject({
      type: 'tree', category: 'Decorations', name: 'Cây đào',
      pos: [5, 0, -3], rot: [0, 0, 0], scale: [1, 1, 1], color: '#4a7a3a'
    });
    ED.Core.addObject({
      type: 'lantern', category: 'Decorations', name: 'Đèn lồng',
      pos: [0, 0, 5], rot: [0, 0, 0], scale: [1, 1, 1], color: '#e53e3e',
      extra: { light: { intensity: 1.2, lightColor: '#ffd76b' } }
    });
  }

  function start() {
    if (_started) return false;
    _started = true;

    // 1. Core (không cần init — state thuần, sẵn sàng ngay).
    if (!ED.Core) return false;

    // 2. Viewport.
    var viewportEl = document.getElementById('viewport');
    var viewportOk = false;
    if (ED.Viewport && viewportEl) {
      viewportOk = ED.Viewport.init(viewportEl);
    }
    if (!viewportOk && ED.UI) {
      // UI chưa init ở bước này nên log ra console trình duyệt.
      if (window.console) window.console.error('Map Editor: Viewport init that bai (THREE chua load?).');
    }

    // 3. UI.
    _callInit('UI');
    if (ED.UI) ED.UI.restorePanelStates();

    // 4. Các module khác nếu đã load (nhóm B/C/D) — gọi init nếu tồn tại.
    _callInit('Assets');
    _callInit('Building');
    _callInit('Terrain');
    _callInit('Environment');
    _callInit('Fx');
    _callInit('Character');
    _callInit('Animation');
    _callInit('Ik');
    _callInit('Weight');
    _callInit('Retarget');
    _callInit('NpcAi');
    _callInit('Nodes');
    _callInit('Play');
    _callInit('GameLink');
    _callInit('Nav');
    _callInit('Material');
    _callInit('Export');
    _callInit('Itch');
    _callInit('Minimap');

    // 5. Project mẫu nếu chưa có project nào.
    if (!ED.Core.getProject()) _sampleProject();
    if (ED.Viewport) {
      ED.Viewport.syncTerrain();
      ED.Core.listObjects().forEach(function (o) { ED.Viewport.syncObject(o); });
    }
    if (ED.UI) {
      ED.UI.refreshHierarchy();
      ED.UI.refreshInspector();
      ED.UI.log('Map Editor sẵn sàng — project: ' +
        (ED.Core.getProject() ? ED.Core.getProject().name : '?'));
    }

    // 6. Resize: panel thu gọn làm đổi kích thước viewport.
    if (typeof ResizeObserver !== 'undefined' && viewportEl) {
      var ro = new ResizeObserver(function () {
        if (ED.Viewport && ED.Viewport.init) {
          // Viewport tự resize qua window resize; gọi lại bằng cách dispatch
          // để tránh phụ thuộc API nội bộ.
          window.dispatchEvent(new Event('resize'));
        }
      });
      ro.observe(viewportEl);
    }

    // 7. Bắt lỗi toàn cục -> console panel.
    window.onerror = function (msg, src, line, col) {
      if (ED.UI) ED.UI.log('Lỗi: ' + msg + ' (' + (src || '?') + ':' + line + ')');
      return false;
    };
    window.addEventListener('unhandledrejection', function (e) {
      if (ED.UI) ED.UI.log('Promise lỗi: ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
    });

    return true;
  }

  // Khởi động khi DOM sẵn sàng.
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }

  return { start: start };
})();
