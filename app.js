// =============================================================
// Despensa — PWA
// =============================================================

const STORAGE_KEY = 'despensa_v2';
const HISTORY_KEY = 'despensa_history_v2';
const SHOP_STATE_KEY = 'despensa_shop_state_v2';

// Ubicaciones en casa
const LOCATIONS = ['Nevera', 'Despensa', 'Congelador', 'Otros'];

// Zonas Mercadona Las Tablas — extraídas del plano real de la tienda.
// Orden = recorrido real: entrada por Cajas (sur), giro a la derecha,
// subida por la columna derecha, U por el techo de la tienda hasta arriba-izquierda,
// bajada por la izquierda, cruce horizontal por abajo hasta Frutas y verduras,
// fin en Cajas.
const MERCADONA_ZONES = [
  'Comida preparada (caliente)',
  'Comida preparada (nevera)',
  'Bebidas alcohólicas',
  'Pescadería',
  'Pescado envasado nevera',
  'Bebidas y refrescos',
  'Congelados',
  'Helados y chocolates',
  'Patatas fritas',
  'Verduras y frutas congeladas',
  'Pavo y pollo',
  'Pasta y aceites',
  'Huevos y legumbres',
  'Ternera y cerdo',
  'Leche',
  'Yogures y postres',
  'Pan/Picos y desayuno/dulces',
  'Panadería',
  'Utensilios de plástico',
  'Café, chocolate y chuches',
  'Zumos',
  'Limpieza hogar',
  'Zona baño y cuidado personal',
  'Quesos',
  'Cortador jamón',
  'Embutido aperitivo',
  'Embutido envasado',
  'Frutos secos',
  'Frutas y verduras',
  'Otros',
];

// Mapeo de categorías antiguas (versión anterior de la app) → zonas nuevas.
// Solo se aplica al cargar datos antiguos, para que no se queden huérfanos.
const LEGACY_ZONE_MAP = {
  'Frutas y verduras': 'Frutas y verduras',
  'Carnicería y pescadería': 'Pavo y pollo',
  'Lácteos y huevos': 'Leche',
  'Charcutería y quesos': 'Quesos',
  'Panadería': 'Panadería',
  'Despensa': 'Pasta y aceites',
  'Conservas': 'Pasta y aceites',
  'Pasta, arroz y legumbres': 'Pasta y aceites',
  'Desayuno y dulces': 'Pan/Picos y desayuno/dulces',
  'Aceites y salsas': 'Pasta y aceites',
  'Bebidas': 'Bebidas y refrescos',
  'Congelados': 'Congelados',
  'Higiene y droguería': 'Zona baño y cuidado personal',
  'Limpieza': 'Limpieza hogar',
  'Otros': 'Otros',
};

const SEED = [
  { name: 'Leche entera 1L',        stock: 3, min: 2, location: 'Nevera',    zone: 'Leche' },
  { name: 'Huevos (docena)',        stock: 1, min: 1, location: 'Nevera',    zone: 'Huevos y legumbres' },
  { name: 'Yogur natural',          stock: 6, min: 4, location: 'Nevera',    zone: 'Yogures y postres' },
  { name: 'Queso fresco',           stock: 2, min: 1, location: 'Nevera',    zone: 'Quesos' },
  { name: 'Pan de molde',           stock: 1, min: 1, location: 'Despensa',  zone: 'Pan/Picos y desayuno/dulces' },
  { name: 'Plátanos',               stock: 5, min: 3, location: 'Despensa',  zone: 'Frutas y verduras' },
  { name: 'Tomates',                stock: 4, min: 3, location: 'Nevera',    zone: 'Frutas y verduras' },
  { name: 'Manzanas',               stock: 6, min: 4, location: 'Nevera',    zone: 'Frutas y verduras' },
  { name: 'Pechuga de pollo',       stock: 2, min: 2, location: 'Nevera',    zone: 'Pavo y pollo' },
  { name: 'Salmón fresco',          stock: 1, min: 1, location: 'Nevera',    zone: 'Pescadería' },
  { name: 'Arroz',                  stock: 2, min: 1, location: 'Despensa',  zone: 'Pasta y aceites' },
  { name: 'Pasta',                  stock: 3, min: 2, location: 'Despensa',  zone: 'Pasta y aceites' },
  { name: 'Lentejas',               stock: 2, min: 1, location: 'Despensa',  zone: 'Huevos y legumbres' },
  { name: 'Aceite de oliva',        stock: 1, min: 1, location: 'Despensa',  zone: 'Pasta y aceites' },
  { name: 'Vinagre',                stock: 1, min: 1, location: 'Despensa',  zone: 'Pasta y aceites' },
  { name: 'Agua 1.5L (pack)',       stock: 2, min: 2, location: 'Despensa',  zone: 'Bebidas y refrescos' },
  { name: 'Café molido',            stock: 1, min: 1, location: 'Despensa',  zone: 'Café, chocolate y chuches' },
  { name: 'Cereales',               stock: 2, min: 1, location: 'Despensa',  zone: 'Pan/Picos y desayuno/dulces' },
  { name: 'Atún en lata',           stock: 6, min: 4, location: 'Despensa',  zone: 'Pasta y aceites' },
  { name: 'Verduras congeladas',    stock: 2, min: 1, location: 'Congelador', zone: 'Verduras y frutas congeladas' },
  { name: 'Pizza congelada',        stock: 2, min: 1, location: 'Congelador', zone: 'Congelados' },
  { name: 'Papel higiénico (pack)', stock: 1, min: 1, location: 'Otros',     zone: 'Zona baño y cuidado personal' },
  { name: 'Detergente lavadora',    stock: 1, min: 1, location: 'Otros',     zone: 'Limpieza hogar' },
];

