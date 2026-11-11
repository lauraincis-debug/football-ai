import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {handleGemini} from '../server/gemini.mjs';

test('Gemini endpoints require a session and reject cross-origin requests', async t=>{
 process.env.STUDIO_PASSWORD='a-strong-test-password';process.env.GEMINI_API_KEY='test-key';
 const original=globalThis.fetch;let upstream=0;globalThis.fetch=(url,options)=>{if(String(url).startsWith('https://generativelanguage.googleapis.com/')){upstream++;return Promise.resolve(new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({title:'Riz',tips:['Rincer','Mesurer','Cuire']})}]}}]}),{status:200,headers:{'content-type':'application/json'}}))}return original(url,options)};
 const server=createServer((req,res)=>handleGemini(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{globalThis.fetch=original;server.close();delete process.env.STUDIO_PASSWORD;delete process.env.GEMINI_API_KEY});
 const base=`http://127.0.0.1:${server.address().port}`;const post=(path,data,extra={})=>original(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...extra},body:JSON.stringify(data)});
 assert.equal((await post('/api/gemini/script',{idea:'riz'})).status,401);assert.equal(upstream,0);
 assert.equal((await post('/api/auth/login',{password:'wrong'})).status,401);
 assert.equal((await post('/api/auth/login',{password:process.env.STUDIO_PASSWORD},{Origin:'https://evil.example'})).status,403);
 let login=await post('/api/auth/login',{password:process.env.STUDIO_PASSWORD});assert.equal(login.status,200);let cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);
 let result=await post('/api/gemini/script',{idea:'riz'},{Cookie:cookie});assert.equal(result.status,200);assert.equal((await result.json()).title,'Riz');assert.equal(upstream,1);
 assert.equal((await post('/api/auth/logout',{}, {Cookie:cookie})).status,200);assert.equal((await post('/api/gemini/script',{idea:'riz'},{Cookie:cookie})).status,401);
});
