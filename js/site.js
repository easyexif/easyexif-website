/* Shared site chrome and helpers. Pages mark their slots with data-site="header|tools|promo|footer". */
(() => {
  'use strict';

  // Paste the Chrome Web Store listing URL here once it is published.
  // While it is empty, every "Add to Chrome" button shows "Coming soon" instead of a link.
  const EXTENSION_URL = '';

  const ICONS = {
    view: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    edit: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
    remove: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>',
    copy: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
    extract: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
    upload: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>'
  };
  const TOOLS = [
    { id: 'view', href: 'index.html', nav: 'Viewer', title: 'EXIF viewer', desc: 'See the camera, lens, settings, date and GPS location hidden inside any photo.' },
    { id: 'edit', href: 'edit.html', nav: 'Edit', title: 'EXIF editor', desc: 'Change the date, camera, copyright or location of a photo, or fix a wrong timestamp.' },
    { id: 'remove', href: 'remove.html', nav: 'Remove', title: 'Remove EXIF', desc: 'Strip location and other private metadata before you share. Works on many photos at once.' },
    { id: 'copy', href: 'copy.html', nav: 'Copy', title: 'Copy EXIF', desc: 'Copy metadata from one photo onto another, like an edit that lost its camera info.' },
    { id: 'extract', href: 'extract.html', nav: 'Extract', title: 'Extract EXIF', desc: 'Export a photo’s metadata as JSON, CSV or text, and save its embedded thumbnail.' }
  ];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bytes = n => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

  function download(blobOrBytes, name, type) {
    const blob = blobOrBytes instanceof Blob ? blobOrBytes : new Blob([blobOrBytes], { type: type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  let toastTimer;
  function toast(msg) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  async function readBytes(file) { return new Uint8Array(await file.arrayBuffer()); }
  const baseName = name => name.replace(/\.[^.]+$/, '');
  const extOf = name => (/\.([^.]+)$/.exec(name) || [, ''])[1].toLowerCase();

  /** Wires a drop area: click, keyboard, drag-and-drop (and optionally paste). */
  function dropzone(el, { multiple = false, accept = 'image/*,.heic,.heif,.avif,.tif,.tiff', onFiles, paste = false }) {
    const input = el.querySelector('input[type=file]');
    input.accept = accept; input.multiple = multiple;
    el.tabIndex = 0; el.setAttribute('role', 'button');
    const open = () => input.click();
    el.addEventListener('click', e => { if (e.target.closest('a,button') || el.classList.contains('filled')) return; open(); });
    el.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !el.classList.contains('filled')) { e.preventDefault(); open(); } });
    input.addEventListener('change', () => { if (input.files.length) onFiles(Array.from(input.files)); input.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => el.addEventListener(ev, e => { e.preventDefault(); el.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => el.addEventListener(ev, e => { e.preventDefault(); el.classList.remove('over'); }));
    el.addEventListener('drop', e => {
      const files = Array.from(e.dataTransfer.files);
      if (files.length) onFiles(multiple ? files : files.slice(0, 1));
    });
    if (paste) document.addEventListener('paste', e => {
      const files = Array.from(e.clipboardData ? e.clipboardData.files : []).filter(f => f.type.startsWith('image/'));
      if (files.length) onFiles(multiple ? files : files.slice(0, 1));
    });
    return { open };
  }
  const dropMarkup = (title, hint) => `<input type="file"><div class="icon">${ICONS.upload}</div><strong>${title}</strong><span>${hint}</span>`;

  /* ---------- chrome */
  function header(current) {
    return `<header class="site-header"><div class="wrap">
      <a class="brand" href="index.html"><img src="icon.png" alt="" width="30" height="30">EasyEXIF</a>
      <nav class="nav" aria-label="Tools">${TOOLS.map(t => `<a href="${t.href}"${t.id === current ? ' aria-current="page"' : ''}>${t.nav}</a>`).join('')}</nav>
      <a class="btn primary small" data-ext href="${EXTENSION_URL}" target="_blank" rel="noopener">Add to Chrome</a>
    </div></header>`;
  }
  function toolCards(current) {
    return `<div class="wrap"><div class="section-title"><h2>Every photo-metadata tool you need</h2><p>All free, all private. Nothing leaves your device.</p></div>
      <div class="cards">${TOOLS.map(t => `<a class="card" href="${t.href}"${t.id === current ? ' aria-current="page"' : ''}><div class="icon">${ICONS[t.id]}</div><h3>${t.title}</h3><p>${t.desc}</p></a>`).join('')}</div></div>`;
  }
  function promo() {
    return `<div class="wrap"><div class="promo-box">
      <div><h2>See any photo’s EXIF without leaving the page.</h2>
      <p>The EasyEXIF Chrome extension puts camera, lens and exposure details right on top of photos as you browse, so you never have to download an image to peek inside it.</p>
      <ul><li>Hover labels with camera, lens, settings, date and size</li><li>Finds the best available version of an image and downloads it</li><li>Full details window with search, GPS and copy buttons</li><li>Runs locally. No photos or metadata are uploaded</li></ul>
      <div class="row"><a class="btn primary big" data-ext href="${EXTENSION_URL}" target="_blank" rel="noopener">Add EasyEXIF to Chrome</a></div></div>
      <div class="mock" aria-hidden="true"><div class="label">Canon EOS R6<br>EF85mm f/1.8 USM<br>85mm · f/2.2 · 1/320s · ISO 400<br>3/12/2026, 12:10:45 AM</div><div class="dl">⬇ Best 1150×1560</div></div>
    </div></div>`;
  }
  function footer() {
    return `<footer class="site-footer"><div class="wrap">
      <div><a class="brand" href="index.html" style="display:flex"><img src="icon.png" alt="" width="30" height="30">EasyEXIF</a>
      <p>Free photo metadata tools that run in your browser. Your images are never uploaded.</p></div>
      <div><h4>Tools</h4>${TOOLS.map(t => `<a href="${t.href}">${t.title}</a>`).join('')}</div>
      <div><h4>EasyEXIF</h4><a data-ext href="${EXTENSION_URL}" target="_blank" rel="noopener">Chrome extension</a><a href="privacy.html">Privacy</a></div>
    </div></footer>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const current = document.body.dataset.tool || '';
    const slots = { header: () => header(current), tools: () => toolCards(current), promo, footer };
    $$('[data-site]').forEach(el => { const f = slots[el.dataset.site]; if (f) el.innerHTML = f(); });
    if (!EXTENSION_URL) comingSoon(document);
  });

  function comingSoon(root) {
    root.querySelectorAll('[data-ext]').forEach(a => {
      a.removeAttribute('href'); a.removeAttribute('target');
      a.setAttribute('aria-disabled', 'true');
      if (a.classList.contains('btn')) { a.textContent = a.classList.contains('big') ? 'Chrome extension coming soon' : 'Extension coming soon'; a.style.cursor = 'default'; a.style.opacity = '.75'; }
      else { a.style.textDecoration = 'none'; a.style.color = 'inherit'; }
    });
  }

  window.Site = { $, $$, esc, bytes, download, toast, readBytes, baseName, extOf, dropzone, dropMarkup, ICONS, EXTENSION_URL, comingSoon };
})();
