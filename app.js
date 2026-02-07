const API_BASE = 'https://vgregion.entryscape.net/rowstore/dataset/fc4d86d5-5ad4-43af-8193-319cd4448fc0';
const BATCH_LIMIT = 500;
const PAGE_SIZE = 100;

let allResults = [];
let displayedResults = [];
let sortField = 'bokforingsdatum';
let sortAsc = false;
let isLoading = false;
let visibleCount = PAGE_SIZE;
let searchAbort = null;

const searchBtn = document.getElementById('searchBtn');
const resultsBody = document.getElementById('resultsBody');
const statusText = document.getElementById('statusText');
const emptyMsg = document.getElementById('emptyMsg');
const loadMoreBtn = document.getElementById('loadMoreBtn');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');

// Search when pressing Enter in any filter field
document.getElementById('fieldFilters').addEventListener('keydown', e => {
  if (e.key === 'Enter') doSearch();
});

async function doSearch() {
  allResults = [];
  visibleCount = PAGE_SIZE;

  if (!hasFilters()) {
    statusText.textContent = 'Ange minst ett filter och tryck Sök.';
    resultsBody.innerHTML = '';
    emptyMsg.style.display = 'none';
    loadMoreBtn.style.display = 'none';
    return;
  }

  await fetchResults();
}

function clearAllFilters() {
  document.getElementById('filterForvaltning').value = '';
  document.getElementById('filterKontoText').value = '';
  document.getElementById('filterLeverantor').value = '';
  document.getElementById('filterKontoNr').value = '';
  document.getElementById('filterLevId').value = '';
  document.getElementById('filterDateFrom').value = '';
  document.getElementById('filterDateTo').value = '';
  if (periodMode) setPeriodMode(null);
  allResults = [];
  displayedResults = [];
  resultsBody.innerHTML = '';
  emptyMsg.style.display = 'none';
  loadMoreBtn.style.display = 'none';
  statusText.textContent = 'Ange minst ett filter och tryck Sök.';
  if (kontoData) renderKontoList();
  if (levData) renderLevList();
}

function hasFilters() {
  return document.getElementById('filterForvaltning').value.trim() ||
         document.getElementById('filterKontoText').value.trim() ||
         document.getElementById('filterLeverantor').value.trim() ||
         document.getElementById('filterKontoNr').value.trim() ||
         document.getElementById('filterLevId').value.trim() ||
         document.getElementById('filterDateFrom').value ||
         document.getElementById('filterDateTo').value;
}

function getFilterSummary() {
  const tags = [];
  const forv = document.getElementById('filterForvaltning').value.trim();
  if (forv) tags.push({ label: 'Förvaltning', value: forv });
  const kontoText = document.getElementById('filterKontoText').value.trim();
  if (kontoText) tags.push({ label: 'Kontotext', value: kontoText });
  const lev = document.getElementById('filterLeverantor').value.trim();
  if (lev) tags.push({ label: 'Leverantör', value: lev });
  const konto = document.getElementById('filterKontoNr').value.trim();
  if (konto) tags.push({ label: 'Konto', value: konto });
  const levId = document.getElementById('filterLevId').value.trim();
  if (levId) tags.push({ label: 'Lev-ID', value: levId });
  const dateFrom = document.getElementById('filterDateFrom').value;
  const dateTo = document.getElementById('filterDateTo').value;
  if (dateFrom && dateTo) {
    tags.push({ label: 'Period', value: dateFrom + ' \u2013 ' + dateTo });
  } else if (dateFrom) {
    tags.push({ label: 'Fr.o.m.', value: dateFrom });
  } else if (dateTo) {
    tags.push({ label: 'T.o.m.', value: dateTo });
  }
  if (tags.length === 0) return '';
  const html = tags.map(t =>
    '<span class="filter-tag"><span class="filter-label">' + escHtml(t.label) +
    ':</span> <span class="filter-value">' + escHtml(t.value) + '</span></span>'
  ).join(' ');
  return '<div class="filter-summary">' + html + '</div>';
}

