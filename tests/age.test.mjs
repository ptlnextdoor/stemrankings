// COPPA age gate against the live project. Run: SR=<service_role> ANON=<anon> node tests/age.test.mjs
const URL='https://oxcnlommtnziwfbpxigd.supabase.co', SR=process.env.SR, ANON=process.env.ANON;
const H=(k,t)=>({apikey:k,Authorization:'Bearer '+(t||k),'Content-Type':'application/json'});
const j=async p=>{const r=await p;const t=await r.text();try{return{s:r.status,b:JSON.parse(t)}}catch{return{s:r.status,b:t}}};
const ok=(c,m)=>{console.log((c?'ok  ':'FAIL')+' '+m);if(!c)process.exitCode=1};
const pw='T3st-'+Math.random().toString(36).slice(2)+'!aA9';
const purge=async(e)=>{const l=await (await fetch(URL+'/auth/v1/admin/users?per_page=1000',{headers:H(SR)})).json();for(const u of (l.users||[]).filter(u=>u.email===e))await fetch(URL+'/auth/v1/admin/users/'+u.id,{method:'DELETE',headers:H(SR)})};
async function mk(e){await purge(e);await fetch(URL+'/auth/v1/admin/users',{method:'POST',headers:H(SR),body:JSON.stringify({email:e,password:pw,email_confirm:true})});
 const r=await j(await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:H(ANON),body:JSON.stringify({email:e,password:pw})}));return{tok:r.b.access_token,id:r.b.user.id}}
const Y=new Date().getFullYear();
const save=(u,n)=>j(fetch(URL+'/rest/v1/saved_professors',{method:'POST',headers:H(ANON,u.tok),body:JSON.stringify({author_name:n})}));
const setYear=(u,y)=>j(fetch(URL+'/rest/v1/profiles?id=eq.'+u.id,{method:'PATCH',headers:{...H(ANON,u.tok),Prefer:'return=representation'},body:JSON.stringify({birth_year:y})}));
const fn=(u,path,body)=>j(fetch(URL+'/functions/v1/'+path,{method:'POST',headers:H(ANON,u.tok),body:JSON.stringify(body)}));
const N=await mk('age-none@example.com'), K=await mk('age-kid@example.com'), T=await mk('age-teen@example.com');
try{
let r=await save(N,'X');ok(r.s>=400,'no birth year yet: cannot save professors ('+r.s+')');
r=await j(fetch(URL+'/rest/v1/user_docs',{method:'POST',headers:H(ANON,N.tok),body:JSON.stringify({kind:'bio',content:'x'})}));ok(r.s>=400,'no birth year yet: cannot upload documents ('+r.s+')');
r=await fn(N,'draft',{action:'profile'});ok(r.s===403&&r.b.age,'no birth year yet: draft function refuses ('+r.s+')');
r=await setYear(K,Y-12);ok(r.s===200,'12-year-old can record birth year');
r=await save(K,'X');ok(r.s>=400,'under 13: cannot save professors ('+r.s+')');
r=await fn(K,'draft',{action:'profile'});ok(r.s===403,'under 13: draft function refuses ('+r.s+')');
r=await fn(K,'billing',{action:'checkout'});ok(r.s===403&&/13 or older/.test(r.b.error),'under 13: cannot start a subscription ('+r.s+')');
r=await setYear(K,Y-20);ok(r.s>=400,'birth year cannot be changed after it is set ('+r.s+')');
r=await j(fetch(URL+`/rest/v1/profiles?id=eq.${K.id}&select=birth_year`,{headers:H(SR)}));ok(r.b[0].birth_year===Y-12,'birth year still the original value');
r=await setYear(T,Y-13);ok(r.s===200,'13-year-old records birth year');
r=await save(T,'Y');ok(r.s===201,'13 and over: can save professors ('+r.s+')');
r=await fn(T,'billing',{action:'checkout'});ok(r.s===200&&/^https:\/\/checkout\.stripe\.com\//.test(r.b.url),'13 and over: gets a Stripe checkout session ('+r.s+')');
r=await setYear(T,Y-40);ok(r.s>=400,'teen cannot change birth year either');
}finally{for(const u of [N,K,T]) await fetch(URL+'/auth/v1/admin/users/'+u.id,{method:'DELETE',headers:H(SR)});}
