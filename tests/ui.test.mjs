// End-to-end UI check. Serve the repo (python3 -m http.server 8000), then:
// SR=<service_role key> ANON=<anon key> PAGE=http://localhost:8000/ node tests/ui.test.mjs

// Real-time browser driver over Chrome DevTools Protocol (no virtual time).
import { spawn } from 'node:child_process';
const URL='https://oxcnlommtnziwfbpxigd.supabase.co', SR=process.env.SR, ANON=process.env.ANON, PAGE=process.env.PAGE;
const H=(k,t)=>({apikey:k,Authorization:'Bearer '+(t||k),'Content-Type':'application/json'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pw='T3st-'+Math.random().toString(36).slice(2)+'!aA9', email='ui-test@example.com';
await fetch(URL+'/auth/v1/admin/users',{method:'POST',headers:H(SR),body:JSON.stringify({email,password:pw,email_confirm:true})});
const sess=await (await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:H(ANON),body:JSON.stringify({email,password:pw})})).json();
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--remote-debugging-port=9333','--user-data-dir=/tmp/cdp-prof-'+Date.now(),'about:blank'],{stdio:'ignore'});
let tabs; for(let i=0;i<40;i++){try{tabs=await (await fetch('http://127.0.0.1:9333/json')).json();break}catch{await sleep(250)}}
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
let id=0; const pend={}; ws.onmessage=m=>{const d=JSON.parse(m.data); if(d.id&&pend[d.id]){pend[d.id](d);delete pend[d.id]}};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}))});
const ev=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true}); return r.result.result.value ?? r.result.exceptionDetails?.exception?.description};
const res={}; const ok=(c,m)=>{console.log((c?'ok  ':'FAIL')+' '+m); if(!c) process.exitCode=1};
const until=async(expr,ms=15000)=>{for(let t=0;t<ms;t+=250){if(await ev(expr))return true;await sleep(250)}return false};
await send('Page.navigate',{url:PAGE});
ok(await until(`!!document.getElementById('signin-form')`),'signed out: sign-in form shows');
await until(`!!document.querySelector('[id$=-widget]')`);
await ev(`csr.toggleFaculty(document.querySelector('[id$=-widget]').id.replace('-widget',''))`);
ok(await until(`document.querySelectorAll('.save-star').length>0`),'faculty rows show save stars');
await ev(`document.querySelector('.save-star').click()`);
ok(await until(`document.getElementById('signin-msg').textContent.includes('Sign in to save')`),'signed-out star click prompts sign-in');
// sign in by planting the real session supabase-js would store after the magic link
await ev(`localStorage.setItem('sb-oxcnlommtnziwfbpxigd-auth-token', ${JSON.stringify(JSON.stringify(sess))})`);
await send('Page.reload');
ok(await until(`(document.getElementById('account-bar')||{}).textContent?.includes('Signed in as ${email}')`),'signed in: bar shows email');
await until(`!!document.querySelector('[id$=-widget]')`);
await ev(`csr.toggleFaculty(document.querySelector('[id$=-widget]').id.replace('-widget',''))`);
await until(`document.querySelectorAll('.save-star').length>0`);
const name=await ev(`document.querySelector('.save-star').dataset.name`);
await ev(`document.querySelector('.save-star').click()`);
ok(await until(`document.querySelector('.save-star').textContent==='\u2605'`),`star fills after saving "${name}"`);
ok(await until(`document.getElementById('mylist-btn').textContent==='My list (1)'`),'My list count = 1');
let db=await (await fetch(URL+'/rest/v1/saved_professors?select=author_name,user_id',{headers:H(SR)})).json();
ok(db.length===1&&db[0].author_name===name&&db[0].user_id===sess.user.id,'row persisted in database for this user');
await send('Page.reload');
ok(await until(`(document.getElementById('mylist-btn')||{}).textContent==='My list (1)'`),'saved list survives page reload');
await ev(`document.getElementById('mylist-btn').click()`);
ok(await until(`document.getElementById('my-list').textContent.includes(${JSON.stringify(name)})`),'My list panel shows the professor');
await ev(`document.querySelector('[data-remove]').click()`);
ok(await until(`document.getElementById('mylist-btn').textContent==='My list (0)'`),'remove from list works');
db=await (await fetch(URL+'/rest/v1/saved_professors?select=author_name',{headers:H(SR)})).json();
ok(db.length===0,'row deleted from database');
await ev(`document.getElementById('signout-btn').click()`);
ok(await until(`!!document.getElementById('signin-form')`),'sign out returns to sign-in form');
ws.close(); chrome.kill();
await fetch(URL+'/auth/v1/admin/users/'+sess.user.id,{method:'DELETE',headers:H(SR)});
