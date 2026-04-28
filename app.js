'use strict';

const API_BASE = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';
const DB_NAME = 'duel-deck-studio-cache';
const DB_STORE = 'apiResponses';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const LOCAL_DECK_KEY = 'duelDeckStudio.savedDeck.v1';
const AUTO_DECK_KEY = 'duelDeckStudio.autoDeck.v1';
const PAGE_SIZE = 48;

const ZONES = ['main', 'extra', 'side'];
const FORMAT_TO_BAN_FIELD = {
  tcg: 'ban_tcg',
  ocg: 'ban_ocg',
  goat: 'ban_goat',
};
const MASTER_DUEL_LIMITS = {
  '23434538': 1, // Maxx "C"
  '24224830': 1, // Called by the Grave
  '65681983': 1, // Crossout Designator
  '94145021': 2, // Droll & Lock Bird
};

const state = {
  format: 'tcg',
  cards: [],
  idToCard: new Map(),
  filteredCards: [],
  visibleLimit: PAGE_SIZE,
  selectedCardId: null,
  deckName: 'Untitled Deck',
  deck: makeEmptyDeck(),
  loading: false,
  filters: {
    query: '',
    bucket: 'all',
    extraType: 'all',
    monsterType: 'all',
    race: 'all',
    attribute: 'all',
    level: 'all',
    link: 'all',
    sort: 'name',
    legalOnly: true,
    showImages: true,
  },
};

const el = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  bindEvents();
  restoreAutoDeck();
  exposeAgentBridge();
  loadCards(false);
});

function cacheElements() {
  Object.assign(el, {
    dataStatus: document.getElementById('dataStatus'),
    formatSelect: document.getElementById('formatSelect'),
    refreshDataBtn: document.getElementById('refreshDataBtn'),
    importBtn: document.getElementById('importBtn'),
    headerViewDeckBtn: document.getElementById('headerViewDeckBtn'),
    exportBtn: document.getElementById('exportBtn'),
    clearDeckBtn: document.getElementById('clearDeckBtn'),
    searchInput: document.getElementById('searchInput'),
    clearSearchBtn: document.getElementById('clearSearchBtn'),
    bucketFilter: document.getElementById('bucketFilter'),
    extraTypeFilter: document.getElementById('extraTypeFilter'),
    monsterTypeFilter: document.getElementById('monsterTypeFilter'),
    raceFilter: document.getElementById('raceFilter'),
    attributeFilter: document.getElementById('attributeFilter'),
    levelFilter: document.getElementById('levelFilter'),
    linkFilter: document.getElementById('linkFilter'),
    sortSelect: document.getElementById('sortSelect'),
    legalOnlyToggle: document.getElementById('legalOnlyToggle'),
    imageToggle: document.getElementById('imageToggle'),
    resultCount: document.getElementById('resultCount'),
    deckCountMeta: document.getElementById('deckCountMeta'),
    resultsGrid: document.getElementById('resultsGrid'),
    showMoreBtn: document.getElementById('showMoreBtn'),
    deckPanel: document.getElementById('deckPanel'),
    deckFloatBtn: document.getElementById('deckFloatBtn'),
    deckHeadingViewBtn: document.getElementById('deckHeadingViewBtn'),
    deckCollapseBtn: document.getElementById('deckCollapseBtn'),
    floatDeckCount: document.getElementById('floatDeckCount'),
    deckTitle: document.getElementById('deckTitle'),
    overallStatus: document.getElementById('overallStatus'),
    mainStat: document.getElementById('mainStat'),
    extraStat: document.getElementById('extraStat'),
    sideStat: document.getElementById('sideStat'),
    copyStat: document.getElementById('copyStat'),
    saveDeckBtn: document.getElementById('saveDeckBtn'),
    loadDeckBtn: document.getElementById('loadDeckBtn'),
    viewDeckBtn: document.getElementById('viewDeckBtn'),
    sampleBtn: document.getElementById('sampleBtn'),
    sortDeckBtn: document.getElementById('sortDeckBtn'),
    mainCount: document.getElementById('mainCount'),
    extraCount: document.getElementById('extraCount'),
    sideCount: document.getElementById('sideCount'),
    mainList: document.getElementById('mainList'),
    extraList: document.getElementById('extraList'),
    sideList: document.getElementById('sideList'),
    cardPreview: document.getElementById('cardPreview'),
    cardReaderDialog: document.getElementById('cardReaderDialog'),
    cardReaderContent: document.getElementById('cardReaderContent'),
    deckViewDialog: document.getElementById('deckViewDialog'),
    deckViewTitle: document.getElementById('deckViewTitle'),
    deckViewSummary: document.getElementById('deckViewSummary'),
    deckViewContent: document.getElementById('deckViewContent'),
    deckViewModeToggle: document.getElementById('deckViewModeToggle'),
    validationBadge: document.getElementById('validationBadge'),
    issueList: document.getElementById('issueList'),
    totalDeckBadge: document.getElementById('totalDeckBadge'),
    typeBars: document.getElementById('typeBars'),
    levelGrid: document.getElementById('levelGrid'),
    importDialog: document.getElementById('importDialog'),
    ydkInput: document.getElementById('ydkInput'),
    fileInput: document.getElementById('fileInput'),
    pickFileBtn: document.getElementById('pickFileBtn'),
    applyImportBtn: document.getElementById('applyImportBtn'),
    toastStack: document.getElementById('toastStack'),
  });
}

function bindEvents() {
  el.formatSelect.value = state.format;
  el.formatSelect.addEventListener('change', async () => {
    state.format = el.formatSelect.value;
    toast('Format updated', `Using ${formatLabel()} limits and card pool.`);
    await loadCards(false);
    renderAll();
  });

  el.refreshDataBtn.addEventListener('click', () => loadCards(true));
  el.importBtn.addEventListener('click', () => {
    el.ydkInput.value = '';
    el.importDialog.showModal();
  });
  el.exportBtn.addEventListener('click', exportYdk);
  el.clearDeckBtn.addEventListener('click', () => {
    if (!hasAnyCardsInDeck()) return;
    const ok = confirm('Clear the current deck?');
    if (!ok) return;
    state.deck = makeEmptyDeck();
    state.selectedCardId = null;
    renderAll();
    persistAutoDeck();
    toast('Deck cleared', 'Your builder is empty now.');
  });

  el.searchInput.addEventListener('input', debounce(() => {
    state.filters.query = el.searchInput.value.trim();
    state.visibleLimit = PAGE_SIZE;
    renderAll(false);
  }, 140));

  el.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const first = state.filteredCards[0];
      if (first) addCard(first.id, 'auto');
    }
  });

  el.clearSearchBtn.addEventListener('click', () => {
    el.searchInput.value = '';
    state.filters.query = '';
    state.visibleLimit = PAGE_SIZE;
    renderAll(false);
  });

  el.bucketFilter.addEventListener('change', () => updateFilter('bucket', el.bucketFilter.value));
  el.extraTypeFilter.addEventListener('change', () => updateFilter('extraType', el.extraTypeFilter.value));
  el.monsterTypeFilter.addEventListener('change', () => updateFilter('monsterType', el.monsterTypeFilter.value));
  el.raceFilter.addEventListener('change', () => updateFilter('race', el.raceFilter.value));
  el.attributeFilter.addEventListener('change', () => updateFilter('attribute', el.attributeFilter.value));
  el.levelFilter.addEventListener('change', () => updateFilter('level', el.levelFilter.value));
  el.linkFilter.addEventListener('change', () => updateFilter('link', el.linkFilter.value));
  el.sortSelect.addEventListener('change', () => updateFilter('sort', el.sortSelect.value));
  el.legalOnlyToggle.addEventListener('change', () => updateFilter('legalOnly', el.legalOnlyToggle.checked));
  el.imageToggle.addEventListener('change', () => updateFilter('showImages', el.imageToggle.checked));

  el.showMoreBtn.addEventListener('click', () => {
    state.visibleLimit += PAGE_SIZE;
    renderResults();
  });

  el.deckFloatBtn.addEventListener('click', () => {
    if (el.deckPanel.classList.contains('is-collapsed')) setDeckDrawerOpen(true);
    else openDeckView();
  });
  el.headerViewDeckBtn.addEventListener('click', openDeckView);
  el.deckHeadingViewBtn.addEventListener('click', openDeckView);
  el.deckCollapseBtn.addEventListener('click', () => setDeckDrawerOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !el.deckPanel.classList.contains('is-collapsed')) {
      setDeckDrawerOpen(false);
    }
  });

  const persistDeckTitle = debounce(() => persistAutoDeck(), 300);
  el.deckTitle.addEventListener('input', () => {
    state.deckName = el.deckTitle.textContent.trim() || 'Untitled Deck';
    persistDeckTitle();
  });

  el.saveDeckBtn.addEventListener('click', () => {
    localStorage.setItem(LOCAL_DECK_KEY, JSON.stringify(serializeDeckState()));
    toast('Saved locally', 'Deck saved in this browser.');
  });

  el.loadDeckBtn.addEventListener('click', () => {
    const raw = localStorage.getItem(LOCAL_DECK_KEY);
    if (!raw) {
      toast('No saved deck', 'Use “Save locally” first.', 'warning');
      return;
    }
    const parsed = safeJsonParse(raw);
    if (!parsed) {
      toast('Could not load deck', 'The local deck data is malformed.', 'error');
      return;
    }
    hydrateDeckState(parsed);
    renderAll();
    toast('Deck loaded', 'Local deck restored.');
  });

  el.viewDeckBtn.addEventListener('click', openDeckView);
  el.deckViewModeToggle.addEventListener('click', toggleDeckViewMode);
  el.sampleBtn.addEventListener('click', loadStarterShell);
  el.sortDeckBtn.addEventListener('click', () => {
    sortDeck();
    renderAll();
    toast('Deck sorted', 'Cards are grouped by type, then name.');
  });

  el.pickFileBtn.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', handleFileImport);
  el.applyImportBtn.addEventListener('click', () => importYdk(el.ydkInput.value));

  for (const zone of document.querySelectorAll('.deck-zone')) {
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      zone.classList.remove('drag-over');
      const payload = readDragPayload(event);
      if (!payload) return;
      const targetZone = zone.dataset.zone;
      if (payload.sourceZone) {
        moveOneCard(payload.id, payload.sourceZone, targetZone);
      } else {
        addCard(payload.id, targetZone);
      }
    });
  }
}

