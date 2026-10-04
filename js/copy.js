(() => {
  'use strict';
  const { $, esc, bytes, download, toast, readBytes, baseName, extOf, dropzone, dropMarkup } = Site;
  const C = ExifCore;
  const slots = {
    src: { drop: $('#drop-src'), hint: 'Photo that has the EXIF' },
    tgt: { drop: $('#drop-tgt'), hint: 'Photo that needs it' }
  };
  const state = { src: null, tgt: null };
  const urls = {};

  for (const [key, slot] of Object.entries(slots)) {
    slot.drop.innerHTML = '<input type="file"><div class="inner"></div>';
    slot.inner = slot.drop.querySelector('.inner');
    slot.input = slot.drop.querySelector('input');
    empty(key);
    dropzone(slot.drop, { onFiles: files => load(key, files[0]), paste: false });
  }
  function empty(key) {
    const slot = slots[key];
    slot.drop.classList.remove('filled');
    slot.inner.innerHTML = dropMarkup('Drop or click', slot.hint).replace('<input type="file">', '');
  }
  async function load(key, file) {
    const data = await readBytes(file);
    const meta = C.readMetadata(data);
    state[key] = { file, data, meta };
    if (urls[key]) URL.revokeObjectURL(urls[key]);
    urls[key] = URL.createObjectURL(file);
    paintSlot(key);
    refresh();
  }
  function paintSlot(key) {
    const s = state[key], slot = slots[key];
    if (!s) { empty(key); return; }
    slot.drop.classList.add('filled');
    const info = key === 'src'
      ? (s.meta.exifBytes ? `${s.meta.summary.camera || 'EXIF found'}${s.meta.gps ? ' · has GPS' : ''}` : 'No EXIF in this photo')
      : (s.meta.canWrite ? `${s.meta.formatName} · ${bytes(s.file.size)}` : `${s.meta.formatName} can’t be written`);
    slot.inner.innerHTML = `<div class="thumb-row" style="text-align:left;width:100%"><img src="${urls[key]}" alt=""><div><div class="name">${esc(s.file.name)}</div><div class="muted small">${esc(info)}</div>
      <button class="btn small" style="margin-top:6px" data-replace>Replace</button></div></div>`;
    slot.inner.querySelector('[data-replace]').addEventListener('click', e => { e.stopPropagation(); slot.input.click(); });
  }

  ['o-gps', 'o-owner', 'o-ori'].forEach(id => $('#' + id).addEventListener('change', refresh));
  $('#swap').addEventListener('click', () => {
    [state.src, state.tgt] = [state.tgt, state.src];
    [urls.src, urls.tgt] = [urls.tgt, urls.src];
    paintSlot('src'); paintSlot('tgt'); refresh();
  });

  /* ---------- building the result */
  const OWNER = { ifd0: [0x13b, 0x9c9d, 0xa431], exif: [0xa430, 0xa431, 0xa435, 0xa420] };
  function patchNumber(tiffBytes, kind, name, value) {
    const t = C.parseTiff(tiffBytes), e = t && C.getEntry(t, kind, name);
    if (!e || e.count !== 1 || (e.type !== 3 && e.type !== 4)) return false;
    const dv = new DataView(tiffBytes.buffer, tiffBytes.byteOffset, tiffBytes.byteLength);
    if (e.type === 3) dv.setUint16(e.entryOffset + 8, value, t.little); else dv.setUint32(e.entryOffset + 8, value, t.little);
    return true;
  }

  function build() {
    const src = state.src, tgt = state.tgt;
    if (!src.meta.exifBytes || !src.meta.tiff) throw new Error('The source photo has no EXIF data to copy.');
    if (!tgt.meta.canWrite) throw new Error(`${tgt.meta.formatName} files can’t be written here. Use a JPEG, PNG or WebP as the target.`);
    const gps = $('#o-gps').checked, owner = $('#o-owner').checked, keepOri = $('#o-ori').checked;
    const ori = keepOri ? C.orientationOf(tgt.data) : null;
    const W = +tgt.meta.info.Width || 0, H = +tgt.meta.info.Height || 0;
    let tiff = null, rebuilt = false;

    const viaModel = () => {
      const model = C.toModel(src.meta.tiff);
      if (!gps) model.gps = [];
      if (!owner) for (const kind of Object.keys(OWNER)) model[kind] = model[kind].filter(e => !OWNER[kind].includes(e.tag));
      if (keepOri) { if (ori > 1) C.setEntry(model, 'ifd0', 0x112, 3, ori); else C.removeEntry(model, 'ifd0', 0x112); }
      if (W && H) for (const [n, v] of [['PixelXDimension', W], ['PixelYDimension', H]]) if (C.getEntry(src.meta.tiff, 'exif', n)) C.setEntry(model, 'exif', C.NAME_TO_TAG.exif[n], 4, v);
      return C.serializeModel(model);
    };

    if (gps && owner) {
      tiff = src.meta.exifBytes.slice();
      if (keepOri && !C.patchOrientation(tiff, ori || 1) && ori > 1) { tiff = viaModel(); rebuilt = true; }
      else if (W && H) { patchNumber(tiff, 'exif', 'PixelXDimension', W); patchNumber(tiff, 'exif', 'PixelYDimension', H); }
    } else { tiff = viaModel(); rebuilt = true; }
    return { bytes: C.setExifBlock(tgt.data, tiff), rebuilt };
  }

  /* ---------- UI */
  const ROWS = [['Camera', 'camera'], ['Lens', 'lens'], ['Exposure', 'exposure'], ['Date taken', 'date'], ['Software', 'software'], ['Artist', 'artist'], ['Copyright', 'copyright']];
  function refresh() {
    const ready = state.src && state.tgt;
    $('#panel').hidden = !ready;
    if (!ready) return;
    const warn = $('#warn'), save = $('#save');
    warn.innerHTML = ''; save.disabled = true;
    let result;
    try { result = build(); } catch (err) {
      warn.innerHTML = `<div class="notice bad">${esc(err.message)}</div>`;
      $('#compare').innerHTML = '';
      return;
    }
    state.result = result;
    save.disabled = false;
    if (result.rebuilt) warn.innerHTML = '<div class="notice">A fresh EXIF block is built for this copy, so the camera’s proprietary maker note is left out.</div>';
    const after = C.readMetadata(result.bytes);
    const before = state.tgt.meta;
    const gpsText = m => (m.gps ? `${m.gps.lat.toFixed(4)}, ${m.gps.lon.toFixed(4)}` : '—');
    const lines = ROWS.map(([label, key]) => [label, before.summary[key] || '—', after.summary[key] || '—']);
    lines.push(['GPS', gpsText(before), gpsText(after)]);
    $('#compare').innerHTML = `<div class="head"><span>Field</span><span>Target now</span><span>After copy</span></div>` +
      lines.map(([l, a, b]) => `<div class="line"><span>${l}</span><span>${esc(a)}</span><span class="${a !== b ? 'changed' : ''}">${esc(b)}</span></div>`).join('');
  }

  $('#save').addEventListener('click', () => {
    if (!state.result) return;
    const ext = extOf(state.tgt.file.name) || 'jpg';
    download(state.result.bytes, `${baseName(state.tgt.file.name)}-with-exif.${ext}`, state.tgt.file.type || 'image/jpeg');
    toast('Saved. Your originals are unchanged.');
  });
  Site.handoff.take().then(f => { if (f) load('src', f); });
})();
