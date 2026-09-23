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

  // Contents: close the compact index after a jump, and mark the section in view.
  document.querySelectorAll('.document-nav a').forEach((link) => link.addEventListener('click', () => { document.querySelector('.document-nav').open = false; }));
  const navLinks = [...document.querySelectorAll('.document-sidebar nav a')];
  const headings = [...document.querySelectorAll('.brief-section h2')];
  let requested = null;
  const mark = () => {
    let active = null;
    for (const heading of headings) if (heading.getBoundingClientRect().top < 180) active = heading;
    if (requested) active = headings.find((heading) => '#' + heading.id === requested) || active;
    navLinks.forEach((link) => {
      if (active && link.hash === '#' + active.id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  };
  navLinks.forEach((link) => link.addEventListener('click', () => { requested = link.hash; mark(); }));
  const releaseRequested = () => { requested = null; };
  document.addEventListener('wheel', releaseRequested, { passive: true });
  document.addEventListener('touchmove', releaseRequested, { passive: true });
  document.addEventListener('keydown', (event) => {
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) releaseRequested();
  });
  let pending = false;
  document.addEventListener('scroll', () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { mark(); pending = false; });
  }, { passive: true });
  mark();

  // Margin questions. Drafts live in this browser; a local Reader server can
  // receive them as one revisioned batch, mirroring the grill questionnaire.
  const t = es ? {
    ask: 'Preguntar sobre este párrafo', label: 'Tu pregunta sobre el párrafo seleccionado', placeholder: '¿Qué quieres preguntar?',
    save: 'Guardar', cancel: 'Cancelar', edit: 'Editar', remove: 'Borrar', saved: 'Guardada', sent: 'Enviada',
    count: (n) => n === 1 ? '1 pregunta guardada' : `${n} preguntas guardadas`, empty: 'Preguntar sobre un párrafo',
    send: 'Enviar al modelo', sentAll: 'Enviadas al modelo', panel: 'Preguntas para el modelo', close: 'Cerrar',
    hint: 'Haz clic en cualquier párrafo, hallazgo o tabla y escribe tu pregunta en el margen. Puedes juntar varias y enviarlas al final.',
    keyboard: 'Elegir un párrafo con el teclado', copy: 'Copiar para el chat', download: 'Descargar JSON',
    required: 'Escribe la pregunta antes de guardarla.', stored: 'Pregunta guardada en este navegador.', deleted: 'Pregunta borrada.',
    noStorage: 'Este navegador no permite guardar borradores. Copia tus preguntas antes de cerrar.',
    sending: 'Enviando tus preguntas…', delivered: (receipt) => `Preguntas enviadas. Vuelve al chat y di «ya pregunté». Recibo: ${receipt}`,
    conflict: 'Otra pestaña envió preguntas antes. Conservamos las tuyas; vuelve a enviar para crear una revisión nueva.',
    offline: 'Este archivo se abrió sin el servidor local. Copia las preguntas y pégalas en el chat, o descárgalas.',
    copied: 'Copiadas. Pégalas en el chat con el modelo.', copyFailed: 'No se pudo copiar. Descarga el archivo JSON.',
    picking: 'Usa Tab para recorrer los párrafos y Enter para preguntar. Escape termina.', about: 'Sobre', header: 'Encabezado', findings: 'Hallazgos',
    intro: (title, n) => `Preguntas sobre «${title}» (${n})`, question: 'Pregunta',
  } : {
    ask: 'Ask about this paragraph', label: 'Your question about the selected paragraph', placeholder: 'What do you want to ask?',
    save: 'Save', cancel: 'Cancel', edit: 'Edit', remove: 'Delete', saved: 'Saved', sent: 'Sent',
    count: (n) => n === 1 ? '1 saved question' : `${n} saved questions`, empty: 'Ask about a paragraph',
    send: 'Send to the model', sentAll: 'Sent to the model', panel: 'Questions for the model', close: 'Close',
    hint: 'Click any paragraph, finding or table and write your question in the margin. Gather several and send them together.',
    keyboard: 'Choose a paragraph with the keyboard', copy: 'Copy for the chat', download: 'Download JSON',
    required: 'Write the question before saving it.', stored: 'Question saved in this browser.', deleted: 'Question deleted.',
    noStorage: 'This browser cannot keep drafts. Copy your questions before closing.',
    sending: 'Sending your questions…', delivered: (receipt) => `Questions sent. Return to the chat and say “questions sent”. Receipt: ${receipt}`,
    conflict: 'Another tab sent questions first. Yours are kept; send again to create a new revision.',
    offline: 'This file was opened without the local server. Copy the questions into the chat, or download them.',
    copied: 'Copied. Paste them into the chat with the model.', copyFailed: 'Copy failed. Download the JSON file instead.',
    picking: 'Use Tab to move through paragraphs and Enter to ask. Escape ends.', about: 'About', header: 'Header', findings: 'Findings',
    intro: (title, n) => `Questions about “${title}” (${n})`, question: 'Question',
  };
  const margin = document.querySelector('[data-margin]');
  const notesList = margin && margin.querySelector('[data-notes]');
  if (!margin || !notesList) return;
  const documentId = root.dataset.document || 'report';
  const key = 'ds-report-questions:v1:' + documentId;
  const endpoint = /^https?:$/.test(location.protocol) ? location.pathname.replace(/\.html?$/i, '') + '.questions.json' : null;
  const title = (document.querySelector('.brief-header h1') || {}).textContent || document.title;
  let state = { questions: [], serverRevision: 0, sentSignature: '' };
  try {
    const saved = JSON.parse(store.get(key) || 'null');
    if (saved && Array.isArray(saved.questions)) state = { questions: saved.questions.filter((item) => item && typeof item.question === 'string'), serverRevision: Number(saved.serverRevision) || 0, sentSignature: String(saved.sentSignature || '') };
  } catch { /* A corrupt draft is ignored rather than blocking the report. */ }
  const signature = (questions) => JSON.stringify(questions.map((item) => [item.id, item.blockId, item.question]));
  const persist = () => { if (!store.set(key, JSON.stringify(state))) announce(t.noStorage, 'error'); };
  const icon = (path) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const bookmark = icon('<path d="M6 3.5h12v17l-6-4.2-6 4.2z"/>');

  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'ask-pill';
  pill.hidden = true;
  pill.textContent = t.ask;
  const composer = document.createElement('form');
  composer.className = 'ask-composer';
  composer.hidden = true;
  composer.innerHTML = `<label class="visually-hidden" for="ask-input"></label><p class="ask-excerpt" aria-hidden="true"></p><textarea id="ask-input" rows="4" maxlength="2000"></textarea><div class="ask-actions"><button type="submit" class="ask-save"></button><button type="button" class="ask-cancel"></button></div><p class="ask-error" role="alert"></p>`;
  const input = composer.querySelector('textarea');
  composer.querySelector('label').textContent = t.label;
  input.placeholder = t.placeholder;
  composer.querySelector('.ask-save').textContent = t.save;
  composer.querySelector('.ask-cancel').textContent = t.cancel;
  margin.append(pill, composer);

  const tray = document.createElement('div');
  tray.className = 'question-tray';
  const panel = document.createElement('section');
  panel.className = 'question-panel';
  panel.id = 'question-panel';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'question-panel-title');
  panel.innerHTML = `<div class="panel-head"><h2 id="question-panel-title"></h2><button type="button" class="panel-close"></button></div><p class="panel-hint"></p><ol class="panel-list"></ol><div class="panel-actions"><button type="button" class="panel-send"></button><button type="button" class="panel-copy"></button><button type="button" class="panel-download"></button><button type="button" class="panel-keyboard"></button></div><p class="panel-status" role="status" aria-live="polite"></p>`;
  panel.querySelector('h2').textContent = t.panel;
  panel.querySelector('.panel-close').textContent = t.close;
  panel.querySelector('.panel-hint').textContent = t.hint;
  panel.querySelector('.panel-copy').textContent = t.copy;
  panel.querySelector('.panel-download').textContent = t.download;
  panel.querySelector('.panel-keyboard').textContent = t.keyboard;
  const status = panel.querySelector('.panel-status');
  margin.append(tray);
  document.body.append(panel);

  let active = null;
  let editing = null;
  const blockFor = (id) => document.querySelector(`[data-q="${CSS.escape(id)}"]`);
  const excerptOf = (block) => block.innerText.replace(/\s+/g, ' ').trim().slice(0, 240);
  const sectionOf = (block) => {
    if (block.closest('.findings')) return t.findings;
    if (block.closest('.brief-header')) return t.header;
    const heading = block.closest('.brief-section') && block.closest('.brief-section').querySelector('h2');
    return heading ? heading.textContent.replace(/^\d{2}/, '').trim() : '';
  };
  const marginVisible = () => margin.getClientRects().length > 0 && getComputedStyle(margin).display !== 'none' && margin.offsetWidth > 120;
  const topOf = (block) => block.getBoundingClientRect().top - margin.getBoundingClientRect().top;
  const ordered = () => [...state.questions].sort((a, b) => {
    const left = blockFor(a.blockId);
    const right = blockFor(b.blockId);
    if (!left || !right || left === right) return String(a.createdAt).localeCompare(String(b.createdAt));
    return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

  function announce(message, tone) {
    status.textContent = message;
    status.dataset.tone = tone || '';
  }
  function clearSelection() {
    if (active) active.classList.remove('is-asking');
    active = null;
    pill.hidden = true;
  }
  function select(block) {
    if (active && active !== block) active.classList.remove('is-asking');
    active = block;
    block.classList.add('is-asking');
    composer.hidden = true;
    pill.hidden = false;
    layout();
  }
  function openComposer(block, question) {
    select(block);
    editing = question || null;
    pill.hidden = true;
    composer.hidden = false;
    composer.querySelector('.ask-excerpt').textContent = excerptOf(block);
    composer.querySelector('.ask-error').textContent = '';
    input.value = question ? question.question : '';
    layout();
    input.focus({ preventScroll: true });
    const smooth = reduced.matches ? 'auto' : 'smooth';
    if (!marginVisible()) {
      block.scrollIntoView({ block: 'start', behavior: reduced.matches ? 'auto' : 'instant' });
      const topbar = document.querySelector('.brief-topbar');
      const barBottom = topbar && getComputedStyle(topbar).display !== 'none' ? topbar.getBoundingClientRect().bottom : 0;
      if (barBottom) {
        const heading = block.closest('.brief-section') && block.closest('.brief-section').querySelector('h2');
        if (heading) {
          const rect = heading.getBoundingClientRect();
          if (rect.top < barBottom && rect.bottom > barBottom) scrollBy({ top: rect.bottom - barBottom + 16, behavior: smooth });
        }
      }
      return;
    }
    const overflow = composer.getBoundingClientRect().bottom - (innerHeight - 110);
    if (overflow > 0) scrollBy({ top: overflow, behavior: smooth });
  }
  function closeComposer(restore) {
    composer.hidden = true;
    editing = null;
    const block = active;
    clearSelection();
    if (restore && block && block.hasAttribute('tabindex')) block.focus({ preventScroll: true });
  }
  function stopPicking() {
    delete root.dataset.picking;
    document.querySelectorAll('[data-q][tabindex="0"][data-picking]').forEach((block) => { block.removeAttribute('tabindex'); block.removeAttribute('data-picking'); });
  }
  function startPicking() {
    root.dataset.picking = 'true';
    const blocks = [...document.querySelectorAll('[data-q]')].filter((block) => block.getClientRects().length);
    blocks.forEach((block) => { if (!block.hasAttribute('tabindex')) { block.tabIndex = 0; block.dataset.picking = ''; } });
    panel.hidden = true;
    renderTray();
    const visible = blocks.find((block) => block.getBoundingClientRect().top > 80) || blocks[0];
    if (visible) visible.focus();
    announce(t.picking);
  }

  function save(event) {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) { composer.querySelector('.ask-error').textContent = t.required; input.focus(); return; }
    const now = new Date().toISOString();
    if (editing) Object.assign(editing, { question: text, updatedAt: now });
    else if (active) state.questions.push({ id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), blockId: active.dataset.q, section: sectionOf(active), excerpt: excerptOf(active), question: text, createdAt: now, updatedAt: now });
    persist();
    closeComposer(true);
    render();
    announce(t.stored);
  }
  function remove(question) {
    state.questions = state.questions.filter((item) => item !== question);
    persist();
    render();
    announce(t.deleted);
  }

  function noteItem(question, index, withExcerpt) {
    const item = document.createElement('li');
    item.className = 'note';
    item.dataset.for = question.blockId;
    const numberMark = document.createElement('span');
    numberMark.className = 'note-num';
    numberMark.textContent = String(index + 1);
    numberMark.setAttribute('aria-hidden', 'true');
    const body = document.createElement('div');
    if (withExcerpt) {
      const about = document.createElement('p');
      about.className = 'note-about';
      about.textContent = `${t.about}: ${question.excerpt.slice(0, 90)}${question.excerpt.length > 90 ? '…' : ''}`;
      body.append(about);
    }
    const text = document.createElement('p');
    text.className = 'note-text';
    text.textContent = question.question;
    const meta = document.createElement('p');
    meta.className = 'note-meta';
    const sent = state.sentSignature && state.sentSignature === signature(state.questions);
    meta.textContent = `${sent ? t.sent : t.saved} · ${String(question.updatedAt || question.createdAt).slice(0, 10)}`;
    const actions = document.createElement('div');
    actions.className = 'note-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = t.edit;
    edit.addEventListener('click', () => {
      const block = blockFor(question.blockId);
      panel.hidden = true;
      renderTray();
      if (block) { block.scrollIntoView({ block: 'center', behavior: reduced.matches ? 'auto' : 'smooth' }); openComposer(block, question); }
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = t.remove;
    del.addEventListener('click', () => remove(question));
    actions.append(edit, del);
    body.append(text, meta, actions);
    item.append(numberMark, body);
    item.addEventListener('mouseenter', () => { const block = blockFor(question.blockId); if (block) block.classList.add('is-linked'); });
    item.addEventListener('mouseleave', () => { const block = blockFor(question.blockId); if (block) block.classList.remove('is-linked'); });
    return item;
  }
  function renderTray() {
    const count = state.questions.length;
    const sent = count > 0 && state.sentSignature === signature(state.questions);
    tray.replaceChildren();
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'tray-open';
    open.setAttribute('aria-expanded', String(!panel.hidden));
    open.setAttribute('aria-controls', 'question-panel');
    open.innerHTML = bookmark + '<span></span>';
    open.querySelector('span').textContent = count ? t.count(count) : t.empty;
    open.addEventListener('click', () => { panel.hidden = !panel.hidden; renderTray(); if (!panel.hidden) panel.querySelector('.panel-close').focus(); });
    tray.append(open);
    tray.dataset.count = String(count);
    if (count) {
      const send = document.createElement('button');
      send.type = 'button';
      send.className = 'tray-send';
      send.textContent = sent ? t.sentAll : t.send;
      send.disabled = sent;
      send.addEventListener('click', submit);
      tray.append(send);
    }
    const panelSend = panel.querySelector('.panel-send');
    panelSend.textContent = sent ? t.sentAll : t.send;
    panelSend.disabled = !count || sent;
    panel.querySelector('.panel-copy').disabled = !count;
    panel.querySelector('.panel-download').disabled = !count;
  }
  function render() {
    const questions = ordered();
    document.querySelectorAll('[data-q][data-asked]').forEach((block) => block.removeAttribute('data-asked'));
    questions.forEach((question) => { const block = blockFor(question.blockId); if (block) block.dataset.asked = ''; });
    notesList.replaceChildren(...questions.map((question, index) => noteItem(question, index, false)));
    panel.querySelector('.panel-list').replaceChildren(...questions.map((question, index) => noteItem(question, index, true)));
    renderTray();
    layout();
  }
  function layout() {
    if (!marginVisible()) {
      notesList.querySelectorAll('.note').forEach((note) => { note.style.top = ''; });
      pill.style.top = '';
      composer.style.top = '';
      return;
    }
    let floor = 0;
    notesList.querySelectorAll('.note').forEach((note) => {
      const block = blockFor(note.dataset.for);
      const top = Math.max(block ? topOf(block) : floor, floor);
      note.style.top = `${top}px`;
      floor = top + note.offsetHeight + 16;
    });
    if (active) {
      const top = `${Math.max(0, topOf(active))}px`;
      pill.style.top = top;
      composer.style.top = top;
    }
  }

  function exportText() {
    const questions = ordered();
    return [t.intro(title.trim(), questions.length), ...questions.map((question, index) => `\n${index + 1}. ${t.about}${question.section ? ` (${question.section})` : ''}: “${question.excerpt}”\n   ${t.question}: ${question.question}`)].join('\n');
  }
  function payload() {
    return { documentId, title: title.trim(), questions: ordered().map(({ id, blockId, section, excerpt, question, createdAt, updatedAt }) => ({ id, blockId, section, excerpt, question, createdAt, updatedAt })) };
  }
  function offline() {
    panel.hidden = false;
    renderTray();
    announce(t.offline);
    panel.querySelector('.panel-copy').focus();
  }
  async function submit() {
    if (!state.questions.length) return;
    if (!endpoint) { offline(); return; }
    const sentSignature = signature(state.questions);
    announce(t.sending);
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: state.serverRevision, data: payload() }), signal: AbortSignal.timeout(10000) });
      if (response.status === 409) {
        const latest = await response.json().catch(() => ({}));
        state.serverRevision = Number(latest.revision) || state.serverRevision;
        persist();
        panel.hidden = false;
        renderTray();
        announce(t.conflict, 'error');
        return;
      }
      if (!response.ok) { offline(); return; }
      const result = await response.json();
      state.serverRevision = result.revision;
      state.sentSignature = sentSignature;
      persist();
      render();
      panel.hidden = false;
      renderTray();
      announce(t.delivered(result.receipt), 'success');
    } catch {
      offline();
    }
  }
  async function copy() {
    const text = exportText();
    try {
      await navigator.clipboard.writeText(text);
      announce(t.copied, 'success');
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.className = 'visually-hidden';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      announce(ok ? t.copied : t.copyFailed, ok ? 'success' : 'error');
    }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload(), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${es ? 'preguntas' : 'questions'}-${documentId}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  composer.addEventListener('submit', save);
  composer.querySelector('.ask-cancel').addEventListener('click', () => closeComposer(true));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); closeComposer(true); }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) composer.requestSubmit();
  });
  pill.addEventListener('click', () => { if (active) openComposer(active); });
  panel.querySelector('.panel-close').addEventListener('click', () => { panel.hidden = true; renderTray(); tray.querySelector('.tray-open').focus(); });
  panel.querySelector('.panel-send').addEventListener('click', submit);
  panel.querySelector('.panel-copy').addEventListener('click', copy);
  panel.querySelector('.panel-download').addEventListener('click', download);
  panel.querySelector('.panel-keyboard').addEventListener('click', startPicking);

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest('.ask-composer,.ask-pill,.question-tray,.question-panel,.margin-notes')) return;
    if (target.closest('a,button,summary,input,textarea,select,video,label,.map-scroll,.document-sidebar,.brief-topbar,.brief-footer')) return;
    if (String(getSelection() || '').trim()) return;
    const block = target.closest('[data-q]');
    if (!composer.hidden && input.value.trim()) return;
    if (!block || block === active) { closeComposer(false); return; }
    select(block);
  });
  document.addEventListener('keydown', (event) => {
    const block = event.target instanceof Element && event.target.matches('[data-q]') ? event.target : null;
    if (block && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openComposer(block); return; }
    if (event.key === 'Escape') {
      if (!composer.hidden) { closeComposer(true); return; }
      if (!panel.hidden) { panel.hidden = true; renderTray(); tray.querySelector('.tray-open').focus(); return; }
      if (active) clearSelection();
      if (root.dataset.picking) stopPicking();
    }
  });

  if ('ResizeObserver' in window) new ResizeObserver(() => layout()).observe(document.querySelector('.brief') || document.body);
  addEventListener('resize', layout);
  document.addEventListener('toggle', layout, true);
  if (document.fonts) document.fonts.ready.then(layout);
  render();

  if (endpoint) {
    fetch(endpoint, { signal: AbortSignal.timeout(5000) }).then((response) => response.ok ? response.json() : null).then((saved) => {
      if (!saved) return;
      state.serverRevision = Number(saved.revision) || 0;
      const serverQuestions = saved.data && Array.isArray(saved.data.questions) ? saved.data.questions : [];
      if (!state.questions.length && serverQuestions.length) {
        state.questions = serverQuestions;
        state.sentSignature = signature(serverQuestions);
      } else if (serverQuestions.length && signature(serverQuestions) === signature(state.questions)) {
        state.sentSignature = signature(state.questions);
      }
      persist();
      render();
    }).catch(() => {});
  }
})();
