// Browser test of the profile panel: paste a doc, upload a real PDF, build profile.
// Serve the repo, then: SR=... ANON=... PAGE=http://localhost:8000/ PDF=/path/to/resume.pdf node tests/profile-ui.test.mjs
import { spawn } from 'node:child_process';
const URL='https://oxcnlommtnziwfbpxigd.supabase.co', SR=process.env.SR, ANON=process.env.ANON, PAGE=process.env.PAGE, PDF=process.env.PDF;
const H=(k,t)=>({apikey:k,Authorization:'Bearer '+(t||k),'Content-Type':'application/json'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pw='T3st-'+Math.random().toString(36).slice(2)+'!aA9', email='profile-ui@example.com';
const purge=async(e)=>{const l=await (await fetch(URL+'/auth/v1/admin/users?per_page=1000',{headers:H(SR)})).json();for(const u of (l.users||[]).filter(u=>u.email===e))await fetch(URL+'/auth/v1/admin/users/'+u.id,{method:'DELETE',headers:H(SR)})};
await purge(email);
await fetch(URL+'/auth/v1/admin/users',{method:'POST',headers:H(SR),body:JSON.stringify({email,password:pw,email_confirm:true})});
const sess=await (await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:H(ANON),body:JSON.stringify({email,password:pw})})).json();
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--remote-debugging-port=9334','--user-data-dir=/tmp/cdp-prof2-'+Date.now(),'about:blank'],{stdio:'ignore'});
let tabs; for(let i=0;i<40;i++){try{tabs=await (await fetch('http://127.0.0.1:9334/json')).json();break}catch{await sleep(250)}}
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
let id=0; const pend={}; ws.onmessage=m=>{const d=JSON.parse(m.data); if(d.id&&pend[d.id]){pend[d.id](d);delete pend[d.id]}};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}))});
const ev=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true}); return r.result.result.value};
const ok=(c,m)=>{console.log((c?'ok  ':'FAIL')+' '+m); if(!c) process.exitCode=1};
const until=async(expr,ms=20000)=>{for(let t=0;t<ms;t+=250){if(await ev(expr))return true;await sleep(250)}return false};
try{
await send('Page.navigate',{url:PAGE}); await until(`!!document.getElementById('signin-form')`);
await ev(`localStorage.setItem('sb-oxcnlommtnziwfbpxigd-auth-token', ${JSON.stringify(JSON.stringify(sess))})`);
await send('Page.reload');
ok(await until(`!!document.getElementById('profile-btn')`),'signed in: My profile button shows');
ok(await until(`document.getElementById('credits').textContent==='$1.00 credits'`),'bar shows the $1.00 signup credit');
await ev(`document.getElementById('billing-btn').click()`);
ok(await until(`/switched on/i.test(document.getElementById('billing-msg').textContent) || location.host.includes('stripe')`),'"Get $10/mo plan" reaches the server (Stripe page, or "not switched on" until keys are set)');
console.log('   billing:', await ev(`document.getElementById('billing-msg') ? document.getElementById('billing-msg').textContent : location.href`));
await ev(`document.getElementById('profile-btn').click()`);
ok(await until(`!!document.getElementById('doc-form')`),'profile panel opens with upload form');
ok(await ev(`document.getElementById('build-profile').disabled`),'Build profile disabled until a document exists');
await ev(`document.getElementById('doc-kind').value='bio'; document.getElementById('doc-text').value='I want to work on neural engineering and EEG decoding.'; document.getElementById('doc-form').requestSubmit()`);
ok(await until(`document.querySelectorAll('.docs [data-deldoc]').length===1`),'pasted bio saved and listed');
// real file upload through the file input
await send('DOM.enable'); const {result:{root}}=await send('DOM.getDocument',{depth:-1});
const {result:{nodeId}}=await send('DOM.querySelector',{nodeId:root.nodeId,selector:'#doc-file'});
await send('DOM.setFileInputFiles',{nodeId,files:[PDF]});
await ev(`document.getElementById('doc-kind').value='resume'; document.getElementById('doc-form').requestSubmit()`);
ok(await until(`document.querySelectorAll('.docs [data-deldoc]').length===2`,30000),'PDF resume uploaded and listed');
const rows=await (await fetch(URL+'/rest/v1/user_docs?select=kind,title,content',{headers:H(SR)})).json();
const pdfRow=rows.find(r=>r.kind==='resume');
ok(pdfRow&&/robot arm/i.test(pdfRow.content)&&/0\.1 mm/.test(pdfRow.content),'PDF text extracted correctly into the database');
ok(await until(`!document.getElementById('build-profile').disabled`),'Build profile enabled once documents exist');
await ev(`document.getElementById('build-profile').click()`);
ok(await until(`/AI key|Rebuild/.test(document.getElementById('my-profile').textContent)`),'Build profile responds (key missing message, or a built profile)');
console.log('   build result:', (await ev(`(document.getElementById('build-msg')||{}).textContent || 'profile built'`)));
await ev(`document.querySelector('[data-deldoc]').click()`);
ok(await until(`document.querySelectorAll('.docs [data-deldoc]').length===1`),'delete document works');
}finally{ ws.close(); chrome.kill(); await fetch(URL+'/auth/v1/admin/users/'+sess.user.id,{method:'DELETE',headers:H(SR)}); }