function updateFilter(key, value) {
  state.filters[key] = value;
  state.visibleLimit = PAGE_SIZE;
  renderAll(false);
}

async function loadCards(forceRefresh) {
  state.loading = true;
  setDataStatus('loading', forceRefresh ? 'Refreshing…' : 'Loading…');
  el.resultsGrid.setAttribute('aria-busy', 'true');

  try {
    const cacheKey = getCacheKey();
    if (!forceRefresh) {
      const cached = await getCachedResponse(cacheKey);
      if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS && Array.isArray(cached.cards)) {
        ingestCards(cached.cards);
        setDataStatus('ready', 'Cached');
        renderAll();
        return;
      }
    }

    const response = await fetch(getApiUrl(), { cache: 'no-store' });
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.data)) throw new Error('Unexpected API response');

    ingestCards(payload.data);
    await setCachedResponse(cacheKey, { savedAt: Date.now(), cards: payload.data });
    setDataStatus('ready', `${state.cards.length.toLocaleString()} cards`);
    toast('Card database ready', `${state.cards.length.toLocaleString()} ${formatLabel()} cards loaded.`);
  } catch (error) {
    const cached = await getCachedResponse(getCacheKey());
    if (cached && Array.isArray(cached.cards)) {
      ingestCards(cached.cards);
      setDataStatus('ready', 'Cached fallback');
      toast('Using cached cards', 'The live API was unavailable, so cached data was loaded.', 'warning');
    } else {
      setDataStatus('error', 'API error');
      el.resultsGrid.innerHTML = `<div class="deck-empty">Could not load card data. Check your internet connection, then try Refresh cards.</div>`;
      toast('Could not load cards', error.message || 'Unknown API error.', 'error');
    }
  } finally {
    state.loading = false;
    el.resultsGrid.setAttribute('aria-busy', 'false');
    renderAll();
  }
}

function getApiUrl() {
  const format = state.format === 'casual' || state.format === 'masterduel' ? 'tcg' : state.format;
  const params = new URLSearchParams({ format });
  return `${API_BASE}?${params.toString()}`;
}

function getCacheKey() {
  return `cards:${state.format === 'casual' || state.format === 'masterduel' ? 'tcg' : state.format}:v1`;
}

function ingestCards(rawCards) {
  const normalized = rawCards.map(normalizeCard).filter(Boolean);
  normalized.sort((a, b) => a.name.localeCompare(b.name));
  state.cards = normalized;
  state.idToCard = new Map(normalized.map((card) => [String(card.id), card]));
  populateFilterOptions();
}

function normalizeCard(card) {
  if (!card || !card.id || !card.name) return null;
  const images = Array.isArray(card.card_images) ? card.card_images : [];
  const primaryImage = images[0] || {};
  const price = Array.isArray(card.card_prices) && card.card_prices[0] ? card.card_prices[0] : {};
  const name = String(card.name);
  const type = String(card.type || 'Unknown');
  const race = String(card.race || 'Unknown');
  const attribute = card.attribute ? String(card.attribute) : '';
  const archetype = card.archetype ? String(card.archetype) : '';
  const desc = String(card.desc || '');
  const isExtra = isExtraType(type);
  const isMonster = type.includes('Monster') || type === 'Token';
  const isSpell = type === 'Spell Card';
  const isTrap = type === 'Trap Card';
  const isToken = type === 'Token';
  const isSkill = type === 'Skill Card' || type.includes('Skill');

  return {
    ...card,
    id: String(card.id),
    name,
    type,
    race,
    attribute,
    archetype,
    desc,
    atk: typeof card.atk === 'number' ? card.atk : null,
    def: typeof card.def === 'number' ? card.def : null,
    level: typeof card.level === 'number' ? card.level : null,
    linkval: typeof card.linkval === 'number' ? card.linkval : null,
    scale: typeof card.scale === 'number' ? card.scale : null,
    images,
    imageSmall: primaryImage.image_url_small || primaryImage.image_url || '',
    imageLarge: primaryImage.image_url || primaryImage.image_url_small || '',
    imageCropped: primaryImage.image_url_cropped || primaryImage.image_url_small || '',
    price,
    isExtra,
    isMonster,
    isSpell,
    isTrap,
    isToken,
    isSkill,
    deckable: !isToken && !isSkill,
    searchText: `${name} ${desc} ${type} ${race} ${attribute} ${archetype}`.toLowerCase(),
  };
}

