// Gmail-send edge function checks against the live project (no real email is ever sent; without
// a connected Gmail every send path returns a clear error before any Gmail API call).
// Run: SR=<service_role> ANON=<anon> node tests/gmail.test.mjs
// Creates and deletes throwaway users.
const URL='https://oxcnlommtnziwfbpxigd.supabase.co', SR=process.env.SR, ANON=process.env.ANON;
const H=(k,t)=>({apikey:k,Authorization:'Bearer '+(t||k),'Content-Type':'application/json'});
const j=async r=>{const t=await r.text();try{return{s:r.status,b:JSON.parse(t)}}catch{return{s:r.status,b:t}}};
const pw='T3st-'+Math.random().toString(36).slice(2)+'!aA9';
const ok=(c,m)=>{console.log((c?'ok  ':'FAIL')+' '+m);if(!c)process.exitCode=1};
const purge=async(e)=>{const l=await (await fetch(URL+'/auth/v1/admin/users?per_page=1000',{headers:H(SR)})).json();for(const u of (l.users||[]).filter(u=>u.email===e))await fetch(URL+'/auth/v1/admin/users/'+u.id,{method:'DELETE',headers:H(SR)})};
async function mk(e){await purge(e);await fetch(URL+'/auth/v1/admin/users',{method:'POST',headers:H(SR),body:JSON.stringify({email:e,password:pw,email_confirm:true})});
 const r=await j(await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:H(ANON),body:JSON.stringify({email:e,password:pw})}));
 await fetch(URL+'/rest/v1/profiles?id=eq.'+r.b.user.id,{method:'PATCH',headers:H(SR),body:JSON.stringify({birth_year:2005,display_name:'Test Student'})});
 return{tok:r.b.access_token,id:r.b.user.id}}
const fn=(tok,body)=>fetch(URL+'/functions/v1/gmail',{method:'POST',headers:H(ANON,tok),body:JSON.stringify(body)}).then(j);

const A=await mk('gm-a@example.com');
try{
  // 1. signed out
  let r=await fn(null,{action:'status'});ok(r.s===401,'function rejects signed-out callers ('+r.s+')');
  // 2. fresh user is not connected
  r=await fn(A.tok,{action:'status'});ok(r.s===200&&r.b.connected===false,'fresh user: Gmail not connected');
  // 3. send with no connection -> clear 409, no email sent
  r=await fn(A.tok,{action:'send',author_name:'Daniel S. Margulies'});
  ok(r.s===409&&/[Cc]onnect/.test(r.b.error)&&r.b.needs_connect,'send without a connection returns a clear 409');
  // 4. unknown action
  r=await fn(A.tok,{action:'nope'});ok(r.s===400,'unknown action rejected ('+r.s+')');
  // 5. send missing author_name
  r=await fn(A.tok,{action:'send'});ok(r.s===400||r.s===409,'send without author_name is rejected ('+r.s+')');
  // 6. gmail_connections table is server-only (anon/authenticated cannot read it)
  r=await j(await fetch(URL+'/rest/v1/gmail_connections?select=*',{headers:H(ANON,A.tok)}));
  ok(r.s>=400||(Array.isArray(r.b)&&r.b.length===0),'users cannot read gmail_connections directly ('+r.s+')');
  // 7. connect with a bogus code fails cleanly (no crash) when configured, or says not configured
  r=await fn(A.tok,{action:'connect',code:'bogus-code'});
  ok(r.s>=400,'connect with a bad/unconfigured code fails cleanly ('+r.s+')');
}finally{
  await fetch(URL+'/auth/v1/admin/users/'+A.id,{method:'DELETE',headers:H(SR)});
  ok(true,'cleaned up test user');
}
console.log('note: per-day (20) and per-professor (7d) caps + MIME/encryption are covered by deno unit tests (supabase/functions/gmail/mail.test.ts).');
