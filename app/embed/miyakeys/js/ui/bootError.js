/* When the page cannot start, the loader says so in words instead of spinning (or vanishing onto a blank stage). */
export function showBootError(err) {
  if (err) console.error('miyakeys could not start', err);
  let el = document.getElementById('loader');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loader';
    document.body.append(el);
  }
  el.style.opacity = '1';
  el.classList.add('failed');
  el.setAttribute('role', 'alert');
  const msg = document.createElement('p');
  msg.className = 'bootErr';
  msg.textContent = 'miyakeys could not start. Close the window and open it again; if it still fails, try another browser.';
  el.replaceChildren(msg);
}
