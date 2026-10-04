(() => {
  'use strict';
  const { $, esc, bytes, download, toast, readBytes, baseName, extOf, dropzone, dropMarkup } = Site;
  const drop = $('#drop'), work = $('#work'), list = $('#list');
  drop.innerHTML = dropMarkup('Drop photos here, or click to choose', 'JPEG, PNG and WebP are cleaned losslessly. Select as many as you like.');
  const items = [];
  const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' };

  dropzone(drop, { multiple: true, paste: true, page: true, onFiles: add });
  $('#opt-ori').addEventListener('change', reprocessAll);
  $('#opt-icc').addEventListener('change', reprocessAll);
  $('#clear').addEventListener('click', () => { items.splice(0).forEach(i => URL.revokeObjectURL(i.url)); render(); });
  $('#dl-all').addEventListener('click', downloadAll);

  async function add(files) {
    for (const file of files) {
      const item = { file, url: URL.createObjectURL(file), status: 'working' };
      items.push(item);
      item.data = await readBytes(file);
      item.before = ExifCore.readMetadata(item.data);
      await process(item);
    }
    render();
  }
  async function process(item) {
    item.error = item.result = item.note = null;
    const fmt = item.before.format;
    try {
      if (ExifCore.WRITABLE.has(fmt)) {
        const bytesOut = ExifCore.stripMetadata(item.data, { keepOrientation: $('#opt-ori').checked, keepColorProfile: $('#opt-icc').checked });
        item.result = { bytes: bytesOut, name: `${baseName(item.file.name)}-clean.${EXT[fmt]}`, type: MIME[fmt] };
        const after = ExifCore.readMetadata(bytesOut);
        const left = after.flags.filter(f => f.level !== 'low' || f.id === 'date' || f.id === 'camera');
        item.clean = !left.length;
        item.leftover = left;
      } else {
        // Anything the browser can draw is re-drawn as a clean PNG.
        const blob = await ExifCore.reencode(item.file, 'image/png');
        item.result = { bytes: new Uint8Array(await blob.arrayBuffer()), name: `${baseName(item.file.name)}-clean.png`, type: 'image/png' };
        item.clean = true;
        item.note = `Re-drawn as PNG (${item.before.formatName} can’t be edited in place).`;
      }
    } catch (err) {
      item.error = fmt === 'heic' || fmt === 'unknown' ? 'This format can’t be read by your browser. Try converting it to JPEG first.' : (err.message || 'Could not process this file.');
    }
    item.status = 'done';
  }
  async function reprocessAll() { for (const i of items) await process(i); render(); }

  function render() {
    work.hidden = !items.length;
    list.innerHTML = items.map((it, i) => {
      const b = it.before;
      const found = b ? b.flags.filter(f => f.level !== 'low' || ['date', 'camera'].includes(f.id)).map(f => f.title) : [];
      const state = it.error ? `<span class="pill bad">${esc(it.error)}</span>`
        : !it.result ? '<span class="pill">Working…</span>'
        : it.clean ? '<span class="pill ok">Clean ✓</span>' : `<span class="pill warn">Still has: ${esc(it.leftover.map(f => f.title).join(', '))}</span>`;
      const info = it.result
        ? `${bytes(it.file.size)} → ${bytes(it.result.bytes.length)} · ${found.length ? 'Removed: ' + esc(found.join(', ')) : 'Had no sensitive metadata'}`
        : `${bytes(it.file.size)}`;
      return `<div class="file-item"><img src="${it.url}" alt=""><div><div class="name">${esc(it.file.name)}</div><div class="info">${info}${it.note ? ' · ' + esc(it.note) : ''}</div><div style="margin-top:4px">${state}</div></div>
        <button class="btn small" data-i="${i}" ${it.result ? '' : 'disabled'}>Download</button></div>`;
    }).join('');
    list.querySelectorAll('button[data-i]').forEach(btn => btn.addEventListener('click', () => {
      const r = items[+btn.dataset.i].result;
      download(r.bytes, r.name, r.type);
    }));
    const ok = items.filter(i => i.result);
    $('#dl-all').disabled = !ok.length;
    $('#dl-all').textContent = ok.length > 1 ? `Download ${ok.length} photos (ZIP)` : 'Download clean photo';
  }

  function downloadAll() {
    const ok = items.filter(i => i.result);
    if (!ok.length) return;
    if (ok.length === 1) { download(ok[0].result.bytes, ok[0].result.name, ok[0].result.type); return; }
    const used = new Set();
    const files = ok.map(i => {
      let name = i.result.name, n = 1;
      while (used.has(name)) name = i.result.name.replace(/(\.[^.]+)$/, `-${++n}$1`);
      used.add(name);
      return { name, data: i.result.bytes };
    });
    download(ExifCore.makeZip(files), 'clean-photos.zip');
    toast('ZIP created on your device');
  }
})();
