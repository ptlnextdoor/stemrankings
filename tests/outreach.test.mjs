// Outreach checks against the live project. Run: SR=<service_role> ANON=<anon> node tests/outreach.test.mjs
// Creates and deletes throwaway users. Works with or without an LLM key configured.
const URL='https://oxcnlommtnziwfbpxigd.supabase.co', SR=process.env.SR, ANON=process.env.ANON;
const H=(k,t)=>({apikey:k,Authorization:'Bearer '+(t||k),'Content-Type':'application/json'});
const j=async r=>{const t=await r.text();try{return{s:r.status,b:JSON.parse(t)}}catch{return{s:r.status,b:t}}};
const pw='T3st-'+Math.random().toString(36).slice(2)+'!aA9';
const ok=(c,m)=>{console.log((c?'ok  ':'FAIL')+' '+m);if(!c)process.exitCode=1};
const purge=async(e)=>{const l=await (await fetch(URL+'/auth/v1/admin/users?per_page=1000',{headers:H(SR)})).json();for(const u of (l.users||[]).filter(u=>u.email===e))await fetch(URL+'/auth/v1/admin/users/'+u.id,{method:'DELETE',headers:H(SR)})};
async function mk(e){await purge(e);await fetch(URL+'/auth/v1/admin/users',{method:'POST',headers:H(SR),body:JSON.stringify({email:e,password:pw,email_confirm:true})});
 const r=await j(await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:H(ANON),body:JSON.stringify({email:e,password:pw})}));return{tok:r.b.access_token,id:r.b.user.id}}
const fn=(tok,body)=>fetch(URL+'/functions/v1/draft',{method:'POST',headers:H(ANON,tok),body:JSON.stringify(body)}).then(j);
const A=await mk('out-a@example.com'),B=await mk('out-b@example.com');
try{
let r=await j(await fetch(URL+'/rest/v1/user_docs',{method:'POST',headers:{...H(ANON,A.tok),Prefer:'return=representation'},body:JSON.stringify({kind:'resume',title:'CV',content:'High school junior. Built a 6-DOF robot arm for plasma wound therapy, positioning error under 0.1 mm. Python, ROS, SolidWorks.'})}));
ok(r.s===201,'A can add a document');
r=await j(await fetch(URL+'/rest/v1/user_docs?select=*',{headers:H(ANON,B.tok)}));ok(Array.isArray(r.b)&&r.b.length===0,"B cannot read A's documents");
r=await j(await fetch(URL+'/rest/v1/user_docs?select=*',{headers:H(ANON)}));ok(Array.isArray(r.b)&&r.b.length===0,'anonymous visitor cannot read documents');
r=await j(await fetch(URL+'/rest/v1/profiles?id=eq.'+A.id,{method:'PATCH',headers:H(ANON,A.tok),body:JSON.stringify({profile_summary:'I won a Nobel prize'})}));ok(r.s>=400,'A cannot write profile_summary directly ('+r.s+')');
r=await j(await fetch(URL+'/rest/v1/drafts',{method:'POST',headers:H(ANON,A.tok),body:JSON.stringify({author_name:'x',subject:'s',body:'b'})}));ok(r.s>=400,'A cannot forge drafts ('+r.s+')');
r=await j(await fetch(URL+'/rest/v1/credit_ledger',{method:'POST',headers:H(ANON,A.tok),body:JSON.stringify({user_id:A.id,delta_cents:5000,reason:'admin'})}));ok(r.s>=400,'A cannot write the credit ledger ('+r.s+')');
r=await fn(null,{action:'profile'});ok(r.s===401,'function rejects signed-out callers ('+r.s+')');
r=await fn(B.tok,{action:'profile'});ok(r.s===400&&/Add your resume/.test(r.b.error),'profile build without docs explains what to do');
r=await fn(A.tok,{action:'email',author_name:'Daniel S. Margulies'});ok(r.s===400&&/Build your profile/.test(r.b.error),'email before profile explains what to do');
r=await fn(A.tok,{action:'nope'});ok(r.s===400,'unknown action rejected ('+r.s+')');
r=await fn(A.tok,{action:'profile'});
const keyed=r.s===200;
if(!keyed){ok(r.s===503&&/AI key/.test(r.b.error),'no LLM key yet: clear "not switched on" message ('+r.s+')');}
else{
 ok(typeof r.b.profile_summary==='string'&&r.b.profile_summary.length>20,'profile built from documents');
 ok(!/nobel/i.test(r.b.profile_summary),'profile does not invent facts');
 r=await fn(A.tok,{action:'email',author_name:'Daniel S. Margulies'});
 ok(r.s===200&&r.b.subject&&r.b.body,'email drafted');
 const w=(r.b.body||'').split(/\s+/).length;ok(w>=60&&w<=180,`body is concise (${w} words)`);
 ok((r.b.papers||[]).some(p=>(r.b.body||'').toLowerCase().includes((p.title||'').toLowerCase().split(' ').slice(0,3).join(' '))),'body names one of the professor\'s real papers');
 console.log('--- sample draft ---\nSUBJECT: '+r.b.subject+'\n'+r.b.body+'\n---');
}
// out of credits: zero B's balance, then a profile build must return 402 (only reachable once an AI key is set).
await fetch(URL+'/rest/v1/profiles?id=eq.'+B.id,{method:'PATCH',headers:H(SR),body:JSON.stringify({credits_cents:0})});
await fetch(URL+'/rest/v1/user_docs',{method:'POST',headers:H(ANON,B.tok),body:JSON.stringify({kind:'bio',content:'x'})});
r=await fn(B.tok,{action:'profile'});
ok(keyed ? (r.s===402&&r.b.credits) : r.s===503,'zero balance blocks generation server-side ('+r.s+')');
}finally{
for(const u of [A,B]) await fetch(URL+'/auth/v1/admin/users/'+u.id,{method:'DELETE',headers:H(SR)});
const left=await (await fetch(URL+'/rest/v1/user_docs?select=id',{headers:H(SR)})).json();ok(left.length===0,'deleting users removes their documents');
}
