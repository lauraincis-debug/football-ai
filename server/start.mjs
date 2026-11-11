import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {handleGemini} from './gemini.mjs';
const root=resolve('www');const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.webmanifest':'application/manifest+json'};
createServer(async(req,res)=>{let path;try{path=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}catch{res.writeHead(400).end();return}if(path.startsWith('/api/'))return handleGemini(req,res);let file=resolve(root,'.'+(path==='/'?'/index.html':path));if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403).end();return}try{let data=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(data)}catch{res.writeHead(404).end('Not found')}}).listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Cuisine Land server listening'));
