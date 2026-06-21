(function(){
  var menu = document.getElementById('ctxmenu');
  if(!menu) return;
  function build(items){
    return items.map(function(it){
      if(it.sep) return '<div class="ctx-sep"></div>';
      if(it.href) return '<a class="ctx-item" href="'+it.href+'">'+it.icon+it.label+'</a>';
      return '<button class="ctx-item" data-act="'+it.act+'">'+it.icon+it.label+'</button>';
    }).join('');
  }
  function show(items, x, y, ctx){
    menu.innerHTML = build(items);
    menu.hidden = false;
    // 定位（防止溢出）
    menu.style.left = '0px'; menu.style.top = '0px';
    var rect = menu.getBoundingClientRect();
    var px = Math.min(x, window.innerWidth - rect.width - 8);
    var py = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = px + 'px'; menu.style.top = py + 'px';
    menu._ctx = ctx;
  }
  function hide(){ menu.hidden = true; menu._ctx = null; }
  document.addEventListener('click', function(e){
    if(!menu.hidden && !menu.contains(e.target)) hide();
  });
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);

  // 触发：对带 [data-ctxjson] 的元素
  document.addEventListener('contextmenu', function(e){
    var el = e.target.closest('[data-ctxjson]');
    if(!el) return;
    e.preventDefault();
    var ctx = JSON.parse(el.getAttribute('data-ctxjson'));
    var items = window.__buildCtxMenu ? window.__buildCtxMenu(ctx) : [];
    if(!items.length) return;
    show(items, e.clientX, e.clientY, ctx);
  });
  // 长按（移动端）
  var lpTimer = null, lpEl = null, lpXY = null;
  document.addEventListener('touchstart', function(e){
    var el = e.target.closest('[data-ctxjson]');
    if(!el) return;
    lpEl = el;
    var t = e.touches[0]; lpXY = {x:t.clientX, y:t.clientY};
    lpTimer = setTimeout(function(){
      if(!lpEl) return;
      var ctx = JSON.parse(lpEl.getAttribute('data-ctxjson'));
      var items = window.__buildCtxMenu ? window.__buildCtxMenu(ctx) : [];
      if(items.length) show(items, lpXY.x, lpXY.y, ctx);
    }, 550);
  }, {passive:true});
  document.addEventListener('touchmove', function(){ clearTimeout(lpTimer); lpEl=null; }, {passive:true});
  document.addEventListener('touchend', function(){ clearTimeout(lpTimer); lpEl=null; }, {passive:true});

  // 菜单项点击（事件委托）
  menu.addEventListener('click', function(e){
    var item = e.target.closest('.ctx-item');
    if(!item || !menu._ctx) return;
    var act = item.getAttribute('data-act');
    if(act && window.__ctxAction) window.__ctxAction(act, menu._ctx);
    hide();
  });
  // Esc 关闭
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') hide(); });
})();
