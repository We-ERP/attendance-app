const $ = s => document.querySelector(s);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const P = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
  task: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  leave: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  back: '<path d="M9 18l6-6-6-6"/>'
};

const ic = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

function paintIcons(root = document) {
  root.querySelectorAll('[data-ic]').forEach(el => el.innerHTML = ic(el.dataset.ic));
}

function toast(msg, isErr = false) {
  const t = $('#toast');
  if (!t) return alert(msg);
  t.textContent = msg;
  t.classList.toggle('err', isErr);
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3500);
}

function busy(on, text = 'جاري التحميل...') {
  const b = $('#busy');
  if (!b) return;
  $('#busyText').textContent = text;
  b.hidden = !on;
}

function setBadge(sel, n) {
  const b = $(sel);
  b.hidden = !n;
  b.textContent = n;
}

function avatarHTML(e) {
  if (e.avatar) return `<img src="${esc(e.avatar)}" alt="">`;
  const initials = (e.name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('');
  return `<span>${esc(initials)}</span>`;
}

function row(icon, title, sub, tag = '', iconCls = '', tagCls = '') {
  return `
    <div class="item">
      <div class="item-ic ${iconCls}">${ic(icon)}</div>
      <div class="grow"><b>${esc(title)}</b><small>${esc(sub)}</small></div>
      ${tag ? `<span class="tag ${tagCls}">${esc(tag)}</span>` : ''}
    </div>`;
}

const stat = (v, label, sub = '') =>
  `<div class="stat"><b>${esc(v)}</b><span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
