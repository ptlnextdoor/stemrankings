// End-to-end: find professors by interest, save one, run it through the outreach tracker.
// Serve the repo, then: SR=... ANON=... PAGE=http://localhost:8000/ node tests/tracker-ui.test.mjs
import { spawn } from 'node:child_process';
const URL='https://oxcnlommtnziwfbpxigd.supabase.co', SR=process.env.SR, ANON=process.env.ANON, PAGE=process.env.PAGE;
const H=(k,t)=>({apikey:k,Authorization:'Bearer '+(t||k),'Content-Type':'application/json'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const email='tracker-ui@example.com', pw='T3st-'+Math.random().toString(36).slice(2)+'!aA9';
const purge=async(e)=>{const l=await (await fetch(URL+'/auth/v1/admin/users?per_page=1000',{headers:H(SR)})).json();for(const u of (l.users||[]).filter(u=>u.email===e))await fetch(URL+'/auth/v1/admin/users/'+u.id,{method:'DELETE',headers:H(SR)})};
await purge(email);
await fetch(URL+'/auth/v1/admin/users',{method:'POST',headers:H(SR),body:JSON.stringify({email,password:pw,email_confirm:true})});
const sess=await (await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:H(ANON),body:JSON.stringify({email,password:pw})})).json();
await fetch(URL+'/rest/v1/profiles?id=eq.'+sess.user.id,{method:'PATCH',headers:H(SR),body:JSON.stringify({birth_year:2005,display_name:'Test Student'})});
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--remote-debugging-port=9335','--user-data-dir=/tmp/cdp-tr-'+Date.now(),'about:blank'],{stdio:'ignore'});
let tabs; for(let i=0;i<40;i++){try{tabs=await (await fetch('http://127.0.0.1:9335/json')).json();break}catch{await sleep(250)}}
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
let id=0; const pend={}; ws.onmessage=m=>{const d=JSON.parse(m.data); if(d.id&&pend[d.id]){pend[d.id](d);delete pend[d.id]}};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}))});
const ev=async(expr)=>{if(/^\s*(const|let) /.test(expr)||/;\s*(const|let) /.test(expr)) expr='{'+expr+'}';const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true}); return r.result.result.value};
const ok=(c,m)=>{console.log((c?'ok  ':'FAIL')+' '+m); if(!c) process.exitCode=1};
const until=async(expr,ms=30000)=>{for(let t=0;t<ms;t+=250){if(await ev(expr))return true;await sleep(250)}return false};
const db=async()=>(await (await fetch(URL+'/rest/v1/saved_professors?select=*&user_id=eq.'+sess.user.id,{headers:H(SR)})).json());
try{
await send('Page.navigate',{url:PAGE}); await until(`!!document.getElementById('find-form')`);
// finder works signed OUT (free discovery)
await ev(`document.getElementById('find-q').value='soft robotics actuators'; document.getElementById('find-form').requestSubmit()`);
ok(await until(`document.querySelectorAll('.prof-card').length>=10`),'signed out: finder returns 10+ professor cards');
const top=await ev(`[...document.querySelectorAll('.prof-card b a')].slice(0,5).map(a=>a.textContent).join(', ')`);
console.log('   top results:', top);
ok(await ev(`[...document.querySelectorAll('.prof-card')].every(c=>c.querySelectorAll('li').length>=1 && /active 20\\d\\d/.test(c.textContent))`),'every card shows recent papers and an active year');
// professor page panel
await ev(`document.querySelector('.prof-card .prof-open').click()`);
ok(await until(`document.querySelector('#prof-panel.open h3') && /papers in 2 yrs/.test(document.getElementById('prof-panel').textContent)`),'clicking a name opens the professor panel with stats');
ok(await ev(`document.querySelectorAll('#prof-panel .pp-papers li').length>=3`),'panel lists recent papers');
const colab=await ev(`document.querySelectorAll('#prof-panel .pp-collab .prof-open').length`); console.log('   collaborators listed:', colab);
if(colab){ const before=await ev(`document.querySelector('#prof-panel h3').firstChild.textContent.trim()`);
  await ev(`document.querySelector('#prof-panel .pp-collab .prof-open').click()`);
  ok(await until(`document.querySelector('#prof-panel h3') && document.querySelector('#prof-panel h3').firstChild.textContent.trim()!==${JSON.stringify(before)}`),'clicking a collaborator opens their page'); }
await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
ok(await until(`!document.querySelector('#prof-panel.open')`),'Escape closes the panel');
await ev(`document.querySelector('.prof-card .save-star').click()`);
ok(await until(`/Sign in to save/.test(document.getElementById('signin-msg').textContent)`),'saving while signed out prompts sign-in');
// sign in, search again, save from results
await ev(`localStorage.setItem('sb-oxcnlommtnziwfbpxigd-auth-token', ${JSON.stringify(JSON.stringify(sess))})`);
await send('Page.reload'); await until(`!!document.getElementById('mylist-btn')`);
await ev(`document.getElementById('find-q').value='soft robotics actuators'; document.getElementById('find-form').requestSubmit()`);
await until(`document.querySelectorAll('.prof-card').length>=10`);
const name=await ev(`document.querySelector('.prof-card b a').textContent`);
await ev(`document.querySelector('.prof-card .save-star').click()`);
ok(await until(`document.querySelector('.prof-card .save-star').textContent==='\u2605'`),`saved "${name}" from finder (star fills)`);
let rows=await db(); ok(rows.length===1&&rows[0].author_name===name&&rows[0].openalex_id&&rows[0].status==='saved','DB row has OpenAlex id and status=saved');
// tracker
await ev(`document.getElementById('mylist-btn').click()`);
ok(await until(`!!document.querySelector('.tracker select[data-field=status]')`),'tracker table renders');
await ev(`const s=document.querySelector('.tracker select[data-field=status]'); s.value='sent'; s.dispatchEvent(new Event('change'))`);
ok(await until(`/Sent 1/.test(document.querySelector('.pipeline').textContent)`),'status -> Sent updates the pipeline counts');
rows=await db(); const d10=new Date(Date.now()+10*864e5).toISOString().slice(0,10);
ok(rows[0].status==='sent'&&rows[0].sent_at&&rows[0].follow_up_on===d10,`marking Sent records sent_at and auto-sets follow-up to ${d10} (got ${rows[0].follow_up_on})`);
ok(await ev(`document.querySelector('.tracker input[data-field=follow_up_on]').value===${JSON.stringify(d10)}`),'follow-up date shown in the table');
await ev(`const e=document.querySelector('.tracker input[data-field=contact_email]'); e.value='not-an-email'; window.alert=m=>window._a=m; e.dispatchEvent(new Event('change'))`);
ok(await until(`/doesn't look right/.test(window._a||'')`),'invalid email rejected');
await sleep(500);
await ev(`window._a=''; const e=document.querySelector('.tracker input[data-field=contact_email]'); e.value='prof@university.edu'; e.dispatchEvent(new Event('change'))`);
await sleep(1500);
await ev(`const n=document.querySelector('.tracker input[data-field=note]'); n.value='Asked about summer 2027 internship'; n.dispatchEvent(new Event('change'))`);
await sleep(1500); rows=await db();
ok(rows[0].contact_email==='prof@university.edu'&&rows[0].note==='Asked about summer 2027 internship','email and note saved');
// overdue follow-up banner
await fetch(URL+'/rest/v1/saved_professors?user_id=eq.'+sess.user.id,{method:'PATCH',headers:H(SR),body:JSON.stringify({follow_up_on:'2020-01-01'})});
await send('Page.reload'); await until(`!!document.getElementById('mylist-btn')`); await ev(`document.getElementById('mylist-btn').click()`);
ok(await until(`/Follow up today/.test((document.querySelector('.due')||{}).textContent||'')`),'overdue follow-up shows a reminder banner');
await ev(`const s=document.querySelector('.tracker select[data-field=status]'); s.value='replied'; s.dispatchEvent(new Event('change'))`);
ok(await until(`!document.querySelector('.due')`),'marking Replied clears the reminder');
// isolation: another user cannot read this tracker
const o=await (await fetch(URL+'/rest/v1/saved_professors?select=*',{headers:H(ANON)})).json();ok(Array.isArray(o)&&o.length===0,'anonymous visitor cannot read tracker rows');
}finally{ ws.close(); chrome.kill(); await purge(email); }
