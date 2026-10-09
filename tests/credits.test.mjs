// Credits + billing checks against the live project.
// Run: SR=<service_role> ANON=<anon> WHS=<STRIPE_WEBHOOK_SECRET set on the project> node tests/credits.test.mjs
// Sends correctly signed (and forged) Stripe events to the deployed webhook. Creates/deletes a throwaway user.
import { createHmac } from 'node:crypto';
const URL='https://oxcnlommtnziwfbpxigd.supabase.co', SR=process.env.SR, ANON=process.env.ANON, WHS=process.env.WHS;
const H=(k,t)=>({apikey:k,Authorization:'Bearer '+(t||k),'Content-Type':'application/json'});
const j=async r=>{const t=await r.text();try{return{s:r.status,b:JSON.parse(t)}}catch{return{s:r.status,b:t}}};
const ok=(c,m)=>{console.log((c?'ok  ':'FAIL')+' '+m);if(!c)process.exitCode=1};
const pw='T3st-'+Math.random().toString(36).slice(2)+'!aA9', email='credits-test@example.com';
const purge=async(e)=>{const l=await (await fetch(URL+'/auth/v1/admin/users?per_page=1000',{headers:H(SR)})).json();for(const u of (l.users||[]).filter(u=>u.email===e))await fetch(URL+'/auth/v1/admin/users/'+u.id,{method:'DELETE',headers:H(SR)})};
await purge(email);
await fetch(URL+'/auth/v1/admin/users',{method:'POST',headers:H(SR),body:JSON.stringify({email,password:pw,email_confirm:true})});
const S=(await j(await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:H(ANON),body:JSON.stringify({email,password:pw})}))).b;
const uid=S.user.id, tok=S.access_token;
const bal=async()=>(await (await fetch(URL+`/rest/v1/profiles?id=eq.${uid}&select=credits_cents,plan`,{headers:H(SR)})).json())[0];
const sign=(raw,secret=WHS,ts=Math.floor(Date.now()/1000))=>`t=${ts},v1=`+createHmac('sha256',secret).update(`${ts}.${raw}`).digest('hex');
const hook=(evt,sig)=>{const raw=JSON.stringify(evt);return fetch(URL+'/functions/v1/stripe-webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':sig??sign(raw)},body:raw}).then(j)};
const invoice=(id,amt=1000)=>({type:'invoice.paid',data:{object:{id,subscription:'sub_test',amount_paid:amt,customer:'cus_test_'+uid.slice(0,8),subscription_details:{metadata:{user_id:uid}}}}});
try{
let b=await bal(); ok(b.credits_cents===100 && b.plan==='free','new user gets $1.00 signup credit');
let r=await j(await fetch(URL+'/rest/v1/profiles?id=eq.'+uid,{method:'PATCH',headers:H(ANON,tok),body:JSON.stringify({credits_cents:999999})}));ok(r.s>=400,'user cannot set own balance ('+r.s+')');
r=await j(await fetch(URL+'/rest/v1/rpc/grant_credits',{method:'POST',headers:H(ANON,tok),body:JSON.stringify({p_user:uid,p_amount:99999,p_reason:'admin',p_ref:'hack'})}));ok(r.s>=400,'user cannot call grant_credits ('+r.s+')');
r=await j(await fetch(URL+'/rest/v1/rpc/spend_credits',{method:'POST',headers:H(ANON,tok),body:JSON.stringify({p_user:uid,p_cost:-5000,p_reason:'draft'})}));ok(r.s>=400,'user cannot call spend_credits with a negative cost ('+r.s+')');
r=await j(await fetch(URL+'/rest/v1/credit_ledger',{method:'POST',headers:H(ANON,tok),body:JSON.stringify({user_id:uid,delta_cents:5000,reason:'admin'})}));ok(r.s>=400,'user cannot write the ledger ('+r.s+')');
r=await j(await fetch(URL+'/rest/v1/credit_ledger?select=delta_cents,reason',{headers:H(ANON,tok)}));ok(r.b.length===1&&r.b[0].reason==='signup_bonus','user can read own ledger');
// webhook security
r=await hook(invoice('in_forged'),'t=1,v1=deadbeef');ok(r.s===400,'forged signature rejected ('+r.s+')');
r=await hook(invoice('in_wrongkey'),sign(JSON.stringify(invoice('in_wrongkey')),'whsec_wrong'));ok(r.s===400,'signature with wrong secret rejected');
const old=Math.floor(Date.now()/1000)-3600; r=await hook(invoice('in_replay'),sign(JSON.stringify(invoice('in_replay')),WHS,old));ok(r.s===400,'replayed (hour-old) event rejected');
ok((await bal()).credits_cents===100,'balance unchanged after rejected events');
// paid invoice grants $10 once
r=await hook(invoice('in_test_1'));ok(r.s===200,'valid signed invoice.paid accepted');
b=await bal();ok(b.credits_cents===1100&&b.plan==='pro','invoice.paid grants $10 of credits and sets plan=pro ('+b.credits_cents+')');
r=await hook(invoice('in_test_1'));ok((await bal()).credits_cents===1100,'Stripe retry of the same invoice does not double-grant');
r=await hook(invoice('in_test_2'));ok((await bal()).credits_cents===2100,'next month renewal adds another $10 (credits roll over)');
r=await hook(invoice('in_zero',0));ok((await bal()).credits_cents===2100,'$0 invoice grants nothing');
// spend path: atomic, no overdraft
await fetch(URL+'/rest/v1/profiles?id=eq.'+uid,{method:'PATCH',headers:H(SR),body:JSON.stringify({credits_cents:50})});
const spends=await Promise.all(Array.from({length:6},()=>fetch(URL+'/rest/v1/rpc/spend_credits',{method:'POST',headers:H(SR),body:JSON.stringify({p_user:uid,p_cost:25,p_reason:'draft'})}).then(r=>r.status)));
ok(spends.filter(s=>s===200).length===2,`6 parallel $0.25 spends on a $0.50 balance: exactly 2 succeed (${spends.join(',')})`);
ok((await bal()).credits_cents===0,'balance never goes negative');
// cancel
r=await hook({type:'customer.subscription.deleted',data:{object:{customer:'cus_none'}}});ok(r.s===200,'cancel for unknown customer handled');
await fetch(URL+'/rest/v1/profiles?id=eq.'+uid,{method:'PATCH',headers:H(SR),body:JSON.stringify({stripe_customer_id:'cus_t_'+uid.slice(0,8),credits_cents:300})});
r=await hook({type:'customer.subscription.deleted',data:{object:{customer:'cus_t_'+uid.slice(0,8)}}});
b=await bal();ok(b.plan==='free'&&b.credits_cents===300,'cancelling sets plan=free and keeps remaining credits');
// draft function with no AI key: must not charge
r=await j(await fetch(URL+'/functions/v1/draft',{method:'POST',headers:H(ANON,tok),body:JSON.stringify({action:'profile'})}));
ok((await bal()).credits_cents===300,'a request that cannot run is not charged ('+r.s+')');
r=await j(await fetch(URL+'/functions/v1/billing',{method:'POST',headers:H(ANON,tok),body:JSON.stringify({action:'checkout'})}));ok(r.s===503||r.s===200,'checkout responds ('+r.s+(r.b.error?': '+r.b.error:'')+')');
}finally{ await fetch(URL+'/auth/v1/admin/users/'+uid,{method:'DELETE',headers:H(SR)}); }
