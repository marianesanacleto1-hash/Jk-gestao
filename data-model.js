/* Cliente -> serviço contratado (offerings) -> visita realizada (services) -> pagamento.
 * services retains its historic storage key; no visit is inferred from a client date.
 */
(function(root){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const key=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
function today(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function validDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return false;const d=new Date(s+'T12:00:00');return !isNaN(d)&&iso(d)===s}
function iso(d){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function nextDate(last,freq){if(!last||freq==='Avulso')return '';const d=new Date(last+'T12:00:00');if(freq==='Quinzenal')d.setDate(d.getDate()+15);else if(freq==='A cada 10 dias')d.setDate(d.getDate()+10);else if(freq==='Mensal')d.setMonth(d.getMonth()+1);else return '';if(d.getDay()===6)d.setDate(d.getDate()+2);else if(d.getDay()===0)d.setDate(d.getDate()+1);return iso(d)}
const frequencies=['A cada 10 dias','Quinzenal','Mensal','Avulso'];
function base(){return {clients:[],offerings:[],services:[],payments:[],meta:{schemaVersion:3}}}
function migrate(input){
 if(!input||!Array.isArray(input.clients))throw Error('Backup inválido.');
 if(input.meta?.schemaVersion===3){const db=clone(input);validate(db);return db}
 const source=clone(input),db={...clone(input),clients:[],offerings:[],services:clone(input.services||[]),payments:clone(input.payments||[]),meta:{...(input.meta||{}),schemaVersion:3}};
 // Reviewed identities only: both Sesc Forquilhinha records are the same customer.
 const sescA='fcd27097-8882-45f5-ace2-cddf24470bbb',sescB='4b2a17fa-1f0b-4a0c-af92-d4af010906ee';
 const a=source.clients.find(c=>c.id===sescA),b=source.clients.find(c=>c.id===sescB);
 const mergeSesc=a&&b&&key(a.name)==='sesc'&&key(b.name)==='sesc'&&key(a.address??a.city)==='forquilhinha'&&key(b.address??b.city)==='forquilhinha';
 const clientMap={};
 for(const c of source.clients){const id=mergeSesc&&c.id===sescB?sescA:c.id;clientMap[c.id]=id;
  if(!db.clients.some(x=>x.id===id))db.clients.push({id,name:mergeSesc&&id===sescA?'Sesc Forquilhinha':c.name,address:c.address??c.city??''});
  db.offerings.push({id:'offering_'+c.id,clientId:id,name:c.notes?.trim()||'Serviço cadastrado',freq:c.freq||'Avulso',value:Number(c.value||0),nextDue:c.nextDue||'',legacyClientId:c.id});
 }
 const aliases={};
 // Reviewed duplicate import stubs: keep the valid initial visit and archive the stub.
 const pairs=[['7a768f86-4f2e-4883-aa94-16bdad360240','57dfc294-467e-40d4-b86f-976be445780c'],['db40d540-0dc1-44e1-ba97-c67f5dbaa1ba','79b5199b-82e9-4264-8579-ebc9949852b2']];
 for(const [oldId,keepId] of pairs){const old=db.services.find(s=>s.id===oldId),keep=db.services.find(s=>s.id===keepId);
  if(old&&keep&&old.clientId===keep.clientId&&old.date===keep.date&&Number(old.amount)===0&&old.note==='Importado de versão antiga'&&keep.note?.startsWith('Histórico inicial')&&keep.cyclePosition===1){
   // Never consolidate an import that has acquired a genuine active nonzero payment.
   if(db.payments.some(p=>p.serviceId===oldId&&!p.reversedAt&&Number(p.amount)!==0))continue;
   aliases[oldId]=keepId;db.services=db.services.filter(s=>s.id!==oldId);
  }
 }
 for(const s of db.services){s.offeringId='offering_'+s.clientId;s.clientId=clientMap[s.clientId]||s.clientId;if(aliases[s.cycleFirstId])s.cycleFirstId=aliases[s.cycleFirstId]}
 for(const p of db.payments){if(aliases[p.serviceId]){p.legacyServiceId=p.serviceId;p.serviceId=aliases[p.serviceId]}p.clientId=clientMap[p.clientId]||p.clientId;const s=db.services.find(s=>s.id===p.serviceId);if(s)p.offeringId=s.offeringId}
 // Explicitly link existing sequential fortnightly pairs; do not create dates or visits.
 for(const o of db.offerings){let first=null;for(const s of visitsFor(db,o.id)){if(s.cyclePosition===1)first=s;else if(s.cyclePosition===2){if(first&&!s.cycleFirstId)s.cycleFirstId=first.id;first=null}}}
 db.migrationArchive={...(db.migrationArchive||{}),structureV3:{source,clientAliases:clientMap,visitAliases:aliases}};
 validate(db);return db;
}
function validate(db){
 for(const list of ['clients','offerings','services','payments']){if(!Array.isArray(db[list]))throw Error('Estrutura inválida: '+list);const ids=new Set();for(const x of db[list]){if(!x.id||ids.has(x.id))throw Error('Identificador duplicado: '+list);ids.add(x.id)}}
 for(const o of db.offerings)if(!db.clients.some(c=>c.id===o.clientId))throw Error('Serviço sem cliente.');
 for(const s of db.services){const o=db.offerings.find(o=>o.id===s.offeringId);if(!o||o.clientId!==s.clientId)throw Error('Visita sem serviço/cliente válido.');if(!validDate(s.date))throw Error('Data de visita inválida.')}
 for(const p of db.payments){const s=db.services.find(s=>s.id===p.serviceId);if(!s||s.clientId!==p.clientId||s.offeringId!==p.offeringId)throw Error('Pagamento sem visita/serviço válido.')}
 return true;
}
function visitsFor(db,id){return db.services.filter(s=>s.offeringId===id).sort((a,b)=>a.date.localeCompare(b.date))}
function activePayments(db){return db.payments.filter(p=>!p.reversedAt)}
function pending(db,asOf=today()){return db.services.filter(s=>s.chargeDue&&!s.paid&&s.date<=asOf)}
function totalPending(db,asOf=today()){return pending(db,asOf).reduce((sum,s)=>sum+Number(s.amount||0),0)}
function paidMonth(db,asOf=today()){return activePayments(db).filter(p=>(p.date||'').startsWith(asOf.slice(0,7))).reduce((sum,p)=>sum+Number(p.amount||0),0)}
function saveClient(db,input,id){const name=input.name?.trim(),address=input.address?.trim()||'';if(!name)throw Error('Informe o nome do cliente.');const duplicate=db.clients.find(c=>c.id!==id&&key(c.name)===key(name));if(duplicate)throw Error('Este cliente já está cadastrado. Abra “Serviços” nesse cliente para adicionar outro serviço.');const c=id?db.clients.find(c=>c.id===id):null;if(id&&!c)throw Error('Cliente não encontrado.');const out={...(c||{}),id:id||input.id,name,address};if(c)Object.assign(c,out);else db.clients.push(out);return out}
function saveOffering(db,input,id){const c=db.clients.find(c=>c.id===input.clientId),name=input.name?.trim(),value=Number(input.value);if(!c||!name)throw Error('Selecione o cliente e informe a descrição do serviço.');if(!frequencies.includes(input.freq)||!Number.isFinite(value)||value<0)throw Error('Frequência ou valor inválido.');if(input.nextDue&&!validDate(input.nextDue))throw Error('Próxima visita inválida.');if(db.offerings.some(o=>o.id!==id&&o.clientId===c.id&&key(o.name)===key(name)))throw Error('Este serviço já existe neste cliente. Edite o serviço existente.');const old=id?db.offerings.find(o=>o.id===id):null;if(id&&!old)throw Error('Serviço não encontrado.');if(old&&old.clientId!==c.id)throw Error('Não é possível trocar o cliente deste serviço.');const out={...(old||{}),id:id||input.id,clientId:c.id,name,freq:input.freq,value,nextDue:input.nextDue||''};if(old)Object.assign(old,out);else db.offerings.push(out);return out}
function complete(db,offeringId,{id,date,amount,note=''},asOf=today()){
 const o=db.offerings.find(o=>o.id===offeringId);if(!o)throw Error('Selecione o serviço.');if(!validDate(date)||date>asOf)throw Error('Informe uma data realizada, até hoje.');amount=Number(amount);if(!Number.isFinite(amount)||amount<0)throw Error('Valor inválido.');
 const visits=visitsFor(db,o.id);if(visits.some(s=>s.date===date))throw Error('Este serviço já possui visita registrada neste dia. Consulte a aba Visitas.');
 if(o.freq==='Quinzenal'&&visits.at(-1)?.date>date)throw Error('Registre as visitas quinzenais na ordem das datas para preservar o ciclo.');
 const first=visits.find(s=>s.cyclePosition===1&&!s.cycleClosed),fortnight=o.freq==='Quinzenal';
 const s={id,clientId:o.clientId,offeringId:o.id,offeringName:o.name,date,amount,note,chargeDue:!fortnight||!!first,paid:fortnight&&!first,cycleClosed:!fortnight||!!first};
 if(fortnight){s.cyclePosition=first?2:1;if(first){first.cycleClosed=true;s.cycleFirstId=first.id}}
 db.services.push(s);const last=visitsFor(db,o.id).at(-1).date;o.nextDue=nextDate(last,o.freq);return s;
}
function pay(db,id,{paymentId,date},asOf=today()){
 const s=db.services.find(s=>s.id===id);if(!s||!s.chargeDue||s.paid||s.date>asOf)throw Error('Esta visita não possui cobrança pendente.');if(!validDate(date)||date>asOf||date<s.date)throw Error('Informe a data do pagamento entre a visita e hoje.');if(activePayments(db).some(p=>p.serviceId===id))throw Error('Pagamento já registrado.');
 const c=db.clients.find(c=>c.id===s.clientId),o=db.offerings.find(o=>o.id===s.offeringId);s.paid=true;db.payments.push({id:paymentId,clientId:s.clientId,clientName:c.name,offeringId:o.id,offeringName:o.name,serviceId:s.id,serviceDate:s.date,date,amount:Number(s.amount||0)});
}
function undo(db,id,stamp=new Date().toISOString()){const p=db.payments.find(p=>p.id===id&&!p.reversedAt);if(!p)throw Error('Este pagamento já foi desfeito.');const s=db.services.find(s=>s.id===p.serviceId);if(!s)throw Error('Visita não encontrada.');p.reversedAt=stamp;if(s.chargeDue)s.paid=activePayments(db).some(p=>p.serviceId===s.id)}
function undoLegacy(db,id,paymentId,stamp=new Date().toISOString()){const s=db.services.find(s=>s.id===id);if(!s?.paid||!s.chargeDue||activePayments(db).some(p=>p.serviceId===id))throw Error('Pagamento histórico não encontrado.');db.payments.push({id:paymentId,clientId:s.clientId,offeringId:s.offeringId,serviceId:s.id,amount:s.amount,date:null,legacy:true,reversedAt:stamp});s.paid=false}
const api={base,migrate,validate,key,today,validDate,nextDate,frequencies,visitsFor,activePayments,pending,totalPending,paidMonth,saveClient,saveOffering,complete,pay,undo,undoLegacy};if(typeof module!=='undefined')module.exports=api;else root.JKModel=api;
})(typeof window!=='undefined'?window:this);
