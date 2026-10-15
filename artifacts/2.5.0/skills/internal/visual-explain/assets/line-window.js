(() => {
  const data = JSON.parse(document.getElementById('visual-data').textContent);
  const rail = document.querySelector('.rail');
  const drawing = document.querySelector('.drawing');
  const figure = document.querySelector('figure');
  const buttons = [...rail.querySelectorAll('button')];
  const items = [...rail.children];
  const windowBox = document.querySelector('.focus-window');
  const notes = document.getElementById('annotations');
  const connections = document.querySelector('.connections');
  const narrow = matchMedia('(max-width:640px)');
  let selected = data.selected;
  let dragging = false;

  function position() {
    const parent = narrow.matches ? items[selected] : figure;
    if (notes.parentNode !== parent) {
      if (narrow.matches) parent.append(notes);
      else connections.after(notes);
    }
    if (narrow.matches) return;
    const bounds = drawing.getBoundingClientRect();
    const box = buttons[selected].getBoundingClientRect();
    const center = box.left - bounds.left + box.width / 2;
    const width = Math.min(112, box.width - 8);
    windowBox.style.left = '0';
    windowBox.style.width = `${width}px`;
    windowBox.style.height = `${bounds.height - 29}px`;
    windowBox.style.transform = `translateX(${center - width / 2}px)`;
    connections.setAttribute('viewBox', `0 0 ${bounds.width} 40`);
    const ends = [(bounds.width - 48) / 4, bounds.width - (bounds.width - 48) / 4];
    [...connections.children].forEach((path, i) => {
      const start = center + (i === 0 ? -1 : 1) * width / 2;
      path.setAttribute('d', `M${start} 0 C${start} 20 ${ends[i]} 20 ${ends[i]} 40`);
    });
  }
  function choose(index, focus = false) {
    selected = Math.max(0, Math.min(buttons.length - 1, index));
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === selected)));
    notes.setAttribute('aria-label', data.steps[selected].label);
    document.getElementById('include').textContent = data.steps[selected].include;
    document.getElementById('exclude').textContent = data.steps[selected].exclude;
    position();
    if (focus) buttons[selected].focus({ preventScroll: false });
  }
  buttons.forEach((button, index) => {
    button.disabled = false;
    button.addEventListener('click', () => choose(index));
    button.addEventListener('keydown', event => {
      const offsets = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
      let target;
      if (Object.hasOwn(offsets, event.key)) target = index + offsets[event.key];
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = buttons.length - 1;
      else return;
      event.preventDefault();
      choose(target, true);
    });
  });
  function nearest(clientX) {
    const distances = buttons.map(button => {
      const rect = button.getBoundingClientRect();
      return Math.abs(clientX - rect.left - rect.width / 2);
    });
    return distances.indexOf(Math.min(...distances));
  }
  windowBox.addEventListener('pointerdown', event => {
    if (narrow.matches || event.button !== 0) return;
    dragging = true;
    windowBox.classList.add('dragging');
    windowBox.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  windowBox.addEventListener('pointermove', event => {
    if (!dragging) return;
    const target = nearest(event.clientX);
    if (target !== selected) choose(target);
  });
  const finish = () => { dragging = false; windowBox.classList.remove('dragging'); };
  windowBox.addEventListener('pointerup', finish);
  windowBox.addEventListener('pointercancel', finish);
  windowBox.addEventListener('lostpointercapture', finish);
  narrow.addEventListener('change', position);
  new ResizeObserver(position).observe(drawing);
  document.documentElement.classList.add('js');
  choose(selected);
})();
