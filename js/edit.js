(() => {
  'use strict';
  const { $, $$, esc, bytes, download, toast, readBytes, baseName, extOf, dropzone, dropMarkup } = Site;
  const C = ExifCore;
  const drop = $('#drop'), editor = $('#editor');
  drop.innerHTML = dropMarkup('Drop a photo here, or click to choose', 'JPEG, PNG or WebP. It opens right here and is never uploaded.');
  let state = null, objectUrl = null;
  const fields = $$('[data-tag]');

  dropzone(drop, { paste: true, onFiles: files => open(files[0]) });
  $('#another').addEventListener('click', () => drop.click());

  async function open(file) {
    const data = await readBytes(file);
    const meta = C.readMetadata(data);
    if (!meta.canWrite) {
      editor.hidden = true;
      $('#unsup').hidden = false;
      $('#unsup').innerHTML = `${esc(meta.formatName)} files can’t be edited here. Use a JPEG, PNG or WebP. You can still <a href="index.html">view</a> its metadata.`;
      return;
    }
    $('#unsup').hidden = true;
    state = { file, data, meta, original: {} };
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    $('#pv').src = objectUrl;
    $('#fname').textContent = file.name;
    $('#facts').innerHTML = [['Type', meta.formatName], ['Size', bytes(file.size)], ['Dimensions', meta.summary.dimensions]].filter(f => f[1]).map(f => `<div><dt>${f[0]}</dt><dd>${esc(f[1])}</dd></div>`).join('');
    fill();
    editor.hidden = false;
    renderNotes();
    update();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- reading fields from the file */
  function entryOf(f) { return C.getEntry(state.meta.tiff, f.dataset.kind, f.dataset.tag); }
  function initialValue(f) {
    const e = entryOf(f);
    if (!e) return '';
    const type = f.dataset.type;
    if (type === 'ascii') return String(e.value || '').trim();
    if (type === 'date') return C.localFromExifDate(e.value);
    if (type === 'short') return e.value == null ? '' : String(Array.isArray(e.value) ? e.value[0] : e.value);
    if (type === 'comment') { const t = C.formatEntry('exif', 'UserComment', e); return t === '(empty)' ? '' : t; }
    if (type === 'fraction') {
      const r = e.rat && e.rat[0];
      if (r && r[0] === 1 && r[1] > 0) return `1/${r[1]}`;
      const v = Array.isArray(e.value) ? e.value[0] : e.value;
      return v >= 1 ? String(+v.toFixed(2)) : v > 0 ? (v < 0.3 ? `1/${Math.round(1 / v)}` : String(+v.toFixed(3))) : '';
    }
    const v = Array.isArray(e.value) ? e.value[0] : e.value;
    return Number.isFinite(v) ? String(+v.toFixed(2)) : '';
  }
  function fill() {
    for (const f of fields) {
      const v = f.tagName === 'SELECT' && !state.meta.tiff ? '' : initialValue(f);
      f.value = v;
      state.original[f.id] = f.value;   // read back, so selects normalise like the form does
    }
    const gps = state.meta.gps;
    $('#f-lat').value = gps ? String(+gps.lat.toFixed(6)) : '';
    $('#f-lon').value = gps ? String(+gps.lon.toFixed(6)) : '';
    $('#f-alt').value = gps && gps.altitude != null ? String(+gps.altitude.toFixed(1)) : '';
    $('#f-latlon').value = '';
    $('#all-dates').checked = false;
    state.original.gps = [$('#f-lat').value, $('#f-lon').value, $('#f-alt').value].join('|');
  }

  function renderNotes() {
    const notes = [];
    const t = state.meta.tiff;
    if (t && (C.getEntry(t, 'exif', 'MakerNote') || state.meta.thumbnail)) notes.push('<div class="notice">This photo has a maker note or embedded thumbnail. They are left out of the edited copy because their internal offsets can’t be moved safely.</div>');
    if (!t) notes.push('<div class="notice">This photo has no EXIF yet. Fill in any fields to add some.</div>');
    $('#notes').innerHTML = notes.join('');
  }

  /* ---------- change tracking */
  function gpsKey() { return [$('#f-lat').value, $('#f-lon').value, $('#f-alt').value].join('|'); }
  function changedFields() { return fields.filter(f => f.value !== state.original[f.id]); }
  function update() {
    const n = changedFields().length + (gpsKey() !== state.original.gps ? 1 : 0);
    $('#changes').textContent = n ? `${n} change${n === 1 ? '' : 's'} ready` : 'No changes yet';
    $('#save').disabled = !n;
  }
  $('#form').addEventListener('input', update);
  $('#form').addEventListener('change', update);
  $('#reset').addEventListener('click', () => { if (state) { fill(); update(); } });
  $('#clear-gps').addEventListener('click', () => { $('#f-lat').value = $('#f-lon').value = $('#f-alt').value = $('#f-latlon').value = ''; update(); });
  $('#f-latlon').addEventListener('input', e => {
    const m = /(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)/.exec(e.target.value);
    if (m) { $('#f-lat').value = m[1]; $('#f-lon').value = m[2]; update(); }
  });

  /* ---------- saving */
  function commentBytes(text) { return Uint8Array.from([...new TextEncoder().encode('ASCII\0\0\0'), ...new TextEncoder().encode(text)]); }
  function parseDecimal(text, name, min, max) {
    const v = parseFloat(text);
    if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${name} must be a number between ${min} and ${max}.`);
    return v;
  }
  function apply(model, f) {
    const kind = f.dataset.kind, tag = C.NAME_TO_TAG[kind][f.dataset.tag], type = f.dataset.type, v = f.value.trim();
    if (!v) { C.removeEntry(model, kind, tag); return; }
    if (type === 'ascii') C.setEntry(model, kind, tag, 2, v);
    else if (type === 'comment') C.setEntry(model, kind, tag, 7, commentBytes(v));
    else if (type === 'short') { const n = Math.round(parseDecimal(v, f.labels[0].textContent, 0, 65535)); C.setEntry(model, kind, tag, 3, n); }
    else if (type === 'date') {
      const d = C.exifDate(v);
      if (!d) throw new Error('Enter a valid date and time.');
      C.setEntry(model, kind, tag, 2, d);
    } else if (type === 'fraction') {
      const m = /^(\d+)\s*\/\s*(\d+)$/.exec(v);
      if (m && +m[2] > 0) C.setEntry(model, kind, tag, 5, [[+m[1], +m[2]]]);
      else C.setEntry(model, kind, tag, 5, parseDecimal(v, 'Shutter speed', 0, 100000));
    } else if (type === 'number') C.setEntry(model, kind, tag, 5, parseDecimal(v, f.labels[0].textContent, 0, 100000));
  }

  $('#save').addEventListener('click', () => {
    try {
      const model = C.toModel(state.meta.tiff);
      for (const f of changedFields()) apply(model, f);
      if ($('#all-dates').checked) {
        const d = C.exifDate($('#f-date').value);
        if (d) { C.setEntry(model, 'exif', 0x9004, 2, d); C.setEntry(model, 'ifd0', 0x132, 2, d); }
      }
      if (gpsKey() !== state.original.gps) {
        const la = $('#f-lat').value.trim(), lo = $('#f-lon').value.trim(), al = $('#f-alt').value.trim();
        if (!la && !lo) C.setGps(model, null, null);
        else {
          if (!la || !lo) throw new Error('Enter both latitude and longitude.');
          C.setGps(model, parseDecimal(la, 'Latitude', -90, 90), parseDecimal(lo, 'Longitude', -180, 180), al ? parseDecimal(al, 'Altitude', -20000, 100000) : null);
        }
      }
      const tiff = C.serializeModel(model);
      const out = C.setExifBlock(state.data, tiff);
      // Read it back to make sure the edit took.
      const check = C.readMetadata(out);
      if (!check.tiff) throw new Error('The edited file could not be verified.');
      const ext = extOf(state.file.name) || 'jpg';
      download(out, `${baseName(state.file.name)}-edited.${ext}`, state.file.type || 'image/jpeg');
      toast('Edited copy saved. Your original is unchanged.');
    } catch (err) {
      toast(err.message || 'Could not edit this photo.');
    }
  });
})();
