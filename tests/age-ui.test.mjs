// Browser: a new account is asked its birth year once; under-13 is blocked, 13+ gets the full bar.
// Serve the repo, then: SR=... ANON=... PAGE=http://localhost:8000/ node tests/age-ui.test.mjs
import { spawn } from 'node:child_process';
const URL='https://oxcnlommtnziwfbpxigd.supabase.co', SR=process.env.SR, ANON=process.env.ANON, PAGE=process.env.PAGE;
const H=(k,t)=>({apikey:k,Authorization:'Bearer '+(t||k),'Content-Type':'application/json'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ok=(c,m)=>{console.log((c?'ok  ':'FAIL')+' '+m); if(!c) process.exitCode=1};
const purge=async(e)=>{const l=await (await fetch(URL+'/auth/v1/admin/users?per_page=1000',{headers:H(SR)})).json();for(const u of (l.users||[]).filter(u=>u.email===e))await fetch(URL+'/auth/v1/admin/users/'+u.id,{method:'DELETE',headers:H(SR)})};
async function session(email){const pw='T3st-'+Math.random().toString(36).slice(2)+'!aA9';await purge(email);
 await fetch(URL+'/auth/v1/admin/users',{method:'POST',headers:H(SR),body:JSON.stringify({email,password:pw,email_confirm:true})});
 return (await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:H(ANON),body:JSON.stringify({email,password:pw})})).json();}
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--remote-debugging-port=9336','--user-data-dir=/tmp/cdp-age-'+Date.now(),'about:blank'],{stdio:'ignore'});
let tabs; for(let i=0;i<40;i++){try{tabs=await (await fetch('http://127.0.0.1:9336/json')).json();break}catch{await sleep(250)}}
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
let id=0; const pend={}; ws.onmessage=m=>{const d=JSON.parse(m.data); if(d.id&&pend[d.id]){pend[d.id](d);delete pend[d.id]}};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}))});
const ev=async(expr)=>{if(/(^|;)\s*(const|let) /.test(expr)) expr='{'+expr+'}';const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true}); return r.result.result.value};
const until=async(expr,ms=20000)=>{for(let t=0;t<ms;t+=250){if(await ev(expr))return true;await sleep(250)}return false};
const Y=new Date().getFullYear();
async function signIn(s){await send('Page.navigate',{url:PAGE}); await until(`!!document.getElementById('account-bar')`);
 await ev(`localStorage.setItem('sb-oxcnlommtnziwfbpxigd-auth-token', ${JSON.stringify(JSON.stringify(s))})`); await send('Page.reload');}
const kid=await session('ageui-kid@example.com'), teen=await session('ageui-teen@example.com');
try{
await signIn(kid);
ok(await until(`!!document.getElementById('age-form')`),'new account sees the birth-year question');
ok(await ev(`!document.getElementById('mylist-btn')`),'no account features before answering');
await ev(`document.getElementById('age-year').value='${Y-11}'; document.getElementById('age-form').requestSubmit()`);
ok(await until(`/13 or older/.test(document.getElementById('account-bar').textContent)`),'under-13 sees the block message');
ok(await ev(`!document.getElementById('mylist-btn') && !document.getElementById('billing-btn')`),'under-13 gets no list, profile or billing');
await ev(`document.getElementById('find-q').value='soft robotics'; document.getElementById('find-form').requestSubmit()`);
ok(await until(`document.querySelectorAll('.prof-card').length>0`),'under-13 can still search professors');
await send('Page.reload');
ok(await until(`/13 or older/.test(document.getElementById('account-bar').textContent)`),'block persists after reload (no re-asking)');
await ev(`localStorage.clear()`);
await signIn(teen);
await until(`!!document.getElementById('age-form')`);
await ev(`document.getElementById('age-year').value='${Y-16}'; document.getElementById('age-form').requestSubmit()`);
ok(await until(`!!document.getElementById('mylist-btn') && /credits/.test(document.getElementById('account-bar').textContent)`),'16-year-old gets the full account bar with credits');
await send('Page.reload');
ok(await until(`!!document.getElementById('mylist-btn')`),'not asked again after reload');
ok(await ev(`!document.getElementById('age-form')`),'birth-year form gone for good');
}finally{ ws.close(); chrome.kill(); await purge('ageui-kid@example.com'); await purge('ageui-teen@example.com'); }