// ---------- State ----------
let data = loadData();
let history = loadHistory();
let shopState = loadShopState();
let currentTab = 'home';
let locFilter = 'all'; // all | Nevera | Despensa | Congelador | Otros

// ---------- Storage ----------
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migración automática: si algún producto tiene una zona del esquema anterior,
      // la traducimos al nuevo esquema sin perder datos.
      let migrated = false;
      parsed.forEach(p => {
        if (p.zone && !MERCADONA_ZONES.includes(p.zone) && LEGACY_ZONE_MAP[p.zone]) {
          p.zone = LEGACY_ZONE_MAP[p.zone];
          migrated = true;
        } else if (p.zone && !MERCADONA_ZONES.includes(p.zone)) {
          // Zona desconocida que no está en el mapa de legado: fallback a Otros
          p.zone = 'Otros';
          migrated = true;
        }
      });
      if (migrated) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed)); } catch (e) {}
      }
      return parsed;
    }
  } catch (e) {}
  const seed = SEED.map((p, i) => ({ id: 'p' + (i + 1), ...p }));
  saveData(seed);
  return seed;
}
function saveData(d) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d || data)); } catch (e) {}
}
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}
function saveHistory() {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (e) {}
}
function loadShopState() {
  try {
    const raw = localStorage.getItem(SHOP_STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {};
}
function saveShopState() {
  try { localStorage.setItem(SHOP_STATE_KEY, JSON.stringify(shopState)); } catch (e) {}
}

function uid() { return 'p' + Date.now() + Math.floor(Math.random() * 1000); }

// ---------- Tabs ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    setTab(tab);
  });
});

function setTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.panel').forEach(p => {
    p.classList.toggle('active', p.id === 'panel-' + tab);
  });
  const subtitles = {
    home: 'Inventario de casa',
    shop: 'Lista de la compra',
    history: 'Compras anteriores',
    manage: 'Añadir y editar productos'
  };
  document.getElementById('head-subtitle').textContent = subtitles[tab] || '';
  renderAll();
  window.scrollTo(0, 0);
}

// ---------- Populate selects & filter chips ----------
function populateSelects() {
  const locSel = document.getElementById('new-loc');
  locSel.innerHTML = LOCATIONS.map(l => `<option value="${l}">${l}</option>`).join('');
  const catSel = document.getElementById('new-cat');
  catSel.innerHTML = MERCADONA_ZONES.map(z => `<option value="${z}">${z}</option>`).join('');

  const filterBar = document.getElementById('loc-filter');
  const opts = [{k: 'all', label: 'Todo'}, ...LOCATIONS.map(l => ({k: l, label: l}))];
  filterBar.innerHTML = opts.map(o =>
    `<button class="chip ${o.k === locFilter ? 'active' : ''}" data-loc="${o.k}">${o.label}</button>`
  ).join('');
  filterBar.querySelectorAll('.chip').forEach(c => {
    c.addEventListener('click', () => {
      locFilter = c.dataset.loc;
      populateSelects();
      renderHome();
    });
  });
}

