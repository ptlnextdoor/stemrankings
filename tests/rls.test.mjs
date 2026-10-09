// Security check against the live Supabase project. Run: SR=<service_role key> ANON=<anon key> node tests/rls.test.mjs
// Creates and deletes two throwaway users. Never commit the service_role key.
const URL='https://oxcnlommtnziwfbpxigd.supabase.co', SR=process.env.SR, ANON=process.env.ANON;
const H=(k,t)=>({apikey:k,Authorization:'Bearer '+(t||k),'Content-Type':'application/json'});
const j=async r=>{const t=await r.text();try{return{s:r.status,b:JSON.parse(t)}}catch{return{s:r.status,b:t}}};
const pw='T3st-'+Math.random().toString(36).slice(2)+'!aA9';
async function mk(e){await fetch(URL+'/auth/v1/admin/users',{method:'POST',headers:H(SR),body:JSON.stringify({email:e,password:pw,email_confirm:true})});
 const r=await j(await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:H(ANON),body:JSON.stringify({email:e,password:pw})}));return{tok:r.b.access_token,id:r.b.user.id}}
const A=await mk('rls-a@example.com'),B=await mk('rls-b@example.com');
const ok=(c,m)=>{console.log((c?'ok  ':'FAIL')+' '+m);if(!c)process.exitCode=1};
let r=await j(await fetch(URL+'/rest/v1/profiles?select=*',{headers:H(ANON,A.tok)}));ok(r.b.length===1&&r.b[0].plan==='free','signup trigger created profile, plan=free');
r=await j(await fetch(URL+'/rest/v1/saved_professors',{method:'POST',headers:{...H(ANON,A.tok),Prefer:'return=representation'},body:JSON.stringify({author_name:'Ada Lovelace',institution:'MIT'})}));ok(r.s===201,'A can save a professor ('+r.s+')');
r=await j(await fetch(URL+'/rest/v1/saved_professors?select=*',{headers:H(ANON,B.tok)}));ok(Array.isArray(r.b)&&r.b.length===0,'B cannot see A\'s saved list');
r=await j(await fetch(URL+'/rest/v1/saved_professors',{method:'POST',headers:H(ANON,B.tok),body:JSON.stringify({user_id:A.id,author_name:'Injected'})}));ok(r.s>=400,'B cannot insert into A\'s list ('+r.s+')');
r=await j(await fetch(URL+'/rest/v1/saved_professors?author_name=eq.Ada%20Lovelace',{method:'DELETE',headers:{...H(ANON,B.tok),Prefer:'return=representation'}}));ok(Array.isArray(r.b)&&r.b.length===0,'B cannot delete A\'s rows');
r=await j(await fetch(URL+'/rest/v1/profiles?id=eq.'+A.id,{method:'PATCH',headers:{...H(ANON,A.tok),Prefer:'return=representation'},body:JSON.stringify({plan:'pro'})}));ok(r.s>=400,'A cannot self-upgrade plan to pro ('+r.s+')');
r=await j(await fetch(URL+'/rest/v1/profiles?id=eq.'+A.id,{method:'PATCH',headers:{...H(ANON,A.tok),Prefer:'return=representation'},body:JSON.stringify({display_name:'Ada'})}));ok(r.s===200&&r.b[0]?.display_name==='Ada','A can edit display_name');
r=await j(await fetch(URL+'/rest/v1/profiles?select=*',{headers:H(ANON)}));ok(Array.isArray(r.b)&&r.b.length===0,'anonymous visitor sees no profiles');
r=await j(await fetch(URL+'/rest/v1/saved_professors?select=*',{headers:H(ANON)}));ok(Array.isArray(r.b)&&r.b.length===0,'anonymous visitor sees no saved lists');
r=await j(await fetch(URL+'/rest/v1/saved_professors',{method:'POST',headers:H(ANON,A.tok),body:JSON.stringify({author_name:'x'.repeat(500)})}));ok(r.s>=400,'oversized input rejected ('+r.s+')');
for(const u of [A,B]) await fetch(URL+'/auth/v1/admin/users/'+u.id,{method:'DELETE',headers:H(SR)});
r=await j(await fetch(URL+'/rest/v1/saved_professors?select=*',{headers:H(SR)}));ok(r.b.length===0,'deleting a user cascades their data');