function getFilterParams() {
  const params = {};
  const forv = document.getElementById('filterForvaltning').value.trim();
  if (forv) params.forvaltning = forv + '*';

  const kontoText = document.getElementById('filterKontoText').value.trim();
  if (kontoText) params.konto_text = kontoText + '*';

  const lev = document.getElementById('filterLeverantor').value.trim();
  if (lev) params.leverantor = lev + '*';

  const konto = document.getElementById('filterKontoNr').value.trim();
  if (konto) params.konto_nr = konto;

  const levId = document.getElementById('filterLevId').value.trim();
  if (levId) params.leverantor_id = levId;

  // Use bokforingsdatum prefix to narrow server-side when possible
  const dateFrom = document.getElementById('filterDateFrom').value;
  const dateTo = document.getElementById('filterDateTo').value;
  if (dateFrom && dateTo) {
    const prefix = commonPrefix(dateFrom, dateTo);
    if (prefix.length >= 4) {
      params.bokforingsdatum = prefix + '*';
    }
  } else if (dateFrom) {
    params.bokforingsdatum = dateFrom.substring(0, 4) + '*';
  } else if (dateTo) {
    params.bokforingsdatum = dateTo.substring(0, 4) + '*';
  }

  return params;
}

function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.substring(0, i);
}

async function fetchWithRetry(url, retries = 2, delay = 1000, signal) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
}

