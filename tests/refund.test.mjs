// Real-path charge/refund check: set a deliberately INVALID AI key so the deployed function charges,
// calls live OpenAlex, gets a real rejection from Anthropic's API, and must refund. Remove the key after.
// supabase secrets set ANTHROPIC_API_KEY=sk-ant-invalid-test-key --project-ref oxcnlommtnziwfbpxigd
// SR=... ANON=... node tests/refund.test.mjs ; supabase secrets unset ANTHROPIC_API_KEY --project-ref oxcnlommtnziwfbpxigd
const URL='https://oxcnlommtnziwfbpxigd.supabase.co', SR=process.env.SR, ANON=process.env.ANON;
const H=(k,t)=>({apikey:k,Authorization:'Bearer '+(t||k),'Content-Type':'application/json'});
const j=async r=>{const t=await r.text();try{return{s:r.status,b:JSON.parse(t)}}catch{return{s:r.status,b:t}}};
const ok=(c,m)=>{console.log((c?'ok  ':'FAIL')+' '+m);if(!c)process.exitCode=1};
const email='refund-test@example.com', pw='T3st-'+Math.random().toString(36).slice(2)+'!aA9';
const l=await (await fetch(URL+'/auth/v1/admin/users?per_page=1000',{headers:H(SR)})).json();for(const u of (l.users||[]).filter(u=>u.email===email))await fetch(URL+'/auth/v1/admin/users/'+u.id,{method:'DELETE',headers:H(SR)});
await fetch(URL+'/auth/v1/admin/users',{method:'POST',headers:H(SR),body:JSON.stringify({email,password:pw,email_confirm:true})});
const S=(await j(await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:H(ANON),body:JSON.stringify({email,password:pw})}))).b;
const uid=S.user.id,tok=S.access_token;
const bal=async()=>(await (await fetch(URL+`/rest/v1/profiles?id=eq.${uid}&select=credits_cents`,{headers:H(SR)})).json())[0].credits_cents;
const ledger=async()=>(await (await fetch(URL+`/rest/v1/credit_ledger?user_id=eq.${uid}&select=delta_cents,reason&order=id`,{headers:H(SR)})).json()).map(r=>r.reason+':'+r.delta_cents).join(' ');
try{
await fetch(URL+'/rest/v1/user_docs',{method:'POST',headers:H(ANON,tok),body:JSON.stringify({kind:'resume',content:'Junior. Built EEG decoding pipeline in Python.'})});
let r=await j(await fetch(URL+'/functions/v1/draft',{method:'POST',headers:H(ANON,tok),body:JSON.stringify({action:'profile'})}));
ok(r.s===500&&/weren't charged/.test(r.b.error)&&/api-key|x-api-key|authentication/i.test(r.b.error),'profile: real Anthropic API rejected the call, user told they were not charged ('+r.s+': '+String(r.b.error).slice(0,80)+')');
ok(await bal()===100,'profile: balance restored to $1.00 after failure');
await fetch(URL+'/rest/v1/profiles?id=eq.'+uid,{method:'PATCH',headers:H(SR),body:JSON.stringify({profile_summary:'Junior. EEG decoding in Python.'})});
r=await j(await fetch(URL+'/functions/v1/draft',{method:'POST',headers:H(ANON,tok),body:JSON.stringify({action:'email',author_name:'Daniel S. Margulies'})}));
ok(r.s===500&&/weren't charged/.test(r.b.error),'email: reached the LLM step (so the live OpenAlex lookup found papers), then failed and refunded ('+r.s+')');
ok(await bal()===100,'email: balance restored to $1.00');
r=await j(await fetch(URL+'/functions/v1/draft',{method:'POST',headers:H(ANON,tok),body:JSON.stringify({action:'email',author_name:'Zzqx Nonexistent Personname'})}));
ok(r.s===404&&/weren't charged/.test(r.b.error),'email to unknown professor: OpenAlex finds nothing, refunded ('+r.s+')');
ok(await bal()===100,'balance still $1.00');
const L=await ledger(); console.log('   ledger:',L);
ok(L==='signup_bonus:100 profile:-10 refund:10 email:-25 refund:25 email:-25 refund:25','ledger shows each charge paired with its refund');
}finally{await fetch(URL+'/auth/v1/admin/users/'+uid,{method:'DELETE',headers:H(SR)});}
