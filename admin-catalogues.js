/* Admin → Catalogues tab.
 *
 * New catalogue: the supplier's PDF is opened in the browser (pdf.js), each design is cut out of its page,
 * the size / stone / weight text around it is removed and the picture is cleaned up. The admin checks the
 * designs and their supplier codes, then everything is uploaded to Cloudinary and a branded PDF is made (jsPDF).
 * Nothing is shown on the website until the catalogue is published.
 *
 * Uses api(), $, esc, toast from admin.html. */

const CAT_CONTACT = "Call / WhatsApp: +91 98773 13252  |  +91 62831 32334";
const CAT_SITE = "www.sardargems.com";
const MAX_SUPPLIER_MB = 200;         // PDFs are kept on Hostinger (sjh-website/files.php)
const LIBS = {
  pdfjs: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  pdfWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
};
const loaded = {};
function loadScript(src){ return loaded[src] || (loaded[src] = new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => { delete loaded[src]; no(new Error('Could not load ' + src.split('/').pop())); }; document.head.appendChild(s); })); }

const catSlug = s => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40);
const initials = s => String(s||'').split(/\s+/).filter(Boolean).map(w=>w[0]).join('').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
const padN = (n, total) => String(n).padStart(total > 99 ? 3 : 2, '0');
const mb = b => (b/1048576).toFixed(1) + ' MB';

let CATS_ALL = [];        // catalogues from the server
let DRAFT = null;         // { file, name, slug, prefix, sprefix, tiles:[{n, page, dataUrl, blob, orig, keep, found}] }

/* ---------------- cutting designs out of pages ---------------- */

// Gold/rose-gold pixels: clearly coloured and not dark. Grey text, lines and white background are not.
function goldMask(d, w, h){
  const m = new Uint8Array(w*h);
  for (let i = 0, p = 0; i < w*h; i++, p += 4) {
    const r = d[p], g = d[p+1], b = d[p+2];
    const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    if (mx - mn > 60 && mx > 120 && r >= b) m[i] = 1;
  }
  return m;
}

function cutDesign(canvas){
  const W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  const m = goldMask(d, W, H);
  const y0 = Math.floor(H*0.06), y1 = Math.floor(H*0.9);
  for (let y = 0; y < H; y++) if (y < y0 || y > y1) m.fill(0, y*W, (y+1)*W);
  const colN = new Uint32Array(W), rowN = new Uint32Array(H);
  for (let y = y0; y <= y1; y++) for (let x = 0, i = y*W; x < W; x++, i++) if (m[i]) { colN[x]++; rowN[y]++; }
  const minCount = Math.max(4, Math.round(W/300));
  let cx0 = -1, cx1 = -1, cy0 = -1, cy1 = -1;
  for (let x = 0; x < W; x++) if (colN[x] >= minCount) { if (cx0 < 0) cx0 = x; cx1 = x; }
  for (let y = 0; y < H; y++) if (rowN[y] >= minCount) { if (cy0 < 0) cy0 = y; cy1 = y; }
  if (cx0 < 0 || cy0 < 0 || (cx1-cx0) < W*0.03 || (cy1-cy0) < H*0.03) return null;

  // Keep only what is close to the gold (stones sit inside gold settings); whiten the rest.
  const B = 4, bw = Math.ceil(W/B), bh = Math.ceil(H/B), blk = new Uint8Array(bw*bh);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y*W+x]) blk[((y/B)|0)*bw + ((x/B)|0)] = 1;
  const R = Math.max(2, Math.round(W*0.012/B));
  const tmp = new Uint8Array(bw*bh), keep = new Uint8Array(bw*bh);
  for (let y = 0; y < bh; y++) { let run = -1e9; for (let x = 0; x < bw; x++) { if (blk[y*bw+x]) run = x; if (x - run <= R) tmp[y*bw+x] = 1; } run = 1e9; for (let x = bw-1; x >= 0; x--) { if (blk[y*bw+x]) run = x; if (run - x <= R) tmp[y*bw+x] = 1; } }
  for (let x = 0; x < bw; x++) { let run = -1e9; for (let y = 0; y < bh; y++) { if (tmp[y*bw+x]) run = y; if (y - run <= R) keep[y*bw+x] = 1; } run = 1e9; for (let y = bh-1; y >= 0; y--) { if (tmp[y*bw+x]) run = y; if (run - y <= R) keep[y*bw+x] = 1; } }

  const pad = Math.round(W*0.03);
  const X0 = Math.max(0, cx0-pad), Y0 = Math.max(0, cy0-pad), X1 = Math.min(W-1, cx1+pad), Y1 = Math.min(H-1, cy1+pad);
  const cw = X1-X0+1, ch = Y1-Y0+1;
  const out = new ImageData(cw, ch), o = out.data;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const sx = X0+x, sy = Y0+y, si = (sy*W+sx)*4, oi = (y*cw+x)*4;
    if (keep[((sy/B)|0)*bw + ((sx/B)|0)]) { o[oi] = d[si]; o[oi+1] = d[si+1]; o[oi+2] = d[si+2]; }
    else { o[oi] = o[oi+1] = o[oi+2] = 255; }
    o[oi+3] = 255;
  }
  return out;
}

