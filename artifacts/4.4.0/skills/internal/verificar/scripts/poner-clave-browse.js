// Pone la contraseña de la cuenta de prueba en el campo de contraseña visible, sin mostrarla.
// Úsalo dentro de un execute de Browse cuando el campo ya está en pantalla.
return await page.evaluate(async () => {
  const el = document.querySelector('input[type=password]');
  if (!el) return 'no hay campo de contraseña visible';
  const r = await fetch('http://127.0.0.1:3499/clave');
  if (!r.ok) return 'el ayudante de clave respondió ' + r.status;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(el, (await r.text()).trim());
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'clave puesta';
}, undefined, undefined, false);
