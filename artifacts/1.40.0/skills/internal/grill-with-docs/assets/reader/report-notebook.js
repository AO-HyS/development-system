(() => {
  const root = document.documentElement;
  const es = root.lang === 'es';
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
  };

  // Theme and print.
  const themeButtons = [...document.querySelectorAll('[data-theme-toggle]')];
  const applyTheme = (theme) => {
    root.dataset.theme = theme;
    themeButtons.forEach((button) => button.setAttribute('aria-pressed', String(theme === 'dark')));
  };
  const savedTheme = store.get('ds-report-theme');
  if (savedTheme === 'dark' || savedTheme === 'light') applyTheme(savedTheme);

  // PR Lens maps.
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let expanded = null;
  const mapLabel = (open) => open ? (es ? 'Cerrar mapa' : 'Close map') : (es ? 'Ampliar mapa' : 'Expand map');
  const collapse = () => {
    if (!expanded) return;
    const button = expanded.querySelector('[data-map-expand]');
    expanded.classList.remove('is-expanded');
    button.setAttribute('aria-expanded', 'false');
    button.textContent = mapLabel(false);
    button.focus();
    expanded = null;
    document.body.classList.remove('map-open');
  };
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-theme-toggle')) {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      store.set('ds-report-theme', next);
      return;
    }
    if (button.hasAttribute('data-print')) { window.print(); return; }
    const map = button.closest('[data-map]');
    if (!map) return;
    if (button.hasAttribute('data-map-expand')) {
      if (expanded === map) { collapse(); return; }
      collapse();
      expanded = map;
      map.classList.add('is-expanded');
      button.setAttribute('aria-expanded', 'true');
      button.textContent = mapLabel(true);
      document.body.classList.add('map-open');
      return;
    }
    if (button.hasAttribute('data-map-motion')) {
      const image = map.querySelector('img');
      const playing = button.getAttribute('aria-pressed') !== 'true';
      image.src = playing ? image.dataset.animated : image.dataset.still;
      button.setAttribute('aria-pressed', String(playing));
      button.textContent = playing ? (es ? 'Pausar recorrido' : 'Pause flow') : (es ? 'Animar recorrido' : 'Animate flow');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') collapse();
    if (event.key === 'Tab' && expanded) {
      const controls = [...expanded.querySelectorAll('button,summary,[tabindex="0"]')].filter((element) => element.getClientRects().length);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  reduced.addEventListener('change', () => {
    if (reduced.matches) document.querySelectorAll('[data-map-motion][aria-pressed="true"]').forEach((button) => button.click());
  });

  const preference = matchMedia('(prefers-color-scheme: dark)');
  if (!savedTheme) applyTheme(preference.matches ? 'dark' : 'light');
  preference.addEventListener('change', () => { if (!store.get('ds-report-theme')) applyTheme(preference.matches ? 'dark' : 'light'); });
  themeButtons.forEach(button => {
    const update = () => { const label = root.dataset.theme === 'dark' ? (es ? 'Cambiar a tema claro' : 'Use light theme') : (es ? 'Cambiar a tema oscuro' : 'Use dark theme'); button.setAttribute('aria-label', label); const span = button.querySelector('span'); if (span) span.textContent = label; };
    update(); button.addEventListener('click', () => queueMicrotask(update)); preference.addEventListener('change', update);
  });
  document.querySelectorAll('a[href^="http"]').forEach(link => { link.target = '_blank'; link.rel = 'noopener noreferrer'; });

  const grill = Boolean(document.querySelector('#questionnaire'));
  const documentId = root.dataset.document || (grill ? 'questionnaire' : 'report');
  const key = 'ds-report-questions:v1:' + documentId;
  const endpoint = !grill && /^https?:$/.test(location.protocol) ? location.pathname.replace(/\.html?$/i, '') + '.questions.json' : null;
  const title = document.querySelector('h1')?.textContent || document.title;
  let questions = [], serverRevision = 0, sentSignature = '', generation = 0, sending = false;
  let active = null, editing = null, origin = null;
  const signature = data => JSON.stringify(data.map(q => [q.id, q.blockId, q.question]));
  function normalize(raw = []) {
    if (!Array.isArray(raw) || raw.length > 200) throw new Error('Invalid margin questions');
    const ids = new Set();
    return raw.map(q => {
      if (!q || typeof q !== 'object') throw new Error('Invalid margin question');
      q = {...q};
      if(!grill)for(const field of ['section','excerpt'])if(typeof q[field]==='string')q[field]=q[field].slice(0,240);
      for (const [field, limit] of [['id',160],['blockId',grill ? 120 : 65536],['section',240],['excerpt',240],['question',2000],['createdAt',80],['updatedAt',80]]) {
        if (typeof q[field] !== 'string' || q[field].length > limit || (['id','blockId','question'].includes(field) && !q[field].trim())) throw new Error('Invalid margin question field');
      }
      if (ids.has(q.id)) throw new Error('Duplicate margin question'); ids.add(q.id);
      return Object.fromEntries(['id','blockId','section','excerpt','question','createdAt','updatedAt'].map(field => [field,q[field]]));
    });
  }
  const blockFor = id => document.querySelector(`[data-q="${CSS.escape(id)}"],[data-q-legacy="${CSS.escape(id)}"]`);
  const ordered = () => [...questions].sort((a,b) => { const l=blockFor(a.blockId),r=blockFor(b.blockId); return l&&r&&l!==r ? (l.compareDocumentPosition(r)&Node.DOCUMENT_POSITION_FOLLOWING ? -1:1) : a.createdAt.localeCompare(b.createdAt); });
  const snapshot = () => normalize(ordered());
  const cleanText = block => {const copy=block.cloneNode(true);copy.querySelectorAll('.ask-composer,.report-question-note,button,svg').forEach(node=>node.remove());return copy.textContent.replace(/\s+/g,' ').trim();};
  const excerptOf = block => (block.dataset.sectionTitle || cleanText(block)).slice(0,240);
  const sectionOf = block => ((block.closest('.brief-section')?.querySelector('h2') ? cleanText(block.closest('.brief-section').querySelector('h2')) : '') || '').replace(/^\d{2}/,'').trim().slice(0,240);
  const host = document.querySelector('#report-actions');
  if (host) host.innerHTML = `<p class="question-count"></p><button type="button" class="send panel-send">${es?'Enviar':'Send'}</button><p class="send-help">${es?'Guarda una revisión y copia el texto para pegarlo en el chat.':'Save a revision and copy the text for the chat.'}</p><p class="panel-status" role="status" aria-live="polite"></p><div class="copy-fail" hidden><label class="field-label" for="report-copy-text">${es?'Selecciona y copia este texto':'Select and copy this text'}</label><textarea id="report-copy-text" class="field" readonly></textarea></div><div class="panel-actions"><button type="button" class="panel-copy">${es?'Copiar para el chat':'Copy for chat'}</button><button type="button" class="panel-download">${es?'Descargar JSON':'Download JSON'}</button></div><details><summary>${es?'Mis preguntas':'My questions'}</summary><ol class="notes-summary"></ol></details>`;
  const status = host?.querySelector('.panel-status');
  function announce(text,tone='') { if(status){status.textContent=text;status.dataset.tone=tone;} }
  function resetSend() { announce(''); const fallback=host?.querySelector('.copy-fail'); if(fallback){fallback.hidden=true;fallback.querySelector('textarea').value='';} }
  function persist() {
    if(grill) return;
    if(!store.set(key,JSON.stringify({questions,serverRevision,sentSignature}))) announce(es?'No se puede guardar el borrador. Descarga una copia.':'Draft storage unavailable. Download a copy.','error');
  }
  function changed() { generation++; resetSend(); persist(); document.dispatchEvent(new CustomEvent('report-questions-change')); updateActions(); }
  function updateActions() {
    if(!host)return;host.querySelector('.question-count').textContent=es?`${questions.length} preguntas en este documento`:`${questions.length} questions in this document`;
    host.querySelector('.panel-send').disabled=sending||(!questions.length&&!active);host.querySelector('.panel-copy').disabled=!questions.length&&!active;
    const list=host.querySelector('.notes-summary');list.replaceChildren();ordered().forEach(q=>{const item=document.createElement('li');item.textContent=q.question;list.append(item);});
  }
  function close(restore=false) {
    if(!active)return;flush();const block=active,back=origin;block.querySelector(':scope > .ask-composer')?.remove();block.classList.remove('is-asking');active=null;editing=null;origin=null;render();
    if(restore)(back?.isConnected?back:block).focus({preventScroll:true});
  }
  function flush() {
    if(!active)return;const value=active.querySelector(':scope > .ask-composer textarea')?.value.trim()||'';
    if(!value){if(editing){questions=questions.filter(q=>q.id!==editing.id);editing=null;changed();}return;}
    const now=new Date().toISOString();
    if(editing){if(editing.question!==value){editing.question=value;editing.updatedAt=now;changed();}}
    else {
      if(questions.length>=200){announce(es?'Máximo 200 preguntas.':'Maximum 200 questions.','error');return;}
      editing={id:crypto.randomUUID(),blockId:active.dataset.q,section:sectionOf(active),excerpt:excerptOf(active),question:value,createdAt:now,updatedAt:now};questions.push(editing);changed();
    }
  }
  function render() {
    document.querySelectorAll('.report-question-note').forEach(node=>node.remove());
    for(const q of questions){const block=blockFor(q.blockId);if(!block||block===active)continue;const note=document.createElement('div');note.className='note report-question-note';const text=document.createElement('p');text.className='note-text';text.textContent=q.question;const actions=document.createElement('div');actions.className='note-actions';
      const edit=document.createElement('button');edit.type='button';edit.className='link';edit.textContent=es?'Editar':'Edit';edit.onclick=event=>{event.stopPropagation();open(block,q,edit);};
      const remove=document.createElement('button');remove.type='button';remove.className='link danger';remove.textContent=es?'Borrar':'Delete';remove.onclick=event=>{event.stopPropagation();questions=questions.filter(item=>item.id!==q.id);changed();render();};actions.append(edit,remove);note.append(text,actions);block.append(note);}
    updateActions();
  }
  function open(block,q=null,from=null) {
    if(active)close();active=block;origin=from||block;editing=q||questions.find(item=>item.blockId===block.dataset.q)||null;
    block.classList.add('is-asking');render();
    const composer=document.createElement('form');composer.className='ask-composer';
    composer.innerHTML=`<p class="ask-excerpt"></p><label class="field-label">${es?'Tu pregunta':'Your question'}<textarea class="field" maxlength="2000" rows="3" placeholder="${es?'¿Qué quieres preguntar?':'What do you want to ask?'}"></textarea></label><div class="ask-actions"><button type="submit" class="ask-save">${es?'Guardar pregunta':'Save question'}</button><button type="button" class="ask-cancel" aria-label="${es?'Cerrar pregunta':'Close question'}">${es?'Cerrar':'Close'}</button></div>`;
    composer.querySelector('.ask-excerpt').textContent=editing?.excerpt||excerptOf(block);const input=composer.querySelector('textarea');input.value=editing?.question||'';
    composer.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();if(input.value.trim())close(true);else input.focus();});
    composer.querySelector('.ask-cancel').onclick=event=>{event.stopPropagation();close(true);};
    input.addEventListener('input',()=>{flush();updateActions();});
    input.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();composer.requestSubmit();}});
    block.append(composer);input.focus({preventScroll:true});composer.scrollIntoView({block:'nearest',behavior:reduced.matches?'instant':'smooth'});updateActions();
  }
  function hydrate(raw) { if(active){active.querySelector(':scope > .ask-composer')?.remove();active.classList.remove('is-asking');active=null;editing=null;} questions=normalize(raw);render(); }
  function legacyCopy(text) {const area=document.createElement('textarea');area.value=text;area.className='visually-hidden';document.body.append(area);area.select();let ok=false;try{ok=document.execCommand('copy');}catch{}area.remove();return ok;}
  function copyText(text) {try{return navigator.clipboard?.writeText ? navigator.clipboard.writeText(text).then(()=>true,()=>legacyCopy(text)):Promise.resolve(legacyCopy(text));}catch{return Promise.resolve(legacyCopy(text));}}
  window.reportQuestions={flush,snapshot,hydrate,normalize,copyText};
  const exportedText = data => [es?`Preguntas sobre «${title}»`:`Questions about “${title}”`,...data.questions.map((q,i)=>`\n${i+1}. ${q.section ? q.section+': ':''}${q.excerpt}\n${q.question}`)].join('\n');
  const payload = () => ({documentId,title,questions:snapshot()});
  function showFallback(text) {const box=host.querySelector('.copy-fail');box.hidden=false;box.querySelector('textarea').value=text;}
  async function copy() {flush();const text=exportedText(payload()),at=generation;const copied=await copyText(text);if(at!==generation)return;announce(copied?(es?'Copiado. Pégalo en el chat.':'Copied. Paste it in chat.'):(es?'No se pudo copiar. Selecciona el texto de abajo.':'Copy failed. Select the text below.'),copied?'success':'error');if(!copied)showFallback(text);}
  async function submit() {
    if(sending)return;flush();const data=payload();if(!data.questions.length)return;
    const text=exportedText(data),at=generation,sent=signature(data.questions),expectedRevision=serverRevision;
    const copiedPromise=copyText(text);sending=true;updateActions();announce(es?'Enviando…':'Sending…');
    let saved=false,receipt='',reason='';
    if(endpoint)try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision,data}),signal:AbortSignal.timeout(10000)});const result=await response.json();if(response.status===409){serverRevision=Number(result.revision)||serverRevision;reason=es?'Otra pestaña guardó antes. Conservamos tu borrador; vuelve a enviar.':'Another tab saved first. Your draft is kept; send again.';}else if(!response.ok)reason=es?'No se pudo guardar.':'Save failed.';else{serverRevision=result.revision;sentSignature=sent;receipt=result.receipt;saved=true;}persist();}catch{reason=es?'La sesión no está disponible.':'Session unavailable.';}else reason=es?'Abre el enlace local para guardar.':'Open the local link to save.';
    const copied=await copiedPromise;sending=false;updateActions();
    const outcomes=es?['No se guardó ni se copió.','Copiado; no se guardó.','Guardado; no se pudo copiar.','Guardado y copiado.']:['Neither saved nor copied.','Copied; not saved.','Saved; copy failed.','Saved and copied.'];
    announce(outcomes[(saved?2:0)+(copied?1:0)]+(receipt?` ${es?'Recibo':'Receipt'}: ${receipt}`:'')+(reason?' '+reason:'')+(at!==generation?(es?' Hay cambios nuevos sin enviar.':' New edits remain unsent.'):''),saved&&copied?'success':'error');if(!copied&&at===generation)showFallback(text);
  }
  if(host){host.querySelector('.panel-send').onclick=submit;host.querySelector('.panel-copy').onclick=copy;host.querySelector('.panel-download').onclick=()=>{flush();const url=URL.createObjectURL(new Blob([JSON.stringify(payload(),null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`questions-${documentId}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};}
  document.querySelectorAll('[data-q]').forEach(block=>{if(!block.hasAttribute('tabindex'))block.tabIndex=0;});
  document.addEventListener('click',event=>{const target=event.target;if(!(target instanceof Element))return;const button=target.closest('[data-section-ask]');if(button){const block=button.closest('[data-q]');if(block)open(block,null,button);return;}
    if(target.closest('.ask-composer,.report-question-note,a,button,input,textarea,select,label,summary,video,audio,[data-map]'))return;
    if(String(getSelection()||'').trim())return;const block=target.closest('[data-q]');if(block&&block!==active)open(block);else if(!block&&active)close();});
  document.addEventListener('pointerdown',event=>{if(active&&event.target instanceof Element&&!active.contains(event.target))close();});
  document.addEventListener('keydown',event=>{if(event.target instanceof Element&&event.target.matches('[data-q]')&&['Enter',' '].includes(event.key)){event.preventDefault();open(event.target);}if(event.key==='Escape'&&active){event.preventDefault();close(true);}});
  if(!grill){try{const saved=JSON.parse(store.get(key)||'null');if(saved){questions=normalize(saved.questions);serverRevision=Number(saved.serverRevision)||0;sentSignature=saved.sentSignature||'';}}catch{}render();
    if(endpoint){const start=generation;fetch(endpoint,{signal:AbortSignal.timeout(5000)}).then(response=>response.ok?response.json():null).then(saved=>{if(!saved)return;serverRevision=Number(saved.revision)||0;if(!questions.length&&start===generation&&saved.data?.questions?.length){questions=normalize(saved.data.questions);sentSignature=signature(questions);}persist();render();}).catch(()=>{});}}
  else render();
})();