// Light clean-up: sharper stones and edges, a little richer gold, pure white background.
function enhance(im){
  const { width: w, height: h, data: s } = im, out = new ImageData(w, h), o = out.data, amt = 0.55;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y*w+x)*4;
    for (let c = 0; c < 3; c++) {
      const p = s[i+c];
      if (x === 0 || y === 0 || x === w-1 || y === h-1) { o[i+c] = p; continue; }
      const n = s[i-w*4+c] + s[i+w*4+c] + s[i-4+c] + s[i+4+c];
      o[i+c] = Math.max(0, Math.min(255, p + amt*(4*p - n)));
    }
    let r = o[i], g = o[i+1], b = o[i+2];
    const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
    if (mx - mn > 60 && r >= b) {                 // gold: +8% saturation
      const avg = (r+g+b)/3, k = 1.08;
      o[i] = Math.min(255, avg + (r-avg)*k); o[i+1] = Math.min(255, avg + (g-avg)*k); o[i+2] = Math.max(0, avg + (b-avg)*k);
    } else if (mx - mn < 18 && mn > 236) { o[i] = o[i+1] = o[i+2] = 255; }   // near-white -> white
    o[i+3] = 255;
  }
  return out;
}

function toSquareJpeg(im, size = 900){
  const c1 = document.createElement('canvas'); c1.width = im.width; c1.height = im.height; c1.getContext('2d').putImageData(im, 0, 0);
  const c2 = document.createElement('canvas'); c2.width = c2.height = size;
  const x = c2.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, size, size);
  const k = size / Math.max(im.width, im.height), dw = im.width*k, dh = im.height*k;
  x.imageSmoothingQuality = 'high'; x.drawImage(c1, (size-dw)/2, (size-dh)/2, dw, dh);
  return new Promise(ok => c2.toBlob(b => ok({ blob: b, url: URL.createObjectURL(b), dataUrl: c2.toDataURL('image/jpeg', 0.86) }), 'image/jpeg', 0.88));
}

async function processPdf(file, onPage){
  await loadScript(LIBS.pdfjs);
  pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const tiles = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp1 = page.getViewport({ scale: 1 }), scale = Math.min(4, 1800 / vp1.width);
    const vp = page.getViewport({ scale });
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: cx, viewport: vp }).promise;
    const cut = cutDesign(cv);
    let im = cut;
    if (!im) {   // nothing found: keep the whole page so the admin can decide
      const m = Math.round(cv.width*0.04); im = cx.getImageData(m, m, cv.width-2*m, cv.height-2*m);
    }
    const jpg = await toSquareJpeg(cut ? enhance(im) : im);
    tiles.push({ page: p, found: !!cut, keep: !!cut, ...jpg });
    page.cleanup();
    onPage && onPage(p, pdf.numPages);
  }
  return tiles;
}

/* ---------------- branded PDF ---------------- */

