// Small DOM helpers shared by the windows and panels.

export const $ = (id) => document.getElementById(id);

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
}

const TITLE_BAR_HEIGHT = 24;
const MIN_TITLE_BAR_SHOWING = 80;
const isPhoneLayout = () => matchMedia('(max-width: 760px)').matches;

function trackPointer(node, event, onMove) {
  event.preventDefault();
  node.setPointerCapture(event.pointerId);
  const stop = () => {
    node.removeEventListener('pointermove', onMove);
    node.removeEventListener('pointerup', stop);
    node.removeEventListener('pointercancel', stop);
  };
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', stop);
  node.addEventListener('pointercancel', stop);
}

// Places a window, always leaving enough title bar on screen to grab it again.
function moveWindow(frame, left, top) {
  const maxLeft = window.innerWidth - MIN_TITLE_BAR_SHOWING;
  const minLeft = MIN_TITLE_BAR_SHOWING - frame.offsetWidth;
  const maxTop = window.innerHeight - TITLE_BAR_HEIGHT;
  Object.assign(frame.style, {
    left: `${Math.round(Math.max(minLeft, Math.min(maxLeft, left)))}px`,
    top: `${Math.round(Math.max(0, Math.min(maxTop, top)))}px`,
  });
}

// Windows start out centered by CSS, and stay that way until one is moved.
function unpinFromCenter(frame) {
  const { left, top } = frame.getBoundingClientRect();
  Object.assign(frame.style, { right: 'auto', bottom: 'auto', margin: '0', transform: 'none' });
  moveWindow(frame, left, top);
}

export function keepOnScreen(frame) {
  if (frame.style.left) moveWindow(frame, frame.offsetLeft, frame.offsetTop);
}

export function makeDraggable(frame, handle) {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || isPhoneLayout() || event.target.closest('button')) return;
    const { left, top } = frame.getBoundingClientRect();
    const grabX = event.clientX - left, grabY = event.clientY - top;
    unpinFromCenter(frame);
    trackPointer(handle, event, (moved) => moveWindow(frame, moved.clientX - grabX, moved.clientY - grabY));
  });
}

export function makeResizable(frame, grip, minWidth, minHeight) {
  grip.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || isPhoneLayout()) return;
    const rect = frame.getBoundingClientRect();
    const offsetX = rect.right - event.clientX, offsetY = rect.bottom - event.clientY;
    unpinFromCenter(frame);
    trackPointer(grip, event, (moved) => {
      const right = Math.min(window.innerWidth, moved.clientX + offsetX);
      const bottom = Math.min(window.innerHeight, moved.clientY + offsetY);
      frame.style.width = `${Math.max(minWidth, Math.round(right - rect.left))}px`;
      frame.style.height = `${Math.max(minHeight, Math.round(bottom - rect.top))}px`;
    });
  });
}

// A Win98 window floating over the app. Returns its body and a close function.
export function openDialog(title, { small = false, onClose } = {}) {
  const close = () => {
    frame.remove();
    onClose?.();
  };
  const body = el('div', { class: 'window-body' });
  const titleBar = el('div', { class: 'title-bar' },
    el('div', { class: 'title-bar-text' }, title),
    el('div', { class: 'title-bar-controls' }, el('button', { 'aria-label': 'Close', onclick: close })));
  const frame = el('div', { class: `window dialog${small ? ' small' : ''}`, role: 'dialog', 'aria-label': title }, titleBar, body);
  document.body.append(frame);
  makeDraggable(frame, titleBar);
  return { body, close };
}

export function prompt98(title, label, value) {
  return new Promise((resolve) => {
    let answer = null;
    const { body, close } = openDialog(title, { small: true, onClose: () => resolve(answer) });
    const input = el('input', { type: 'text', value });
    const accept = () => {
      answer = input.value;
      close();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') accept();
      event.stopPropagation();
    });
    body.append(el('label', {}, label), input,
      el('div', { class: 'dialog-buttons' },
        el('button', { onclick: accept }, 'OK'),
        el('button', { onclick: close }, 'Cancel')));
    input.select();
  });
}

export function download(name, parts, type) {
  const url = URL.createObjectURL(new Blob(parts, { type }));
  const link = el('a', { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
