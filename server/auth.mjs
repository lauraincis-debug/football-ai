import {randomBytes, createHash, timingSafeEqual} from 'node:crypto';
const sessions=new Map();
let loginAttempts=[], apiRequests=[];
const json=(res,status,message)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(message))};
const now=()=>Date.now();
function limit(history, windowMs, max) {const current=now();while(history.length&&history[0]<current-windowMs)history.shift();if(history.length>=max)return false;history.push(current);return true}
function configured(){return typeof process.env.STUDIO_PASSWORD==='string'&&process.env.STUDIO_PASSWORD.length>=16&&process.env.STUDIO_PASSWORD.length<=256}
function equal(a,b){return timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest())}
function cookie(req,token,age){const secure=req.headers['x-forwarded-proto']==='https'||process.env.NODE_ENV==='production';return `studio_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure?'; Secure':''}`}
function validOrigin(req){try{const origin=new URL(req.headers.origin);return ['http:','https:'].includes(origin.protocol)&&origin.host===req.headers.host}catch{return false}}
function authorized(req){const token=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('studio_session='))?.slice('studio_session='.length);const expiry=sessions.get(token);if(!expiry||expiry<=now()){if(token)sessions.delete(token);return false}return true}
export async function guard(req,res,route){
 if(!route.startsWith('/api/gemini/')&&!route.startsWith('/api/auth/'))return true;
 if(req.method!=='POST'){json(res,405,{error:'Méthode non autorisée.'});return false}
 if(!validOrigin(req)||!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')){json(res,403,{error:'Requête non autorisée.'});return false}
 if(!configured()){json(res,503,{error:'Accès IA non configuré : définir STUDIO_PASSWORD (16 caractères minimum) sur le serveur.'});return false}
 if(route==='/api/auth/login'){
  if(!limit(loginAttempts,15*60*1000,10)){json(res,429,{error:'Trop de tentatives. Réessayez dans 15 minutes.'});return false}
  try{let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>2048){json(res,413,{error:'Requête trop volumineuse.'});return false}chunks.push(chunk)}const body=JSON.parse(Buffer.concat(chunks).toString());if(typeof body.password!=='string'||body.password.length>256||!equal(body.password,process.env.STUDIO_PASSWORD)){json(res,401,{error:'Mot de passe incorrect.'});return false}
   for(const [token,expiry] of sessions)if(expiry<=now())sessions.delete(token);if(sessions.size>=100){json(res,429,{error:'Trop de sessions actives. Réessayez plus tard.'});return false}let token=randomBytes(32).toString('hex');sessions.set(token,now()+8*60*60*1000);res.setHeader('Set-Cookie',cookie(req,token,8*60*60));json(res,200,{ok:true});return false;
  }catch{json(res,400,{error:'Requête invalide.'});return false}
 }
 if(route==='/api/auth/logout'){const token=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('studio_session='))?.slice('studio_session='.length);sessions.delete(token);res.setHeader('Set-Cookie',cookie(req,'',0));json(res,200,{ok:true});return false}
 if(!authorized(req)){json(res,401,{error:'Connectez-vous pour utiliser Gemini.'});return false}
 if(!limit(apiRequests,60*60*1000,60)){json(res,429,{error:'Limite du studio atteinte. Réessayez plus tard.'});return false}
 return true;
}
