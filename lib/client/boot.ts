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