async function fetchAllPages(fieldParams, onProgress, signal) {
  const params = new URLSearchParams({ _limit: BATCH_LIMIT, _offset: 0, ...fieldParams });
  const url = API_BASE + '?' + params.toString();
  const first = await fetchWithRetry(url, 2, 1000, signal);
  let results = first.results || [];
  const total = first.resultCount || 0;

  if (total <= BATCH_LIMIT) return { results, total };

  const urls = [];
  for (let offset = BATCH_LIMIT; offset < total; offset += BATCH_LIMIT) {
    const p = new URLSearchParams({ _limit: BATCH_LIMIT, _offset: offset, ...fieldParams });
    urls.push(API_BASE + '?' + p.toString());
  }

  const CONCURRENCY = 5;
  let idx = 0;
  let fetched = results.length;

  async function worker() {
    while (idx < urls.length) {
      if (signal && signal.aborted) return;
      const myUrl = urls[idx++];
      try {
        const data = await fetchWithRetry(myUrl, 2, 1000, signal);
        if (data.results) {
          results.push(...data.results);
          fetched += data.results.length;
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
        console.warn('Failed batch:', e);
      }
      if (onProgress) onProgress(fetched, total);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(CONCURRENCY, urls.length); i++) workers.push(worker());
  await Promise.all(workers);

  return { results, total };
}

async function fetchResults() {
  if (searchAbort) searchAbort.abort();
  const abort = new AbortController();
  searchAbort = abort;

  isLoading = true;
  searchBtn.disabled = true;
  progressBar.classList.add('active');
  progressFill.style.width = '5%';
  statusText.innerHTML = '<span class="spinner"></span>Söker...';

  const filterParams = getFilterParams();

  let totalExpected = 0;
  let totalFetched = 0;
  function updateProgressBar() {
    if (totalExpected > 0) {
      const pct = Math.min(95, Math.round((totalFetched / totalExpected) * 95));
      progressFill.style.width = pct + '%';
      statusText.innerHTML = '<span class="spinner"></span>Hämtar ' +
        formatNum(totalFetched) + ' / ' + formatNum(totalExpected) + ' rader...';
    }
  }

  try {
    const countParams = new URLSearchParams({ _limit: 1, _offset: 0, ...filterParams });
    const countUrl = API_BASE + '?' + countParams.toString();
    try {
      const countData = await fetchWithRetry(countUrl, 2, 1000, abort.signal);
      totalExpected = countData.resultCount || 0;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }

    statusText.innerHTML = '<span class="spinner"></span>Hämtar ' +
      formatNum(totalExpected) + ' rader...';

    const res = await fetchAllPages(filterParams, (fetched, total) => {
      totalFetched = fetched;
      totalExpected = total;
      updateProgressBar();
    }, abort.signal);
    allResults = res.results;

    progressFill.style.width = '100%';
    setTimeout(() => progressBar.classList.remove('active'), 400);

    renderResults();
  } catch (err) {
    if (err.name === 'AbortError') return;
    statusText.textContent = 'Fel vid sökning: ' + err.message;
    progressBar.classList.remove('active');
    console.error(err);
  } finally {
    if (searchAbort === abort) {
      isLoading = false;
      searchBtn.disabled = false;
    }
  }
}

function renderResults() {
  const dateFrom = document.getElementById('filterDateFrom').value;
  const dateTo = document.getElementById('filterDateTo').value;

  let filtered;
  if (dateFrom && dateTo) {
    filtered = allResults.filter(r => r.bokforingsdatum >= dateFrom && r.bokforingsdatum <= dateTo);
  } else if (dateFrom) {
    filtered = allResults.filter(r => r.bokforingsdatum >= dateFrom);
  } else if (dateTo) {
    filtered = allResults.filter(r => r.bokforingsdatum <= dateTo);
  } else {
    filtered = allResults.slice();
  }

  const isNumeric = sortField === 'nettobelopp';
  const dir = sortAsc ? 1 : -1;
  if (isNumeric) {
    filtered.sort((a, b) => (((parseFloat(a.nettobelopp)) || 0) - ((parseFloat(b.nettobelopp)) || 0)) * dir);
  } else {
    filtered.sort((a, b) => {
      const va = a[sortField] || '';
      const vb = b[sortField] || '';
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return 0;
    });
  }

  displayedResults = filtered;

  document.querySelectorAll('thead th').forEach(th => th.classList.remove('sorted'));
  const activeTh = document.getElementById('th-' + sortField);
  if (activeTh) activeTh.classList.add('sorted');

  const summary = getFilterSummary();

  resultsBody.innerHTML = '';
  if (filtered.length === 0) {
    emptyMsg.style.display = 'block';
    loadMoreBtn.style.display = 'none';
    statusText.innerHTML = '<span class="count">0</span> träffar' + summary;
    return;
  }

  emptyMsg.style.display = 'none';

  const show = filtered.slice(0, visibleCount);
  const frag = document.createDocumentFragment();
  for (const row of show) {
    frag.appendChild(createRow(row));
    frag.appendChild(createDetailRow(row));
  }
  resultsBody.appendChild(frag);

  updateLoadMoreBtn(filtered.length);

  const total = sumAmount(filtered);
  statusText.innerHTML =
    '<span class="count">' + formatNum(filtered.length) + '</span> träffar' +
    ' \u2013 totalt <span class="sum">' + formatAmount(total) + ' kr</span>' +
    summary;
}

function updateLoadMoreBtn(totalLen) {
  if (totalLen > visibleCount) {
    loadMoreBtn.style.display = 'block';
    loadMoreBtn.textContent = 'Visa fler (' + formatNum(totalLen - visibleCount) + ' kvar)';
  } else {
    loadMoreBtn.style.display = 'none';
  }
}

function loadMore() {
  visibleCount += PAGE_SIZE;
  const from = resultsBody.children.length / 2;
  const show = displayedResults.slice(from, visibleCount);
  const frag = document.createDocumentFragment();
  for (const row of show) {
    frag.appendChild(createRow(row));
    frag.appendChild(createDetailRow(row));
  }
  resultsBody.appendChild(frag);
  updateLoadMoreBtn(displayedResults.length);
}

function createRow(r) {
  const tr = document.createElement('tr');
  tr.style.cursor = 'pointer';
  tr.onclick = function () {
    const detail = this.nextElementSibling;
    detail.style.display = detail.style.display === 'table-row' ? 'none' : 'table-row';
  };
  const amt = parseFloat(r.nettobelopp) || 0;
  const negClass = amt < 0 ? ' negative' : '';

  tr.innerHTML =
    '<td>' + escHtml(r.bokforingsdatum || '') + '</td>' +
    '<td><span class="cell-filter" data-field="leverantor" data-value="' + escAttr(r.leverantor || '') + '" title="Filtrera p\u00e5 denna leverant\u00f6r">' + escHtml(r.leverantor || '') + '</span></td>' +
    '<td class="hide-mobile">' + escHtml(r.forvaltning || '') +
      (r.forvaltning ? '<span class="cell-add-filter" data-field="forvaltning" data-value="' + escAttr(r.forvaltning) + '" title="L\u00e4gg till som filter">+</span>' : '') + '</td>' +
    '<td class="hide-mobile">' + escHtml(r.konto_text || '') +
      (r.konto_text ? '<span class="cell-add-filter" data-field="konto_text" data-value="' + escAttr(r.konto_text) + '" title="L\u00e4gg till som filter">+</span>' : '') + '</td>' +
    '<td class="amount' + negClass + '">' + formatAmount(r.nettobelopp) + '</td>' +
    '<td class="hide-mobile">' + escHtml(r.verifikationsnummer || '-') + '</td>';

  const levLink = tr.querySelector('.cell-filter');
  if (levLink) {
    levLink.addEventListener('click', function(e) {
      e.stopPropagation();
      applyFilterFromCell('filterLeverantor', this.dataset.value);
    });
  }

  tr.querySelectorAll('.cell-add-filter').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const field = this.dataset.field;
      const value = this.dataset.value;
      const inputMap = { forvaltning: 'filterForvaltning', konto_text: 'filterKontoText' };
      applyFilterFromCell(inputMap[field], value);
    });
  });

  return tr;
}

function escAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function applyFilterFromCell(inputId, value) {
  document.getElementById(inputId).value = value;
  doSearch();
}

function createDetailRow(r) {
  const tr = document.createElement('tr');
  tr.className = 'row-detail';
  tr.innerHTML =
    '<td colspan="6"><div class="detail-grid">' +
    detailItem('Leverantör', r.leverantor) +
    detailItem('Leverantörs-ID', r.leverantor_id) +
    detailItem('Förvaltning', r.forvaltning) +
    detailItem('Köpare', r.kopare) +
    detailItem('Köpar-ID', r['\ufeffkopare_id'] || r.kopare_id || '') +
    detailItem('Konto', r.konto_nr + ' \u2013 ' + r.konto_text) +
    detailItem('Nettobelopp', formatAmount(r.nettobelopp) + ' kr') +
    detailItem('Bokföringsdatum', r.bokforingsdatum) +
    detailItem('Fakturanummer', r.fakturanummer || '-') +
    detailItem('Verifikationsnr', r.verifikationsnummer) +
    detailItem('Avtal', r.avtal || '-') +
    detailItem('Grund', r.grund || '-') +
    detailItem('Kommun-ID', r.kommun_id || '-') +
    detailItem('S-kod', r.s_kod_nr || '-') +
    '</div></td>';
  return tr;
}

function detailItem(label, value) {
  return '<div><div class="label">' + escHtml(label) + '</div><div class="value">' + escHtml(value || '') + '</div></div>';
}

function sortBy(field) {
  if (sortField === field) {
    sortAsc = !sortAsc;
  } else {
    sortField = field;
    sortAsc = field === 'leverantor' || field === 'forvaltning' || field === 'konto_text';
  }
  visibleCount = PAGE_SIZE;
  renderResults();
}