function populateFilterOptions() {
  const races = [...new Set(state.cards.map((card) => card.race).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const attributes = [...new Set(state.cards.map((card) => card.attribute).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  fillSelect(el.raceFilter, races, 'All');
  fillSelect(el.attributeFilter, attributes, 'All');
  el.raceFilter.value = state.filters.race;
  el.attributeFilter.value = state.filters.attribute;
}

function fillSelect(select, values, label) {
  const current = select.value || 'all';
  select.innerHTML = `<option value="all">${escapeHtml(label)}</option>` + values.map((value) => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join('');
  select.value = values.includes(current) ? current : 'all';
}

function renderAll(shouldPersist = true) {
  applyFilters();
  renderResults();
  renderDeck();
  renderInspector();
  const validation = validateDeck();
  renderValidation(validation);
  renderComposition();
  if (shouldPersist) persistAutoDeck();
}

function applyFilters() {
  const { query, bucket, extraType, monsterType, race, attribute, level, link, sort, legalOnly } = state.filters;
  const q = query.toLowerCase();

  let cards = state.cards.filter((card) => {
    if (legalOnly && !card.deckable) return false;
    if (q && !card.searchText.includes(q)) return false;
    if (race !== 'all' && card.race !== race) return false;
    if (attribute !== 'all' && card.attribute !== attribute) return false;
    
    // Bucket filter (main card type)
    if (bucket === 'monster' && !card.isMonster) return false;
    if (bucket === 'spell' && !card.isSpell) return false;
    if (bucket === 'trap' && !card.isTrap) return false;
    if (bucket === 'extra' && !card.isExtra) return false;
    
    // Extra deck type filter (Fusion, Synchro, Xyz, Link)
    if (extraType !== 'all') {
      const typeLower = card.type.toLowerCase();
      if (extraType === 'fusion' && !typeLower.includes('fusion')) return false;
      if (extraType === 'synchro' && !typeLower.includes('synchro')) return false;
      if (extraType === 'xyz' && !typeLower.includes('xyz')) return false;
      if (extraType === 'link' && !typeLower.includes('link')) return false;
    }
    
    // Monster type filter (Effect, Tuner, Pendulum, etc.)
    if (monsterType !== 'all') {
      const typeLower = card.type.toLowerCase();
      if (monsterType === 'normal' && !typeLower.includes('normal')) return false;
      if (monsterType === 'effect' && !typeLower.includes('effect')) return false;
      if (monsterType === 'ritual' && !typeLower.includes('ritual')) return false;
      if (monsterType === 'tuner' && !typeLower.includes('tuner')) return false;
      if (monsterType === 'pendulum' && !typeLower.includes('pendulum')) return false;
      if (monsterType === 'flip' && !typeLower.includes('flip')) return false;
      if (monsterType === 'toon' && !typeLower.includes('toon')) return false;
      if (monsterType === 'spirit' && !typeLower.includes('spirit')) return false;
      if (monsterType === 'union' && !typeLower.includes('union')) return false;
      if (monsterType === 'gemini' && !typeLower.includes('gemini')) return false;
    }
    
    // Level/Rank filter
    if (level !== 'all') {
      const targetLevel = parseInt(level, 10);
      if (card.level !== targetLevel) return false;
    }
    
    // Link rating filter
    if (link !== 'all') {
      const targetLink = parseInt(link, 10);
      if (card.linkval !== targetLink) return false;
    }
    
    return true;
  });

  cards = cards.slice().sort((a, b) => {
    switch (sort) {
      case 'atk':
        return nullToLow(b.atk) - nullToLow(a.atk) || a.name.localeCompare(b.name);
      case 'def':
        return nullToLow(b.def) - nullToLow(a.def) || a.name.localeCompare(b.name);
      case 'level':
        return nullToLow(b.level ?? b.linkval) - nullToLow(a.level ?? a.linkval) || a.name.localeCompare(b.name);
      case 'new':
        return Number(b.id) - Number(a.id) || a.name.localeCompare(b.name);
      case 'name':
      default:
        return a.name.localeCompare(b.name);
    }
  });

  state.filteredCards = cards;
}

function renderResults() {
  const visible = state.filteredCards.slice(0, state.visibleLimit);
  el.resultCount.textContent = `${state.filteredCards.length.toLocaleString()} card${state.filteredCards.length === 1 ? '' : 's'}`;
  el.deckCountMeta.textContent = `${totalDeckCount()} in deck`;
  el.showMoreBtn.hidden = state.visibleLimit >= state.filteredCards.length;

  if (state.loading) {
    el.resultsGrid.innerHTML = makeSkeletonTiles(12);
    return;
  }

  if (!visible.length) {
    el.resultsGrid.innerHTML = `<div class="deck-empty">No cards match your filters.</div>`;
    return;
  }

  el.resultsGrid.innerHTML = visible.map(renderCardTile).join('');
  for (const tile of el.resultsGrid.querySelectorAll('.card-tile')) {
    const id = tile.dataset.id;
    tile.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      selectCard(id);
    });
    tile.addEventListener('dragstart', (event) => {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('application/json', JSON.stringify({ id }));
    });
  }
  for (const button of el.resultsGrid.querySelectorAll('[data-add-zone]')) {
    button.addEventListener('click', () => addCard(button.dataset.id, button.dataset.addZone));
  }
  for (const button of el.resultsGrid.querySelectorAll('[data-read-card]')) {
    button.addEventListener('click', () => openCardReader(button.dataset.id));
  }
}

function renderCardTile(card) {
  const count = totalCountForId(card.id);
  const limitStatus = getLimitStatus(card);
  const limitClass = limitStatus ? limitStatus.toLowerCase().replace(/\s+/g, '-') : '';
  const limitText = limitStatus ? shortLimit(limitStatus) : '';
  const typeLine = card.isMonster ? `${card.race}${card.attribute ? ` · ${card.attribute}` : ''}` : card.race;
  const smartZone = routeZone(card);
  const cardTypeAttr = getCardFrameType(card);
  const imageMarkup = state.filters.showImages && card.imageSmall
    ? `<img src="${escapeAttr(card.imageSmall)}" loading="lazy" alt="${escapeAttr(card.name)} card image" />`
    : `<div class="no-image">${escapeHtml(card.name)}</div>`;

  return `
    <article class="card-tile" data-id="${escapeAttr(card.id)}" data-card-type="${escapeAttr(cardTypeAttr)}" draggable="true" tabindex="0" aria-label="${escapeAttr(card.name)}">
      ${limitStatus ? `<span class="limit-badge ${limitClass}">${escapeHtml(limitText)}</span>` : ''}
      ${count ? `<span class="count-badge">×${count}</span>` : ''}
      <div class="card-image-wrap">${imageMarkup}</div>
      <div class="card-tile-title" title="${escapeAttr(card.name)}">${highlight(card.name, state.filters.query)}</div>
      <div class="tile-meta"><span>${escapeHtml(card.type)}</span><span>${escapeHtml(typeLine)}</span></div>
      <div class="tile-actions">
        <button class="smart-add" type="button" data-id="${escapeAttr(card.id)}" data-add-zone="auto" title="Smart add to ${smartZone}">+ Smart</button>
        <button type="button" data-id="${escapeAttr(card.id)}" data-read-card title="Expand card for reading">Read</button>
        <button type="button" data-id="${escapeAttr(card.id)}" data-add-zone="main" title="Add to Main Deck">M</button>
        <button type="button" data-id="${escapeAttr(card.id)}" data-add-zone="side" title="Add to Side Deck">S</button>
      </div>
    </article>`;
}

function getCardFrameType(card) {
  const typeLower = card.type.toLowerCase();
  if (card.isSpell) return 'spell';
  if (card.isTrap) return 'trap';
  if (typeLower.includes('link')) return 'link';
  if (typeLower.includes('xyz')) return 'xyz';
  if (typeLower.includes('synchro')) return 'synchro';
  if (typeLower.includes('fusion')) return 'fusion';
  if (typeLower.includes('ritual')) return 'ritual';
  if (typeLower.includes('pendulum')) return 'pendulum';
  if (typeLower.includes('normal') && !typeLower.includes('effect')) return 'normal';
  if (card.isMonster) return 'effect';
  return 'unknown';
}

function makeSkeletonTiles(count) {
  return Array.from({ length: count }, () => `
    <article class="card-tile" aria-hidden="true">
      <div class="card-image-wrap"></div>
      <div class="card-tile-title">Loading card…</div>
      <div class="tile-meta"><span>Fetching</span><span>API</span></div>
    </article>`).join('');
}

function renderDeck() {
  const counts = getZoneCounts();
  const total = counts.main + counts.extra + counts.side;
  el.mainCount.textContent = `${counts.main} / 40–60`;
  el.extraCount.textContent = `${counts.extra} / 15`;
  el.sideCount.textContent = `${counts.side} / 15`;
  el.floatDeckCount.textContent = total;
  el.mainStat.querySelector('strong').textContent = counts.main;
  el.extraStat.querySelector('strong').textContent = counts.extra;
  el.sideStat.querySelector('strong').textContent = counts.side;
  el.deckTitle.textContent = state.deckName;

  setStatState(el.mainStat, counts.main >= 40 && counts.main <= 60);
  setStatState(el.extraStat, counts.extra <= 15);
  setStatState(el.sideStat, counts.side <= 15);

  renderZoneList('main', el.mainList);
  renderZoneList('extra', el.extraList);
  renderZoneList('side', el.sideList);
  if (el.deckViewDialog.open) renderDeckView();
}

function setDeckDrawerOpen(isOpen) {
  el.deckPanel.classList.toggle('is-collapsed', !isOpen);
  el.deckPanel.setAttribute('aria-expanded', String(isOpen));
  el.deckFloatBtn.setAttribute('aria-expanded', String(isOpen));
}

function renderZoneList(zone, container) {
  const entries = Object.entries(state.deck[zone]).filter(([, count]) => count > 0);
  if (!entries.length) {
    container.innerHTML = `<div class="deck-empty">No cards yet.</div>`;
    return;
  }
  const sorted = entries.slice().sort(([idA], [idB]) => sortCardIds(idA, idB));
  container.innerHTML = sorted.map(([id, count]) => renderDeckItem(id, count, zone)).join('');
  bindDeckItemEvents(container, zone);
}

function bindDeckItemEvents(container, zone) {
  for (const item of container.querySelectorAll('.deck-item')) {
    const id = item.dataset.id;
    item.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      selectCard(id);
    });
    item.addEventListener('dragstart', (event) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/json', JSON.stringify({ id, sourceZone: zone }));
    });
  }

  for (const button of container.querySelectorAll('[data-action]')) {
    button.addEventListener('click', () => {
      const id = button.dataset.id;
      const action = button.dataset.action;
      if (action === 'increment') addCard(id, zone);
      if (action === 'decrement') removeCard(id, zone, 1);
      if (action === 'remove') removeCard(id, zone, Infinity);
      if (action.startsWith('move:')) moveOneCard(id, zone, action.split(':')[1]);
    });
  }
}

function openDeckView() {
  renderDeckView();
  el.deckViewDialog.showModal();
}

function toggleDeckViewMode() {
  const isGrid = el.deckViewModeToggle.dataset.mode === 'grid';
  el.deckViewModeToggle.dataset.mode = isGrid ? 'list' : 'grid';
  el.deckViewModeToggle.textContent = isGrid ? 'Grid View' : 'List View';
  el.deckViewContent.classList.toggle('deck-view-list-mode', isGrid);
}

function renderDeckView() {
  const counts = getZoneCounts();
  const total = counts.main + counts.extra + counts.side;
  const mainOk = counts.main >= 40 && counts.main <= 60;
  const extraOk = counts.extra <= 15;
  const sideOk = counts.side <= 15;
  
  el.deckViewTitle.textContent = state.deckName;
  el.deckViewSummary.innerHTML = `
    <span>Main: <strong class="${mainOk ? 'ok' : 'bad'}">${counts.main}</strong></span>
    <span>Extra: <strong class="${extraOk ? 'ok' : 'bad'}">${counts.extra}</strong></span>
    <span>Side: <strong class="${sideOk ? 'ok' : 'bad'}">${counts.side}</strong></span>
    <span>Total: <strong>${total}</strong></span>`;
  
  el.deckViewContent.innerHTML = ZONES.map((zone) => renderDeckViewZone(zone, counts[zone])).join('');
  
  // Bind click events for card selection
  for (const card of el.deckViewContent.querySelectorAll('.deck-view-card')) {
    card.addEventListener('click', () => {
      selectCard(card.dataset.id);
      openCardReader(card.dataset.id);
    });
  }
}

function renderDeckViewZone(zone, count) {
  const labels = {
    main: ['Main Deck', '40–60'],
    extra: ['Extra Deck', '0–15'],
    side: ['Side Deck', '0–15'],
  };
  const entries = Object.entries(state.deck[zone]).filter(([, qty]) => qty > 0);
  if (!entries.length) {
    return `
      <section class="deck-view-zone" data-view-zone="${escapeAttr(zone)}">
        <div class="deck-view-zone-heading">
          <h3>${labels[zone][0]}</h3>
          <span class="zone-count">${count} / ${labels[zone][1]}</span>
        </div>
        <div class="deck-view-empty">No cards in ${labels[zone][0].toLowerCase()}</div>
      </section>`;
  }
  
  const sorted = entries.slice().sort(([idA], [idB]) => sortCardIds(idA, idB));
  
  // Expand cards: show each copy individually for visual layout
  const expandedCards = [];
  for (const [id, qty] of sorted) {
    for (let i = 0; i < qty; i++) {
      expandedCards.push({ id, isFirst: i === 0, qty });
    }
  }
  
  return `
    <section class="deck-view-zone" data-view-zone="${escapeAttr(zone)}">
      <div class="deck-view-zone-heading">
        <h3>${labels[zone][0]}</h3>
        <span class="zone-count">${count} / ${labels[zone][1]}</span>
      </div>
      <div class="deck-view-grid">
        ${expandedCards.map(({ id, isFirst, qty }) => renderDeckViewCard(id, isFirst, qty)).join('')}
      </div>
    </section>`;
}

