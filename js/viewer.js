(() => {
  'use strict';
  const { $, esc, bytes, download, toast, readBytes, baseName, dropzone, dropMarkup } = Site;
  const drop = $('#drop'), out = $('#out');
  drop.innerHTML = dropMarkup('Drop a photo here, or click to choose', 'JPEG, PNG, WebP, HEIC, AVIF or TIFF. You can also paste an image.');
  let objectUrl = null;

  dropzone(drop, { paste: true, onFiles: files => show(files[0]) });

  async function show(file) {
    out.hidden = false;
    out.innerHTML = '<div class="panel panel-pad muted" style="margin-top:20px">Reading…</div>';
    try {
      const data = await readBytes(file);
      const meta = ExifCore.readMetadata(data);
      render(file, data, meta);
      out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      out.innerHTML = `<div class="panel panel-pad notice bad" style="margin-top:20px">Could not read this file. ${esc(err.message || '')}</div>`;
    }
  }

  function render(file, data, meta) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    const s = meta.summary;
    const facts = [['Type', meta.formatName], ['Size', bytes(file.size)], ['Dimensions', s.dimensions], ['Taken', s.date]].filter(f => f[1]);

    const flagHtml = meta.flags.length
      ? `<div class="flags">${meta.flags.map(f => `<div class="flag ${f.level}"><b>${esc(f.title)}</b><span>${esc(f.detail)}</span></div>`).join('')}</div>`
      : '';
    const headline = s.camera || s.exposure
      ? `<div class="headline">${s.camera ? `<div class="cam">${esc(s.camera)}</div>` : ''}${s.lens ? `<div class="sub">${esc(s.lens)}</div>` : ''}${s.exposure ? `<div class="exp">${esc(s.exposure)}</div>` : ''}</div>`
      : '';
    const gps = meta.gps
      ? `<div class="headline"><div class="sub">Location</div><div class="cam" style="font-size:18px">${meta.gps.lat.toFixed(5)}, ${meta.gps.lon.toFixed(5)}</div>
         <div class="sub" style="margin-top:6px"><a class="map-link" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${meta.gps.lat}&mlon=${meta.gps.lon}#map=15/${meta.gps.lat}/${meta.gps.lon}">Open in OpenStreetMap ↗</a> · opens a new tab; only then are the coordinates sent anywhere</div></div>`
      : '';
    const groups = meta.groups.map(g => `<div class="group" data-group><h3>${esc(g.title)}<span>${g.rows.length}</span></h3>
      <table class="tbl"><tbody>${g.rows.map(r => `<tr data-row="${esc((r.label + ' ' + r.name + ' ' + r.value).toLowerCase())}"><th scope="row">${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`).join('')}</tbody></table></div>`).join('');
    const empty = !meta.groups.length || !meta.hasMetadata
      ? `<div class="empty"><h3>${meta.groups.length ? 'No camera data found' : 'No metadata found'}</h3><p>This ${esc(meta.formatName)} has no EXIF block. It may have been stripped by the website or app it came from, or it could be a screenshot or edited export.${meta.format === 'heic' || meta.format === 'avif' ? ' Some HEIC/AVIF layouts store EXIF in a way this viewer cannot read yet.' : ''}</p></div>`
      : '';
    const xmp = meta.xmp ? `<details class="group"><summary style="padding:14px 20px;cursor:pointer;font-weight:600">Raw XMP (${bytes(meta.xmp.length)})</summary><pre class="xmp-raw">${esc(meta.xmp)}</pre></details>` : '';

    out.innerHTML = `<div class="viewer">
      <aside class="stack">
        <div class="panel preview">
          <div class="frame"><img id="pv" alt="Preview of ${esc(file.name)}" src="${objectUrl}"></div>
          <div class="meta"><div class="file">${esc(file.name)}</div><dl class="facts">${facts.map(f => `<div><dt>${f[0]}</dt><dd>${esc(f[1])}</dd></div>`).join('')}</dl>
          <button class="btn small" id="another">Choose another photo</button></div>
        </div>
        ${flagHtml ? `<div><div class="slot-title">Privacy check</div>${flagHtml}</div>` : ''}
      </aside>
      <div class="stack">
        <div class="panel" style="overflow:hidden">
          ${headline}${gps}
          <div class="results-head"><input class="search" id="q" type="search" placeholder="Search ${meta.groups.reduce((n, g) => n + g.rows.length, 0)} fields" aria-label="Search metadata">
            <div class="row"><button class="btn small" id="copy-all">Copy all</button><button class="btn small" id="json">Download JSON</button></div></div>
          ${empty}${groups}${xmp}
        </div>
        <div class="panel panel-pad"><div class="row" style="justify-content:space-between"><div><b>What next?</b><div class="muted small">Your file is still only in this tab.</div></div>
          <div class="row"><a class="btn small" href="remove.html">Remove metadata</a><a class="btn small" href="edit.html">Edit EXIF</a><a class="btn small" href="copy.html">Copy EXIF</a></div></div></div>
        <div class="notice">Tired of downloading photos just to look inside? The <a data-ext href="${Site.EXTENSION_URL}" target="_blank" rel="noopener"><b>EasyEXIF extension</b></a> shows this on any website.</div>
      </div></div>`;

    if (!Site.EXTENSION_URL) Site.comingSoon(out);
    $('#pv').addEventListener('error', () => { $('.preview .frame').hidden = true; });
    $('#another').addEventListener('click', () => drop.click());
    $('#q').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      out.querySelectorAll('[data-group]').forEach(g => {
        let any = false;
        g.querySelectorAll('tr').forEach(tr => { const hit = !q || tr.dataset.row.includes(q); tr.hidden = !hit; any = any || hit; });
        g.hidden = !any;
      });
    });
    $('#copy-all').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(ExifCore.toText(meta, file.name)); toast('Copied to clipboard'); } catch (e) { toast('Copy was blocked by the browser'); }
    });
    $('#json').addEventListener('click', () => download(JSON.stringify(ExifCore.toPlainObject(meta, file.name), null, 2), baseName(file.name) + '-exif.json', 'application/json'));
  }
})();
