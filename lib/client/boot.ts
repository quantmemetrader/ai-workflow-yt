/**
 * The few lines that run before React, from app/layout.tsx's <head>.
 *
 * 1. Translate. The studio reads this app through Chrome's translate, which
 *    replaces text nodes with its own <font> elements. When React later
 *    removes or moves a node whose parent translate changed, the DOM throws
 *    NotFoundError and React gives up on the whole page. Removals and inserts
 *    that no longer match the DOM are made harmless instead.
 * 2. A tab left open across a deploy. It asks for a script of the old build;
 *    if that fails, or a server action from the old build is not found, the
 *    page reloads itself once (never twice within 30 s) instead of showing a
 *    dead end.
 * 3. Everything else that throws in the browser is reported to
 *    /api/client-error (at most five per page), so it shows up in the server
 *    log instead of only on somebody's screen.
 *
 * Plain ES5 in a string: it runs before any bundle and must not depend on one.
 */
export const BOOT_SCRIPT = `(function(){
try{
  if(typeof Node==="function"&&Node.prototype&&!Node.prototype.__auraGuard){
    var rc=Node.prototype.removeChild;
    Node.prototype.removeChild=function(c){
      if(c&&c.parentNode!==this){return c.parentNode?rc.call(c.parentNode,c):c;}
      return rc.apply(this,arguments);
    };
    var ib=Node.prototype.insertBefore;
    Node.prototype.insertBefore=function(n,r){
      if(r&&r.parentNode!==this){return ib.call(this,n,null);}
      return ib.apply(this,arguments);
    };
    Node.prototype.__auraGuard=true;
  }
}catch(e){}
try{
  /* Everything stays Simplified (the owner, 30 Sep). The page says translate="no";
     a browser or 繁简 extension that rewrites it anyway is caught by a hidden
     probe: its text changes, the person is told how to turn it off, and it is
     reported (kind "zh-convert") so we know whose browser does it. */
  var de=document.documentElement;
  de.setAttribute("translate","no");de.classList.add("notranslate");
  var PROBE="简体中文：时间同事草稿你们这样";
  var warned=0;
  var warn=function(seen){
    if(warned)return;warned=1;
    try{var b=JSON.stringify({kind:"zh-convert",message:String(seen).slice(0,80),stack:"",digest:"",url:location.pathname});if(navigator.sendBeacon)navigator.sendBeacon("/api/client-error",new Blob([b],{type:"application/json"}));}catch(e){}
    try{if(sessionStorage.getItem("tg:zh-warned"))return;sessionStorage.setItem("tg:zh-warned","1");}catch(e){}
    var d=document.createElement("div");
    d.setAttribute("translate","no");d.className="notranslate";d.setAttribute("role","alert");
    d.style.cssText="position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;max-width:min(640px,calc(100vw - 24px));background:#fff7e6;border:1px solid #f0c36d;color:#6b4a07;border-radius:12px;padding:12px 40px 12px 14px;font:13px/1.6 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.12)";
    d.textContent="你的浏览器正在把页面自动转成繁体，所以会看到错字。本站内容全部是简体中文：请关闭浏览器的「翻译」（地址栏右侧的翻译图标 › 一律不翻译），或停用繁简转换插件，然后刷新页面。";
    var x=document.createElement("button");x.type="button";x.textContent="×";x.setAttribute("aria-label","关闭");
    x.style.cssText="position:absolute;right:8px;top:6px;border:0;background:none;font-size:18px;color:#6b4a07;cursor:pointer";
    x.onclick=function(){d.remove();};d.appendChild(x);
    (document.body||de).appendChild(d);
  };
  var probe=function(){
    var p=document.createElement("span");
    p.id="tg-zh-probe";p.setAttribute("aria-hidden","true");p.textContent=PROBE;
    p.style.cssText="position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;white-space:nowrap";
    document.body.appendChild(p);
    var check=function(){var t=p.textContent||"";if(t&&t!==PROBE)warn(t);};
    if(typeof MutationObserver==="function")new MutationObserver(check).observe(p,{characterData:true,childList:true,subtree:true});
    var n=0,iv=setInterval(function(){check();if(++n>30)clearInterval(iv);},2000);
  };
  var later=function(){setTimeout(probe,1500);};
  if(document.readyState==="complete")later();else window.addEventListener("load",later);
}catch(e){}
var KEY="aura:reloaded-at",sent=0;
function stale(m){return /ChunkLoadError|Loading (CSS )?chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to find Server Action|older or newer deployment/i.test(m||"");}
function reloadOnce(){try{var t=+sessionStorage.getItem(KEY)||0;if(Date.now()-t<30000)return false;sessionStorage.setItem(KEY,String(Date.now()));}catch(e){}location.reload();return true;}
function report(kind,msg,stack,digest){
  if(sent>=5)return;sent++;
  try{
    var b=JSON.stringify({kind:kind,message:String(msg||"").slice(0,500),stack:String(stack||"").slice(0,1500),digest:digest||"",url:location.pathname+location.search});
    if(navigator.sendBeacon){navigator.sendBeacon("/api/client-error",new Blob([b],{type:"application/json"}));}
    else{fetch("/api/client-error",{method:"POST",body:b,keepalive:true,headers:{"content-type":"application/json"}});}
  }catch(e){}
}
window.__aura={report:report,stale:stale,reloadOnce:reloadOnce};
window.addEventListener("error",function(e){
  var t=e&&e.target,m="";
  if(t&&t!==window&&(t.tagName==="SCRIPT"||(t.tagName==="LINK"&&t.rel==="stylesheet"))){
    m="ChunkLoadError: failed to load "+(t.src||t.href);
  }else if(t&&t!==window){return;}
  else{m=(e&&(e.message||(e.error&&e.error.message)))||"";}
  report("error",m,e&&e.error&&e.error.stack);
  if(stale(m))reloadOnce();
},true);
window.addEventListener("unhandledrejection",function(e){
  var r=e&&e.reason,m=(r&&(r.message||String(r)))||"";
  report("rejection",m,r&&r.stack);
  if(stale(m))reloadOnce();
});
})();`;
