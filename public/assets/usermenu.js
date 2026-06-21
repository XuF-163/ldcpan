(function(){
  var menu=document.getElementById('userMenu');
  var dd=document.getElementById('userDropdown');
  if(!menu||!dd) return;
  var loaded=false;
  window.__toggleUserMenu=function(e){
    e.stopPropagation();
    var willOpen=dd.hidden;
    dd.hidden=!willOpen;
    if(willOpen && !loaded){ loaded=true; loadStats(); }
  };
  // 点外部关闭
  document.addEventListener('click',function(e){
    if(!dd.hidden && !menu.contains(e.target)) dd.hidden=true;
  });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape') dd.hidden=true; });

  function loadStats(){
    var box=document.getElementById('udStats');
    fetch('/admin/stats').then(function(r){return r.json();}).then(function(s){
      box.innerHTML=
        '<div class="ud-grid ud-grid-2">'+
          '<div class="ud-stat"><div class="ud-k">💰 总收益</div><div class="ud-v">'+s.revenue.total+'<small>积分</small></div><div class="ud-sub2 muted">'+s.revenue.orders+' 笔 · 近7天 '+s.revenue.last7d.total+'</div></div>'+
          '<div class="ud-stat"><div class="ud-k">💾 存储占用</div><div class="ud-v">'+humanSize(s.storage.bytes)+'</div><div class="ud-sub2 muted">'+s.storage.files+' 文件 · '+s.storage.downloads+' 下载</div></div>'+
        '</div>'+
        '<div class="ud-grid ud-grid-3">'+
          '<div class="ud-mini c-user"><div class="ud-mk">👤 用户</div><div class="ud-mv">'+s.users+'</div></div>'+
          '<div class="ud-mini c-share"><div class="ud-mk">🔗 分享</div><div class="ud-mv">'+s.shares+'</div></div>'+
          '<div class="ud-mini c-buy"><div class="ud-mk">🛒 购买</div><div class="ud-mv">'+s.purchases+'</div></div>'+
        '</div>';
    }).catch(function(){
      box.innerHTML='<div class="ud-loading muted">统计加载失败</div>';
    });
  }
})();
