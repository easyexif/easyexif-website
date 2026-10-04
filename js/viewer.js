(() => {
  'use strict';
  const { $, esc, bytes, download, toast, readBytes, baseName, dropzone, dropMarkup } = Site;
  const drop = $('#drop'), out = $('#out');
  drop.innerHTML = dropMarkup('Drop a photo here, or click to choose', 'JPEG, PNG, WebP, HEIC, AVIF or TIFF. You can also paste an image.');
  let objectUrl = null;

  dropzone(drop, { paste: true, page: true, onFiles: files => show(files[0]) });

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
    const risks = meta.flags.filter(f => f.level !== 'low').length;
    const canFix = meta.canWrite;
    const fixHtml = !risks ? '' : canFix
      ? `${meta.gps ? '<button class="btn" id="fix-gps">Remove location only</button>' : ''}<button class="btn primary" id="fix-all">Clean everything &amp; download</button><div class="muted small">Done in this tab. Pixels aren’t re-compressed.</div>`
      : `<button class="btn primary" data-go="remove.html">Clean in the Remove tool →</button>`;
    // Photographer check: only for photos that look like they came from a camera.
    let proHtml = '';
    if (meta.summary.camera && meta.rights) {
      const item = (ok, okText, missText, why, btn, focus) => ok
        ? `<div class="flag ok"><b>${okText}</b></div>`
        : `<div class="flag tip"><b>${missText}</b><span>${why}</span>${canFix ? `<button class="btn small" data-go="edit.html?focus=${focus}" style="grid-column:2;justify-self:start;margin-top:6px">${btn}</button>` : ''}</div>`;
      const both = meta.rights.copyright && meta.rights.creator;
      proHtml = `<div id="pro"><div class="slot-title">Photographer check${both ? ' · all set' : ''}</div><div class="flags">
        ${item(meta.rights.copyright, 'Copyright is set', 'Your copyright isn’t set', 'It travels with the file, so anyone who finds your photo can see it’s yours.', 'Add copyright', 'f-copy')}
        ${item(meta.rights.creator, 'Creator name is set', 'No photographer name', 'Credit yourself so your name stays with the photo.', 'Add your name', 'f-artist')}</div></div>`;
    }
    const headline = s.camera || s.exposure
      ? `<div class="headline">${s.camera ? `<div class="cam">${esc(s.camera)}</div>` : ''}${s.lens ? `<div class="sub">${esc(s.lens)}</div>` : ''}${s.exposure ? `<div class="exp">${esc(s.exposure)}</div>` : ''}</div>`
      : '';
    const gps = meta.gps
      ? `<div class="headline"><div class="sub">Location</div><div class="cam" style="font-size:18px">${meta.gps.lat.toFixed(5)}, ${meta.gps.lon.toFixed(5)}</div>
         <div class="sub" style="margin-top:6px"><a class="map-link" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${meta.gps.lat}&mlon=${meta.gps.lon}#map=15/${meta.gps.lat}/${meta.gps.lon}">Open in OpenStreetMap ↗</a> · opens a new tab; only then are the coordinates sent anywhere</div></div>`
      : '';
    const COLLAPSED = new Set(['xmp']);   // long groups start closed
    const groups = meta.groups.map(g => {
      const table = `<table class="tbl"><tbody>${g.rows.map(r => `<tr data-row="${esc((r.label + ' ' + r.name + ' ' + r.value).toLowerCase())}"><th scope="row">${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`).join('')}</tbody></table>`;
      return COLLAPSED.has(g.id)
        ? `<details class="group fold" data-group data-fold><summary><span>${esc(g.title)}</span><span>${g.rows.length}</span></summary>${table}</details>`
        : `<div class="group" data-group><h3>${esc(g.title)}<span>${g.rows.length}</span></h3>${table}</div>`;
    }).join('');
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
        ${flagHtml ? `<div id="privacy"><div class="slot-title">Privacy check${risks ? ` · ${risks} thing${risks === 1 ? '' : 's'} to review` : ' · looks clean'}</div>${flagHtml}<div id="fix" class="stack" style="margin-top:10px">${fixHtml}</div></div>` : ''}
        ${proHtml}
      </aside>
      <div class="stack">
        <div class="panel" style="overflow:hidden">
          ${headline}${gps}
          <div class="results-head"><input class="search" id="q" type="search" placeholder="Search ${meta.groups.reduce((n, g) => n + g.rows.length, 0)} fields" aria-label="Search metadata">
            <div class="row"><button class="btn small" id="copy-all">Copy all</button><button class="btn small" id="json">Download JSON</button></div></div>
          ${empty}${groups}${xmp}
        </div>
        <div class="panel panel-pad"><div class="row" style="justify-content:space-between"><div><b>What next?</b><div class="muted small">Your file is still only in this tab.</div></div>
          <div class="row"><button class="btn small" data-go="remove.html">Remove metadata</button><button class="btn small" data-go="edit.html">Edit EXIF</button><button class="btn small" data-go="copy.html">Copy EXIF</button><button class="btn small" data-go="extract.html">Extract</button></div></div></div>
        <div class="notice">Tired of downloading photos just to look inside? The <a data-ext href="${Site.EXTENSION_URL}" target="_blank" rel="noopener"><b>EasyEXIF extension</b></a> shows this on any website.</div>
      </div></div>`;

    if (!Site.EXTENSION_URL) Site.comingSoon(out);
    out.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', async () => { await Site.handoff.put(file); location.href = b.dataset.go; }));
    const done = (removed, bytesOut, name, type) => {
      download(bytesOut, name, type);
      const after = ExifCore.readMetadata(bytesOut);
      const left = after.flags.filter(f => f.level !== 'low');
      $('#fix').innerHTML = `<div class="notice ok"><b>✓ Clean copy saved.</b> ${esc(removed)}${left.length ? ` Still present: ${esc(left.map(f => f.title).join(', '))}.` : ' We re-checked the new file and found nothing sensitive.'}</div>
        <div class="row"><button class="btn small" id="again">Check another photo</button><button class="btn small" data-go="remove.html">Clean many photos at once</button><a class="btn small" data-ext href="${Site.EXTENSION_URL}" target="_blank" rel="noopener">See EXIF on any website: Add to Chrome</a></div>`;
      $('#again').addEventListener('click', () => drop.click());
      $('#fix').querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', async () => { await Site.handoff.put(file); location.href = b.dataset.go; }));
      if (!Site.EXTENSION_URL) Site.comingSoon($('#fix'));
    };
    const fixAll = $('#fix-all'), fixGps = $('#fix-gps');
    const ext = Site.extOf(file.name) || 'jpg', base = baseName(file.name);
    if (fixAll) fixAll.addEventListener('click', () => {
      try { done('Location, serial numbers, names, thumbnail and other metadata were removed.', ExifCore.stripMetadata(data), `${base}-clean.${ext}`, file.type); }
      catch (err) { toast(err.message || 'Could not clean this photo.'); }
    });
    if (fixGps) fixGps.addEventListener('click', () => {
      try { done('The GPS location was removed. Other details such as camera and date were kept.', ExifCore.removeGps(data), `${base}-no-location.${ext}`, file.type); }
      catch (err) { toast(err.message || 'Could not remove the location.'); }
    });
    $('#pv').addEventListener('error', () => { $('.preview .frame').hidden = true; });
    $('#another').addEventListener('click', () => drop.click());
    $('#q').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      out.querySelectorAll('[data-group]').forEach(g => {
        let any = false;
        g.querySelectorAll('tr').forEach(tr => { const hit = !q || tr.dataset.row.includes(q); tr.hidden = !hit; any = any || hit; });
        g.hidden = !any;
        if (g.hasAttribute('data-fold')) g.open = !!q && any;   // open folded groups only while a search matches
      });
    });
    $('#copy-all').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(ExifCore.toText(meta, file.name)); toast('Copied to clipboard'); } catch (e) { toast('Copy was blocked by the browser'); }
    });
    $('#json').addEventListener('click', () => download(JSON.stringify(ExifCore.toPlainObject(meta, file.name), null, 2), baseName(file.name) + '-exif.json', 'application/json'));
  }
})();