function formatAmount(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return '-';
  return n.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sumAmount(rows) {
  return rows.reduce((s, r) => s + (parseFloat(r.nettobelopp) || 0), 0);
}

function formatNum(n) {
  return n.toLocaleString('sv-SE');
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// -- Period Picker ---------------------------------------------------------
let periodMode = null;
let periodAnchor = new Date();

function setPeriodMode(mode) {
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
  const nav = document.getElementById('periodNav');

  if (!mode) {
    periodMode = null;
    nav.style.display = 'none';
    document.getElementById('filterDateFrom').value = '';
    document.getElementById('filterDateTo').value = '';
    return;
  }

  periodMode = mode;
  periodAnchor = new Date();
  document.querySelectorAll('.period-btn').forEach(b => {
    const map = { 'Vecka': 'week', 'Månad': 'month', 'Kvartal': 'quarter', 'År': 'year' };
    if (map[b.textContent] === mode) b.classList.add('active');
  });
  nav.style.display = 'flex';
  applyPeriod();
}

function stepPeriod(dir) {
  if (!periodMode) return;
  const d = periodAnchor;
  switch (periodMode) {
    case 'week':
      d.setDate(d.getDate() + dir * 7);
      break;
    case 'month':
      d.setMonth(d.getMonth() + dir);
      break;
    case 'quarter':
      d.setMonth(d.getMonth() + dir * 3);
      break;
    case 'year':
      d.setFullYear(d.getFullYear() + dir);
      break;
  }
  applyPeriod();
}

function applyPeriod() {
  const d = periodAnchor;
  let from, to, label;

  switch (periodMode) {
    case 'week': {
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((day + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      from = fmtDate(monday);
      to = fmtDate(sunday);
      const jan4 = new Date(monday.getFullYear(), 0, 4);
      const weekNum = Math.ceil(((monday - jan4) / 86400000 + jan4.getDay() + 1) / 7);
      label = 'v' + weekNum + ' ' + monday.getFullYear();
      break;
    }
    case 'month': {
      const first = new Date(d.getFullYear(), d.getMonth(), 1);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      from = fmtDate(first);
      to = fmtDate(last);
      const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
      label = months[d.getMonth()] + ' ' + d.getFullYear();
      break;
    }
    case 'quarter': {
      const q = Math.floor(d.getMonth() / 3);
      const first = new Date(d.getFullYear(), q * 3, 1);
      const last = new Date(d.getFullYear(), q * 3 + 3, 0);
      from = fmtDate(first);
      to = fmtDate(last);
      label = 'Q' + (q + 1) + ' ' + d.getFullYear();
      break;
    }
    case 'year': {
      from = d.getFullYear() + '-01-01';
      to = d.getFullYear() + '-12-31';
      label = '' + d.getFullYear();
      break;
    }
  }

  document.getElementById('filterDateFrom').value = from;
  document.getElementById('filterDateTo').value = to;
  document.getElementById('periodLabel').textContent = label;
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// -- Konto Catalog ---------------------------------------------------------
let kontoData = null;
let kontoLoading = false;

function toggleKontoPanel() {
  const panel = document.getElementById('kontoPanel');
  const arrow = document.getElementById('kontoArrow');
  document.getElementById('levPanel').classList.remove('open');
  document.getElementById('levArrow').innerHTML = '&#9654;';

  panel.classList.toggle('open');
  arrow.innerHTML = panel.classList.contains('open') ? '&#9660;' : '&#9654;';

  if (panel.classList.contains('open') && !kontoData && !kontoLoading) {
    loadKontoData();
  }
}

async function loadKontoData() {
  kontoLoading = true;
  const statusEl = document.getElementById('kontoStatus');
  const grid = document.getElementById('kontoGrid');
  statusEl.innerHTML = '<span class="spinner"></span>Laddar konton...';
  grid.innerHTML = '';

  try {
    const offsets = [0, 10000, 50000, 100000, 200000, 400000, 600000, 800000];
    const kontos = {};

    const promises = offsets.map(async offset => {
      const params = new URLSearchParams({ _limit: 500, _offset: offset });
      const url = API_BASE + '?' + params.toString();
      try {
        const data = await fetchWithRetry(url);
        for (const r of (data.results || [])) {
          const nr = r.konto_nr;
          const text = r.konto_text;
          if (nr && text) {
            if (!kontos[nr]) kontos[nr] = { text, count: 0 };
            kontos[nr].count++;
          }
        }
      } catch (e) { /* skip failed offsets */ }
    });

    await Promise.all(promises);

    const nrs = Object.keys(kontos).sort();
    statusEl.textContent = nrs.length + ' konton hittade, hämtar antal...';

    const CONCURRENCY = 6;
    let countIdx = 0;
    async function countWorker() {
      while (countIdx < nrs.length) {
        const nr = nrs[countIdx++];
        const params = new URLSearchParams({ _limit: 1, _offset: 0, konto_nr: nr });
        const url = API_BASE + '?' + params.toString();
        try {
          const data = await fetchWithRetry(url);
          kontos[nr].count = data.resultCount || 0;
        } catch (e) { /* keep sampled count */ }
      }
    }
    const countWorkers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, nrs.length); i++) countWorkers.push(countWorker());
    await Promise.all(countWorkers);

    kontoData = kontos;
    renderKontoList();
    statusEl.textContent = nrs.length + ' konton';
  } catch (e) {
    statusEl.textContent = 'Kunde inte ladda konton: ' + e.message;
  } finally {
    kontoLoading = false;
  }
}

function renderKontoList() {
  const grid = document.getElementById('kontoGrid');
  const filter = (document.getElementById('kontoSearchInput').value || '').toLowerCase();
  grid.innerHTML = '';

  const entries = Object.entries(kontoData)
    .map(([nr, d]) => ({ nr, text: d.text, count: d.count }))
    .filter(k => !filter ||
      k.nr.includes(filter) ||
      k.text.toLowerCase().includes(filter))
    .sort((a, b) => a.nr.localeCompare(b.nr));

  if (entries.length === 0) {
    grid.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:.85rem;">Inga konton matchar filtret.</div>';
    return;
  }

  const activeKonto = document.getElementById('filterKontoNr').value.trim();

  for (const k of entries) {
    const row = document.createElement('div');
    row.className = 'catalog-row konto-row' + (k.nr === activeKonto ? ' active' : '');
    row.innerHTML =
      '<span class="cat-id">' + escHtml(k.nr) + '</span>' +
      '<span class="cat-name">' + escHtml(k.text) + '</span>' +
      '<span class="cat-count">' + formatNum(k.count) + ' fakturor</span>';
    row.onclick = () => searchByKonto(k.nr, k.text);
    grid.appendChild(row);
  }
}

function filterKontoList() {
  if (kontoData) renderKontoList();
}

function searchByKonto(nr, text) {
  document.getElementById('filterKontoNr').value = nr;
  if (kontoData) renderKontoList();
  doSearch();
}

// -- Leverantör Catalog ----------------------------------------------------
let levData = null;
let levLoading = false;

function toggleLevPanel() {
  const panel = document.getElementById('levPanel');
  const arrow = document.getElementById('levArrow');
  document.getElementById('kontoPanel').classList.remove('open');
  document.getElementById('kontoArrow').innerHTML = '&#9654;';

  panel.classList.toggle('open');
  arrow.innerHTML = panel.classList.contains('open') ? '&#9660;' : '&#9654;';

  if (panel.classList.contains('open') && !levData && !levLoading) {
    loadLevData();
  }
}

async function loadLevData() {
  levLoading = true;
  const statusEl = document.getElementById('levStatus');
  const grid = document.getElementById('levGrid');
  statusEl.innerHTML = '<span class="spinner"></span>Laddar leverantörer...';
  grid.innerHTML = '';

  try {
    const offsets = [0, 10000, 50000, 100000, 200000, 400000, 600000, 800000];
    const levs = {};

    const promises = offsets.map(async offset => {
      const params = new URLSearchParams({ _limit: 500, _offset: offset });
      const url = API_BASE + '?' + params.toString();
      try {
        const data = await fetchWithRetry(url);
        for (const r of (data.results || [])) {
          const name = r.leverantor;
          if (name && !levs[name]) levs[name] = { count: 0 };
        }
      } catch (e) { /* skip failed offsets */ }
    });

    await Promise.all(promises);

    const names = Object.keys(levs).sort((a, b) => a.localeCompare(b, 'sv'));
    statusEl.textContent = names.length + ' leverantörer hittade, hämtar antal...';

    const CONCURRENCY = 6;
    let levCountIdx = 0;
    async function levCountWorker() {
      while (levCountIdx < names.length) {
        const name = names[levCountIdx++];
        const params = new URLSearchParams({ _limit: 1, _offset: 0, leverantor: name });
        const url = API_BASE + '?' + params.toString();
        try {
          const data = await fetchWithRetry(url);
          levs[name].count = data.resultCount || 0;
        } catch (e) { /* keep 0 */ }
      }
    }
    const levCountWorkers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, names.length); i++) levCountWorkers.push(levCountWorker());
    await Promise.all(levCountWorkers);

    levData = levs;
    renderLevList();
    statusEl.textContent = names.length + ' leverantörer';
  } catch (e) {
    statusEl.textContent = 'Kunde inte ladda leverantörer: ' + e.message;
  } finally {
    levLoading = false;
  }
}

function renderLevList() {
  const grid = document.getElementById('levGrid');
  const filter = (document.getElementById('levSearchInput').value || '').toLowerCase();
  grid.innerHTML = '';

  const entries = Object.entries(levData)
    .map(([name, d]) => ({ name, count: d.count }))
    .filter(l => !filter || l.name.toLowerCase().includes(filter))
    .sort((a, b) => b.count - a.count);

  if (entries.length === 0) {
    grid.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:.85rem;">Inga leverantörer matchar filtret.</div>';
    return;
  }

  const activeLev = document.getElementById('filterLeverantor').value.trim().toLowerCase();

  for (const l of entries) {
    const row = document.createElement('div');
    row.className = 'catalog-row lev-row' + (l.name.toLowerCase() === activeLev ? ' active' : '');
    row.innerHTML =
      '<span class="cat-name">' + escHtml(l.name) + '</span>' +
      '<span class="cat-count">' + formatNum(l.count) + ' fakturor</span>';
    row.onclick = () => searchByLev(l.name);
    grid.appendChild(row);
  }
}

function filterLevList() {
  if (levData) renderLevList();
}

function searchByLev(name) {
  document.getElementById('filterLeverantor').value = name;
  if (levData) renderLevList();
  doSearch();
}

// -- Autocomplete ----------------------------------------------------------
const AC_FIELDS = [
  { inputId: 'filterForvaltning', listId: 'ac-forvaltning', apiField: 'forvaltning' },
  { inputId: 'filterKontoText',   listId: 'ac-konto_text',  apiField: 'konto_text' },
  { inputId: 'filterLeverantor',  listId: 'ac-leverantor',  apiField: 'leverantor' },
];

const acCache = {};
let acActiveIdx = -1;
let acAbort = null;

AC_FIELDS.forEach(cfg => {
  const input = document.getElementById(cfg.inputId);
  const list = document.getElementById(cfg.listId);
  let timer = null;

  input.addEventListener('input', () => {
    clearTimeout(timer);
    acActiveIdx = -1;
    const q = input.value.trim();
    if (q.length < 2) { list.classList.remove('open'); return; }
    timer = setTimeout(() => acFetch(cfg, q), 250);
  });

  input.addEventListener('keydown', e => {
    if (!list.classList.contains('open')) return;
    const items = list.querySelectorAll('li:not(.ac-hint)');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acActiveIdx = Math.min(acActiveIdx + 1, items.length - 1);
      acHighlight(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      acActiveIdx = Math.max(acActiveIdx - 1, 0);
      acHighlight(items);
    } else if (e.key === 'Enter' && acActiveIdx >= 0 && items[acActiveIdx]) {
      e.preventDefault();
      input.value = items[acActiveIdx].textContent;
      list.classList.remove('open');
      acActiveIdx = -1;
    } else if (e.key === 'Escape') {
      list.classList.remove('open');
      acActiveIdx = -1;
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { list.classList.remove('open'); acActiveIdx = -1; }, 150);
  });
});

function acHighlight(items) {
  items.forEach((li, i) => li.classList.toggle('active', i === acActiveIdx));
}

async function acFetch(cfg, query) {
  const list = document.getElementById(cfg.listId);
  const cacheKey = cfg.apiField + ':' + query.toLowerCase();

  if (acCache[cacheKey]) {
    acRender(list, acCache[cacheKey], cfg.inputId);
    return;
  }

  if (acAbort) acAbort.abort();
  const abort = new AbortController();
  acAbort = abort;

  list.innerHTML = '<li class="ac-hint"><span class="ac-spinner"></span>Söker...</li>';
  list.classList.add('open');

  try {
    const params = new URLSearchParams({
      _limit: 100,
      _offset: 0,
      [cfg.apiField]: query + '*'
    });
    const url = API_BASE + '?' + params.toString();
    const data = await fetchWithRetry(url, 2, 1000, abort.signal);
    const values = new Set();
    for (const r of (data.results || [])) {
      const v = r[cfg.apiField];
      if (v) values.add(v);
    }
    const sorted = [...values].sort((a, b) => a.localeCompare(b, 'sv'));
    acCache[cacheKey] = sorted;
    acRender(list, sorted, cfg.inputId);
  } catch (e) {
    if (e.name === 'AbortError') return;
    list.innerHTML = '<li class="ac-hint">Kunde inte hämta förslag</li>';
  }
}

function acRender(list, values, inputId) {
  const input = document.getElementById(inputId);
  list.innerHTML = '';
  acActiveIdx = -1;

  if (values.length === 0) {
    list.innerHTML = '<li class="ac-hint">Inga träffar</li>';
    list.classList.add('open');
    return;
  }

  for (const v of values) {
    const li = document.createElement('li');
    li.textContent = v;
    li.addEventListener('mousedown', e => {
      e.preventDefault();
      input.value = v;
      list.classList.remove('open');
    });
    list.appendChild(li);
  }

  if (values.length >= 50) {
    const hint = document.createElement('li');
    hint.className = 'ac-hint';
    hint.textContent = 'Skriv fler tecken för att begränsa...';
    list.appendChild(hint);
  }

  list.classList.add('open');
}

// -- CSV Export -------------------------------------------------------------
function exportCSV() {
  if (!displayedResults.length) return;
  const headers = ['bokforingsdatum', 'leverantor', 'leverantor_id', 'forvaltning', 'konto_nr', 'konto_text', 'nettobelopp', 'fakturanummer', 'verifikationsnummer', 'kopare', 'avtal', 'grund'];
  const lines = [headers.join(';')];
  for (const r of displayedResults) {
    lines.push(headers.map(h => '"' + (r[h] || '').replace(/"/g, '""') + '"').join(';'));
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vgr-fakturor.csv';
  a.click();
  URL.revokeObjectURL(url);
}
