(function(){
  var fab=document.getElementById('uploadFab');
  var overlay=document.getElementById('dropOverlay');
  if(!fab) return;
  var catList=null; // 分类 datalist HTML（懒加载）
  // ZIP 打包(crc32/buildZip)、openModal、showToast、humanSize、escapeText
  // 已抽到 shared.js（页面 head 先加载），这里直接用全局。

  function fetchCats(cb){
    if(catList!=null){ cb(catList); return; }
    fetch('/upload').then(function(r){return r.text();}).then(function(html){
      var m=/id="catlist"[^>]*>([\s\S]*?)<\/datalist>/.exec(html);
      catList = m ? m[1] : '';
      cb(catList);
    }).catch(function(){ catList=''; cb(''); });
  }

  function openUploadModal(presetFile){
    fetchCats(function(cats){
      var fn = presetFile ? '<div class="muted">📎 '+escapeText(presetFile.name)+' <small>('+humanS(presetFile.size)+')</small></div>' : '';
      var body=
        '<form id="upForm" method="post" action="/upload" enctype="multipart/form-data">'+
          fn+
          '<label>选择文件</label>'+
          '<input class="input" type="file" name="file" id="upFile" required>'+
          '<label>或选择文件夹（自动打包为 .zip）</label>'+
          '<input class="input" type="file" id="upFolder" webkitdirectory directory multiple style="padding:6px;font-size:12px">'+
          '<label>分类</label>'+
          '<input class="input" name="category" list="upCatlist" placeholder="可选">'+
          '<datalist id="upCatlist">'+cats+'</datalist>'+
          '<label>描述</label>'+
          '<textarea class="input" name="description" rows="2" placeholder="可选"></textarea>'+
          '<label>价格（积分，0=免费）</label>'+
          '<input class="input" type="number" name="price" min="0" step="1" value="0">'+
        '</form>';
      var foot='<button class="btn" type="button">取消</button><button class="btn btn-primary" type="button" data-submit>上传</button>';
      var m=openModalX('上传文件', body, foot);
      var input=document.getElementById('upFile');
      // 预填拖入的文件（通过 DataTransfer）
      if(presetFile && input){
        var dt=new DataTransfer(); dt.items.add(presetFile); input.files=dt.files; input.hidden=true;
      }
      // 选文件夹：遍历 webkitRelativePath 打包成 zip，回填到 upFile
      var folderInput=document.getElementById('upFolder');
      if(folderInput){
        folderInput.addEventListener('change',function(){
          var files=folderInput.files;
          if(!files||!files.length) return;
          var items=[];
          for(var i=0;i<files.length;i++){
            var rp=files[i].webkitRelativePath||files[i].name;
            items.push({path:rp, file:files[i]});
          }
          // 顶层文件夹名
          var top=(items[0].path.split('/')[0])||'folder';
          packAndOpen(items, top, input, m);
        });
      }
      m.querySelectorAll('.modal-foot .btn').forEach(function(b){
        if(b.hasAttribute('data-submit')) b.onclick=function(){
          submitUpload(document.getElementById('upForm'), b, m);
        };
        else b.onclick=function(){ m.remove(); };
      });
    });
  }

  // 把多文件打包成 zip，回填到文件输入框，并更新提示
  function packAndOpen(items, folderName, fileInput, modal){
    var progEl=modal.querySelector('.modal-body');
    // 显示打包进度
    var prog=document.createElement('div');
    prog.className='notice ok';
    prog.textContent='正在打包 '+items.length+' 个文件…';
    progEl.insertBefore(prog, progEl.firstChild);
    // 异步读取所有文件为 Uint8Array
    var entries=[], done=0, total=items.length;
    function readNext(idx){
      if(idx>=total){
        // 全部读完，构造 zip
        try{
          var zipBytes=buildZip(entries);
          var zipFile=new File([zipBytes], folderName+'.zip', {type:'application/zip'});
          var dtx=new DataTransfer(); dtx.items.add(zipFile); fileInput.files=dtx.files; fileInput.hidden=true;
          prog.className='notice ok';
          prog.textContent='✅ 已打包 '+folderName+'.zip（'+humanS(zipBytes.size)+'，'+total+' 个文件），可设置分类/价格后上传。';
          // 更新顶部文件名提示
          var fnEl=progEl.querySelector('.muted');
          if(fnEl) fnEl.innerHTML='🗜️ '+escapeText(folderName)+'.zip <small>('+humanS(zipBytes.size)+')</small>';
        }catch(err){
          prog.className='notice err';
          prog.textContent='打包失败：'+(err&&err.message||err);
        }
        return;
      }
      var it=items[idx];
      var reader=new FileReader();
      reader.onload=function(){
        var data=new Uint8Array(reader.result);
        entries.push({path:it.path, data:data});
        done++;
        prog.textContent='正在打包 '+done+'/'+total+' 个文件…';
        readNext(idx+1);
      };
      reader.onerror=function(){
        prog.className='notice err';
        prog.textContent='读取文件失败：'+it.path;
      };
      reader.readAsArrayBuffer(it.file);
    }
    readNext(0);
  }

  // 异步上传：fetch + FormData，成功后弹 toast + 关弹窗 + 刷新列表，不整页跳转
  function submitUpload(form, btn, modal){
    if(!form) return;
    var fd=new FormData(form);
    var fileInput=form.querySelector('[name="file"]');
    if(!fileInput||!fileInput.files||!fileInput.files.length){
      showToast('请选择文件','err'); return;
    }
    var fileName=fileInput.files[0].name;
    btn.disabled=true; var origText=btn.textContent; btn.textContent='上传中…';
    fetch('/upload',{method:'POST',body:fd,headers:{'Accept':'application/json','X-Requested-With':'fetch'}}).then(function(r){
      return r.json().then(function(j){return {status:r.status, json:j};}).catch(function(){
        return {status:r.status, json:{ok:false,error:'HTTP '+r.status}};
      });
    }).then(function(res){
      btn.disabled=false; btn.textContent=origText;
      if(res.json && res.json.ok){
        if(modal){ var inner=modal.querySelector('.modal'); modal.classList.add('closing'); if(inner)inner.classList.add('closing'); setTimeout(function(){modal.remove();},200); }
        showToast('✅ '+fileName+' 上传成功','ok', res.json.url);
        // 延迟刷新列表，让 toast 先显示
        setTimeout(function(){ location.reload(); }, 1200);
      } else {
        var errMsg=(res.json&&res.json.error)||('上传失败 HTTP '+res.status);
        if(/auth|登录|login/i.test(errMsg)){ errMsg='登录已过期，请重新登录'; }
        showToast('上传失败：'+(errMsg||'').slice(0,60),'err');
      }
    }).catch(function(e){
      btn.disabled=false; btn.textContent=origText;
      showToast('上传出错：'+(e&&e.message||e),'err');
    });
  }

  // showToast / escapeText / humanSize / openModal 已在 shared.js 定义（全局）。
  // 兼容别名：本文件内用 openModalX / humanS 名字的地方映射到全局。
  var openModalX=window.openModal, humanS=window.humanSize;

  // ── webkitGetAsEntry 递归：把拖入的 DataTransfer 转成 [{path,file}] 列表 ──
  function readEntry(entry, path, out, cb){
    if(entry.isFile){
      entry.file(function(f){ out.push({path:path+entry.name, file:f}); cb(); },
        function(){ cb(); });
    } else if(entry.isDirectory){
      var reader=entry.createReader();
      var allEntries=[];
      var readBatch=function(){
        reader.readEntries(function(batch){
          if(!batch.length){
            // 子目录读完，递归每个子项
            var i=0;
            (function next(){
              if(i>=allEntries.length){ cb(); return; }
              readEntry(allEntries[i], path+entry.name+'/', out, function(){ i++; next(); });
            })();
            return;
          }
          allEntries=allEntries.concat(Array.prototype.slice.call(batch));
          readBatch();
        }, function(){ cb(); });
      };
      readBatch();
    } else { cb(); }
  }
  function readDroppedItems(dataTransfer, cb){
    var items=dataTransfer.items;
    if(items&&items.length&&items[0].webkitGetAsEntry){
      var entries=[], got=0, total=items.length;
      for(var i=0;i<items.length;i++){
        var entry=items[i].webkitGetAsEntry();
        if(entry){ entries.push(entry); }
        else { total--; }
      }
      if(!entries.length){ cb(null); return; }
      var out=[], done=0;
      for(var j=0;j<entries.length;j++){
        readEntry(entries[j], '', out, function(){
          done++;
          if(done>=entries.length){ cb({items:out, isFolder:entries.length===1&&entries[0].isDirectory, topName:entries[0].isDirectory?entries[0].name:(entries.length>1?'files':null)}); }
        });
      }
    } else {
      // 降级：无 webkitGetAsEntry，直接用 files
      var fs=dataTransfer.files, arr=[];
      for(var k=0;k<fs.length;k++) arr.push({path:fs[k].name, file:fs[k]});
      cb(arr.length?{items:arr, isFolder:false, topName:null}:null);
    }
  }

  // 点击 + 按钮
  fab.addEventListener('click',function(){ openUploadModal(null); });

  // 全局拖拽上传
  var dragDepth=0;
  window.addEventListener('dragenter',function(e){
    if(!e.dataTransfer||!Array.from(e.dataTransfer.types||[]).includes('Files')) return;
    e.preventDefault(); dragDepth++; overlay.hidden=false;
  });
  window.addEventListener('dragover',function(e){
    if(!e.dataTransfer||!Array.from(e.dataTransfer.types||[]).includes('Files')) return;
    e.preventDefault(); e.dataTransfer.dropEffect='copy';
  });
  window.addEventListener('dragleave',function(e){
    dragDepth--; if(dragDepth<=0){ overlay.hidden=true; dragDepth=0; }
  });
  window.addEventListener('drop',function(e){
    if(!e.dataTransfer) return;
    e.preventDefault(); dragDepth=0; overlay.hidden=true;
    readDroppedItems(e.dataTransfer, function(res){
      if(!res){ return; }
      // 单个文件（非文件夹）→ 直接上传
      if(res.items.length===1 && !res.isFolder){
        openUploadModal(res.items[0].file);
        return;
      }
      // 文件夹或多文件 → 打包成 zip
      fetchCats(function(cats){
        var folderName=res.topName||(res.items[0].path.split('/')[0])||'files';
        var body='<form id="upForm" method="post" action="/upload" enctype="multipart/form-data">'+
          '<div id="packStatus" class="notice ok">正在打包 '+res.items.length+' 个文件…</div>'+
          '<label>ZIP 文件名</label>'+
          '<input class="input" name="_zipname" id="zipName" value="'+escapeText(folderName)+'.zip">'+
          '<label>分类</label>'+
          '<input class="input" name="category" list="upCatlist2" placeholder="可选">'+
          '<datalist id="upCatlist2">'+cats+'</datalist>'+
          '<label>描述</label>'+
          '<textarea class="input" name="description" rows="2" placeholder="可选"></textarea>'+
          '<label>价格（积分，0=免费）</label>'+
          '<input class="input" type="number" name="price" min="0" step="1" value="0">'+
          '<input type="hidden" name="file" id="upFile">'+
        '</form>';
        var foot='<button class="btn" type="button">取消</button><button class="btn btn-primary" type="button" data-submit disabled>上传</button>';
        var m=openModalX('打包上传', body, foot);
        var fileInput=document.getElementById('upFile');
        var submitBtn=m.querySelector('[data-submit]');
        var nameInput=document.getElementById('zipName');
        // 打包
        var entries=[], done=0, total=res.items.length;
        function readNext(idx){
          if(idx>=total){
            try{
              var zipBytes=buildZip(entries);
              var finalName=(nameInput.value||folderName).replace(/\.zip$/i,'')+'.zip';
              var zipFile=new File([zipBytes], finalName, {type:'application/zip'});
              var dtx=new DataTransfer(); dtx.items.add(zipFile); fileInput.files=dtx.files;
              var st=document.getElementById('packStatus');
              st.className='notice ok';
              st.textContent='✅ 已打包 '+finalName+'（'+humanS(zipBytes.size)+'，'+total+' 个文件）';
              submitBtn.disabled=false;
            }catch(err){
              var st2=document.getElementById('packStatus');
              st2.className='notice err';
              st2.textContent='打包失败：'+(err&&err.message||err);
            }
            return;
          }
          var it=res.items[idx];
          var reader=new FileReader();
          reader.onload=function(){
            entries.push({path:it.path, data:new Uint8Array(reader.result)});
            done++;
            var st=document.getElementById('packStatus');
            if(st) st.textContent='正在打包 '+done+'/'+total+' 个文件…';
            readNext(idx+1);
          };
          reader.readAsArrayBuffer(it.file);
        }
        readNext(0);
        m.querySelectorAll('.modal-foot .btn').forEach(function(b){
          if(b.hasAttribute('data-submit')) b.onclick=function(){ if(!b.disabled) submitUpload(document.getElementById('upForm'), b, m); };
          else b.onclick=function(){ m.remove(); };
        });
      });
    });
  });
})();