function renderDeckViewCard(id, showQty, qty) {
  const card = getCard(id);
  const limitStatus = getLimitStatus(card);
  const limitClass = limitStatus ? limitStatus.toLowerCase().replace(/[\s-]+/g, '-') : '';
  const image = card.imageSmall || '';
  
  return `
    <article class="deck-view-card" data-id="${escapeAttr(id)}" title="${escapeAttr(card.name)}">
      ${image ? `<img src="${escapeAttr(image)}" alt="${escapeAttr(card.name)}" loading="lazy" />` : `<div class="no-image">${escapeHtml(card.name)}</div>`}
      ${limitStatus ? `<span class="card-limit ${limitClass}">${limitStatus === 'Forbidden' ? 'Ban' : limitStatus === 'Limited' ? 'L1' : 'L2'}</span>` : ''}
      ${showQty && qty > 1 ? `<span class="card-qty">×${qty}</span>` : ''}
      <div class="card-info">
        <span class="card-name">${escapeHtml(card.name)}</span>
        <span class="card-type">${escapeHtml(card.type)}</span>
      </div>
    </article>`;
}

function renderDeckItem(id, count, zone) {
  const card = getCard(id);
  const limitStatus = getLimitStatus(card);
  const image = card.imageSmall ? `<img src="${escapeAttr(card.imageSmall)}" loading="lazy" alt="${escapeAttr(card.name)} thumbnail" />` : '';
  const canMoveExtra = card.isExtra;
  return `
    <article class="deck-item" data-id="${escapeAttr(id)}" draggable="true" tabindex="0">
      <div class="deck-thumb">${image}</div>
      <div class="deck-item-main">
        <div class="deck-item-title" title="${escapeAttr(card.name)}">${escapeHtml(card.name)}</div>
        <div class="deck-item-sub">
          <span>${escapeHtml(card.type)}</span>
          ${limitStatus ? `<span class="badge ${limitStatus === 'Forbidden' ? 'bad' : 'warn'}">${escapeHtml(shortLimit(limitStatus))}</span>` : ''}
          <span>${escapeHtml(zone.toUpperCase())}</span>
        </div>
      </div>
      <div class="deck-item-actions">
        <button type="button" data-id="${escapeAttr(id)}" data-action="decrement" title="Remove one">−</button>
        <span class="qty-pill">${count}</span>
        <button type="button" data-id="${escapeAttr(id)}" data-action="increment" title="Add one">+</button>
        ${zone !== 'main' ? `<button type="button" data-id="${escapeAttr(id)}" data-action="move:main" title="Move one to Main">M</button>` : ''}
        ${zone !== 'extra' && canMoveExtra ? `<button type="button" data-id="${escapeAttr(id)}" data-action="move:extra" title="Move one to Extra">E</button>` : ''}
        ${zone !== 'side' ? `<button type="button" data-id="${escapeAttr(id)}" data-action="move:side" title="Move one to Side">S</button>` : ''}
        <button type="button" data-id="${escapeAttr(id)}" data-action="remove" title="Remove all">×</button>
      </div>
    </article>`;
}

function renderInspector() {
  const selected = state.selectedCardId ? getCard(state.selectedCardId) : null;
  if (!selected || selected.unknown) {
    el.cardPreview.className = 'card-preview empty';
    el.cardPreview.innerHTML = `
      <div class="empty-art" aria-hidden="true"></div>
      <h3>Select a card</h3>
      <p>Click any search result or deck row to inspect stats, text, prices, and limit status.</p>`;
    return;
  }

  const limitStatus = getLimitStatus(selected);
  const count = totalCountForId(selected.id);
  const tcgPrice = selected.price && selected.price.tcgplayer_price ? `$${selected.price.tcgplayer_price}` : '—';
  const cmPrice = selected.price && selected.price.cardmarket_price ? `€${selected.price.cardmarket_price}` : '—';
  const image = selected.imageLarge || selected.imageSmall;
  const canAddExtra = selected.isExtra;

  el.cardPreview.className = 'card-preview';
  el.cardPreview.innerHTML = `
    <div class="preview-card-layout">
      <div class="preview-art">${image ? `<img src="${escapeAttr(image)}" loading="lazy" alt="${escapeAttr(selected.name)} card image" />` : `<div class="no-image">No image</div>`}</div>
      <div class="preview-info">
        <div>
          <h3>${escapeHtml(selected.name)}</h3>
          <p class="muted">${escapeHtml(selected.type)}${selected.archetype ? ` · ${escapeHtml(selected.archetype)}` : ''}</p>
        </div>
        <div class="preview-stat-grid">
          <div class="preview-stat"><span>ATK</span><strong>${selected.atk ?? '—'}</strong></div>
          <div class="preview-stat"><span>DEF / Link</span><strong>${selected.def ?? selected.linkval ?? '—'}</strong></div>
          <div class="preview-stat"><span>Level / Rank</span><strong>${selected.level ?? '—'}</strong></div>
          <div class="preview-stat"><span>Limit</span><strong>${limitStatus || 'Unlimited'}</strong></div>
          <div class="preview-stat"><span>In deck</span><strong>${count}</strong></div>
          <div class="preview-stat"><span>Prices</span><strong>${tcgPrice} / ${cmPrice}</strong></div>
        </div>
        <div class="preview-desc">${escapeHtml(selected.desc).replace(/\n/g, '<br>')}</div>
        <div class="preview-actions">
          <button type="button" data-preview-read>Expand</button>
          <button type="button" data-preview-add="auto">Smart Add</button>
          <button type="button" data-preview-add="main">Main</button>
          ${canAddExtra ? `<button type="button" data-preview-add="extra">Extra</button>` : ''}
          <button type="button" data-preview-add="side">Side</button>
        </div>
      </div>
    </div>`;

  for (const button of el.cardPreview.querySelectorAll('[data-preview-add]')) {
    button.addEventListener('click', () => addCard(selected.id, button.dataset.previewAdd));
  }
  const readButton = el.cardPreview.querySelector('[data-preview-read]');
  if (readButton) readButton.addEventListener('click', () => openCardReader(selected.id));
  const art = el.cardPreview.querySelector('.preview-art');
  if (art) {
    art.setAttribute('role', 'button');
    art.setAttribute('tabindex', '0');
    art.setAttribute('aria-label', `Expand ${selected.name}`);
    art.addEventListener('click', () => openCardReader(selected.id));
    art.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openCardReader(selected.id);
      }
    });
  }
}

