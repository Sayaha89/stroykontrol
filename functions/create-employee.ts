import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
const headers = {'Access-Control-Allow-Origin':'https://sayaha89.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json'};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return reply(405,{error:'Method not allowed'});
 const jwt=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');
 if(!jwt)return reply(401,{error:'Требуется вход'});
 const admin=createClient(Deno.env.get('SUPABASE_URL'),Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await admin.auth.getUser(jwt);
 if(error||!user)return reply(401,{error:'Сессия истекла'});
 const {data:member,error:roleError}=await admin.from('admins').select('user_id').eq('user_id',user.id).maybeSingle();
 if(roleError||!member)return reply(403,{error:'Только руководитель может создавать сотрудников'});
 try{
  const {email,full_name,password}=await req.json();
  if(typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email)||typeof full_name!=='string'||!full_name.trim()||typeof password!=='string'||password.length<12)return reply(400,{error:'Укажите ФИО, почту и пароль от 12 символов'});
  const normalized=email.trim().toLowerCase();
  const {data:created,error:createError}=await admin.auth.admin.createUser({email:normalized,password,email_confirm:true});
  if(createError)return reply(400,{error:createError.message});
  const profile={user_id:created.user.id,full_name:full_name.trim().slice(0,200),email:normalized};
  const {error:profileError}=await admin.from('team_members').insert(profile);
  if(profileError){await admin.auth.admin.deleteUser(created.user.id);return reply(500,{error:'Не удалось создать профиль сотрудника'})}
  return reply(200,{member:profile});
 }catch{return reply(400,{error:'Некорректный запрос'})}
});