// ---------- Render: Home / Inventario ----------
function renderHome() {
  const q = (document.getElementById('search-input').value || '').toLowerCase().trim();
  const list = document.getElementById('inventory-list');
  list.innerHTML = '';

  // Metrics
  const toBuy = data.filter(p => p.stock <= p.min).length;
  document.getElementById('m-tobuy').textContent = toBuy;
  document.getElementById('m-total').textContent = data.length;
  document.getElementById('m-zero').textContent = data.filter(p => p.stock === 0).length;

  // Shop badge
  const badge = document.getElementById('shop-badge');
  if (toBuy > 0) { badge.textContent = toBuy; badge.style.display = 'inline-block'; }
  else { badge.style.display = 'none'; }

  // Filter
  let filtered = data.filter(p => {
    if (q && !p.name.toLowerCase().includes(q)) return false;
    if (locFilter !== 'all' && p.location !== locFilter) return false;
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">🍽</div>Sin resultados</div>`;
    return;
  }

  // Group by location (always — that's the home-physical logic)
  const grouped = {};
  filtered.forEach(p => {
    const k = p.location || 'Otros';
    (grouped[k] = grouped[k] || []).push(p);
  });
  const orderedLocs = LOCATIONS.filter(l => grouped[l]);

  orderedLocs.forEach(loc => {
    const h = document.createElement('div');
    h.className = 'cat-header';
    h.textContent = loc;
    list.appendChild(h);
    grouped[loc].sort((a, b) => a.name.localeCompare(b.name)).forEach(p => {
      list.appendChild(renderItem(p));
    });
  });
}

function renderItem(p) {
  const isZero = p.stock === 0;
  const isLow = p.stock > 0 && p.stock <= p.min;
  const el = document.createElement('div');
  el.className = 'item' + (isZero ? ' zero' : (isLow ? ' low' : ''));
  const badge = isZero
    ? '<span class="badge danger">agotado</span>'
    : (isLow ? '<span class="badge warn">falta</span>' : '');
  el.innerHTML = `
    <div class="item-main">
      <div class="item-name">${escapeHtml(p.name)}${badge}</div>
      <div class="item-meta">Stock ${p.stock} · mín ${p.min} · ${escapeHtml(p.zone || '')}</div>
    </div>
    <div class="qty-controls">
      <button class="qty-btn dec" data-act="dec">−</button>
      <span class="qty-display">${p.stock}</span>
      <button class="qty-btn" data-act="inc">+</button>
    </div>`;
  el.querySelector('[data-act="inc"]').addEventListener('click', () => changeStock(p.id, 1));
  el.querySelector('[data-act="dec"]').addEventListener('click', () => changeStock(p.id, -1));
  return el;
}

function changeStock(id, delta) {
  const p = data.find(x => x.id === id);
  if (!p) return;
  p.stock = Math.max(0, p.stock + delta);
  saveData();
  renderAll();
}

// ---------- Render: Lista de la compra ----------
function renderShop() {
  const needed = data.filter(p => p.stock <= p.min);
  const list = document.getElementById('shop-list');
  const confirmWrap = document.getElementById('shop-confirm-wrap');
  const progWrap = document.getElementById('shop-progress-wrap');
  list.innerHTML = '';

  if (needed.length === 0) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">🎉</div>Todo por encima del mínimo<br><span style="font-size:12px;">No hay nada que comprar</span></div>`;
    confirmWrap.style.display = 'none';
    progWrap.style.display = 'none';
    return;
  }
  confirmWrap.style.display = 'block';

  // Progress: count checked vs total
  const checkedCount = needed.filter(p => shopState[p.id]).length;
  progWrap.style.display = checkedCount > 0 ? 'block' : 'none';
  document.getElementById('shop-checked').textContent = checkedCount;
  document.getElementById('shop-total').textContent = needed.length;
  const pct = needed.length ? Math.round((checkedCount / needed.length) * 100) : 0;
  document.getElementById('shop-fill').style.width = pct + '%';

  // Group by Mercadona zone, in shopping order
  const grouped = {};
  needed.forEach(p => {
    const k = p.zone || 'Otros';
    (grouped[k] = grouped[k] || []).push(p);
  });
  const orderedZones = MERCADONA_ZONES.filter(z => grouped[z]);

  orderedZones.forEach(zone => {
    const h = document.createElement('div');
    h.className = 'cat-header';
    h.textContent = zone;
    list.appendChild(h);
    grouped[zone].sort((a, b) => a.name.localeCompare(b.name)).forEach(p => {
      const qty = Math.max(1, p.min - p.stock + 1);
      const checked = !!shopState[p.id];
      const row = document.createElement('div');
      row.className = 'shop-item' + (checked ? ' bought' : '');
      row.innerHTML = `
        <div class="shop-check ${checked ? 'checked' : ''}">${checked ? '✓' : ''}</div>
        <div class="shop-info">
          <div class="shop-name">${escapeHtml(p.name)}</div>
          <div class="shop-qty">Comprar ${qty} · stock ${p.stock}/${p.min} · ${escapeHtml(p.location || '')}</div>
        </div>`;
      row.addEventListener('click', () => {
        shopState[p.id] = !shopState[p.id];
        saveShopState();
        renderShop();
      });
      list.appendChild(row);
    });
  });
}

