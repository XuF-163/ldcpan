(function(){
  try{
    var KEY='ldcpan_theme';
    var mode = localStorage.getItem(KEY) || 'auto';
    function isNight(){
      // UTC+8 当前小时
      var now = new Date();
      var utc8 = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
      var h = utc8.getHours();
      return h >= 22 || h < 6;
    }
    function apply(m){
      var dark = (m === 'dark') || (m === 'auto' && isNight());
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    }
    window.__setTheme = function(m){
      try{ localStorage.setItem(KEY, m); }catch(e){}
      apply(m);
      var btn = document.querySelector('.theme-toggle');
      if(btn){ btn.setAttribute('data-mode', m); }
    };
    window.__getTheme = function(){ return mode; };
    apply(mode);
    document.addEventListener('DOMContentLoaded', function(){
      var btn = document.querySelector('.theme-toggle');
      if(!btn) return;
      btn.setAttribute('data-mode', mode);
      btn.addEventListener('click', function(){
        var cur = (localStorage.getItem(KEY) || 'auto');
        var next = cur === 'auto' ? 'light' : (cur === 'light' ? 'dark' : 'auto');
        window.__setTheme(next);
      });
    });
  }catch(e){}
})();