function openCardReader(id) {
  const card = getCard(id);
  if (!card || card.unknown) return;
  const image = card.imageLarge || card.imageSmall;
  const limitStatus = getLimitStatus(card);
  const count = totalCountForId(card.id);
  const stats = [
    ['Type', card.type],
    ['Race', card.race || '—'],
    ['Attribute', card.attribute || '—'],
    ['Level / Link', card.level ?? card.linkval ?? '—'],
    ['ATK', card.atk ?? '—'],
    ['DEF', card.def ?? '—'],
    ['Limit', limitStatus || 'Unlimited'],
    ['In deck', count],
  ];

  el.cardReaderContent.innerHTML = `
    <article class="reader-card">
      <div class="reader-image">${image ? `<img src="${escapeAttr(image)}" alt="${escapeAttr(card.name)} card image" />` : `<div class="no-image">No image</div>`}</div>
      <div class="reader-copy">
        <p class="eyebrow">${escapeHtml(card.archetype || card.race || 'Card details')}</p>
        <h2 id="readerTitle">${escapeHtml(card.name)}</h2>
        <div class="reader-stats">
          ${stats.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`).join('')}
        </div>
        <div class="reader-desc">${escapeHtml(card.desc).replace(/\n/g, '<br>')}</div>
        <div class="preview-actions reader-actions">
          <button type="button" data-reader-add="auto">Smart Add</button>
          <button type="button" data-reader-add="main">Main</button>
          ${card.isExtra ? `<button type="button" data-reader-add="extra">Extra</button>` : ''}
          <button type="button" data-reader-add="side">Side</button>
        </div>
      </div>
    </article>`;

  for (const button of el.cardReaderContent.querySelectorAll('[data-reader-add]')) {
    button.addEventListener('click', () => addCard(card.id, button.dataset.readerAdd));
  }
  el.cardReaderDialog.showModal();
}

function renderValidation(validation) {
  const { issues, copyIssues } = validation;
  el.copyStat.querySelector('strong').textContent = copyIssues;
  setStatState(el.copyStat, copyIssues === 0);

  const isClean = issues.length === 0;
  el.validationBadge.textContent = isClean ? 'Legal' : `${issues.length} issue${issues.length === 1 ? '' : 's'}`;
  el.validationBadge.className = `badge ${isClean ? 'ok' : 'bad'}`;
  el.overallStatus.className = `deck-status-card ${isClean ? 'ok' : 'bad'}`;
  el.overallStatus.querySelector('strong').textContent = isClean ? 'Deck is clean' : 'Needs fixes';
  el.overallStatus.querySelector('small').textContent = isClean ? `${formatLabel()} validation passed.` : `${issues.length} issue${issues.length === 1 ? '' : 's'} found.`;

  if (isClean) {
    el.issueList.innerHTML = `<li class="ok"><strong>Ready to duel.</strong><span>Main, Extra, Side, copy limits, and ${formatLabel()} restrictions look good.</span></li>`;
    return;
  }

  el.issueList.innerHTML = issues.map((issue) => `
    <li class="${issue.severity === 'error' ? 'error' : ''}">
      <strong>${escapeHtml(issue.title)}</strong>
      <span>${escapeHtml(issue.detail)}</span>
    </li>`).join('');
}

function renderComposition() {
  const counts = { Monster: 0, Spell: 0, Trap: 0, Extra: 0 };
  const levels = new Map();
  for (const [id, count] of Object.entries(state.deck.main)) {
    const card = getCard(id);
    if (card.isSpell) counts.Spell += count;
    else if (card.isTrap) counts.Trap += count;
    else if (card.isMonster) {
      counts.Monster += count;
      const key = card.level ? `Lv ${card.level}` : card.linkval ? `Link ${card.linkval}` : 'Other';
      levels.set(key, (levels.get(key) || 0) + count);
    }
  }
  counts.Extra = zoneCount('extra');
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  el.totalDeckBadge.textContent = `${totalDeckCount()} cards`;

  const max = Math.max(1, ...Object.values(counts));
  el.typeBars.innerHTML = Object.entries(counts).map(([label, value]) => `
    <div class="bar-row">
      <div class="bar-label"><span>${label}</span><span>${value}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width: ${(value / max) * 100}%"></div></div>
    </div>`).join('');

  const levelEntries = [...levels.entries()].sort((a, b) => naturalLevelOrder(a[0]) - naturalLevelOrder(b[0]));
  el.levelGrid.innerHTML = levelEntries.length
    ? levelEntries.map(([label, value]) => `<div class="mini-cell"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`).join('')
    : `<div class="mini-cell"><span>No Main Deck monsters yet</span><strong>0</strong></div>`;
}

function validateDeck() {
  const issues = [];
  const counts = getZoneCounts();
  let copyIssues = 0;

  if (counts.main < 40) issues.push({ severity: 'error', title: 'Main Deck too small', detail: `Add ${40 - counts.main} more Main Deck card${40 - counts.main === 1 ? '' : 's'} to reach the 40-card minimum.` });
  if (counts.main > 60) issues.push({ severity: 'error', title: 'Main Deck too large', detail: `Remove ${counts.main - 60} card${counts.main - 60 === 1 ? '' : 's'} to stay at 60 or below.` });
  if (counts.extra > 15) issues.push({ severity: 'error', title: 'Extra Deck too large', detail: `Remove ${counts.extra - 15} Extra Deck card${counts.extra - 15 === 1 ? '' : 's'} to stay at 15 or below.` });
  if (counts.side > 15) issues.push({ severity: 'error', title: 'Side Deck too large', detail: `Remove ${counts.side - 15} Side Deck card${counts.side - 15 === 1 ? '' : 's'} to stay at 15 or below.` });

  for (const [id, total] of Object.entries(totalCountsById())) {
    const card = getCard(id);
    const limit = getCopyLimit(card);
    if (total > limit) {
      copyIssues += 1;
      const label = limit === 0 ? 'Forbidden' : `${limit} allowed`;
      issues.push({ severity: 'error', title: `${card.name} exceeds copy limit`, detail: `${total} included across Main, Extra, and Side; ${label} in ${formatLabel()}.` });
    }
    if (!card.deckable) {
      issues.push({ severity: 'error', title: `${card.name} is not a standard Deck card`, detail: 'Token and Skill cards are hidden by default and should not be included in a standard TCG Deck.' });
    }
  }

  for (const [id, count] of Object.entries(state.deck.main)) {
    const card = getCard(id);
    if (count > 0 && card.isExtra) {
      issues.push({ severity: 'error', title: `${card.name} belongs in the Extra Deck`, detail: 'Fusion, Synchro, Xyz, and Link Monsters should not be placed in the Main Deck.' });
    }
  }

  for (const [id, count] of Object.entries(state.deck.extra)) {
    const card = getCard(id);
    if (count > 0 && !card.isExtra) {
      issues.push({ severity: 'error', title: `${card.name} cannot go in the Extra Deck`, detail: 'Only Fusion, Synchro, Xyz, and Link Monsters can start in the Extra Deck.' });
    }
  }

  return { issues, copyIssues };
}

function addCard(id, zone = 'auto', qty = 1, options = {}) {
  const card = getCard(id);
  const targetZone = zone === 'auto' ? routeZone(card) : zone;
  if (!ZONES.includes(targetZone)) return false;

  if (!card.deckable && !options.allowInvalid) {
    toast('Not a standard Deck card', `${card.name} cannot be added to a standard Deck.`, 'warning');
    return false;
  }
  if (targetZone === 'main' && card.isExtra && !options.allowInvalid) {
    toast('Use the Extra Deck', `${card.name} is an Extra Deck monster.`, 'warning');
    return false;
  }
  if (targetZone === 'extra' && !card.isExtra && !options.allowInvalid) {
    toast('Wrong zone', `${card.name} cannot be placed in the Extra Deck.`, 'warning');
    return false;
  }

  const limit = getCopyLimit(card);
  const total = totalCountForId(id);
  if (!options.skipCopyCheck && total + qty > limit) {
    toast('Copy limit reached', `${card.name}: ${total}/${limit} already in deck for ${formatLabel()}.`, 'warning');
    return false;
  }

  const zoneMax = targetZone === 'main' ? 60 : 15;
  if (!options.skipZoneCheck && zoneCount(targetZone) + qty > zoneMax) {
    toast(`${capitalize(targetZone)} Deck is full`, `Remove cards before adding more to the ${capitalize(targetZone)} Deck.`, 'warning');
    return false;
  }

  state.deck[targetZone][String(id)] = (state.deck[targetZone][String(id)] || 0) + qty;
  state.selectedCardId = String(id);
  renderAll();
  return true;
}

function removeCard(id, zone, qty = 1) {
  if (!state.deck[zone] || !state.deck[zone][String(id)]) return;
  if (qty === Infinity || state.deck[zone][String(id)] <= qty) {
    delete state.deck[zone][String(id)];
  } else {
    state.deck[zone][String(id)] -= qty;
  }
  if (totalCountForId(id) === 0 && state.selectedCardId === String(id)) state.selectedCardId = null;
  renderAll();
}

function moveOneCard(id, fromZone, toZone) {
  if (fromZone === toZone) return;
  if (!state.deck[fromZone] || !state.deck[fromZone][String(id)]) return;
  removeCardNoRender(id, fromZone, 1);
  const added = addCard(id, toZone, 1, { skipCopyCheck: true });
  if (!added) {
    state.deck[fromZone][String(id)] = (state.deck[fromZone][String(id)] || 0) + 1;
    renderAll();
    return;
  }
  toast('Moved card', `${getCard(id).name} moved to ${capitalize(toZone)} Deck.`);
}

function removeCardNoRender(id, zone, qty) {
  const key = String(id);
  if (!state.deck[zone] || !state.deck[zone][key]) return;
  if (state.deck[zone][key] <= qty) delete state.deck[zone][key];
  else state.deck[zone][key] -= qty;
}

function routeZone(card) {
  return card.isExtra ? 'extra' : 'main';
}

function getCard(id) {
  const key = String(id);
  return state.idToCard.get(key) || {
    id: key,
    name: `Unknown card ${key}`,
    type: 'Unknown',
    race: 'Unknown',
    attribute: '',
    archetype: '',
    desc: 'This card is not in the currently loaded API card pool.',
    atk: null,
    def: null,
    level: null,
    linkval: null,
    imageSmall: '',
    imageLarge: '',
    price: {},
    isExtra: false,
    isMonster: false,
    isSpell: false,
    isTrap: false,
    isToken: false,
    isSkill: false,
    deckable: false,
    unknown: true,
  };
}

function getLimitStatus(card) {
  if (!card || state.format === 'casual') return '';
  if (state.format === 'masterduel') {
    const limit = MASTER_DUEL_LIMITS[String(card.id)];
    if (limit === 0) return 'Forbidden';
    if (limit === 1) return 'Limited';
    if (limit === 2) return 'Semi-Limited';
    return '';
  }
  const field = FORMAT_TO_BAN_FIELD[state.format];
  return (card.banlist_info && card.banlist_info[field]) || '';
}

function getCopyLimit(card) {
  const status = getLimitStatus(card);
  if (status === 'Forbidden') return 0;
  if (status === 'Limited') return 1;
  if (status === 'Semi-Limited' || status === 'Semi Limited') return 2;
  return 3;
}

function shortLimit(status) {
  if (status === 'Forbidden') return 'Forbidden';
  if (status === 'Limited') return 'Limit 1';
  if (status === 'Semi-Limited' || status === 'Semi Limited') return 'Limit 2';
  return status;
}

function isExtraType(type) {
  return /(^|\s)(Fusion|Synchro|XYZ|Xyz|Link)(\s|$)/i.test(type);
}

function isMonsterCard(card) {
  return card.isMonster && !card.isExtra;
}

function getZoneCounts() {
  return {
    main: zoneCount('main'),
    extra: zoneCount('extra'),
    side: zoneCount('side'),
  };
}

function zoneCount(zone) {
  return Object.values(state.deck[zone]).reduce((sum, count) => sum + Number(count || 0), 0);
}

function totalDeckCount() {
  return ZONES.reduce((sum, zone) => sum + zoneCount(zone), 0);
}

function totalCountForId(id) {
  const key = String(id);
  return ZONES.reduce((sum, zone) => sum + (state.deck[zone][key] || 0), 0);
}

function totalCountsById() {
  const totals = {};
  for (const zone of ZONES) {
    for (const [id, count] of Object.entries(state.deck[zone])) {
      totals[id] = (totals[id] || 0) + count;
    }
  }
  return totals;
}

function hasAnyCardsInDeck() {
  return totalDeckCount() > 0;
}

function makeEmptyDeck() {
  return { main: {}, extra: {}, side: {} };
}

function setStatState(node, ok) {
  node.classList.toggle('ok', ok);
  node.classList.toggle('bad', !ok);
}

function selectCard(id) {
  state.selectedCardId = String(id);
  renderInspector();
}

function sortDeck() {
  for (const zone of ZONES) {
    const sorted = Object.entries(state.deck[zone]).sort(([idA], [idB]) => sortCardIds(idA, idB));
    state.deck[zone] = Object.fromEntries(sorted);
  }
}

function sortCardIds(idA, idB) {
  const a = getCard(idA);
  const b = getCard(idB);
  return bucketWeight(a) - bucketWeight(b)
    || nullToLow(a.level ?? a.linkval) - nullToLow(b.level ?? b.linkval)
    || a.name.localeCompare(b.name);
}

function bucketWeight(card) {
  if (card.isMonster && !card.isExtra) return 0;
  if (card.isSpell) return 1;
  if (card.isTrap) return 2;
  if (card.isExtra) return 3;
  return 4;
}

function exposeAgentBridge() {
  window.duelDeckAgent = {
    version: 1,
    status: agentStatus,
    getCards: agentGetCards,
    searchCards: agentSearchCards,
    getCard: agentGetCard,
    getDeck: agentGetDeck,
    setDeck: agentSetDeck,
    clearDeck: agentClearDeck,
    addCard: agentAddCard,
    removeCard: agentRemoveCard,
    validateDeck: () => cloneForAgent(validateDeck()),
    analyzeDeck: agentAnalyzeDeck,
    simulateHands: agentSimulateHands,
    playtest: agentPlaytestBridge(),
    importYdk: agentImportYdk,
    exportYdk: buildYdkText,
  };
}

function agentPlaytestBridge() {
  return {
    available: () => Boolean(window.duelDeckPlaytest),
    status: () => window.duelDeckPlaytest
      ? window.duelDeckPlaytest.status()
      : { available: false, message: 'Build and load dist/playtest-engine.js to enable the TypeScript playtest engine.' },
    start: (options = {}) => {
      if (!window.duelDeckPlaytest) return { ok: false, error: 'TypeScript playtest engine is not loaded.' };
      return window.duelDeckPlaytest.start({ deck: serializeDeckState(), ...options });
    },
    state: (sessionId) => window.duelDeckPlaytest
      ? window.duelDeckPlaytest.state(sessionId)
      : { ok: false, error: 'TypeScript playtest engine is not loaded.' },
    legalActions: (sessionId) => window.duelDeckPlaytest
      ? window.duelDeckPlaytest.legalActions(sessionId)
      : [],
    action: (action, sessionId) => window.duelDeckPlaytest
      ? window.duelDeckPlaytest.action(action, sessionId)
      : { ok: false, error: 'TypeScript playtest engine is not loaded.' },
    autoRun: (options = {}) => window.duelDeckPlaytest
      ? window.duelDeckPlaytest.autoRun(options)
      : { ok: false, error: 'TypeScript playtest engine is not loaded.' },
  };
}

function agentStatus() {
  return {
    loaded: state.cards.length > 0 && !state.loading,
    loading: state.loading,
    format: state.format,
    formatLabel: formatLabel(),
    cardCount: state.cards.length,
    filteredCardCount: state.filteredCards.length,
    deckName: state.deckName,
    counts: getZoneCounts(),
    total: totalDeckCount(),
  };
}

function agentGetCards(options = {}) {
  const limit = clampAgentLimit(options.limit, 100);
  const offset = Math.max(0, Number(options.offset) || 0);
  const source = options.filtered ? state.filteredCards : state.cards;
  return source.slice(offset, offset + limit).map((card) => toAgentCard(card, Boolean(options.full)));
}

function agentSearchCards(query = '', options = {}) {
  const q = String(query || '').trim().toLowerCase();
  const limit = clampAgentLimit(options.limit, 25);
  const bucket = options.bucket || 'all';
  const archetype = String(options.archetype || '').trim().toLowerCase();
  const race = String(options.race || '').trim().toLowerCase();
  const attribute = String(options.attribute || '').trim().toLowerCase();
  const legalOnly = options.legalOnly !== false;

  return state.cards
    .filter((card) => {
      if (legalOnly && !card.deckable) return false;
      if (q && !card.searchText.includes(q)) return false;
      if (archetype && card.archetype.toLowerCase() !== archetype) return false;
      if (race && card.race.toLowerCase() !== race) return false;
      if (attribute && card.attribute.toLowerCase() !== attribute) return false;
      if (bucket === 'monster' && !card.isMonster) return false;
      if (bucket === 'spell' && !card.isSpell) return false;
      if (bucket === 'trap' && !card.isTrap) return false;
      if (bucket === 'extra' && !card.isExtra) return false;
      return true;
    })
    .slice(0, limit)
    .map((card) => toAgentCard(card, Boolean(options.full)));
}

function agentGetCard(id, options = {}) {
  return toAgentCard(getCard(id), options.full !== false);
}

function agentGetDeck(options = {}) {
  const deckState = serializeDeckState();
  if (!options.includeCards) return cloneForAgent(deckState);
  return {
    ...cloneForAgent(deckState),
    cards: ZONES.reduce((zones, zone) => {
      zones[zone] = Object.entries(state.deck[zone]).map(([id, count]) => ({
        count,
        card: toAgentCard(getCard(id), Boolean(options.fullCards)),
      }));
      return zones;
    }, {}),
  };
}

function agentSetDeck(deckState) {
  hydrateDeckState(deckState || {});
  renderAll();
  return {
    ok: true,
    deck: agentGetDeck(),
    validation: cloneForAgent(validateDeck()),
  };
}

function agentClearDeck() {
  state.deck = makeEmptyDeck();
  state.selectedCardId = null;
  renderAll();
  return { ok: true, deck: agentGetDeck(), validation: cloneForAgent(validateDeck()) };
}

function agentAddCard(id, zone = 'auto', qty = 1, options = {}) {
  const ok = addCard(id, zone, Math.max(1, Math.floor(Number(qty) || 1)), options);
  return {
    ok,
    deck: agentGetDeck(),
    validation: cloneForAgent(validateDeck()),
  };
}

function agentRemoveCard(id, zone, qty = 1) {
  if (!ZONES.includes(zone)) return { ok: false, error: 'Unknown zone' };
  removeCard(id, zone, qty === Infinity ? Infinity : Math.max(1, Math.floor(Number(qty) || 1)));
  return {
    ok: true,
    deck: agentGetDeck(),
    validation: cloneForAgent(validateDeck()),
  };
}

function agentImportYdk(text) {
  importYdk(String(text || ''));
  return {
    ok: true,
    deck: agentGetDeck(),
    validation: cloneForAgent(validateDeck()),
  };
}

function agentAnalyzeDeck() {
  const analysis = {
    counts: getZoneCounts(),
    total: totalDeckCount(),
    types: { monsters: 0, spells: 0, traps: 0, extra: zoneCount('extra'), other: 0 },
    attributes: {},
    races: {},
    archetypes: {},
    levels: {},
    roles: { starters: [], extenders: [], searchers: [], disruption: [], removal: [], recovery: [] },
    issues: validateDeck().issues,
  };

  for (const zone of ZONES) {
    for (const [id, count] of Object.entries(state.deck[zone])) {
      const card = getCard(id);
      countAgentCardStats(analysis, card, count, zone);
      tagAgentRoles(analysis.roles, card, count, zone);
    }
  }

  return cloneForAgent(analysis);
}

function agentSimulateHands(options = {}) {
  const handSize = clampAgentRange(options.handSize, 5, 1, 10);
  const trials = clampAgentRange(options.trials, 1, 1, 250);
  const includeCards = options.includeCards !== false;
  const fullCards = Boolean(options.fullCards);
  const mainDeck = expandDeckZone('main');

  if (mainDeck.length < handSize) {
    return {
      ok: false,
      error: `Main Deck has ${mainDeck.length} card${mainDeck.length === 1 ? '' : 's'}, cannot draw ${handSize}.`,
      counts: getZoneCounts(),
    };
  }

  const rng = makeAgentRng(options.seed);
  const hands = [];
  const aggregate = makeHandAggregate();

  for (let index = 0; index < trials; index += 1) {
    const ids = Array.isArray(options.handIds) && options.handIds.length
      ? normalizeAgentHandIds(options.handIds).slice(0, handSize)
      : drawAgentHand(mainDeck, handSize, rng);
    const hand = evaluateAgentHand(ids, { includeCards, fullCards });
    hands.push(hand);
    updateHandAggregate(aggregate, hand);
  }

  finalizeHandAggregate(aggregate, trials);

  return cloneForAgent({
    ok: true,
    deckName: state.deckName,
    format: state.format,
    handSize,
    trials,
    aggregate,
    hands,
  });
}

function countAgentCardStats(analysis, card, count, zone) {
  if (zone !== 'extra') {
    if (card.isSpell) analysis.types.spells += count;
    else if (card.isTrap) analysis.types.traps += count;
    else if (card.isMonster) analysis.types.monsters += count;
    else analysis.types.other += count;
  }
  addAgentCount(analysis.attributes, card.attribute || 'None', count);
  addAgentCount(analysis.races, card.race || 'Unknown', count);
  if (card.archetype) addAgentCount(analysis.archetypes, card.archetype, count);
  const level = card.level ? `Level ${card.level}` : card.linkval ? `Link ${card.linkval}` : '';
  if (level) addAgentCount(analysis.levels, level, count);
}

function tagAgentRoles(roles, card, count, zone) {
  const text = `${card.name} ${card.desc}`.toLowerCase();
  const entry = { id: card.id, name: card.name, count, zone };
  if (/\b(add|adds|adding)\b.+\b(hand|deck)\b|search your deck|from your deck to your hand/.test(text)) roles.searchers.push(entry);
  if (/normal summon|starter|one card|when this card is summoned/.test(text)) roles.starters.push(entry);
  if (/special summon|summon this card|summon 1/.test(text)) roles.extenders.push(entry);
  if (/negate|cannot activate|quick effect|during either player's turn/.test(text)) roles.disruption.push(entry);
  if (/destroy|banish|send.+to the graveyard|return.+to the hand|shuffle.+into the deck/.test(text)) roles.removal.push(entry);
  if (/graveyard|gy|special summon.+from your graveyard|add.+from your graveyard/.test(text)) roles.recovery.push(entry);
}

function expandDeckZone(zone) {
  return Object.entries(state.deck[zone] || {}).flatMap(([id, count]) => (
    Array.from({ length: Math.max(0, Number(count) || 0) }, () => String(id))
  ));
}

function drawAgentHand(deckIds, handSize, rng) {
  const pool = deckIds.slice();
  const hand = [];
  while (hand.length < handSize && pool.length) {
    const index = Math.floor(rng() * pool.length);
    hand.push(pool.splice(index, 1)[0]);
  }
  return hand;
}

function normalizeAgentHandIds(ids) {
  return ids.map((id) => String(id)).filter((id) => /^\d+$/.test(id));
}

function evaluateAgentHand(ids, options = {}) {
  const cards = ids.map((id) => getCard(id));
  const buckets = {
    normalSummons: [],
    starters: [],
    extenders: [],
    searchers: [],
    drawPower: [],
    disruption: [],
    removal: [],
    recovery: [],
    protection: [],
    bricks: [],
  };

  for (const card of cards) tagAgentHandCard(buckets, card);

  const lines = inferAgentHandLines(buckets, cards);
  const score = scoreAgentHand(buckets, lines, cards);
  const summary = summarizeAgentHand(score, lines, buckets);

  return {
    cardIds: ids,
    cards: options.includeCards ? cards.map((card) => toAgentCard(card, Boolean(options.fullCards))) : undefined,
    summary,
    score,
    quality: score >= 8 ? 'strong' : score >= 5 ? 'playable' : score >= 3 ? 'thin' : 'weak',
    buckets: Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, value.map(toAgentHandEntry)])),
    lines,
  };
}

function tagAgentHandCard(buckets, card) {
  const text = `${card.name} ${card.desc}`.toLowerCase();
  const target = (bucket) => buckets[bucket].push(card);

  if (card.isMonster && !card.isExtra) target('normalSummons');
  if (/normal summon|starter|one card|when this card is summoned|if this card is summoned|reveal.+add|activate.+from your deck/.test(text)) target('starters');
  if (/special summon|summon this card|summon 1|from your hand|if you control|if you have no monsters/.test(text)) target('extenders');
  if (/\b(add|adds|adding)\b.+\b(hand|deck)\b|search your deck|from your deck to your hand|excavate.+add/.test(text)) target('searchers');
  if (/draw \d|draw cards|discard.+draw|trade-in|pot of|allure of darkness/.test(text)) target('drawPower');
  if (/negate|cannot activate|quick effect|during either player's turn|from your hand.*activate|opponent activates/.test(text)) target('disruption');
  if (/destroy|banish|send.+to the graveyard|return.+to the hand|shuffle.+into the deck|send.+to the gy/.test(text)) target('removal');
  if (/graveyard|gy|special summon.+from your graveyard|add.+from your graveyard|banished.+add|banished.+special summon/.test(text)) target('recovery');
  if (/cannot be destroyed|unaffected|protect|target.*instead|cannot target/.test(text)) target('protection');
  if (isLikelyAgentBrick(card, text)) target('bricks');
}

function isLikelyAgentBrick(card, text) {
  if (card.isSpell || card.isTrap || card.isExtra) return false;
  if (/cannot be normal summoned|must be special summoned|cannot be special summoned|tribute \d|2 tributes|3 tributes/.test(text)) return true;
  return Number(card.level || 0) >= 7 && !/special summon|discard|reveal|from your hand/.test(text);
}

function inferAgentHandLines(buckets, cards) {
  const lines = [];
  const names = (items) => items.slice(0, 3).map((card) => card.name);
  if (buckets.starters.length) lines.push({ type: 'starter', strength: 3, cards: names(buckets.starters), detail: 'Has a probable engine starter or summon-trigger card.' });
  if (buckets.searchers.length) lines.push({ type: 'search', strength: 2, cards: names(buckets.searchers), detail: 'Can likely access another engine piece from deck or hand.' });
  if (buckets.starters.length && buckets.extenders.length) lines.push({ type: 'combo', strength: 4, cards: names([...buckets.starters, ...buckets.extenders]), detail: 'Starter plus extender suggests the hand can keep playing after the first action.' });
  if (buckets.disruption.length) lines.push({ type: 'defense', strength: 2, cards: names(buckets.disruption), detail: 'Has interaction for the opponent turn or board contesting.' });
  if (buckets.removal.length) lines.push({ type: 'board_break', strength: 2, cards: names(buckets.removal), detail: 'Has removal that may answer established cards.' });
  if (buckets.drawPower.length) lines.push({ type: 'dig', strength: 1, cards: names(buckets.drawPower), detail: 'Can potentially draw or cycle into missing pieces.' });
  if (!lines.length && cards.some((card) => card.isMonster && !card.isExtra)) lines.push({ type: 'basic_play', strength: 1, cards: names(cards.filter((card) => card.isMonster && !card.isExtra)), detail: 'Has a normal summon, but no obvious engine line was detected.' });
  return lines;
}

function scoreAgentHand(buckets, lines, cards) {
  const lineScore = lines.reduce((sum, line) => sum + line.strength, 0);
  const typeSpread = Number(cards.some((card) => card.isMonster && !card.isExtra)) + Number(cards.some((card) => card.isSpell)) + Number(cards.some((card) => card.isTrap));
  const brickPenalty = Math.min(3, buckets.bricks.length);
  return Math.max(0, Math.min(10, lineScore + typeSpread - brickPenalty));
}

function summarizeAgentHand(score, lines, buckets) {
  if (score >= 8) return 'Strong opener: multiple useful lines are visible.';
  if (buckets.starters.length && buckets.extenders.length) return 'Playable opener: starter plus extender detected.';
  if (buckets.starters.length || buckets.searchers.length) return 'Playable opener: at least one starter or search path detected.';
  if (buckets.disruption.length >= 2) return 'Defensive opener: limited engine access, but meaningful interaction.';
  if (buckets.bricks.length >= 3) return 'Weak opener: too many likely bricks.';
  return 'Thin opener: no clear engine line detected.';
}

function toAgentHandEntry(card) {
  return { id: card.id, name: card.name };
}

function makeHandAggregate() {
  return {
    averageScore: 0,
    strongHands: 0,
    playableHands: 0,
    weakHands: 0,
    starterHands: 0,
    starterExtenderHands: 0,
    disruptionHands: 0,
    brickedHands: 0,
  };
}

function updateHandAggregate(aggregate, hand) {
  aggregate.averageScore += hand.score;
  if (hand.quality === 'strong') aggregate.strongHands += 1;
  if (hand.score >= 5) aggregate.playableHands += 1;
  if (hand.score < 3) aggregate.weakHands += 1;
  if (hand.buckets.starters.length || hand.buckets.searchers.length) aggregate.starterHands += 1;
  if ((hand.buckets.starters.length || hand.buckets.searchers.length) && hand.buckets.extenders.length) aggregate.starterExtenderHands += 1;
  if (hand.buckets.disruption.length) aggregate.disruptionHands += 1;
  if (hand.buckets.bricks.length >= 2) aggregate.brickedHands += 1;
}

function finalizeHandAggregate(aggregate, trials) {
  const rate = (value) => Number((value / trials).toFixed(3));
  aggregate.averageScore = Number((aggregate.averageScore / trials).toFixed(2));
  aggregate.strongRate = rate(aggregate.strongHands);
  aggregate.playableRate = rate(aggregate.playableHands);
  aggregate.weakRate = rate(aggregate.weakHands);
  aggregate.starterRate = rate(aggregate.starterHands);
  aggregate.starterExtenderRate = rate(aggregate.starterExtenderHands);
  aggregate.disruptionRate = rate(aggregate.disruptionHands);
  aggregate.brickRate = rate(aggregate.brickedHands);
}

function addAgentCount(target, key, count) {
  target[key] = (target[key] || 0) + count;
}

function toAgentCard(card, full = false) {
  if (!card) return null;
  const base = {
    id: card.id,
    name: card.name,
    type: card.type,
    race: card.race,
    attribute: card.attribute,
    archetype: card.archetype,
    atk: card.atk,
    def: card.def,
    level: card.level,
    linkval: card.linkval,
    scale: card.scale,
    isExtra: card.isExtra,
    isMonster: card.isMonster,
    isSpell: card.isSpell,
    isTrap: card.isTrap,
    deckable: card.deckable,
    routeZone: routeZone(card),
    limitStatus: getLimitStatus(card) || 'Unlimited',
    copyLimit: getCopyLimit(card),
    imageSmall: card.imageSmall,
    imageLarge: card.imageLarge,
  };
  if (full) {
    base.desc = card.desc;
    base.price = card.price;
    base.banlistInfo = card.banlist_info || {};
  }
  return cloneForAgent(base);
}

function clampAgentLimit(value, fallback) {
  const number = Math.floor(Number(value) || fallback);
  return Math.max(1, Math.min(number, 500));
}

function clampAgentRange(value, fallback, min, max) {
  const number = Math.floor(Number(value) || fallback);
  return Math.max(min, Math.min(number, max));
}

function makeAgentRng(seed) {
  if (seed === undefined || seed === null || seed === '') return Math.random;
  let value = Number(seed);
  if (!Number.isFinite(value)) {
    value = String(seed).split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  }
  value = Math.abs(Math.floor(value)) || 1;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function cloneForAgent(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildYdkText() {
  const expand = (zone) => Object.entries(state.deck[zone])
    .sort(([idA], [idB]) => sortCardIds(idA, idB))
    .flatMap(([id, count]) => Array.from({ length: count }, () => id));

  const lines = [
    '#created by Duel Deck Studio',
    `#deck ${state.deckName}`,
    '#main',
    ...expand('main'),
    '#extra',
    ...expand('extra'),
    '!side',
    ...expand('side'),
    '',
  ];

  return lines.join('\n');
}