function buildShoppingText() {
  const needed = data.filter(p => p.stock <= p.min);
  if (needed.length === 0) return '🎉 Lista vacía, todo en orden.';
  const grouped = {};
  needed.forEach(p => { (grouped[p.zone || 'Otros'] = grouped[p.zone || 'Otros'] || []).push(p); });
  const orderedZones = MERCADONA_ZONES.filter(z => grouped[z]);
  let txt = '🛒 *Lista de la compra*\n';
  orderedZones.forEach(zone => {
    txt += `\n*${zone}*\n`;
    grouped[zone].sort((a, b) => a.name.localeCompare(b.name)).forEach(p => {
      const q = Math.max(1, p.min - p.stock + 1);
      txt += `• ${p.name} (x${q})\n`;
    });
  });
  return txt.trim();
}

document.getElementById('btn-whatsapp').addEventListener('click', () => {
  const txt = buildShoppingText();
  const url = 'https://wa.me/?text=' + encodeURIComponent(txt);
  window.open(url, '_blank');
});

document.getElementById('btn-copy').addEventListener('click', async () => {
  const txt = buildShoppingText();
  try {
    await navigator.clipboard.writeText(txt);
    toast('Lista copiada');
  } catch (e) {
    prompt('Copia manualmente:', txt);
  }
});

document.getElementById('btn-confirm-shop').addEventListener('click', () => {
  const checkedIds = Object.keys(shopState).filter(k => shopState[k]);
  if (checkedIds.length === 0) {
    toast('Marca productos antes de confirmar');
    return;
  }
  showDialog({
    title: 'Confirmar compra',
    msg: `Vas a sumar al stock ${checkedIds.length} producto(s) y guardar la compra en el histórico.`,
    confirmText: 'Confirmar',
    onConfirm: () => {
      const items = [];
      checkedIds.forEach(id => {
        const p = data.find(x => x.id === id);
        if (!p) return;
        const toAdd = Math.max(1, p.min - p.stock + 1);
        items.push({ name: p.name, qty: toAdd, zone: p.zone });
        p.stock += toAdd;
      });
      history.unshift({
        date: new Date().toISOString(),
        items: items
      });
      shopState = {};
      saveData(); saveHistory(); saveShopState();
      renderAll();
      toast('Compra registrada');
      setTab('home');
    }
  });
});

// ---------- Render: Histórico ----------
function renderHistory() {
  const list = document.getElementById('history-list');
  list.innerHTML = '';
  if (history.length === 0) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">📦</div>Sin compras registradas todavía</div>`;
    return;
  }
  history.forEach((h, idx) => {
    const d = new Date(h.date);
    const dateStr = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const totalItems = h.items.reduce((s, i) => s + (i.qty || 1), 0);
    const row = document.createElement('div');
    row.className = 'history-item';
    const detailId = 'hdet-' + idx;
    row.innerHTML = `
      <div class="history-date">${dateStr.charAt(0).toUpperCase() + dateStr.slice(1)} · ${timeStr}</div>
      <div class="history-summary">${h.items.length} productos · ${totalItems} unidades</div>
      <button class="history-toggle" data-target="${detailId}">Ver detalle ▾</button>
      <div class="history-detail" id="${detailId}" style="display:none;"></div>`;
    const detailEl = row.querySelector('#' + detailId);
    const grouped = {};
    h.items.forEach(it => { (grouped[it.zone || 'Otros'] = grouped[it.zone || 'Otros'] || []).push(it); });
    const orderedZones = MERCADONA_ZONES.filter(z => grouped[z]);
    detailEl.textContent = orderedZones.map(z =>
      `${z}\n` + grouped[z].map(it => `  • ${it.name} (x${it.qty})`).join('\n')
    ).join('\n\n');
    row.querySelector('.history-toggle').addEventListener('click', e => {
      const t = e.currentTarget;
      const det = document.getElementById(t.dataset.target);
      const open = det.style.display !== 'none';
      det.style.display = open ? 'none' : 'block';
      t.textContent = open ? 'Ver detalle ▾' : 'Ocultar ▴';
    });
    list.appendChild(row);
  });
}

