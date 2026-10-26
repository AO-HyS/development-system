'use strict';
const config=JSON.parse(document.querySelector('#question-data').textContent);
const questions=config.questions;
const form=document.querySelector('#questionnaire');
const storageKey='grill:'+config.sessionId+':'+config.questionnaireHash;
const answersEndpoint=new URL('answers',location.href).href;
const draftEndpoint=new URL('draft',location.href).href;
let draftKey=storageKey;
try{let tabKey=sessionStorage.getItem(storageKey+':tab');if(!tabKey){tabKey=crypto.randomUUID();sessionStorage.setItem(storageKey+':tab',tabKey);}draftKey=storageKey+':draft:'+tabKey;}catch{}
const statusEl=document.querySelector('#status');
const draftStatus=document.querySelector('#draft-status');
const sections=[...document.querySelectorAll('.question')];
let draftRevision=0, draftTimer=0, draftSaving=false, draftPending=false, importPending=false, syncState='none';
let deferred=new Set(), serverRevision=0, revision=0, mode='all', active=0, updatedAt='', edited=false, dirty=false, recovery=null;
function message(text,kind=''){statusEl.textContent=text;statusEl.className='status '+kind;}
function collect(){return {sessionId:config.sessionId,version:config.version,questionnaireHash:config.questionnaireHash,updatedAt,answers:questions.map(q=>({id:q.id,title:q.title,options:q.options,choice:form.querySelector('input[name="answer-'+q.id+'"]:checked')?.value||'',note:document.getElementById('note-'+q.id).value,deferred:deferred.has(q.id)})),generalNotes:document.querySelector('#general-notes').value,questions:window.reportQuestions.snapshot()};}
function answered(a){return !a.deferred&&Boolean(a.choice||a.note.trim());}
function meaningful(data){return data.answers.some(a=>a.choice||a.note.trim()||a.deferred)||Boolean(data.generalNotes.trim())||Boolean(data.questions?.length);}
function normalize(data){
  if(!data||data.sessionId!==config.sessionId||data.version!==config.version||!Array.isArray(data.answers))throw new Error('El archivo no corresponde a esta sesión.');
  if(data.questionnaireHash!==config.questionnaireHash||data.answers.length!==questions.length||typeof data.generalNotes!=='string'||data.generalNotes.length>12000)throw new Error('El archivo tiene un formato no válido.');
  const ids=new Set();
  for(const a of data.answers){if(!a||typeof a.id!=='string'||ids.has(a.id)||typeof a.note!=='string'||a.note.length>6000||typeof a.choice!=='string'||typeof a.deferred!=='boolean')throw new Error('Hay una respuesta con formato no válido.');ids.add(a.id);const q=questions.find(q=>q.id===a.id);if(!q||(a.choice&&!Object.hasOwn(q.options,a.choice)))throw new Error('Hay una opción que requiere revisión.');}
  return {...data,questions:window.reportQuestions.normalize(Object.hasOwn(data,'questions')?data.questions:[])};
}
function hydrate(raw){
  const data=normalize(raw);copySnapshot=null;document.querySelector('#copy-fallback').hidden=true;document.querySelector('#copy-status').textContent='';form.reset();deferred=new Set();
  for(const a of data.answers){if(!questions.some(q=>q.id===a.id))continue;if(a.choice)form.querySelector('input[name="answer-'+a.id+'"][value="'+a.choice+'"]').checked=true;document.getElementById('note-'+a.id).value=a.note;document.getElementById('details-'+a.id).open=Boolean(a.note)||!Object.keys(questions.find(q=>q.id===a.id).options).length;if(a.deferred)deferred.add(a.id);}
  document.querySelector('#general-notes').value=data.generalNotes;document.querySelector('#general-notes').closest('details').open=Boolean(data.generalNotes);window.reportQuestions.hydrate(data.questions);updatedAt=data.updatedAt||'';render();
}
function render(){
  const data=collect();const count=data.answers.filter(answered).length;const open=data.answers.filter(a=>a.deferred).length;
  document.querySelectorAll('.count').forEach(e=>e.textContent=count+' de '+questions.length+' respondidas');document.querySelector('progress').max=questions.length;document.querySelector('progress').value=count;
  const pending=data.answers.map((answer,index)=>({answer,index})).filter(({answer})=>!answered(answer));
  const pendingList=document.querySelector('#pending-list');pendingList.replaceChildren();
  document.querySelector('#pending-heading').textContent=pending.length?pending.length+' '+(pending.length===1?'pregunta pendiente':'preguntas pendientes'):'Sin preguntas pendientes';
  document.querySelector('#pending-explanation').textContent=pending.length?'Estas son las preguntas sin respuesta o dejadas para después. Pulsa una para continuar.':'Las '+questions.length+' preguntas tienen respuesta. Esto no confirma que los últimos cambios estén enviados; revisa el estado de guardado.';
  pending.forEach(({answer:a,index:i})=>{const li=document.createElement('li');const link=document.createElement('a');link.href='#q-'+a.id;link.textContent=(i+1)+'. '+questions[i].title+(a.deferred?' — Para después':' — Sin responder');link.addEventListener('click',event=>{event.preventDefault();showMode(mode,i,true);});li.append(link);pendingList.append(li);});
  data.answers.forEach(a=>{const link=document.querySelector('.nav a[href="#q-'+a.id+'"]');if(!link)return;let badge=link.querySelector('.nav-answer-status');if(!badge){badge=document.createElement('small');badge.className='nav-answer-status';link.append(badge);}const done=answered(a);badge.textContent=done?'✓':a.deferred?'Después':'Pendiente';badge.setAttribute('aria-label',done?'Respondida':a.deferred?'Pendiente, para después':'Sin responder');link.dataset.answerStatus=done?'answered':'pending';});
  const summary=document.querySelector('#answer-summary');summary.replaceChildren();
  data.answers.forEach((a,i)=>{const q=questions[i];const state=a.deferred?'Para después':answered(a)?a.choice?'Opción '+a.choice+' elegida':'Respuesta escrita':'Sin responder';document.getElementById('state-'+a.id).textContent=state;document.querySelector('[data-defer="'+a.id+'"]').setAttribute('aria-pressed',String(a.deferred));const li=document.createElement('li');const title=document.createElement('strong');title.textContent=q.title;li.append(title);const answer=document.createElement('p');answer.textContent=a.choice?a.choice+'. '+q.options[a.choice]:state;li.append(answer);if(a.deferred&&a.choice){const pending=document.createElement('small');pending.textContent='Decisión para después; elección conservada como referencia.';li.append(pending);}if(a.note){const note=document.createElement('p');note.textContent=a.note;li.append(note);}summary.append(li);});
  document.querySelector('#save-feedback').textContent=open?open+' decisiones para después. Puedes guardar aunque falten respuestas.':'';
}
const syncEl=document.querySelector('#sync-status'), noticeEl=document.querySelector('#draft-notice');
function notice(text){noticeEl.hidden=!text;noticeEl.firstElementChild.textContent=text||'';}
function sync(state,text){syncState=state;syncEl.textContent=text;syncEl.className='status '+(state==='saved'?'success':state==='offline'||state==='conflict'?'error':'');}
let storageBlocked=false;
function storeDraft(){try{localStorage.setItem(draftKey,JSON.stringify({...collect(),draftDirty:dirty,baseRevision:serverRevision,draftRevision}));localStorage.setItem(storageKey+':latest',draftKey);draftStatus.textContent='Borrador guardado en este navegador. Pulsa «Enviar» para compartirlo aquí.';if(storageBlocked){storageBlocked=false;notice('');}}catch{storageBlocked=true;notice('Este navegador bloquea el almacenamiento local: recargar esta página no conservará el borrador. Usa «Exportar borrador» para no perder lo escrito.');draftStatus.textContent='Este navegador no permite guardar el borrador. Guarda en la sesión o descarga una copia.';}}
function draftBody(source,data,base){return JSON.stringify({expectedRevision:draftRevision,baseSubmission:base??serverRevision,source,data:data||collect()});}
function scheduleDraft(){if(location.protocol==='file:')return;sync('pending','Cambios sin sincronizar con el servidor…');clearTimeout(draftTimer);draftTimer=setTimeout(pushDraft,800);}
async function pushDraft(){
  if(recovery||draftSaving){draftPending=true;return;}
  draftSaving=true;draftPending=false;const source=importPending?'import':'autosave';
  try{
    const response=await fetch(draftEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:draftBody(source),signal:AbortSignal.timeout(8000)});
    const result=await response.json();
    if(response.status===409){
      const latest=await fetch(draftEndpoint,{signal:AbortSignal.timeout(8000)});const saved=latest.ok?await latest.json():null;
      if(result.code==='submitted'){importPending=false;const submitted=await fetch(answersEndpoint,{signal:AbortSignal.timeout(8000)});sync('conflict','Borrador no guardado: ya existe un envío más reciente.');if(submitted.ok)offerRecovery(await submitted.json());notice(result.error);}
      else if(saved&&saved.data){sync('conflict','El servidor tiene otro borrador. Elige qué versión conservar.');offerRecovery({kind:'draft',revision:saved.revision,data:saved.data});}
      return;
    }
    if(!response.ok)throw new Error(result.error||'No se pudo sincronizar.');
    draftRevision=result.revision;importPending=false;storeDraft();notice(storageBlocked?noticeEl.firstElementChild.textContent:'');sync('saved','Guardado en el servidor (borrador '+draftRevision+').');
  }catch{sync('offline','Sin conexión con el servidor. Lo escrito solo está en este navegador: expórtalo si vas a cerrar el túnel o cambiar de host.');draftPending=false;}
  finally{draftSaving=false;if(draftPending)scheduleDraft();}
}
function exportDraft(){const payload={kind:'grill-draft',sessionId:config.sessionId,questionnaireHash:config.questionnaireHash,baseRevision:draftRevision,baseSubmission:serverRevision,exportedAt:new Date().toISOString(),data:collect()};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=config.sessionId+'-borrador.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Borrador exportado. Impórtalo en la página nueva con «Importar borrador».','success');}
document.querySelector('#export-draft').addEventListener('click',()=>{window.reportQuestions.flush();exportDraft();});
document.querySelector('#import-draft').addEventListener('click',()=>document.querySelector('#import-draft-file').click());
document.querySelector('#import-draft-file').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{
  if(file.size>2000000)throw new Error('El archivo es demasiado grande.');
  const payload=JSON.parse(await file.text());
  if(!payload||payload.kind!=='grill-draft'||payload.sessionId!==config.sessionId||payload.questionnaireHash!==config.questionnaireHash||!Number.isInteger(payload.baseSubmission))throw new Error('El archivo no es un borrador de este cuestionario.');
  if(payload.baseSubmission<serverRevision)throw new Error('Importación rechazada: ya existe un envío (revisión '+serverRevision+') posterior a este borrador. Los envíos no se sobrescriben.');
  const data=normalize(payload.data);
  if(meaningful(collect())&&!confirm('Importar reemplazará el borrador visible. Exporta antes una copia si quieres conservarlo. ¿Continuar?'))return;
  hydrate(data);importPending=true;change();message('Borrador importado. Se reconcilia con el servidor al sincronizar.','success');
}catch(error){message(error.message||'No se pudo importar el borrador.','error');}finally{event.target.value='';}});
function change(){copySnapshot=null;document.querySelector('#copy-fallback').hidden=true;document.querySelector('#copy-status').textContent='';edited=true;dirty=true;revision++;updatedAt=new Date().toISOString();render();storeDraft();scheduleDraft();if(statusEl.classList.contains('success'))message('Tienes cambios nuevos. Vuelve a guardar cuando quieras.');}
document.addEventListener('report-questions-change',change);
form.addEventListener('input',event=>{if(event.target.closest('.ask-composer,.report-question-note'))return;const section=event.target.closest('.question');if(section)deferred.delete(section.dataset.questionId);change();});
form.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.defer){const id=button.dataset.defer;deferred.has(id)?deferred.delete(id):deferred.add(id);change();}if(button.dataset.clear){const id=button.dataset.clear;form.querySelectorAll('input[name="answer-'+id+'"]').forEach(i=>i.checked=false);deferred.delete(id);change();}});
function showMode(nextMode,index=active,focus=false){mode=nextMode;active=Math.min(Math.max(index,0),questions.length-1);sections.forEach((section,i)=>section.hidden=mode==='one'&&i!==active);document.querySelector('.focus-controls').hidden=mode!=='one';document.querySelector('#all-mode').setAttribute('aria-pressed',String(mode==='all'));document.querySelector('#one-mode').setAttribute('aria-pressed',String(mode==='one'));document.querySelector('#previous').disabled=active===0;document.querySelector('#next-question').disabled=active===questions.length-1;document.querySelector('#position').textContent=(active+1)+' / '+questions.length;if(focus){sections[active].focus({preventScroll:true});sections[active].scrollIntoView({block:'start',behavior:'instant'});}}
document.querySelector('#all-mode').addEventListener('click',()=>showMode('all'));
document.querySelector('#one-mode').addEventListener('click',()=>showMode('one',active,true));
document.querySelector('#previous').addEventListener('click',()=>showMode('one',active-1,true));
document.querySelector('#next-question').addEventListener('click',()=>showMode('one',active+1,true));
document.querySelector('#next-open').addEventListener('click',()=>{const answers=collect().answers;let index=answers.findIndex((a,i)=>i>active&&!answered(a));if(index<0)index=answers.findIndex(a=>!answered(a));if(index<0){message('Todas las preguntas tienen respuesta. Puedes revisarlas y guardar.','success');document.querySelector('#respuestas').scrollIntoView();return;}showMode(mode,index,true);});
document.querySelectorAll('a[href^="#"]').forEach(link=>link.addEventListener('click',()=>{const index=questions.findIndex(q=>'#q-'+q.id===link.getAttribute('href'));if(index>=0)showMode(mode,index);else if(link.getAttribute('href')==='#questions')showMode('all');}));
function asText(data){return ['Grill with Docs — '+config.title,'Cuestionario: '+config.sessionId,...data.answers.map((a,i)=>`${i+1}. ${a.title}\n${a.deferred?'Para después\n':''}${a.choice?a.choice+'. '+a.options[a.choice]:'Sin elección'}${a.note?'\nComentario: '+a.note:''}`),'Notas generales:\n'+data.generalNotes,...(data.questions||[]).map(q=>'Pregunta sobre '+(q.section||q.blockId||'el cuestionario')+'\n'+(q.excerpt?q.excerpt+'\n':'')+q.question)].join('\n\n');}
document.querySelector('#download').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(collect(),null,2)],{type:'application/json;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=config.sessionId+'-respuestas.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Copia preparada. Puedes importarla aquí para recuperar tus respuestas.','success');});
let copySnapshot=null;
let copyAttempt=0;
function copyAnswers(snapshot){
  const attempt=++copyAttempt;
  copySnapshot=snapshot;
  const text=asText(snapshot), promise=window.reportQuestions.copyText(text);
  document.querySelector('#copy-status').textContent='Copiando para el chat…';
  return promise.then(ok=>{
    if(attempt!==copyAttempt||copySnapshot!==snapshot)return ok;
    document.querySelector('#copy-status').textContent=ok?'Respuestas copiadas. Pégalas en el chat.':'No se pudo copiar. Selecciona el texto o vuelve a copiar.';
    document.querySelector('#copy-status').className='status '+(ok?'success':'error');
    document.querySelector('#copy-fallback').hidden=ok;
    document.querySelector('#copy-text').value=text;
    return ok;
  }).catch(()=>{if(attempt===copyAttempt&&copySnapshot===snapshot){document.querySelector('#copy-status').textContent='No se pudo copiar. Selecciona el texto o vuelve a copiar.';document.querySelector('#copy-fallback').hidden=false;document.querySelector('#copy-text').value=text;}return false;});
}
document.querySelector('#copy').addEventListener('click',()=>{window.reportQuestions.flush();copyAnswers(structuredClone(collect()));});
document.querySelector('#retry-copy').addEventListener('click',()=>{if(copySnapshot)copyAnswers(copySnapshot);});
document.querySelector('#copy-text').addEventListener('click',event=>event.target.select());
document.querySelector('#import').addEventListener('click',()=>document.querySelector('#import-file').click());
document.querySelector('#import-file').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>2000000)throw new Error('El archivo es demasiado grande.');const data=normalize(JSON.parse(await file.text()));if(meaningful(collect())&&!confirm('Importar reemplazará el borrador visible. Descarga una copia antes si quieres conservarlo. ¿Continuar?'))return;hydrate(data);change();message('Respuestas importadas. Revisa el resumen y guarda en la sesión.','success');}catch(error){message(error.message||'No se pudo importar el archivo.','error');}finally{event.target.value='';}});
form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(recovery){message('Hay dos versiones. Elige «Conservar mi borrador» o «Recuperar guardadas» antes de guardar.','error');recoveryBox.scrollIntoView({block:'center'});return;}
  window.reportQuestions.flush();
  const data=structuredClone(collect());
  if(!meaningful(data)){message('Elige una opción, deja una decisión para después o escribe un comentario antes de guardar.','error');return;}
  const sentRevision=revision, expectedRevision=serverRevision;
  // Start clipboard in the original gesture; save and copy share this snapshot.
  const copying=copyAnswers(data);
  clearTimeout(draftTimer);await pushDraft();
  if(recovery){message('Hay dos versiones. Elige «Conservar mi borrador» o «Recuperar guardadas» antes de enviar.','error');recoveryBox.scrollIntoView({block:'center'});await copying;return;}
  if(location.protocol==='file:'){message('La sesión no está disponible desde este archivo. Puedes copiar o descargar tus respuestas.','error');await copying;return;}
  const button=document.querySelector('#send');button.disabled=true;button.textContent='Guardando…';message('Guardando tus respuestas en la sesión…');
  try{
    const response=await fetch(answersEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision,data,draftRevision}),signal:AbortSignal.timeout(10000)});
    const result=await response.json();
    if(response.status===409){const latest=await fetch(answersEndpoint,{signal:AbortSignal.timeout(10000)});if(latest.ok)offerRecovery(await latest.json());}
    if(!response.ok)throw new Error(result.error||'No se pudo guardar.');
    serverRevision=result.revision;dirty=sentRevision!==revision;storeDraft();if(sentRevision!==revision)scheduleDraft();else sync('saved','Enviado. Recibo de la revisión '+result.revision+' basado en el borrador '+result.draftRevision+'.');
    message(sentRevision===revision?'Respuestas guardadas en la sesión. Recibo: '+result.receipt:'Copia guardada. Tienes cambios posteriores pendientes de enviar.','success');
  }catch(error){message(error.message+' Tu borrador sigue en pantalla; puedes descargarlo.','error');}
  finally{button.disabled=false;button.textContent='Enviar';}
  await copying;
});
const recoveryBox=document.querySelector('#recovery');
function offerRecovery(saved){recovery=saved;recoveryBox.hidden=false;draftStatus.textContent='Hay una versión guardada diferente. Tu borrador se conserva; elige qué versión continuar.';}
document.querySelector('#keep-draft').addEventListener('click',()=>{if(!recovery)return;const draftKind=recovery.kind==='draft';if(draftKind)draftRevision=recovery.revision;else serverRevision=recovery.revision;dirty=true;storeDraft();recovery=null;recoveryBox.hidden=true;notice('');scheduleDraft();message('Conservamos tu borrador. Al guardar, crearás una nueva versión en la sesión.');});
document.querySelector('#use-saved').addEventListener('click',()=>{if(!recovery)return;try{localStorage.setItem(draftKey+':recovery',JSON.stringify(collect()));}catch{message('No se pudo respaldar tu borrador. Descárgalo antes de cambiar de versión.','error');return;}if(recovery.kind==='draft')draftRevision=recovery.revision;else serverRevision=recovery.revision;hydrate(recovery.data);dirty=false;storeDraft();recovery=null;recoveryBox.hidden=true;notice('');sync('saved','Guardado en el servidor (borrador '+draftRevision+').');document.querySelector('#download-recovery').hidden=false;message('Recuperamos las respuestas guardadas. El borrador anterior sigue disponible para descargar.');});
document.querySelector('#download-recovery').addEventListener('click',()=>{try{const raw=localStorage.getItem(draftKey+':recovery');if(!raw)return;const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=config.sessionId+'-borrador-anterior.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{message('No se pudo recuperar la copia anterior.','error');}});
try{const raw=localStorage.getItem(draftKey)||localStorage.getItem(localStorage.getItem(storageKey+':latest')||storageKey);if(raw){const data=JSON.parse(raw);hydrate(data);dirty=data.draftDirty!==false;serverRevision=Number.isInteger(data.baseRevision)?data.baseRevision:0;draftStatus.textContent='Borrador recuperado de este navegador.';}document.querySelector('#download-recovery').hidden=!localStorage.getItem(draftKey+':recovery');}catch{draftStatus.textContent='No se pudo recuperar el borrador. Puedes importar una copia descargada.';}
render();showMode('all');
function signature(d){return JSON.stringify([d.answers.map(a=>[a.id,a.choice,a.note,a.deferred]),d.generalNotes,d.questions||[]]);}
(async()=>{
  if(location.protocol==='file:'){sync('offline','Abierto desde un archivo: no hay servidor. Usa «Exportar borrador» para conservar lo escrito.');return;}
  try{
    const response=await fetch(answersEndpoint,{signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error();const saved=await response.json();
    const draftResponse=await fetch(draftEndpoint,{signal:AbortSignal.timeout(5000)});if(!draftResponse.ok)throw new Error();const stored=await draftResponse.json();
    if(saved.data&&saved.revision!==serverRevision&&meaningful(collect())&&(dirty||edited)){offerRecovery(saved);sync('conflict','Hay un envío distinto del que viste. Elige qué versión conservar.');return;}
    serverRevision=saved.revision;
    if(saved.data&&!edited&&(!meaningful(collect())||!dirty)){hydrate(saved.data);dirty=false;storeDraft();draftStatus.textContent='Respuestas recuperadas de la sesión local.';}
    // A draft older than the last submission is superseded by it and stays read-only.
    const current=stored.data&&stored.baseSubmission===serverRevision;
    if(!current){draftRevision=Math.max(draftRevision,stored.revision);if(meaningful(collect())&&dirty)scheduleDraft();else sync('saved','Sin borrador pendiente; el servidor está al día.');return;}
    // Typing before this load finished: adopt the server revision only for identical content; otherwise autosave stays suspended behind the recovery choice.
    if(!edited&&!meaningful(collect())){hydrate(stored.data);draftRevision=stored.revision;dirty=true;storeDraft();sync('saved','Borrador recuperado del servidor (borrador '+draftRevision+').');return;}
    if(signature(collect())===signature(normalize(stored.data))){draftRevision=stored.revision;sync('saved','Guardado en el servidor (borrador '+draftRevision+').');return;}
    sync('conflict','El borrador de este navegador y el del servidor difieren. Elige qué versión conservar.');offerRecovery({kind:'draft',revision:stored.revision,data:stored.data});
  }catch{sync('offline','Sin conexión con el servidor. Lo escrito solo está en este navegador: expórtalo si vas a cerrar el túnel o cambiar de host.');draftStatus.textContent='La sesión local no está disponible. El borrador y la descarga siguen funcionando.';}
})();