async function makeBrandedPdf(name, tiles, onlyFirstPage = false){
  await loadScript(LIBS.jspdf);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = 595.28, H = 841.89;
  const MAROON = [91,26,31], GOLD = [184,137,59], IVORY = [251,247,240], INK = [58,42,32];
  doc.setProperties({ title: `Sardar Gems - ${name}`, author: 'Sardar Gems & Jewellers' });
  // cover
  doc.setFillColor(...MAROON); doc.rect(0, 0, W, H, 'F');
  doc.setDrawColor(...GOLD); doc.setLineWidth(1); doc.rect(24, 24, W-48, H-48); doc.setLineWidth(0.4); doc.rect(30, 30, W-60, H-60);
  doc.setTextColor(...GOLD); doc.setFont('times', 'normal'); doc.setFontSize(12); doc.text('E S T .   1 9 7 8', W/2, 150, { align: 'center' });
  doc.setTextColor(255,255,255); doc.setFont('times', 'bold'); doc.setFontSize(44); doc.text('SARDAR GEMS', W/2, H/2-90, { align: 'center' });
  doc.setTextColor(...GOLD); doc.setFont('times', 'normal'); doc.setFontSize(15); doc.text('&  J E W E L L E R S', W/2, H/2-62, { align: 'center' });
  doc.line(W/2-60, H/2-35, W/2+60, H/2-35);
  doc.setTextColor(255,255,255); doc.setFont('times', 'italic'); doc.setFontSize(26); doc.text(name, W/2, H/2+10, { align: 'center' });
  doc.setTextColor(...GOLD); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`COLLECTION OF ${tiles.length} DESIGNS`, W/2, H/2+35, { align: 'center' });
  doc.setTextColor(255,255,255); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(CAT_CONTACT, W/2, H-135, { align: "center" });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text('Sultanwind Road, Amritsar, Punjab', W/2, H-95, { align: 'center' });
  doc.setTextColor(...GOLD); doc.text(CAT_SITE, W/2, H-78, { align: 'center' });

  const margin = 36, top = 76, bottom = 46, gap = 14;
  const cw = (W-2*margin-gap)/2, ch = (H-top-bottom-gap)/2, img = Math.min(cw-20, ch-60);
  const pages = []; for (let i = 0; i < tiles.length; i += 4) pages.push(tiles.slice(i, i+4));
  const list = onlyFirstPage ? pages.slice(0, 1) : pages;
  list.forEach((items, pi) => {
    doc.addPage();
    doc.setFillColor(...IVORY); doc.rect(0, 0, W, H, 'F');
    doc.setFillColor(...MAROON); doc.rect(0, 0, W, 56, 'F');
    doc.setTextColor(255,255,255); doc.setFont('times', 'bold'); doc.setFontSize(17); doc.text('SARDAR GEMS', margin, 35);
    doc.setTextColor(...GOLD); doc.setFont('times', 'italic'); doc.setFontSize(11); doc.text(name, W-margin, 34, { align: 'right' });
    doc.setDrawColor(...GOLD); doc.setLineWidth(1.5); doc.line(0, 57, W, 57);
    items.forEach((t, k) => {
      const col = k % 2, row = (k/2)|0, x = margin + col*(cw+gap), y = top + row*(ch+gap);
      doc.setFillColor(255,255,255); doc.setDrawColor(230,215,188); doc.setLineWidth(0.8); doc.roundedRect(x, y, cw, ch, 6, 6, 'FD');
      doc.addImage(t.dataUrl, 'JPEG', x+(cw-img)/2, y+12+(ch-60-img)/2, img, img);
      doc.setDrawColor(...GOLD); doc.setLineWidth(0.5); doc.line(x+cw/2-30, y+ch-38, x+cw/2+30, y+ch-38);
      doc.setTextColor(...MAROON); doc.setFont('times', 'bold'); doc.setFontSize(14); doc.text(t.code, x+cw/2, y+ch-18, { align: 'center' });
    });
    doc.setTextColor(...INK); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text(`Sardar Gems & Jewellers  ·  ${CAT_CONTACT}  ·  ${CAT_SITE}`, margin, H-22);
    doc.text(`${pi+1} / ${pages.length}`, W-margin, H-22, { align: 'right' });
  });
  return doc.output('blob');
}

