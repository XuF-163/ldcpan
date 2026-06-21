/**
 * 共享客户端工具库（所有页面加载，最先执行）。
 * 暴露到 window.*，供 upload.js / usermenu.js / 页面级内联脚本统一调用，消除重复实现。
 *
 * 包含：openModal / showToast / humanSize / escAttr / escapeText / crc32 / buildZip
 */
(function () {
  // ── 字节大小格式化 ──
  function humanSize(b) {
    if (b < 1024) return b + " B";
    var u = ["KB", "MB", "GB", "TB"], v = b / 1024, i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 100 ? 0 : 1) + " " + u[i];
  }

  // ── HTML 转义（浏览器端用）──
  // escAttr: 转义 & " <（用于属性值）
  function escAttr(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }
  // escapeText: 转义 & <（用于文本内容）
  function escapeText(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }

  // ── 模态弹窗（带开关动画）──
  // 返回弹窗 overlay 元素，含 _close() 方法
  function openModal(title, bodyHtml, footHtml) {
    var ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML =
      '<div class="modal"><div class="modal-head"><h3>' + title + '</h3><button class="modal-x" type="button">×</button></div>' +
      '<div class="modal-body">' + bodyHtml + "</div>" +
      (footHtml ? '<div class="modal-foot">' + footHtml + "</div>" : "") +
      "</div>";
    var inner = ov.querySelector(".modal");
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      ov.classList.add("closing");
      if (inner) inner.classList.add("closing");
      setTimeout(function () { ov.remove(); }, 200);
    }
    ov._close = close;
    ov.addEventListener("click", function (e) {
      if (e.target === ov || e.target.classList.contains("modal-x")) close();
    });
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") {
        close();
        document.removeEventListener("keydown", esc);
      }
    });
    document.body.appendChild(ov);
    return ov;
  }

  // ── 悬浮通知 toast：右上角滑入，自动消失 ──
  function showToast(msg, type, link) {
    var box = document.getElementById("toastBox");
    if (!box) {
      box = document.createElement("div");
      box.id = "toastBox";
      box.className = "toast-box";
      document.body.appendChild(box);
    }
    var t = document.createElement("div");
    t.className = "toast toast-" + (type || "ok");
    var html = '<span class="toast-msg">' + escapeText(msg) + "</span>";
    if (link) html += '<a class="toast-link" href="' + escapeText(link) + '">查看</a>';
    t.innerHTML = html;
    box.appendChild(t);
    // 双重 rAF：先以初始态渲染一帧，再加 show 类，transition 才会真正播放
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { t.classList.add("show"); });
    });
    var timer = setTimeout(function () { dismiss(t); }, type === "err" ? 6000 : 3500);
    function dismiss(el) {
      el.classList.remove("show");
      el.classList.add("hide");
      // transition transform/opacity 均 .4s，等动画播完再移除 DOM
      setTimeout(function () { el.remove(); }, 420);
    }
    t.addEventListener("click", function () { clearTimeout(timer); dismiss(t); });
  }

  // ── ZIP 打包（STORE 不压缩），零依赖 ──
  var CRC_TAB = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) { c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
      t[n] = c;
    }
    return t;
  })();
  function crc32(data) {
    var crc = 0xffffffff;
    for (var i = 0; i < data.length; i++) { crc = CRC_TAB[(crc ^ data[i]) & 0xff] ^ (crc >>> 8); }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function buildZip(entries) {
    var metas = [], offset = 0, FLAG = 0x800, DT = 0x0000, DD = 0x0021;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var p = String(e.path).replace(/\\/g, "/");
      var isDir = !!e.isDir || p.charAt(p.length - 1) === "/";
      if (isDir && p.charAt(p.length - 1) !== "/") p += "/";
      var name = new TextEncoder().encode(p);
      var data = isDir ? new Uint8Array(0) : e.data;
      var crc = isDir ? 0 : crc32(data);
      metas.push({ name: name, data: data, crc: crc, isDir: isDir, off: offset });
      offset += 30 + name.length + data.length;
    }
    var cdSize = 0;
    for (var j = 0; j < metas.length; j++) cdSize += 46 + metas[j].name.length;
    var buf = new Uint8Array(offset + cdSize + 22), dv = new DataView(buf.buffer), pos = 0;
    function w16(v) { dv.setUint16(pos, v, true); pos += 2; }
    function w32(v) { dv.setUint32(pos, v, true); pos += 4; }
    for (var a = 0; a < metas.length; a++) {
      var m = metas[a];
      w32(0x04034b50); w16(20); w16(FLAG); w16(0); w16(DT); w16(DD); w32(m.crc); w32(m.data.length); w32(m.data.length); w16(m.name.length); w16(0);
      buf.set(m.name, pos); pos += m.name.length; buf.set(m.data, pos); pos += m.data.length;
    }
    var cdStart = pos;
    for (var b = 0; b < metas.length; b++) {
      var c = metas[b];
      w32(0x02014b50); w16(20); w16(20); w16(FLAG); w16(0); w16(DT); w16(DD); w32(c.crc); w32(c.data.length); w32(c.data.length); w16(c.name.length); w16(0); w16(0); w16(0); w16(0); w32(c.isDir ? 0x10 : 0); w32(c.off);
      buf.set(c.name, pos); pos += c.name.length;
    }
    var cdEnd = pos;
    w32(0x06054b50); w16(0); w16(0); w16(metas.length); w16(metas.length); w32(cdEnd - cdStart); w32(cdStart); w16(0);
    return buf;
  }

  // ── 暴露到全局 ──
  window.humanSize = humanSize;
  window.escAttr = escAttr;
  window.escapeText = escapeText;
  window.openModal = openModal;
  window.showToast = showToast;
  window.crc32 = crc32;
  window.buildZip = buildZip;
})();
