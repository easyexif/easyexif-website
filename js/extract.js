(() => {
  'use strict';
  const { $, esc, bytes, download, toast, readBytes, baseName, dropzone, dropMarkup } = Site;
  const C = ExifCore;
  const drop = $('#drop'), work = $('#work'), list = $('#list');
  drop.innerHTML = dropMarkup('Drop photos here, or click to choose', 'Select as many as you like. Nothing is uploaded.');
  const items = [];
  let previewIndex = -1, previewText = '';

  dropzone(drop, { multiple: true, paste: true, page: true, onFiles: add });
  $('#clear').addEventListener('click', () => { items.splice(0).forEach(i => URL.revokeObjectURL(i.url)); previewIndex = -1; render(); });
  $('#all-csv').addEventListener('click', () => download(C.toCsv(items.map(i => ({ name: i.file.name, meta: i.meta }))), 'exif-metadata.csv', 'text/csv'));
  $('#all-json').addEventListener('click', () => {
    const obj = {};
    for (const i of items) obj[i.file.name] = C.toPlainObject(i.meta, i.file.name);
    download(JSON.stringify(items.length === 1 ? obj[items[0].file.name] : obj, null, 2), 'exif-metadata.json', 'application/json');
  });
  $('#preview-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(previewText); toast('Copied'); } catch (e) { toast('Copy was blocked by the browser'); }
  });

  async function add(files) {
    for (const file of files) {
      const data = await readBytes(file);
      items.push({ file, data, meta: C.readMetadata(data), url: URL.createObjectURL(file) });
    }
    if (previewIndex < 0) previewIndex = 0;
    render();
  }

  function render() {
    work.hidden = !items.length;
    $('#count').textContent = `${items.length} photo${items.length === 1 ? '' : 's'} read`;
    list.innerHTML = items.map((it, i) => {
      const rows = it.meta.groups.reduce((n, g) => n + (g.id === 'file' ? 0 : g.rows.length), 0);
      const sub = [it.meta.formatName, bytes(it.file.size), rows ? `${rows} tags` : 'no metadata found', it.meta.gps ? 'has GPS' : ''].filter(Boolean).join(' · ');
      return `<div class="file-item"><img src="${it.url}" alt=""><div><div class="name">${esc(it.file.name)}</div><div class="info">${esc(sub)}</div></div>
        <div class="row" style="justify-content:flex-end">
          <button class="btn small" data-a="view" data-i="${i}">Preview</button>
          <button class="btn small" data-a="json" data-i="${i}">JSON</button>
          <button class="btn small" data-a="txt" data-i="${i}">Text</button>
          ${it.meta.thumbnail ? `<button class="btn small" data-a="thumb" data-i="${i}">Thumbnail</button>` : ''}
          ${it.meta.xmp ? `<button class="btn small" data-a="xmp" data-i="${i}">XMP</button>` : ''}
        </div></div>`;
    }).join('');
    list.querySelectorAll('button').forEach(b => b.addEventListener('click', () => act(b.dataset.a, items[+b.dataset.i], +b.dataset.i)));
    paintPreview();
  }

  function act(kind, it, i) {
    const n = baseName(it.file.name);
    if (kind === 'view') { previewIndex = i; paintPreview(); $('#preview-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    else if (kind === 'json') download(JSON.stringify(C.toPlainObject(it.meta, it.file.name), null, 2), `${n}-exif.json`, 'application/json');
    else if (kind === 'txt') download(C.toText(it.meta, it.file.name), `${n}-exif.txt`, 'text/plain');
    else if (kind === 'thumb') download(it.meta.thumbnail, `${n}-thumbnail.jpg`, 'image/jpeg');
    else if (kind === 'xmp') download(it.meta.xmp, `${n}.xmp`, 'application/xml');
  }

  function paintPreview() {
    const it = items[previewIndex];
    $('#preview-panel').hidden = !it;
    if (!it) return;
    previewText = it.meta.groups.length ? C.toText(it.meta, it.file.name) : 'No metadata found in this file.';
    $('#preview-title').textContent = it.file.name;
    $('#preview').textContent = previewText;
  }
})();