/* ---------------- uploads ---------------- */

async function cldUpload(sig, file, filename, onProgress){
  const fd = new FormData();
  fd.append('file', file, filename);
  fd.append('api_key', sig.apiKey); fd.append('timestamp', sig.timestamp); fd.append('signature', sig.signature);
  fd.append('public_id', sig.public_id); fd.append('tags', sig.tags); fd.append('context', sig.context);
  if (sig.type) fd.append('type', sig.type);
  return new Promise((ok, no) => {
    const x = new XMLHttpRequest();
    x.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloud}/${sig.resourceType}/upload`);
    if (onProgress) x.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded/e.total);
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch(e){} (x.status < 300 && !j.error) ? ok(j) : no(new Error((j.error && j.error.message) || 'Upload failed (' + x.status + ')')); };
    x.onerror = () => no(new Error('Network error while uploading'));
    x.send(fd);
  });
}

/** Upload a PDF to Hostinger (sjh-website/files.php) with the signed link from the server. */
function hostUpload(url, file, filename, onProgress){
  const fd = new FormData(); fd.append('file', file, filename);
  return new Promise((ok, no) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    if (onProgress) x.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded/e.total);
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch(e){}
      (x.status < 300 && j.ok) ? ok(j) : no(new Error(j.error || (x.status === 413 ? 'This PDF is bigger than the hosting upload limit (hPanel → PHP Configuration → upload_max_filesize / post_max_size).' : 'PDF upload failed (' + x.status + ')'))); };
    x.onerror = () => no(new Error('Could not reach the PDF storage (office.sardargems.com). Check that files.php is uploaded.'));
    x.send(fd);
  });
}

/* ---------------- UI ---------------- */

function catStatus(msg, cls){ const el = $('catProg'); el.textContent = msg; el.className = 'st' + (cls ? ' ' + cls : ''); }

$('catFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  $('catFileName').textContent = `${f.name} · ${mb(f.size)}`;
  if (!$('catName').value) $('catName').value = f.name.replace(/\.pdf$/i,'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
  $('catName').dispatchEvent(new Event('input'));
};
$('catName').oninput = () => { if (!$('catPrefix').dataset.touched) $('catPrefix').value = 'SJH-' + (initials($('catName').value) || 'X'); };
$('catPrefix').oninput = () => { $('catPrefix').dataset.touched = 1; };
$('catPick').onclick = () => $('catFile').click();

$('catProcess').onclick = async () => {
  const f = $('catFile').files[0];
  const name = $('catName').value.trim(), prefix = $('catPrefix').value.trim().toUpperCase().replace(/[^A-Z0-9-]/g,''), sprefix = $('catSPrefix').value.trim();
  $('catErr').textContent = '';
  if (!f) return $('catErr').textContent = 'Choose the supplier PDF first';
  if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) return $('catErr').textContent = 'That is not a PDF file';
  if (f.size > MAX_SUPPLIER_MB*1048576) return $('catErr').textContent = `This PDF is ${mb(f.size)}. The limit is ${MAX_SUPPLIER_MB} MB — compress it first (e.g. ilovepdf.com → Compress PDF).`;
  if (!name) return $('catErr').textContent = 'Give the catalogue a name';
  if (!prefix) return $('catErr').textContent = 'Enter the code prefix, e.g. SJH-DE';
  const slug = catSlug(name);
  if (CATS_ALL.some(c => c.slug === slug)) return $('catErr').textContent = 'A catalogue with this name already exists — use a different name';
  $('catProcess').disabled = true;
  try {
    catStatus('Opening the PDF…');
    const tiles = await processPdf(f, (p, n) => catStatus(`Cutting out designs… page ${p} of ${n}`));
    DRAFT = { file: f, name, slug, prefix, sprefix, tiles };
    numberDraft();
    catStatus(`${tiles.filter(t=>t.keep).length} designs found on ${tiles.length} pages. Check them below, then save.`, 'ok');
    renderDraft();
  } catch(e) { catStatus(''); $('catErr').textContent = e.message; }
  $('catProcess').disabled = false;
};

function numberDraft(){
  const kept = DRAFT.tiles.filter(t => t.keep);
  let n = 0;
  DRAFT.tiles.forEach(t => {
    if (!t.keep) { t.n = 0; t.code = ''; return; }
    n++; t.n = n; t.code = `${DRAFT.prefix}-${padN(n, kept.length)}`;
    if (!t.origTouched) t.orig = DRAFT.sprefix ? `${DRAFT.sprefix} ${n}` : `Page ${t.page}`;
  });
}

function renderDraft(){
  const box = $('catDraft'); box.hidden = !DRAFT;
  if (!DRAFT) return;
  $('catDraftTitle').textContent = `${DRAFT.name} — ${DRAFT.tiles.filter(t=>t.keep).length} designs`;
  $('catDraftGrid').innerHTML = DRAFT.tiles.map((t, i) => `
    <div class="ct ${t.keep ? '' : 'off'}" data-i="${i}">
      <img src="${t.url}" alt="">
      ${t.found ? '' : '<span class="warn">No design found — check</span>'}
      <div class="ctb">
        <label class="ck"><input type="checkbox" ${t.keep ? 'checked' : ''} data-k="${i}"> ${t.keep ? `<b>${esc(t.code)}</b>` : 'Skip'}</label>
        <span class="pg">Page ${t.page}</span>
        ${t.keep ? `<input type="text" value="${esc(t.orig)}" data-o="${i}" placeholder="Supplier code">` : ''}
      </div>
    </div>`).join('');
}
$('catDraftGrid').addEventListener('change', e => {
  const k = e.target.dataset.k; if (k !== undefined) { DRAFT.tiles[k].keep = e.target.checked; numberDraft(); renderDraft(); }
});
$('catDraftGrid').addEventListener('input', e => {
  const o = e.target.dataset.o; if (o !== undefined) { DRAFT.tiles[o].orig = e.target.value; DRAFT.tiles[o].origTouched = true; }
});
$('catDiscard').onclick = () => { DRAFT = null; renderDraft(); catStatus(''); $('catFile').value = ''; $('catFileName').textContent = ''; };

$('catSave').onclick = async () => {
  const kept = DRAFT.tiles.filter(t => t.keep);
  if (!kept.length) return toast('Tick at least one design');
  $('catSave').disabled = true; $('catDiscard').disabled = true;
  const { slug, name, prefix, sprefix, file } = DRAFT;
  try {
    catStatus('Saving the supplier PDF…');
    const c = await api({ action:'cat-create', slug, name, prefix, sprefix, count: kept.length });
    await hostUpload(c.supplierUrl, file, 'supplier.pdf', p => catStatus(`Saving the supplier PDF… ${Math.round(p*100)}%`));
    for (let i = 0; i < kept.length; i++) {
      const t = kept[i];
      catStatus(`Uploading designs… ${i+1} of ${kept.length}`);
      const s = await api({ action:'cat-sign', kind:'tile', slug, n: t.n, code: t.code, orig: t.orig, page: t.page });
      const up = await cldUpload(s, t.blob, `${t.code}.jpg`);
      await api({ action:'tile-add', slug, publicId: up.public_id, code: t.code, orig: t.orig, page: t.page, n: t.n });
    }
    catStatus('Making the branded PDF…');
    const full = await makeBrandedPdf(name, kept), prev = await makeBrandedPdf(name, kept, true);
    const sb = await api({ action:'cat-sign', kind:'branded', slug }); await hostUpload(sb.url, full, 'branded.pdf', p => catStatus(`Saving the branded PDF… ${Math.round(p*100)}%`));
    const sp = await api({ action:'cat-sign', kind:'preview', slug }); await hostUpload(sp.url, prev, 'preview.pdf');
    await api({ action:'cat-save', slug, count: kept.length, branded: sb.ref, preview: sp.ref });
    catStatus('Checking…');
    const check = await api({ action:'cat-tiles', slug });
    if ((check.tiles || []).length < kept.length) throw new Error(`Only ${(check.tiles||[]).length} of ${kept.length} designs were saved. Delete this catalogue and try again.`);
    catStatus('Saved. Check it below and tap Publish to show it on the website.', 'ok');
    toast('Catalogue saved');
    DRAFT = null; renderDraft(); $('catFile').value = ''; $('catFileName').textContent = ''; $('catName').value = ''; $('catSPrefix').value = ''; delete $('catPrefix').dataset.touched;
    await loadCatalogues();
  } catch(e) {
    catStatus('Stopped: ' + e.message + ' — the unfinished catalogue is listed below as Draft; delete it and try again.', 'bad');
    loadCatalogues();
    toast(e.message);
  }
  $('catSave').disabled = false; $('catDiscard').disabled = false;
};

async function loadCatalogues(){
  try {
    const j = await api({ action:'cat-list' });
    CATS_ALL = j.catalogues || [];
    renderCatalogues();
  } catch(e) { $('catListErr').textContent = e.message; }
}

function renderCatalogues(){
  $('catEmpty').hidden = CATS_ALL.length > 0;
  $('catList').innerHTML = CATS_ALL.map(c => `
    <div class="cust" data-slug="${esc(c.slug)}">
      <div class="h"><div><b>${esc(c.name)}</b><div class="s">${c.count} designs · codes ${esc(c.prefix)}-01… · supplier ${esc(c.sprefix || '—')}</div>${c.stored != null && c.stored < c.count ? `<div class="err" style="margin:4px 0 0">Only ${c.stored} of ${c.count} designs are stored — delete this catalogue and upload it again.</div>` : ''}</div>
        <span class="st-pill ${c.status === 'published' ? 'st-approved' : 'st-pending'}">${c.status === 'published' ? 'On website' : 'Draft'}</span></div>
      <div class="acts3">
        <button data-a="designs">Designs</button>
        <button data-a="supplier">Supplier PDF</button>
        <button data-a="branded" ${c.branded ? '' : 'disabled'}>Our PDF</button>
        <button data-a="${c.status === 'published' ? 'unpublish' : 'publish'}" class="${c.status === 'published' ? '' : 'ap'}">${c.status === 'published' ? 'Hide' : 'Publish'}</button>
        <button data-a="delete" class="rj">Delete</button>
      </div>
      <div class="ctlist" hidden></div>
    </div>`).join('');
}

$('catList').addEventListener('click', async e => {
  const b = e.target.closest('button[data-a]'); if (!b) return;
  const card = b.closest('[data-slug]'), slug = card.dataset.slug, c = CATS_ALL.find(x => x.slug === slug), a = b.dataset.a;
  b.disabled = true;
  try {
    if (a === 'publish' || a === 'unpublish') {
      await api({ action:'cat-save', slug, status: a === 'publish' ? 'published' : 'draft' });
      toast(a === 'publish' ? 'Now on the website (within a minute)' : 'Hidden from the website');
      await loadCatalogues(); return;
    }
    if (a === 'supplier' || a === 'branded') {
      const w = window.open('', '_blank');
      const j = await api({ action:'cat-download', slug, which: a });
      if (w) w.location = j.url; else location.href = j.url;
    }
    if (a === 'delete') {
      if (!confirm(`Delete "${c.name}" with all ${c.count} designs and both PDFs? This cannot be undone.`)) return;
      await api({ action:'cat-delete', slug }); toast('Deleted'); await loadCatalogues(); return;
    }
    if (a === 'designs') {
      const list = card.querySelector('.ctlist');
      if (!list.hidden) { list.hidden = true; return; }
      list.hidden = false; list.innerHTML = '<div class="empty">Loading…</div>';
      const j = await api({ action:'cat-tiles', slug });
      list.innerHTML = `<div class="ctgrid">${(j.tiles||[]).map(t => `
        <div class="ct" data-id="${esc(t.publicId)}" data-cat="${esc(slug)}" data-n="${t.n}" data-page="${t.page}" data-code="${esc(t.code)}">
          <img src="${esc(t.thumb)}" alt="" loading="lazy">
          <div class="ctb"><b>${esc(t.code)}</b><span class="pg">Page ${t.page}</span>
            <input type="text" value="${esc(t.orig)}" data-orig placeholder="Supplier code">
            <div class="ctbtn"><button data-t="save">Save</button><button data-t="del" class="rj">Remove</button></div></div>
        </div>`).join('')}</div>`;
    }
  } catch(err) { toast(err.message); }
  finally { b.disabled = false; }
});

$('catList').addEventListener('click', async e => {
  const b = e.target.closest('button[data-t]'); if (!b) return;
  const t = b.closest('.ct'), card = b.closest('[data-slug]');
  b.disabled = true;
  try {
    if (b.dataset.t === 'save') {
      await api({ action:'tile-save', publicId: t.dataset.id, cat: t.dataset.cat, code: t.dataset.code, orig: t.querySelector('[data-orig]').value, page: t.dataset.page, n: t.dataset.n });
      toast('Saved');
    } else {
      if (!confirm(`Remove ${t.dataset.code} from this catalogue? The PDFs are not changed.`)) return;
      await api({ action:'tile-delete', publicId: t.dataset.id }); t.remove(); toast('Removed');
    }
  } catch(err) { toast(err.message); }
  finally { b.disabled = false; }
});

/* ---------------- look up a retailer's list ---------------- */

function parseCodes(text){
  const re = /([A-Z][A-Z0-9]{0,7}(?:-[A-Z0-9]{1,8})*-\d{1,4})(?:\s*[x×*]\s*(\d{1,4}))?/gi, map = new Map();
  let m; while ((m = re.exec(text))) { const c = m[1].toUpperCase(); map.set(c, (map.get(c) || 0) + (Number(m[2]) || 1)); }
  return map;
}

$('lkBtn').onclick = async () => {
  const qty = parseCodes($('lkText').value);
  $('lkOut').innerHTML = '';
  if (!qty.size) return $('lkOut').innerHTML = '<div class="empty">No design codes found in that text.</div>';
  $('lkBtn').disabled = true;
  try {
    const j = await api({ action:'lookup', codes: [...qty.keys()] });
    const found = new Map(j.found.map(t => [t.code.toUpperCase(), t]));
    const groups = {};
    for (const [code, n] of qty) {
      const t = found.get(code); if (!t) continue;
      const k = t.cat; (groups[k] = groups[k] || { cat: t.catalogue, rows: [] }).rows.push({ ...t, qty: n });
    }
    const missing = [...qty.keys()].filter(c => !found.has(c));
    $('lkOut').innerHTML = Object.entries(groups).map(([slug, g]) => {
      const text = g.rows.sort((a,b)=>a.n-b.n).map(r => `${r.orig} ×${r.qty}`).join(', ');
      return `<div class="cust" data-slug="${esc(slug)}">
        <div class="h"><div><b>${esc(g.cat ? g.cat.name : slug)}</b><div class="s">${g.rows.length} designs · for supplier: ${esc(text)}</div></div></div>
        <div class="lkrows">${g.rows.map(r => `<div class="lkr"><img src="${esc(r.thumb)}" alt=""><div><b>${esc(r.code)} ×${r.qty}</b><div class="s">Supplier: <b>${esc(r.orig)}</b> · page ${r.page}</div></div></div>`).join('')}</div>
        <div class="acts3"><button data-lk="copy" data-text="${esc(text)}">Copy supplier list</button><button data-lk="pdf">Supplier PDF</button></div>
      </div>`;
    }).join('') + (missing.length ? `<div class="err">Not found: ${missing.map(esc).join(', ')}</div>` : '');
  } catch(e) { $('lkOut').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  $('lkBtn').disabled = false;
};
$('lkOut').addEventListener('click', async e => {
  const b = e.target.closest('button[data-lk]'); if (!b) return;
  if (b.dataset.lk === 'copy') { try { await navigator.clipboard.writeText(b.dataset.text); toast('Copied'); } catch(err) { prompt('Copy this:', b.dataset.text); } return; }
  const slug = b.closest('[data-slug]').dataset.slug, w = window.open('', '_blank');
  try { const j = await api({ action:'cat-download', slug, which:'supplier' }); if (w) w.location = j.url; else location.href = j.url; }
  catch(err) { if (w) w.close(); toast(err.message); }
});