function exportYdk() {
  const blob = new Blob([buildYdkText()], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const safeName = state.deckName.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'yugioh-deck';
  anchor.href = url;
  anchor.download = `${safeName}.ydk`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  toast('Exported .ydk', 'Deck file downloaded.');
}

function importYdk(text) {
  if (!text.trim()) {
    toast('No import text', 'Paste a .ydk list or choose a file.', 'warning');
    return;
  }

  const deck = makeEmptyDeck();
  let currentZone = 'main';
  let imported = 0;
  let ignored = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.toLowerCase() === '#main') { currentZone = 'main'; continue; }
    if (line.toLowerCase() === '#extra') { currentZone = 'extra'; continue; }
    if (line.toLowerCase() === '!side') { currentZone = 'side'; continue; }
    if (line.startsWith('#')) continue;
    if (/^\d+$/.test(line)) {
      deck[currentZone][line] = (deck[currentZone][line] || 0) + 1;
      imported += 1;
    } else {
      ignored += 1;
    }
  }

  state.deck = deck;
  state.selectedCardId = null;
  renderAll();
  el.importDialog.close();
  toast('Deck imported', `${imported} card line${imported === 1 ? '' : 's'} loaded${ignored ? `, ${ignored} ignored` : ''}.`);
}

async function handleFileImport(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const text = await file.text();
  el.ydkInput.value = text;
  event.target.value = '';
}

