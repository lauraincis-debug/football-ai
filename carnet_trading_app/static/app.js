let jeton = null;
const $ = id => document.getElementById(id);
async function api(path, options={}) {
  const headers = new Headers(options.headers || {});
  if (jeton) headers.set("Authorization", `Bearer ${jeton}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type","application/json");
  let response;
  try { response = await fetch(path,{...options,headers,credentials:"omit"}); }
  catch(e) { throw new Error("Erreur réseau : vérifiez que le serveur est lancé."); }
  const data = await response.json().catch(()=>({detail:"Réponse serveur illisible"}));
  if (response.status===401 && path!=="/api/connexion") { logout(); throw new Error("Session expirée, reconnectez-vous."); }
  if (!response.ok) throw new Error(data.detail || `Erreur HTTP ${response.status}`);
  return data;
}
function logout(){jeton=null;$("dashboard").hidden=true;$("login-panel").hidden=false;}
$("login-form").addEventListener("submit",async e=>{
 e.preventDefault();$("login-error").textContent="";
 try{const d=await api("/api/connexion",{method:"POST",body:JSON.stringify({password:$("password").value,
    totp_code:$("totp").value})});jeton=d.access_token;$("password").value="";$("totp").value="";$("login-panel").hidden=true;$("dashboard").hidden=false;await refresh();}
 catch(err){$("login-error").textContent=err.message;}
});
$("logout").addEventListener("click",logout);
async function refresh(){
 const s=await api("/api/etat");$("capital").textContent=`$${Number(s.capital).toFixed(2)}`;
 const r=s.etat_risque, l=r.limits;
 $("status").textContent=s.arret_urgence?"ARRÊT D'URGENCE ACTIF":"Système actif · Simulation";
 $("status").className=s.arret_urgence?"bad":"good";
 $("risk-summary").innerHTML=`Perte du jour : <b class="${r.day_pnl<0?'bad':'good'}">$${r.day_pnl.toFixed(2)}</b><br>Perte semaine : <b class="${r.week_pnl<0?'bad':'good'}">$${r.week_pnl.toFixed(2)}</b><br>
    Drawdown : ${(r.drawdown*100).toFixed(2)}% / ${(l.drawdown_max*100).toFixed(1)}%<br>Trades aujourd'hui : ${r.trades_today} / ${l.trades_max_jour}<br>Pertes consécutives : ${r.losses_in_row} / ${l.pertes_consecutives_max}<br>Arrêt d'urgence : ${s.arret_urgence?'ACTIF':'inactif'}`;
 renderTrades(s.transactions);
}
function renderTrades(trades){
 const body=$("trades");body.replaceChildren();
 for(const t of trades){const tr=document.createElement("tr");
   [t.id,t.instrument,t.side,t.entry,t.stop,t.quantity,t.status,t.status==="closed"?Number(t.pnl).toFixed
    (2):"—"].forEach(v=>{const td=document.createElement("td");td.textContent=String(v);tr.appendChild(td
    );});
   const td=document.createElement("td");
   if(t.status==="open"){const b=document.createElement("button");b.textContent="Clôturer";b.addEventListener("click",async()=>{const px=prompt("Prix de sortie simulé :");if(!px||!Number.isFinite(Number(px)
    )||Number(px)<=0)return;try{const out=await api(`/api/transactions/${t.id}/cloturer`,{method:"POST",body:JSON.stringify({exit_price:Number(px)})});alert(`PnL simulé : $${out.pnl}`);await refresh();}catch(e){alert(e.message)}});td.appendChild(b);}else td.textContent="—";
   tr.appendChild(td);body.appendChild(tr);
 }
}

$("trade-form").addEventListener("submit",async e=>{
 e.preventDefault();$("trade-message").textContent="";
 const v={instrument:$("instrument").value,side:$("side").value,entry:Number($("entry").value),stop:Number($("stop").value),target:$("target").value?Number($("target").value):null,quantity:Number($("quantity").value),note:$("note").value};
 try{const d=await api("/api/transactions",{method:"POST",body:JSON.stringify(v)});$("trade-message").textContent=`Trade papier #${d.id} ouvert. Risque simulé : $${d.risk_usd}`;await refresh();}
 catch(err){$("trade-message").textContent=err.message;}
});
$("stop-button").addEventListener("click",async()=>{try{await api("/api/arret-urgence",{method:"POST",body:JSON.stringify({confirmation:$("stop-confirm").value})});$("emergency-message").textContent="Arrêtactivé.";await refresh();}catch(e){$("emergency-message").textContent=e.message}});
$("resume-button").addEventListener("click",async()=>{try{await api("/api/reactiver",{method:"POST",body:
    JSON.stringify({confirmation:$("resume-confirm").value})});$("emergency-message").textContent="Système réactivé en mode simulation.";await refresh();}catch(e){$("emergency-message").textContent=e.message}});
$("run-backtest").addEventListener("click",async()=>{
 const f=$("csv").files[0];if(!f){$("backtest-result").textContent="Choisissez un CSV.";return;}
 try{
  const text=await f.text();const lines=text.trim().split(/\r?\n/);
  const headers=lines.shift().split(",").map(x=>x.trim().toLowerCase());
  const required=["timestamp","open","high","low","close","volume"];
  const missing=required.filter(h=>!headers.includes(h));
  if(missing.length)throw new Error("Colonnes obligatoires absentes : "+missing.join(", "));
  const candles=lines.filter(Boolean).map(line=>{const a=line.split(",");const o={};headers.forEach((h,i)=>o[h]=["timestamp"].includes(h)?a[i].trim():Number(a[i]));return o;});
  const result=await api("/api/backtest",{method:"POST",body:JSON.stringify({candles})});
  $("backtest-result").textContent=JSON.stringify(result,null,2);
 }catch(e){$("backtest-result").textContent=e.message;}
});
$("live-form").addEventListener("submit",async e=>{
 e.preventDefault();$("live-message").textContent="";
 if($("live-confirm").value!=="I_ACCEPT_REAL_FINANCIAL_RISK"){ $("live-message").textContent="Confirmation exacte requise.";return; }
 const body={symbol:$("live-symbol").value,side:$("live-side").value,amount:Number($("live-amount").value
    ),price:Number($("live-price").value),stop_price:Number($("live-stop").value)};
 try{const d=await api("/api/live/order",{method:"POST",body:JSON.stringify(body)});$("live-message").textContent=JSON.stringify(d);}
 catch(err){$("live-message").textContent=err.message;}
});
