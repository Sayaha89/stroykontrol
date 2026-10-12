const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../functions/create-employee.ts'),'utf8').replace(/^import .*;\n/,'');
(async()=>{for(const mode of ['no-token','bad-token','not-admin','invalid','success','duplicate','profile-error']){
 let handler,created=0,deleted=0;
 const client={auth:{getUser:async()=>({data:{user:mode==='bad-token'?null:{id:'manager'}},error:mode==='bad-token'?{}:null}),admin:{createUser:async()=>{created++;return {data:{user:{id:'new-member'}},error:mode==='duplicate'?{message:'Already exists'}:null}},deleteUser:async()=>{deleted++}}},from:table=>table==='admins'?{select(){return this},eq(){return this},maybeSingle:async()=>({data:mode==='not-admin'?null:{user_id:'manager'},error:null})}:{insert:async()=>({error:mode==='profile-error'?{}:null})}};
 new Function('createClient','Deno',source)(()=>client,{env:{get:()=> 'server-only'},serve:h=>handler=h});
 const response=await handler(new Request('https://function.test',{method:'POST',headers:mode==='no-token'?{}:{Authorization:'Bearer test-token'},body:JSON.stringify({full_name:'Тестовый сотрудник',email:'employee@example.com',password:mode==='invalid'?'short':'initial-password-test'})}));
 const expected={'no-token':401,'bad-token':401,'not-admin':403,invalid:400,success:200,duplicate:400,'profile-error':500}[mode];assert.equal(response.status,expected);
 if(['no-token','bad-token','not-admin','invalid'].includes(mode))assert.equal(created,0);
 if(mode==='profile-error')assert.equal(deleted,1);
 if(mode==='success')assert.equal((await response.json()).member.user_id,'new-member');
 console.log(mode+': passed');
}})().catch(e=>{console.error(e);process.exitCode=1});