function loadStarterShell() {
  if (!state.cards.length) {
    toast('Cards still loading', 'Wait for the card database, then load the shell.', 'warning');
    return;
  }
  if (hasAnyCardsInDeck()) {
    const ok = confirm('Replace the current deck with the starter shell?');
    if (!ok) return;
  }

  const shell = makeEmptyDeck();
  const addByName = (name, zone, count = 1) => {
    const card = state.cards.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    if (!card) return;
    shell[zone][card.id] = (shell[zone][card.id] || 0) + count;
  };

  const mainCards = [
    ['Blue-Eyes White Dragon', 3],
    ['Sage with Eyes of Blue', 3],
    ['The White Stone of Ancients', 3],
    ['Blue-Eyes Alternative White Dragon', 2],
    ['Effect Veiler', 3],
    ['Ash Blossom & Joyous Spring', 3],
    ['Polymerization', 2],
    ['Bingo Machine, Go!!!', 3],
    ['Trade-In', 3],
    ['Return of the Dragon Lords', 3],
    ['Dragon Shrine', 3],
    ['The Melody of Awakening Dragon', 3],
    ['Infinite Impermanence', 3],
    ['True Light', 2],
  ];
  const extraCards = [
    ['Blue-Eyes Ultimate Dragon', 1],
    ['Neo Blue-Eyes Ultimate Dragon', 1],
    ['Blue-Eyes Twin Burst Dragon', 1],
    ['Azure-Eyes Silver Dragon', 1],
    ['Blue-Eyes Spirit Dragon', 1],
    ['Hieratic Seal of the Heavenly Spheres', 1],
    ['Number 38: Hope Harbinger Dragon Titanic Galaxy', 1],
  ];
  const sideCards = [
    ['Cosmic Cyclone', 3],
    ['Evenly Matched', 3],
    ['Nibiru, the Primal Being', 3],
  ];

  mainCards.forEach(([name, count]) => addByName(name, 'main', count));
  extraCards.forEach(([name, count]) => addByName(name, 'extra', count));
  sideCards.forEach(([name, count]) => addByName(name, 'side', count));

  state.deck = shell;
  state.deckName = 'Blue-Eyes Starter Shell';
  sortDeck();
  renderAll();
  toast('Starter shell loaded', 'Use validation to finish or tune it for your format.');
}