// ---------- Render: Gestionar ----------
function renderManage() {
  const list = document.getElementById('manage-list');
  list.innerHTML = '';
  if (data.length === 0) {
    list.innerHTML = `<div class="empty">No hay productos</div>`;
    return;
  }
  data.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(p => {
    const row = document.createElement('div');
    row.className = 'manage-row';
    row.innerHTML = `
      <input type="text" value="${escapeAttr(p.name)}" data-f="name" />
      <input type="number" class="num-input" value="${p.stock}" min="0" inputmode="numeric" data-f="stock" />
      <input type="number" class="num-input" value="${p.min}" min="0" inputmode="numeric" data-f="min" />
      <button class="delete-btn" title="Eliminar">×</button>`;
    // Inline edit
    row.querySelectorAll('[data-f]').forEach(inp => {
      inp.addEventListener('change', () => {
        const f = inp.dataset.f;
        if (f === 'name') p.name = inp.value;
        else p[f] = Math.max(0, parseInt(inp.value) || 0);
        saveData();
        renderHome();
      });
    });
    // Tap on name area opens detail editor (location + zone)
    row.querySelector('[data-f="name"]').addEventListener('focus', () => {
      // also expose loc/zone via a small inline action: long-press or double-tap is too clever.
      // simpler: show a quick prompt-style dialog.
    });
    row.querySelector('[data-f="name"]').addEventListener('dblclick', () => editFull(p));
    // Delete
    row.querySelector('.delete-btn').addEventListener('click', () => {
      showDialog({
        title: 'Eliminar producto',
        msg: `¿Eliminar "${p.name}" del inventario? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        danger: true,
        onConfirm: () => {
          data = data.filter(x => x.id !== p.id);
          saveData();
          renderAll();
          toast('Producto eliminado');
        }
      });
    });
    // Long-press / right-click to edit location + zone
    let pressTimer = null;
    row.addEventListener('touchstart', () => {
      pressTimer = setTimeout(() => editFull(p), 600);
    });
    row.addEventListener('touchend', () => { if (pressTimer) clearTimeout(pressTimer); });
    row.addEventListener('touchmove', () => { if (pressTimer) clearTimeout(pressTimer); });
    list.appendChild(row);
  });
}

function editFull(p) {
  // Modal-like dialog with location and zone selects
  const dlg = document.createElement('div');
  dlg.className = 'dialog-bg';
  dlg.innerHTML = `
    <div class="dialog">
      <h3>Editar producto</h3>
      <div class="form-grid">
        <div class="form-field">
          <label>Nombre</label>
          <input type="text" id="ef-name" value="${escapeAttr(p.name)}" />
        </div>
        <div class="form-grid two">
          <div class="form-field">
            <label>Ubicación</label>
            <select id="ef-loc">${LOCATIONS.map(l => `<option value="${l}" ${l===p.location?'selected':''}>${l}</option>`).join('')}</select>
          </div>
          <div class="form-field">
            <label>Zona Mercadona</label>
            <select id="ef-zone">${MERCADONA_ZONES.map(z => `<option value="${z}" ${z===p.zone?'selected':''}>${z}</option>`).join('')}</select>
          </div>
        </div>
      </div>
      <div class="dialog-actions" style="margin-top:16px;">
        <button id="ef-cancel">Cancelar</button>
        <button class="confirm" id="ef-save">Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('#ef-cancel').addEventListener('click', () => dlg.remove());
  dlg.querySelector('#ef-save').addEventListener('click', () => {
    p.name = dlg.querySelector('#ef-name').value.trim() || p.name;
    p.location = dlg.querySelector('#ef-loc').value;
    p.zone = dlg.querySelector('#ef-zone').value;
    saveData();
    renderAll();
    dlg.remove();
    toast('Producto actualizado');
  });
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });
}

// Add product
document.getElementById('btn-add').addEventListener('click', () => {
  const name = document.getElementById('new-name').value.trim();
  const stock = parseInt(document.getElementById('new-stock').value) || 0;
  const min = parseInt(document.getElementById('new-min').value) || 0;
  const location = document.getElementById('new-loc').value;
  const zone = document.getElementById('new-cat').value;
  if (!name) { toast('Introduce un nombre'); return; }
  data.push({ id: uid(), name, stock: Math.max(0, stock), min: Math.max(0, min), location, zone });
  saveData();
  document.getElementById('new-name').value = '';
  document.getElementById('new-stock').value = 0;
  document.getElementById('new-min').value = 1;
  renderAll();
  toast(`"${name}" añadido`);
});

// ---------- Settings / data ----------
document.getElementById('settings-btn').addEventListener('click', () => {
  const dlg = document.createElement('div');
  dlg.className = 'dialog-bg';
  dlg.innerHTML = `
    <div class="dialog">
      <h3>Ajustes y datos</h3>
      <p>Tus datos se guardan en este navegador. Haz copia de seguridad regularmente.</p>
      <div class="form-grid">
        <button id="set-export">Exportar copia (JSON)</button>
        <button id="set-import">Importar copia (JSON)</button>
        <button id="set-clear-history">Borrar histórico de compras</button>
        <button id="set-reset" style="color:var(--danger);">Reiniciar todo</button>
      </div>
      <div class="dialog-actions" style="margin-top:16px;">
        <button id="set-close">Cerrar</button>
      </div>
      <input type="file" id="import-file" accept=".json" style="display:none;" />
    </div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('#set-close').addEventListener('click', () => dlg.remove());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });

  dlg.querySelector('#set-export').addEventListener('click', () => {
    const payload = { data, history, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `despensa-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  dlg.querySelector('#set-import').addEventListener('click', () => {
    dlg.querySelector('#import-file').click();
  });
  dlg.querySelector('#import-file').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(r.result);
        const newData = Array.isArray(parsed) ? parsed : parsed.data;
        if (!Array.isArray(newData)) throw new Error();
        data = newData.map(p => ({
          id: p.id || uid(),
          name: p.name,
          stock: p.stock || 0,
          min: p.min || 0,
          location: p.location || 'Otros',
          zone: p.zone || p.category || 'Otros'
        }));
        if (parsed.history && Array.isArray(parsed.history)) history = parsed.history;
        saveData(); saveHistory();
        dlg.remove();
        renderAll();
        toast('Datos importados');
      } catch {
        toast('Archivo no válido');
      }
    };
    r.readAsText(f);
  });

  dlg.querySelector('#set-clear-history').addEventListener('click', () => {
    showDialog({
      title: 'Borrar histórico',
      msg: '¿Borrar todas las compras registradas? Los productos del inventario no se ven afectados.',
      confirmText: 'Borrar histórico',
      danger: true,
      onConfirm: () => {
        history = [];
        saveHistory();
        dlg.remove();
        renderAll();
        toast('Histórico borrado');
      }
    });
  });

  dlg.querySelector('#set-reset').addEventListener('click', () => {
    showDialog({
      title: 'Reiniciar todo',
      msg: 'Esto borrará TODOS los productos y el histórico, y restaurará los productos de ejemplo. ¿Continuar?',
      confirmText: 'Reiniciar',
      danger: true,
      onConfirm: () => {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(HISTORY_KEY);
        localStorage.removeItem(SHOP_STATE_KEY);
        data = loadData();
        history = [];
        shopState = {};
        dlg.remove();
        renderAll();
        toast('Datos reiniciados');
      }
    });
  });
});

// ---------- Search ----------
document.getElementById('search-input').addEventListener('input', renderHome);

// ---------- Utilities ----------
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function escapeAttr(s) { return escapeHtml(s); }

function toast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2700);
}

function showDialog({ title, msg, confirmText = 'Confirmar', danger = false, onConfirm }) {
  const dlg = document.createElement('div');
  dlg.className = 'dialog-bg';
  dlg.innerHTML = `
    <div class="dialog">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(msg)}</p>
      <div class="dialog-actions">
        <button id="dlg-cancel">Cancelar</button>
        <button class="confirm ${danger ? 'danger' : ''}" id="dlg-ok">${escapeHtml(confirmText)}</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('#dlg-cancel').addEventListener('click', () => dlg.remove());
  dlg.querySelector('#dlg-ok').addEventListener('click', () => {
    dlg.remove();
    if (onConfirm) onConfirm();
  });
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });
}

function renderAll() {
  renderHome();
  renderShop();
  renderHistory();
  renderManage();
}

// ---------- Service worker registration ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

// ---------- Init ----------
populateSelects();
renderAll();