function serializeDeckState() {
  return {
    deckName: state.deckName,
    deck: state.deck,
    format: state.format,
    selectedCardId: state.selectedCardId,
    savedAt: new Date().toISOString(),
  };
}

function hydrateDeckState(data) {
  state.deckName = typeof data.deckName === 'string' ? data.deckName : 'Untitled Deck';
  state.deck = normalizeDeckState(data.deck || makeEmptyDeck());
  state.format = typeof data.format === 'string' ? data.format : state.format;
  state.selectedCardId = data.selectedCardId ? String(data.selectedCardId) : null;
  el.formatSelect.value = state.format;
}

function normalizeDeckState(deck) {
  const normalized = makeEmptyDeck();
  for (const zone of ZONES) {
    if (!deck[zone] || typeof deck[zone] !== 'object') continue;
    for (const [id, count] of Object.entries(deck[zone])) {
      const numberCount = Number(count);
      if (/^\d+$/.test(String(id)) && Number.isFinite(numberCount) && numberCount > 0) {
        normalized[zone][String(id)] = Math.floor(numberCount);
      }
    }
  }
  return normalized;
}

function persistAutoDeck() {
  try {
    localStorage.setItem(AUTO_DECK_KEY, JSON.stringify(serializeDeckState()));
  } catch {
    // Local persistence is a nice-to-have. Ignore storage quota errors.
  }
}

function restoreAutoDeck() {
  const raw = localStorage.getItem(AUTO_DECK_KEY);
  if (!raw) return;
  const parsed = safeJsonParse(raw);
  if (!parsed) return;
  hydrateDeckState(parsed);
}

function readDragPayload(event) {
  try {
    const raw = event.dataTransfer.getData('application/json');
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.id) return null;
    return { id: String(parsed.id), sourceZone: parsed.sourceZone };
  } catch {
    return null;
  }
}

async function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getCachedResponse(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const store = tx.objectStore(DB_STORE);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

async function setCachedResponse(key, value) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      store.put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore cache write failures.
  }
}

function setDataStatus(status, text) {
  el.dataStatus.className = `status-pill ${status}`;
  el.dataStatus.textContent = text;
}

function formatLabel() {
  const labels = { tcg: 'TCG Advanced', masterduel: 'Master Duel', ocg: 'OCG', goat: 'GOAT', casual: 'Casual' };
  return labels[state.format] || state.format.toUpperCase();
}

function nullToLow(value) {
  return typeof value === 'number' ? value : -999999;
}

function naturalLevelOrder(label) {
  const number = Number(label.replace(/[^0-9]/g, ''));
  if (!Number.isFinite(number)) return 999;
  if (label.startsWith('Link')) return 100 + number;
  return number;
}

function capitalize(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

function safeJsonParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

function toast(title, message, tone = 'default') {
  const node = document.createElement('div');
  node.className = `toast ${tone}`;
  node.innerHTML = `<strong>${escapeHtml(title)}</strong><small>${escapeHtml(message)}</small>`;
  el.toastStack.append(node);
  window.setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    node.style.transition = 'opacity 180ms ease, transform 180ms ease';
    window.setTimeout(() => node.remove(), 220);
  }, 3300);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

function highlight(text, query) {
  const safe = escapeHtml(text);
  if (!query) return safe;
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return safe;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return safe.replace(new RegExp(`(${escaped})`, 'ig'), '<mark>$1</mark>');
  } catch {
    return safe;
  }
}
