import {
  ZONES, LOCATIONS, MEAL_SLOTS, UNITS, UNIT_MAP,
  listenProducts, addProduct, updateProduct, deleteProduct,
  listenRecipes, addRecipe, updateRecipe, deleteRecipe,
  listenMenu, setMealSlot,
  listenHistory, addHistoryEntry, deleteHistoryEntry,
  listenInspirations, addInspiration, deleteInspiration
} from "./data.js";
import {
  extractWeeklyMenuFromPdf
} from "./pdf-import.js";
import {
  db, doc, setDoc, onSnapshot, updateDoc
} from "./firebase-config.js";

// ---------- Estado local (reflejo de Firestore, actualizado por listeners) ----------
let products = [];
let recipes = [];
let menuByDate = {};
let history = [];
let inspirations = [];
let shoppingChecked = {}; // { productId: true }
let selectedDayOffset = 0;
let selectedLocation = "Todas";
let dishAddSearch = {}; // "slot-idx" -> { open, filter }
let menuScrolledToToday = false;
let syncFlags = { products: false, recipes: false, menu: false, history: false, shopping: false, inspirations: false };

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const escapeHtml = s => (s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const needsRestock = p => !!p.needsBuy;
const unitOf = p => UNIT_MAP[p.unit] || UNIT_MAP.ud;
const COUNT_UNITS = ["ud", "bolsa", "bote", "paquete"];
const ZONE_COLOR = {
  "Platos preparados": "#C97C4A",
  "Bebidas": "#4A90A4",
  "Frutas y verduras": "#6B9B4F",
  "Patatas fritas y verdura congelada": "#6FA8C9",
  "Chocolate, helados y congelados": "#8B5E83",
  "Pescadería": "#3E7C8C",
  "Huevos, arroz y pasta": "#D4A24C",
  "Carnes": "#B4514A",
  "Embutidos y quesos": "#C9A227",
  "Baño": "#7C9AA6",
  "Leche y yogures": "#8FA6B8",
  "Pan y desayuno": "#C89050",
  "Café y zumos": "#7A5230",
  "Limpieza": "#5B8266",
  "Otros": "#9B9B9B"
};
const colorFor = p => ZONE_COLOR[p.zone] || "#9B9B9B";
const stepFor = p => (p.customStep != null ? p.customStep : unitOf(p).step);
const fmtNum = n => { const r = Math.round((n + Number.EPSILON) * 100) / 100; return Number.isInteger(r) ? String(r) : String(r); };
const fmtQty = p => { const u = unitOf(p); return `${fmtNum(p.stock)} ${u.short}`; };
const DOW = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];

// ---------- Estado de compra compartido (doc único en Firestore) ----------
const shoppingDocRef = doc(db, "state", "shopping");
onSnapshot(shoppingDocRef, snap => {
  shoppingChecked = snap.exists() ? (snap.data().checked || {}) : {};
  syncFlags.shopping = true;
  renderAll();
});
function setShoppingChecked(productId, val) {
  const next = { ...shoppingChecked, [productId]: val };
  setDoc(shoppingDocRef, { checked: next }, { merge: true });
}
function clearShoppingCheckedFor(ids) {
  const next = { ...shoppingChecked };
  ids.forEach(id => delete next[id]);
  setDoc(shoppingDocRef, { checked: next }, { merge: false });
}

// ---------- Listeners ----------
listenProducts(items => { products = items; syncFlags.products = true; renderAll(); });
listenRecipes(items => { recipes = items; syncFlags.recipes = true; renderAll(); });
listenMenu(map => { menuByDate = map; syncFlags.menu = true; renderAll(); });
listenHistory(items => { history = items; syncFlags.history = true; renderAll(); });
listenInspirations(items => { inspirations = items; syncFlags.inspirations = true; renderAll(); });

function updateSyncStatus() {
  const allOk = Object.values(syncFlags).every(Boolean);
  $("#syncStatus").textContent = allOk ? "" : "Sincronizando…";
}

// ---------- Navegación de pestañas ----------
$$(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});
function scrollToSelectedDay() {
  setTimeout(() => {
    const container = $("#dayTabs");
    const activeTab = $(`.day-tab[data-offset="${selectedDayOffset}"]`);
    if (container && activeTab) {
      const target = activeTab.offsetLeft - (container.clientWidth / 2) + (activeTab.clientWidth / 2);
      if (typeof container.scrollTo === "function") {
        container.scrollTo({ left: target, behavior: "auto" });
      } else {
        container.scrollLeft = target;
      }
    }
  }, 60);
}

function switchView(name) {
  $$(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  $$(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + name));
  $("#fabAdd").style.display = name === "inventario" ? "flex" : "none";
  $("#fabNewRecipe").style.display = name === "menu" ? "flex" : "none";
  if (name === "menu" && !menuScrolledToToday) {
    menuScrolledToToday = true;
    scrollToSelectedDay();
  }
}

// ---------- Fechas ----------
function dateStrFor(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}
function labelFor(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  if (offset === 0) return { dname: "Hoy", dnum: `${d.getDate()}` };
  if (offset === 1) return { dname: "Mañana", dnum: `${d.getDate()}` };
  if (offset === -1) return { dname: "Ayer", dnum: `${d.getDate()}` };
  return { dname: DOW[d.getDay()], dnum: `${d.getDate()}` };
}

function offsetForDate(targetDate) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t = new Date(targetDate); t.setHours(0, 0, 0, 0);
  return Math.round((t - today) / 86400000);
}

const MONTH_NAMES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

function openCalendarPicker() {
  const base = new Date();
  base.setDate(base.getDate() + selectedDayOffset);
  let viewYear = base.getFullYear();
  let viewMonth = base.getMonth();

  const render = () => {
    const first = new Date(viewYear, viewMonth, 1);
    const startWeekday = (first.getDay() + 6) % 7; // lunes = 0
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const todayStr = dateStrFor(0);
    const selDateStr = dateStrFor(selectedDayOffset);

    let cells = "";
    for (let i = 0; i < startWeekday; i++) cells += `<div class="cal-day"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const cellDate = new Date(viewYear, viewMonth, d);
      const cellDateStr = `${viewYear}-${String(viewMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      const cls = ["cal-day"];
      if (cellDateStr === todayStr) cls.push("today");
      if (cellDateStr === selDateStr) cls.push("selected");
      const dots = MEAL_SLOTS.filter(slot => getDishes(cellDateStr, slot.id).length > 0)
        .map(slot => `<span class="cal-dot" style="background:${slot.color}"></span>`).join("");
      cells += `<div class="${cls.join(" ")}" data-date="${cellDateStr}">
        <span class="cal-daynum">${d}</span>
        <span class="cal-dots">${dots}</span>
      </div>`;
    }

    const html = `
      <div class="overlay" id="ovCal">
        <div class="sheet">
          <h3>Ir a una fecha</h3>
          <div class="cal-nav">
            <button id="cal-prev">‹</button>
            <span class="cal-title">${MONTH_NAMES[viewMonth]} ${viewYear}</span>
            <button id="cal-next">›</button>
          </div>
          <div class="cal-grid">
            ${["L","M","X","J","V","S","D"].map(d => `<div class="cal-dow">${d}</div>`).join("")}
            ${cells}
          </div>
          <div class="sheet-actions" style="margin-top:10px;">
            <button class="btn btn-secondary btn-block" id="cal-cancel">Cerrar</button>
          </div>
        </div>
      </div>`;
    $("#modalRoot").innerHTML = html;
    $("#cal-cancel").addEventListener("click", closeSheet);
    $("#ovCal").addEventListener("click", e => { if (e.target.id === "ovCal") closeSheet(); });
    $("#cal-prev").addEventListener("click", () => { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } render(); });
    $("#cal-next").addEventListener("click", () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } render(); });
    $$('.cal-day[data-date]').forEach(cell => cell.addEventListener("click", () => {
      selectedDayOffset = offsetForDate(cell.dataset.date);
      closeSheet();
      renderMenu();
      scrollToSelectedDay();
    }));
  };
  render();
}

// ==================================================================
// RENDER: INVENTARIO
// ==================================================================

function renderInventario() {
  if (products.length === 0) {
    $("#invLocTabs").innerHTML = "";
    $("#invList").innerHTML = emptyState("🧺", "Tu despensa está vacía", "Pulsa el botón + para añadir tu primer producto.");
    return;
  }

  // Selector de ubicación (para no tener que hacer scroll por todas)
  const locTabs = ["Todas", ...LOCATIONS];
  $("#invLocTabs").innerHTML = locTabs.map(loc => {
    const count = loc === "Todas" ? products.length : products.filter(p => p.location === loc).length;
    return `<button class="day-tab loc-tab ${selectedLocation === loc ? "active" : ""}" data-loc="${escapeHtml(loc)}">
      <span class="dname">${escapeHtml(loc)}</span><span class="dnum">${count}</span>
    </button>`;
  }).join("");
  $$(".loc-tab").forEach(b => b.addEventListener("click", () => { selectedLocation = b.dataset.loc; renderInventario(); }));

  const visible = selectedLocation === "Todas" ? products : products.filter(p => p.location === selectedLocation);
  const byLocation = {};
  visible.forEach(p => { (byLocation[p.location] ||= []).push(p); });
  Object.values(byLocation).forEach(list => list.sort((a, b) => a.name.localeCompare(b.name, "es")));

  let html = "";
  LOCATIONS.forEach(loc => {
    if (!byLocation[loc]) return;
    if (selectedLocation === "Todas") html += `<div class="zone-group"><div class="zone-title">${escapeHtml(loc)}</div>`;
    else html += `<div class="zone-group">`;
    html += `<div class="prod-grid">`;
    byLocation[loc].forEach(p => {
      const marked = needsRestock(p);
      html += `
        <div class="prod-card" data-id="${p.id}">
          <div class="prod-card-top">
            <button class="cart-toggle ${marked ? "on" : ""}" data-cart="${p.id}" title="Marcar para comprar">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="9" cy="20" r="1.4" fill="currentColor" stroke="none"/>
                <circle cx="18" cy="20" r="1.4" fill="currentColor" stroke="none"/>
                <path d="M2.5 3h2.2l1.9 11.4a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6l1.4-7.4H6.1"/>
              </svg>
            </button>
          </div>
          <div class="prod-card-name">${escapeHtml(p.name)}</div>
          <div class="stepper compact prod-card-stepper">
            <button data-act="dec" data-id="${p.id}">−</button>
            <span class="val">${fmtQty(p)}</span>
            <button data-act="inc" data-id="${p.id}">+</button>
          </div>
        </div>`;
    });
    html += `</div></div>`;
  });
  $("#invList").innerHTML = html;
}

$("#invList").addEventListener("click", e => {
  const cartBtn = e.target.closest("[data-cart]");
  if (cartBtn) {
    const p = products.find(x => x.id === cartBtn.dataset.cart);
    if (p) updateProduct(p.id, { needsBuy: !p.needsBuy });
    return;
  }
  const btn = e.target.closest("button[data-act]");
  if (btn) {
    const p = products.find(x => x.id === btn.dataset.id);
    if (!p) return;
    const step = stepFor(p);
    const raw = btn.dataset.act === "inc" ? p.stock + step : Math.max(0, p.stock - step);
    const next = Math.round((raw + Number.EPSILON) * 100) / 100;
    updateProduct(p.id, { stock: next });
    return;
  }
  const row = e.target.closest(".prod-card");
  if (row) openProductSheet(products.find(x => x.id === row.dataset.id));
});
let pressTimer = null;
$("#invList").addEventListener("touchstart", e => {
  const row = e.target.closest(".prod-card");
  if (!row) return;
  pressTimer = setTimeout(() => openProductSheet(products.find(x => x.id === row.dataset.id)), 480);
});
$("#invList").addEventListener("touchend", () => clearTimeout(pressTimer));
$("#invList").addEventListener("touchmove", () => clearTimeout(pressTimer));

$("#fabAdd").addEventListener("click", () => openProductSheet(null));
$("#fabNewRecipe").addEventListener("click", () => openRecipeEditor(null));
$("#btnOpenCalendar").addEventListener("click", () => openCalendarPicker());

function openProductSheet(product) {
  const editing = !!product;
  const p = product || { name: "", zone: ZONES[0], location: "Despensa", stock: 1, unit: "ud", note: "", needsBuy: false };
  let noteOpen = !!(p.note && p.note.trim());
  let currentNote = p.note || "";

  const render = () => {
    const html = `
    <div class="overlay" id="ov">
      <div class="sheet">
        <h3>${editing ? "Editar producto" : "Añadir producto"}</h3>
        <input type="text" id="f-name" class="re-name-input" value="${escapeHtml(p.name)}" placeholder="Nombre del producto">

        <div class="field-row">
          <div class="field"><label>Ubicación</label>
            <select id="f-location">${LOCATIONS.map(l => `<option ${l===p.location?"selected":""}>${l}</option>`).join("")}</select>
          </div>
          <div class="field"><label>Zona</label>
            <select id="f-zone">${ZONES.map(z => `<option ${z===p.zone?"selected":""}>${escapeHtml(z)}</option>`).join("")}</select>
          </div>
        </div>
        <div class="field-row">
          <div class="field"><label>Unidad</label>
            <select id="f-unit">${UNITS.map(u => `<option value="${u.id}" ${(p.unit||"ud")===u.id?"selected":""}>${u.label}</option>`).join("")}</select>
          </div>
          <div class="field"><label>Stock actual</label><input type="number" id="f-stock" value="${p.stock}" min="0" step="any"></div>
        </div>

        <div class="check-field-highlight" id="f-halfstep-wrap" style="display:${COUNT_UNITS.includes(p.unit||"ud")?"flex":"none"};">
          <input type="checkbox" id="f-halfstep" ${p.customStep === 1 ? "" : "checked"}>
          <label for="f-halfstep">⚖️ Permitir medias unidades (1/2 aguacate). Desmárcalo si siempre es entero, como los huevos.</label>
        </div>

        ${noteOpen
          ? `<div class="field"><input type="text" id="f-note" value="${escapeHtml(currentNote)}" placeholder="Nota — ej. cada bolsa lleva 4 filetes"></div>`
          : `<button class="re-toggle-link" id="f-openNote">📝 Añadir nota</button>`}

        <div class="check-field"><input type="checkbox" id="f-needbuy" ${p.needsBuy ? "checked" : ""}><label for="f-needbuy" style="margin:0;">Necesario para la compra</label></div>
        <div class="sheet-actions">
          ${editing ? `<button class="btn btn-danger" id="f-delete">Eliminar</button>` : ""}
          <button class="btn btn-secondary" id="f-cancel">Cancelar</button>
          <button class="btn btn-primary" id="f-save">Guardar</button>
        </div>
      </div>
    </div>`;
    $("#modalRoot").innerHTML = html;
    $("#f-unit").addEventListener("change", e => {
      $("#f-halfstep-wrap").style.display = COUNT_UNITS.includes(e.target.value) ? "flex" : "none";
    });
    $("#f-cancel").addEventListener("click", closeSheet);
    $("#ov").addEventListener("click", e => { if (e.target.id === "ov") closeSheet(); });
    $("#f-openNote")?.addEventListener("click", () => { noteOpen = true; render(); $("#f-note").focus(); });
    $("#f-note")?.addEventListener("input", e => { currentNote = e.target.value; });
    if (editing) {
      $("#f-delete").addEventListener("click", () => {
        openConfirm("Eliminar producto", `¿Seguro que quieres eliminar "${p.name}"?`, "Eliminar", () => {
          deleteProduct(p.id);
          closeSheet();
        }, true);
      });
    }
    $("#f-save").addEventListener("click", () => {
      const name = $("#f-name").value.trim();
      if (!name) { $("#f-name").focus(); return; }
      const unitVal = $("#f-unit").value;
      const patch = {
        name,
        location: $("#f-location").value,
        zone: $("#f-zone").value,
        unit: unitVal,
        stock: Number($("#f-stock").value) || 0,
        note: currentNote.trim(),
        needsBuy: $("#f-needbuy").checked,
        customStep: COUNT_UNITS.includes(unitVal) && !$("#f-halfstep").checked ? 1 : null
      };
      if (editing) updateProduct(p.id, patch); else addProduct(patch);
      closeSheet();
    });
  };
  render();
}
function closeSheet() { $("#modalRoot").innerHTML = ""; }

function openConfirm(title, text, confirmText, onConfirm, danger) {
  const html = `
    <div class="overlay" id="ovc">
      <div class="sheet">
        <h3>${escapeHtml(title)}</h3>
        <p style="font-size:14px;color:var(--text-soft);margin:0 0 16px;">${escapeHtml(text)}</p>
        <div class="sheet-actions">
          <button class="btn btn-secondary" id="c-cancel">Cancelar</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="c-ok">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    </div>`;
  $("#modalRoot").innerHTML = html;
  $("#c-cancel").addEventListener("click", closeSheet);
  $("#ovc").addEventListener("click", e => { if (e.target.id === "ovc") closeSheet(); });
  $("#c-ok").addEventListener("click", onConfirm);
}

function emptyState(glyph, title, text) {
  return `<div class="empty"><div class="glyph">${glyph}</div><div class="title">${escapeHtml(title)}</div><p>${escapeHtml(text)}</p></div>`;
}

// ==================================================================
// RENDER: MENÚ SEMANAL
// ==================================================================
function getSlotData(dateStr, slotId) {
  const raw = (menuByDate[dateStr] || {})[slotId];
  if (!raw) return { dishes: [], cooked: null };
  if (Array.isArray(raw)) return { dishes: raw, cooked: null }; // formato anterior (array suelto)
  if (raw.dishes) return { dishes: raw.dishes, cooked: raw.cooked || null }; // formato actual
  return { dishes: [raw], cooked: null }; // formato más antiguo (un solo plato)
}

function getDishes(dateStr, slotId) {
  return getSlotData(dateStr, slotId).dishes;
}

function saveDishes(dateStr, slotId, dishes) {
  const { cooked } = getSlotData(dateStr, slotId);
  return setMealSlot(dateStr, slotId, { dishes, cooked });
}

function saveCooked(dateStr, slotId, cooked) {
  const { dishes } = getSlotData(dateStr, slotId);
  return setMealSlot(dateStr, slotId, { dishes, cooked });
}

function removeDish(dateStr, slotId, idx) {
  const dishes = getDishes(dateStr, slotId).filter((_, i) => i !== idx);
  saveDishes(dateStr, slotId, dishes);
}

function renderMenu() {
  let tabs = "";
  const rangeStart = Math.min(-60, selectedDayOffset - 5);
  const rangeEnd = Math.max(14, selectedDayOffset + 5);
  for (let i = rangeStart; i <= rangeEnd; i++) {
    const l = labelFor(i);
    tabs += `<button class="day-tab ${i===selectedDayOffset?"active":""}" data-offset="${i}">
      <span class="dname">${l.dname}</span><span class="dnum">${l.dnum}</span>
    </button>`;
  }
  $("#dayTabs").innerHTML = tabs;
  $$(".day-tab").forEach(b => b.addEventListener("click", () => { selectedDayOffset = Number(b.dataset.offset); renderMenu(); scrollToSelectedDay(); }));
  const dateStr = dateStrFor(selectedDayOffset);
  let html = "";
  MEAL_SLOTS.forEach(slot => {
    const { dishes, cooked } = getSlotData(dateStr, slot.id);

    if (cooked) {
      // ---- Franja ya confirmada: resumen fijo, sin edición directa ----
      const dishNamesLabel = (cooked.dishNames && cooked.dishNames.length ? cooked.dishNames : dishes.map(d => d.recipeName || d.freeText || "").filter(Boolean)).join(", ");
      const rows = (cooked.items || []).map(it => {
        const p = products.find(x => x.id === it.productId);
        const nowStock = p ? fmtNum(p.stock) : "?";
        return `
          <div class="dish-ing-row cooked">
            <span class="dish-ing-name">${escapeHtml(it.name)}<span class="dish-ing-have">usaste ${fmtNum(it.amount)} ${escapeHtml(it.unit||"")}</span></span>
            <span class="dish-ing-after">ahora ${nowStock} ${escapeHtml(it.unit||"")}</span>
          </div>`;
      }).join("");
      html += `
        <div class="meal-card" data-slot="${slot.id}">
          <div class="slot-band" style="background:${slot.color};">${slot.label}</div>
          <div class="meal-card-body">
            <div class="dish-row cooked-title">
              <span class="dish-name">${escapeHtml(dishNamesLabel || slot.label)}</span>
              <span class="cooked-badge">Cocinado</span>
            </div>
            ${rows}
            <div class="meal-actions">
              <button class="mini-link" data-act="modify-cooked" data-slot="${slot.id}">✏️ Modificar</button>
            </div>
          </div>
        </div>`;
      return;
    }

    // ---- Franja pendiente: edición normal ----
    const aggByProduct = {}; // para el botón "Cocinar" de toda la franja

    const dishBlocks = dishes.map((d, idx) => {
      const name = d.recipeName || d.freeText || "";
      const recipe = d.recipeId ? recipes.find(r => r.id === d.recipeId) : null;
      const pool = recipe ? Object.fromEntries((recipe.ingredients || []).filter(i => i.productId && i.amount != null).map(i => [i.productId, i.amount])) : {};
      const unmeasuredNames = recipe ? (recipe.ingredients || []).filter(i => i.unmeasured).map(i => i.name).filter(Boolean) : [];
      const active = d.customIngredients || pool; // lo que se muestra y se puede editar en línea

      Object.entries(active).forEach(([pid, amt]) => { aggByProduct[pid] = (aggByProduct[pid] || 0) + amt; });

      const rows = Object.entries(active).map(([pid, amt]) => {
        const p = products.find(x => x.id === pid);
        if (!p) return "";
        const after = Math.round((p.stock - (Number(amt) || 0) + Number.EPSILON) * 100) / 100;
        const u = unitOf(p).short;
        return `
          <div class="dish-ing-row">
            <span class="dish-ing-name">${escapeHtml(p.name)}<span class="dish-ing-have">tienes ${fmtNum(p.stock)}</span></span>
            <input type="number" step="any" min="0" class="dish-ing-input" data-dish-ing-amount="${pid}" data-slot="${slot.id}" data-idx="${idx}" value="${amt}">
            <span class="dish-ing-unit">${u}</span>
            <span class="dish-ing-after ${after<0?"neg":""}">→ ${fmtNum(after)}</span>
            <button class="dish-remove" data-act="remove-dish-ing" data-slot="${slot.id}" data-idx="${idx}" data-pid="${pid}" title="No usado esta vez">×</button>
          </div>`;
      }).join("");

      return `
        <div class="dish-row">
          <span class="dish-name" data-act="edit-meal" data-slot="${slot.id}" data-idx="${idx}">${escapeHtml(name)}</span>
          <button class="dish-remove" data-act="remove-dish" data-slot="${slot.id}" data-idx="${idx}" title="Quitar este plato">×</button>
        </div>
        ${rows}
        ${unmeasuredNames.length ? `<div class="unmeasured-note">También lleva: ${unmeasuredNames.map(escapeHtml).join(", ")} (no medido)</div>` : ""}
        ${recipe ? (() => {
          const key = `${slot.id}-${idx}`;
          const state = dishAddSearch[key];
          if (!state || !state.open) {
            return `<button class="add-ing-link" data-act="toggle-add-ing" data-slot="${slot.id}" data-idx="${idx}">+ Añadir ingrediente</button>`;
          }
          const candidates = products
            .filter(p => !(p.id in active) && p.name.toLowerCase().includes((state.filter||"").toLowerCase()))
            .sort((a, b) => a.name.localeCompare(b.name, "es"))
            .slice(0, 6);
          return `
            <input type="text" class="dish-add-search" data-slot="${slot.id}" data-idx="${idx}" placeholder="Buscar producto…" value="${escapeHtml(state.filter||"")}" style="margin-bottom:6px;">
            <div style="border:1px solid var(--border);border-radius:var(--radius-s);margin-bottom:10px;max-height:160px;overflow-y:auto;">
              ${candidates.length === 0 ? `<div style="padding:10px;font-size:12px;color:var(--text-soft);">Sin coincidencias.</div>` : candidates.map(p => `
                <div class="pick-row" data-act="pick-dish-ing" data-slot="${slot.id}" data-idx="${idx}" data-pid="${p.id}" style="cursor:pointer;padding:8px 10px;">
                  <div class="pick-name">${escapeHtml(p.name)}</div>
                  <span class="ing-unit">${unitOf(p).short}</span>
                </div>`).join("")}
            </div>
          `;
        })() : ""}
      `;
    }).join("");

    const aggIng = Object.entries(aggByProduct);

    html += `
      <div class="meal-card" data-slot="${slot.id}">
        <div class="slot-band" style="background:${slot.color};">${slot.label}</div>
        <div class="meal-card-body">
          ${dishBlocks}
          ${dishes.length === 0 ? `
            <button class="add-meal-btn" data-act="edit-meal" data-slot="${slot.id}">
              <span class="add-meal-plus">+</span>
              <span>Añadir plato</span>
            </button>
          ` : `
            <button class="add-dish-link" data-act="edit-meal" data-slot="${slot.id}">+ Añadir otro plato</button>
          `}
          ${aggIng.length ? `<div class="meal-actions"><button class="btn btn-primary" data-act="cook-meal" data-slot="${slot.id}">🍳 Cocinar ${slot.label.toLowerCase()}</button></div>` : ""}
        </div>
      </div>`;
  });
  $("#menuBody").innerHTML = html;

  $$('[data-act="edit-meal"]').forEach(b => b.addEventListener("click", () => {
    const idx = b.dataset.idx !== undefined ? Number(b.dataset.idx) : null;
    openMealSheet(dateStr, b.dataset.slot, idx);
  }));
  $$('[data-act="modify-cooked"]').forEach(b => b.addEventListener("click", () => modifyCooked(dateStr, b.dataset.slot)));
  $$('[data-dish-ing-amount]').forEach(inp => {
    inp.addEventListener("click", e => e.stopPropagation());
    inp.addEventListener("focus", () => inp.select());
    inp.addEventListener("change", () => {
      const { slot, idx } = inp.dataset;
      const dishes = getDishes(dateStr, slot);
      const d = dishes[Number(idx)];
      const recipe = d.recipeId ? recipes.find(r => r.id === d.recipeId) : null;
      const pool = recipe ? Object.fromEntries((recipe.ingredients || []).filter(i => i.productId && i.amount != null).map(i => [i.productId, i.amount])) : {};
      const active = { ...(d.customIngredients || pool) };
      active[inp.dataset.dishIngAmount] = inp.value === "" ? 0 : Number(inp.value);
      dishes[Number(idx)] = { ...d, customIngredients: active };
      saveDishes(dateStr, slot, dishes);
    });
  });
  $$('[data-act="remove-dish-ing"]').forEach(btn => btn.addEventListener("click", e => {
    e.stopPropagation();
    const { slot, idx, pid } = btn.dataset;
    const dishes = getDishes(dateStr, slot);
    const d = dishes[Number(idx)];
    const recipe = d.recipeId ? recipes.find(r => r.id === d.recipeId) : null;
    const pool = recipe ? Object.fromEntries((recipe.ingredients || []).filter(i => i.productId && i.amount != null).map(i => [i.productId, i.amount])) : {};
    const active = { ...(d.customIngredients || pool) };
    delete active[pid];
    dishes[Number(idx)] = { ...d, customIngredients: active };
    saveDishes(dateStr, slot, dishes);
  }));
  $$('[data-act="toggle-add-ing"]').forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    const key = `${b.dataset.slot}-${b.dataset.idx}`;
    dishAddSearch[key] = { open: true, filter: "" };
    renderMenu();
  }));
  const dsInput = $(".dish-add-search");
  if (dsInput) {
    dsInput.focus();
    dsInput.selectionStart = dsInput.selectionEnd = dsInput.value.length;
    dsInput.addEventListener("click", e => e.stopPropagation());
    dsInput.addEventListener("input", e => {
      const key = `${dsInput.dataset.slot}-${dsInput.dataset.idx}`;
      dishAddSearch[key] = { open: true, filter: e.target.value };
      renderMenu();
    });
  }
  $$('[data-act="pick-dish-ing"]').forEach(row => row.addEventListener("click", e => {
    e.stopPropagation();
    const { slot, idx, pid } = row.dataset;
    const dishes = getDishes(dateStr, slot);
    const d = dishes[Number(idx)];
    const recipe = d.recipeId ? recipes.find(r => r.id === d.recipeId) : null;
    const pool = recipe ? Object.fromEntries((recipe.ingredients || []).filter(i => i.productId && i.amount != null).map(i => [i.productId, i.amount])) : {};
    const active = { ...(d.customIngredients || pool), [pid]: 1 };
    dishes[Number(idx)] = { ...d, customIngredients: active };
    delete dishAddSearch[`${slot}-${idx}`];
    saveDishes(dateStr, slot, dishes);
  }));
  $$('[data-act="remove-dish"]').forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    removeDish(dateStr, b.dataset.slot, Number(b.dataset.idx));
  }));
  $$('[data-act="cook-meal"]').forEach(b => b.addEventListener("click", () => cookMeal(dateStr, b.dataset.slot)));
}

// Selector genérico de ingredientes (checks + cantidad + buscar más), reutilizado por
// "Cocinar" y por "Ajustar ingredientes" de un plato concreto.
function openIngredientPickerSheet({ title, hint, pool, initialSelected, confirmLabel, onConfirm }) {
  const selected = { ...initialSelected };
  let filterText = "";

  const render = () => {
    const poolIds = Object.keys(pool);
    const extraIds = Object.keys(selected).filter(id => !pool[id] && selected[id] != null);
    const filtered = products
      .filter(p => !(p.id in pool) && !(p.id in selected) && p.name.toLowerCase().includes(filterText.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .slice(0, 6);

    const rowHtml = (pid, isPoolItem) => {
      const p = products.find(x => x.id === pid);
      if (!p) return "";
      const checked = pid in selected;
      const amt = checked ? selected[pid] : pool[pid];
      const u = unitOf(p).short;
      const after = checked ? Math.round((p.stock - (Number(amt) || 0) + Number.EPSILON) * 100) / 100 : null;
      return `
        <div class="pick-row">
          <div class="checkbox ${checked ? "on" : ""}" data-toggle-pid="${pid}" data-default-amt="${pool[pid] ?? 1}">${checked ? "✓" : ""}</div>
          <div class="pick-name">
            <div class="pick-name-title">${escapeHtml(p.name)}</div>
            <div class="pick-name-sub have">tienes ${fmtNum(p.stock)} ${u}</div>
            ${checked ? `<div class="pick-name-sub after ${after<0?"neg":""}">quedaría ${fmtNum(after)} ${u}</div>` : ""}
          </div>
          ${checked ? `<input type="number" step="any" min="0" data-cook-amount="${pid}" value="${amt}">` : ""}
          ${checked ? `<span class="ing-unit">${u}</span>` : ""}
          ${!isPoolItem && checked ? `<button class="dish-remove" data-remove-extra="${pid}" title="Quitar">×</button>` : ""}
        </div>`;
    };

    const html = `
      <div class="overlay" id="ovC">
        <div class="sheet">
          <h3>${title}</h3>
          <div style="font-size:12.5px;color:var(--text-soft);margin-bottom:10px;">${hint}</div>
          <div id="cookRows">
            ${poolIds.map(pid => rowHtml(pid, true)).join("")}
            ${extraIds.map(pid => rowHtml(pid, false)).join("")}
          </div>
          <div class="field"><label>Añadir algo que no suele llevar</label>
            <input type="text" id="cook-filter" placeholder="Buscar producto…" value="${escapeHtml(filterText)}">
          </div>
          ${filterText ? `
            <div style="border:1px solid var(--border);border-radius:var(--radius-s);margin-bottom:14px;max-height:180px;overflow-y:auto;">
              ${filtered.length === 0 ? `<div style="padding:10px;font-size:12.5px;color:var(--text-soft);">Sin coincidencias.</div>` : filtered.map(p => `
                <div class="pick-row" data-add-pid="${p.id}" style="cursor:pointer;">
                  <div class="pick-name">${escapeHtml(p.name)}</div>
                  <span class="ing-unit">${unitOf(p).short}</span>
                </div>`).join("")}
            </div>
          ` : ""}
          <div class="sheet-actions">
            <button class="btn btn-secondary" id="cook-cancel">Cancelar</button>
            <button class="btn btn-primary" id="cook-confirm">${confirmLabel}</button>
          </div>
        </div>
      </div>`;
    $("#modalRoot").innerHTML = html;
    $("#cook-cancel").addEventListener("click", closeSheet);
    $("#ovC").addEventListener("click", e => { if (e.target.id === "ovC") closeSheet(); });

    $$('[data-toggle-pid]').forEach(box => {
      box.addEventListener("click", () => {
        const pid = box.dataset.togglePid;
        if (pid in selected) delete selected[pid];
        else selected[pid] = Number(box.dataset.defaultAmt) || 1;
        render();
      });
    });
    $$('[data-cook-amount]').forEach(inp => {
      inp.addEventListener("click", e => e.stopPropagation());
      inp.addEventListener("input", () => { selected[inp.dataset.cookAmount] = inp.value === "" ? 0 : Number(inp.value); });
      inp.addEventListener("change", () => render());
      inp.addEventListener("focus", () => inp.select());
    });
    $$('[data-remove-extra]').forEach(btn => btn.addEventListener("click", e => {
      e.stopPropagation();
      delete selected[btn.dataset.removeExtra];
      render();
    }));

    const fInput = $("#cook-filter");
    fInput.addEventListener("input", e => { filterText = e.target.value; render(); });
    if (filterText) { fInput.focus(); fInput.selectionStart = fInput.selectionEnd = fInput.value.length; }
    $$('[data-add-pid]').forEach(row => row.addEventListener("click", () => {
      selected[row.dataset.addPid] = 1;
      filterText = "";
      render();
    }));

    $("#cook-confirm").addEventListener("click", () => {
      const entries = Object.entries(selected).filter(([, amt]) => amt > 0);
      onConfirm(entries);
    });
  };
  render();
}

function cookMeal(dateStr, slotId) {
  const dishes = getDishes(dateStr, slotId);
  const pool = {}; // productId -> cantidad habitual (el conjunto de ingredientes que suele usar esta franja)
  const initialSelected = {}; // parte de lo que ya se ve activo en la vista previa de cada plato
  dishes.forEach(d => {
    if (!d.recipeId) return;
    const r = recipes.find(x => x.id === d.recipeId);
    if (!r) return;
    (r.ingredients || []).forEach(ing => {
      if (!ing.productId || ing.amount == null) return;
      pool[ing.productId] = (pool[ing.productId] || 0) + ing.amount;
    });
    const dishPool = Object.fromEntries((r.ingredients || []).filter(i => i.productId && i.amount != null).map(i => [i.productId, i.amount]));
    const active = d.customIngredients || dishPool;
    Object.entries(active).forEach(([pid, amt]) => {
      initialSelected[pid] = (initialSelected[pid] || 0) + amt;
    });
  });
  if (Object.keys(pool).length === 0) return;

  const slotLabel = MEAL_SLOTS.find(s => s.id === slotId)?.label || "";
  openIngredientPickerSheet({
    title: "Cocinar " + slotLabel.toLowerCase(),
    hint: "Marca lo que habéis usado esta vez — nada se resta hasta que lo selecciones.",
    pool,
    initialSelected,
    confirmLabel: "Cocinar",
    onConfirm: (entries) => {
      if (entries.length === 0) { closeSheet(); return; }
      openConfirm(
        "Confirmar",
        "Se restará esto de tu inventario y quedará guardado en el Historial. Los ingredientes habituales de la receta no cambian, solo lo que va a pasar ahora.",
        "Cocinar",
        () => {
          entries.forEach(([pid, amt]) => {
            const p = products.find(x => x.id === pid);
            if (!p) return;
            const next = Math.round((p.stock - amt + Number.EPSILON) * 100) / 100;
            updateProduct(p.id, { stock: next });
          });
          const items = entries.map(([pid, amt]) => {
            const p = products.find(x => x.id === pid);
            return { productId: pid, name: p ? p.name : "", amount: amt, unit: p ? unitOf(p).short : "" };
          });
          const dishNames = dishes.map(d => d.recipeName || d.freeText || "").filter(Boolean);
          saveCooked(dateStr, slotId, { items, dishNames });
          closeSheet();
        }
      );
    }
  });
}

function modifyCooked(dateStr, slotId) {
  const { cooked } = getSlotData(dateStr, slotId);
  if (!cooked) return;
  const dishes = getDishes(dateStr, slotId);
  const pool = {};
  dishes.forEach(d => {
    if (!d.recipeId) return;
    const r = recipes.find(x => x.id === d.recipeId);
    if (!r) return;
    (r.ingredients || []).forEach(ing => {
      if (!ing.productId || ing.amount == null) return;
      pool[ing.productId] = (pool[ing.productId] || 0) + ing.amount;
    });
  });
  const initialSelected = {};
  (cooked.items || []).forEach(it => { initialSelected[it.productId] = it.amount; });

  const slotLabel = MEAL_SLOTS.find(s => s.id === slotId)?.label || "";
  openIngredientPickerSheet({
    title: "Modificar " + slotLabel.toLowerCase(),
    hint: "Ajusta lo que realmente se usó. Solo se corrige la diferencia en tu inventario, no se vuelve a restar todo.",
    pool,
    initialSelected,
    confirmLabel: "Guardar cambios",
    onConfirm: (entries) => {
      openConfirm(
        "Guardar cambios",
        "Se ajustará tu inventario según la diferencia con lo anterior.",
        "Guardar",
        () => {
          const oldMap = {};
          (cooked.items || []).forEach(it => { oldMap[it.productId] = it.amount; });
          const newMap = Object.fromEntries(entries);
          const allIds = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
          allIds.forEach(pid => {
            const delta = (newMap[pid] || 0) - (oldMap[pid] || 0);
            if (!delta) return;
            const p = products.find(x => x.id === pid);
            if (!p) return;
            const next = Math.round((p.stock - delta + Number.EPSILON) * 100) / 100;
            updateProduct(p.id, { stock: next });
          });
          const items = entries.map(([pid, amt]) => {
            const p = products.find(x => x.id === pid);
            return { productId: pid, name: p ? p.name : "", amount: amt, unit: p ? unitOf(p).short : "" };
          });
          if (items.length === 0) {
            saveCooked(dateStr, slotId, null); // ya no queda nada usado: vuelve a pendiente
          } else {
            saveCooked(dateStr, slotId, { items, dishNames: cooked.dishNames });
          }
          closeSheet();
        }
      );
    }
  });
}

function openMealSheet(dateStr, slotId, dishIndex) {
  const slotLabel = MEAL_SLOTS.find(s=>s.id===slotId).label;
  const dayLabel = labelFor(selectedDayOffset).dname;
  const isEditingDish = dishIndex !== null && dishIndex !== undefined;
  const currentDish = isEditingDish ? getDishes(dateStr, slotId)[dishIndex] : null;

  const applyDish = (value) => {
    const dishes = getDishes(dateStr, slotId);
    if (isEditingDish) dishes[dishIndex] = value;
    else dishes.push(value);
    saveDishes(dateStr, slotId, dishes);
  };

  const renderHome = () => {
    const html = `
      <div class="overlay" id="ov">
        <div class="sheet">
          <h3>${isEditingDish ? "Modificar plato" : "Añadir plato"} · ${slotLabel} — ${escapeHtml(dayLabel)}</h3>
          <div class="option-card" id="opt-existing">
            <div class="oc-icon">📖</div>
            <div class="oc-text">
              <div class="oc-title">Elegir receta guardada</div>
              <div class="oc-sub">${recipes.length ? `${recipes.length} receta(s) en tu recetario` : "Aún no tienes ninguna guardada"}</div>
            </div>
            <div class="oc-chevron">›</div>
          </div>
          <div class="option-card" id="opt-suggest">
            <div class="oc-icon">💡</div>
            <div class="oc-text">
              <div class="oc-title">Qué puedo cocinar</div>
              <div class="oc-sub">Recetas ordenadas por lo que ya tienes</div>
            </div>
            <div class="oc-chevron">›</div>
          </div>
          <div class="option-card" id="opt-new">
            <div class="oc-icon">✨</div>
            <div class="oc-text">
              <div class="oc-title">Crear receta nueva</div>
              <div class="oc-sub">Con ingredientes y cantidades de tu despensa</div>
            </div>
            <div class="oc-chevron">›</div>
          </div>
          <div class="option-card" id="opt-inspiration">
            <div class="oc-icon">💭</div>
            <div class="oc-text">
              <div class="oc-title">Buscar inspiración</div>
              <div class="oc-sub">Tus enlaces guardados</div>
            </div>
            <div class="oc-chevron">›</div>
          </div>
          <div class="option-card" id="opt-free">
            <div class="oc-icon">✏️</div>
            <div class="oc-text">
              <div class="oc-title">Apunte rápido</div>
              <div class="oc-sub">Solo un texto, sin receta guardada</div>
            </div>
            <div class="oc-chevron">›</div>
          </div>
          <div class="sheet-actions" style="margin-top:4px;">
            <button class="btn btn-secondary btn-block" id="m-cancel">Cancelar</button>
          </div>
        </div>
      </div>`;
    $("#modalRoot").innerHTML = html;
    $("#m-cancel").addEventListener("click", closeSheet);
    $("#ov").addEventListener("click", e => { if (e.target.id === "ov") closeSheet(); });
    $("#opt-existing").addEventListener("click", renderPickExisting);
    $("#opt-suggest").addEventListener("click", () => openSuggestionsSheet());
    $("#opt-new").addEventListener("click", () => {
      openRecipeEditor(null, (id, name) => {
        applyDish({ recipeId: id, recipeName: name });
      });
    });
    $("#opt-inspiration").addEventListener("click", () => openInspirationSheet());
    $("#opt-free").addEventListener("click", renderFreeText);
  };

  const renderPickExisting = () => {
    const html = `
      <div class="overlay" id="ovR">
        <div class="sheet">
          <h3>${slotLabel} — ${escapeHtml(dayLabel)}</h3>
          ${recipes.length === 0
            ? emptyState("📖", "Sin recetas guardadas", "Vuelve atrás y crea la primera con \"Crear receta nueva\".")
            : recipes.map(r => `
              <div class="option-card" data-rid="${r.id}">
                <div class="oc-icon">🍽️</div>
                <div class="oc-text">
                  <div class="oc-title">${escapeHtml(r.name)}</div>
                  <div class="oc-sub">${(r.ingredients||[]).length} ingrediente(s)${r.url ? " · con enlace" : ""}</div>
                </div>
                <button class="oc-edit" data-edit-rid="${r.id}" title="Editar receta">✏️</button>
              </div>`).join("")}
          <div class="sheet-actions" style="margin-top:4px;">
            <button class="btn btn-secondary btn-block" id="m-back">‹ Volver</button>
          </div>
        </div>
      </div>`;
    $("#modalRoot").innerHTML = html;
    $("#m-back").addEventListener("click", renderHome);
    $("#ovR").addEventListener("click", e => { if (e.target.id === "ovR") closeSheet(); });
    $$('[data-edit-rid]').forEach(btn => btn.addEventListener("click", e => {
      e.stopPropagation();
      openRecipeEditor(recipes.find(x => x.id === btn.dataset.editRid), () => renderPickExisting());
    }));
    $$('[data-rid]').forEach(card => card.addEventListener("click", () => {
      const r = recipes.find(x => x.id === card.dataset.rid);
      applyDish({ recipeId: r.id, recipeName: r.name });
      closeSheet();
    }));
  };

  const renderFreeText = () => {
    const html = `
      <div class="overlay" id="ovF">
        <div class="sheet">
          <h3>${isEditingDish ? "Modificar plato" : "Añadir plato"} · ${slotLabel} — ${escapeHtml(dayLabel)}</h3>
          <div class="field"><label>Escribe algo suelto (sin receta guardada)</label>
            <input type="text" id="m-free" placeholder="Ej. Cenar fuera, pizza congelada…" value="${currentDish && !currentDish.recipeId ? escapeHtml(currentDish.freeText||"") : ""}">
          </div>
          <div class="sheet-actions">
            <button class="btn btn-secondary" id="m-back">‹ Volver</button>
            <button class="btn btn-primary" id="m-save">Guardar</button>
          </div>
        </div>
      </div>`;
    $("#modalRoot").innerHTML = html;
    $("#m-back").addEventListener("click", renderHome);
    $("#ovF").addEventListener("click", e => { if (e.target.id === "ovF") closeSheet(); });
    $("#m-free").focus();
    $("#m-save").addEventListener("click", () => {
      const free = $("#m-free").value.trim();
      if (!free) { closeSheet(); return; }
      applyDish({ recipeId: null, freeText: free });
      closeSheet();
    });
  };

  renderHome();
}

// ---------- Recetas ----------
function openRecipesSheet() {
  const html = `
    <div class="overlay" id="ov">
      <div class="sheet">
        <h3>Recetas</h3>
        <div id="recipeList">${recipes.length ? "" : `<p style="font-size:13px;color:var(--text-soft);">Aún no tienes recetas guardadas.</p>`}</div>
        ${recipes.map(r => `
          <div class="product-row" data-rid="${r.id}">
            <div class="product-info">
              <div class="product-name">${escapeHtml(r.name)}</div>
              <div class="product-meta">${(r.ingredients||[]).length} ingrediente(s)${r.url ? ` · <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" style="color:var(--primary);">🔗 receta</a>` : ""}</div>
            </div>
            <button class="mini-link" data-act="edit-recipe" data-rid="${r.id}">Editar</button>
          </div>`).join("")}
        <div class="sheet-actions" style="margin-top:14px;">
          <button class="btn btn-secondary" id="r-close">Cerrar</button>
          <button class="btn btn-primary" id="r-new">Nueva receta</button>
        </div>
      </div>
    </div>`;
  $("#modalRoot").innerHTML = html;
  $("#r-close").addEventListener("click", closeSheet);
  $("#ov").addEventListener("click", e => { if (e.target.id === "ov") closeSheet(); });
  $("#r-new").addEventListener("click", () => openRecipeEditor(null));
  $$('[data-act="edit-recipe"]').forEach(b => b.addEventListener("click", () => openRecipeEditor(recipes.find(r => r.id === b.dataset.rid))));
}

function openRecipeEditor(recipe, onSaved) {
  const editing = !!(recipe && recipe.id);
  const initial = recipe ? [...(recipe.ingredients||[])] : [];
  const linkedAmounts = {}; // productId -> amount
  const unmeasured = {}; // productId -> true si es "no medir" (no resta del inventario)
  initial.filter(i => i.productId).forEach(i => {
    linkedAmounts[i.productId] = i.amount ?? "";
    if (i.unmeasured) unmeasured[i.productId] = true;
  });
  let filterText = "";
  let currentName = recipe?.name || "";
  let currentUrl = recipe?.url || "";
  let currentNotes = recipe?.notes || "";
  let urlOpen = !!currentUrl;
  let notesOpen = !!currentNotes;

  const render = () => {
    const selectedPids = Object.keys(linkedAmounts).filter(pid => linkedAmounts[pid] !== "" || unmeasured[pid]);
    const html = `
      <div class="overlay" id="ov2">
        <div class="sheet">
          <h3>${editing ? "Editar receta" : "Nueva receta"}</h3>
          <input type="text" id="re-name" class="re-name-input" value="${escapeHtml(currentName)}" placeholder="Nombre de la receta">

          ${urlOpen
            ? `<div class="field"><input type="text" id="re-url" value="${escapeHtml(currentUrl)}" placeholder="https://enlace a la receta"></div>`
            : `<button class="re-toggle-link" id="re-openUrl">🔗 Añadir enlace</button>`}

          <div id="selectedIngRows">
            ${selectedPids.map(pid => {
              const p = products.find(x => x.id === pid);
              if (!p) return "";
              const isUnmeasured = !!unmeasured[pid];
              return `
                <div class="pick-row">
                  <div class="pick-name">
                    <div class="pick-name-title">${escapeHtml(p.name)}</div>
                    ${!isUnmeasured ? `<div class="pick-name-sub have">tienes ${fmtNum(p.stock)} ${unitOf(p).short}</div>` : ""}
                  </div>
                  ${isUnmeasured
                    ? `<span class="unmeasured-tag">no se mide</span>`
                    : `<input type="number" step="any" min="0" data-pid-amount="${p.id}" value="${linkedAmounts[pid]}">
                       <span class="ing-unit">${unitOf(p).short}</span>`}
                  <button class="dish-remove" data-remove-linked="${p.id}" title="Quitar">×</button>
                </div>
                <div class="unmeasured-toggle">
                  <input type="checkbox" id="um-${pid}" data-toggle-unmeasured="${pid}" ${isUnmeasured ? "checked" : ""}>
                  <label for="um-${pid}">⚖️ No medir</label>
                </div>`;
            }).join("")}
          </div>

          <input type="text" id="re-filter" class="re-search-input" placeholder="🔍 Buscar ingrediente para añadir…" value="${escapeHtml(filterText)}">
          <div id="ingPicker" class="ing-chip-picker">
            ${(() => {
              const candidates = products.filter(p => !((p.id in linkedAmounts && linkedAmounts[p.id] !== "") || unmeasured[p.id]) && p.name.toLowerCase().includes(filterText.toLowerCase()));
              if (candidates.length === 0) return `<div style="padding:12px 4px;font-size:12.5px;color:var(--text-soft);">Sin productos que coincidan.</div>`;
              const byLoc = {};
              candidates.forEach(p => { (byLoc[p.location] ||= []).push(p); });
              Object.values(byLoc).forEach(list => list.sort((a, b) => a.name.localeCompare(b.name, "es")));
              return LOCATIONS.filter(loc => byLoc[loc]).map(loc => `
                <div class="ing-chip-loc">${escapeHtml(loc)}</div>
                <div class="ing-chip-wrap">
                  ${byLoc[loc].map(p => `<button class="ing-chip" data-add-linked="${p.id}">${escapeHtml(p.name)}</button>`).join("")}
                </div>
              `).join("");
            })()}
          </div>

          ${notesOpen
            ? `<div class="field" style="margin-top:14px;"><textarea id="re-notes" placeholder="Notas, pasos…">${escapeHtml(currentNotes)}</textarea></div>`
            : `<button class="re-toggle-link" id="re-openNotes" style="margin-top:10px;">📝 Añadir notas</button>`}

          <div class="sheet-actions">
            ${editing ? `<button class="btn btn-danger" id="re-delete">Eliminar</button>` : ""}
            <button class="btn btn-secondary" id="re-cancel">Cancelar</button>
            <button class="btn btn-primary" id="re-save">Guardar</button>
          </div>
        </div>
      </div>`;
    $("#modalRoot").innerHTML = html;
    $("#re-cancel").addEventListener("click", closeSheet);
    $("#ov2").addEventListener("click", e => { if (e.target.id === "ov2") closeSheet(); });
    $("#re-name").addEventListener("input", e => { currentName = e.target.value; });

    $("#re-openUrl")?.addEventListener("click", () => { urlOpen = true; render(); $("#re-url").focus(); });
    $("#re-url")?.addEventListener("input", e => { currentUrl = e.target.value; });
    $("#re-openNotes")?.addEventListener("click", () => { notesOpen = true; render(); $("#re-notes").focus(); });
    $("#re-notes")?.addEventListener("input", e => { currentNotes = e.target.value; });

    $("#re-filter").addEventListener("input", e => { filterText = e.target.value; render(); });
    const fInput = $("#re-filter");
    if (filterText) { fInput.focus(); fInput.selectionStart = fInput.selectionEnd = fInput.value.length; }

    $$('[data-pid-amount]').forEach(inp => {
      inp.addEventListener("click", e => e.stopPropagation());
      inp.addEventListener("change", () => {
        const pid = inp.dataset.pidAmount;
        linkedAmounts[pid] = inp.value === "" ? "" : Number(inp.value);
        render();
      });
      inp.addEventListener("focus", () => inp.select());
    });
    $$('[data-toggle-unmeasured]').forEach(box => box.addEventListener("change", () => {
      const pid = box.dataset.toggleUnmeasured;
      if (box.checked) { unmeasured[pid] = true; if (!linkedAmounts[pid]) linkedAmounts[pid] = ""; }
      else { delete unmeasured[pid]; }
      render();
    }));
    $$('[data-remove-linked]').forEach(btn => btn.addEventListener("click", () => {
      delete linkedAmounts[btn.dataset.removeLinked];
      delete unmeasured[btn.dataset.removeLinked];
      render();
    }));
    $$('[data-add-linked]').forEach(chip => chip.addEventListener("click", () => {
      linkedAmounts[chip.dataset.addLinked] = 1;
      filterText = "";
      render();
    }));

    if (editing) {
      $("#re-delete").addEventListener("click", () => {
        openConfirm("Eliminar receta", `¿Eliminar "${recipe.name}"? Los días de menú que la usan quedarán vacíos.`, "Eliminar", () => {
          deleteRecipe(recipe.id);
          closeSheet();
        }, true);
      });
    }
    $("#re-save").addEventListener("click", async () => {
      const name = $("#re-name").value.trim();
      if (!name) { $("#re-name").focus(); return; }
      const linked = Object.entries(linkedAmounts)
        .filter(([pid, amt]) => !unmeasured[pid] && amt !== "" && amt != null && Number(amt) > 0)
        .map(([pid, amt]) => {
          const p = products.find(x => x.id === pid);
          return { productId: pid, name: p ? p.name : "", amount: Number(amt) };
        });
      const unmeasuredIng = Object.keys(unmeasured).map(pid => {
        const p = products.find(x => x.id === pid);
        return { productId: pid, name: p ? p.name : "", amount: null, unmeasured: true };
      });
      const cleanIng = [...linked, ...unmeasuredIng];
      const patch = { name, ingredients: cleanIng, notes: currentNotes.trim(), url: currentUrl.trim() };
      if (editing) {
        await updateRecipe(recipe.id, patch);
        closeSheet();
        if (onSaved) onSaved(recipe.id, name);
      } else {
        const ref = await addRecipe(patch);
        closeSheet();
        if (onSaved) onSaved(ref.id, name);
      }
    });
  };
  render();
}

// ---------- Sugerencias: qué puedo cocinar con lo que tengo ----------
function computeRecipeMatches() {
  const withIng = recipes.filter(r => (r.ingredients || []).length > 0);
  const scored = withIng.map(r => {
    const total = r.ingredients.length;
    const have = r.ingredients.filter(ing => {
      const p = products.find(x => x.id === ing.productId);
      return p && p.stock > 0;
    });
    const missing = r.ingredients.filter(ing => {
      const p = products.find(x => x.id === ing.productId);
      return !(p && p.stock > 0);
    }).map(ing => ing.name);
    return { recipe: r, haveCount: have.length, total, missing, pct: have.length / total };
  });
  scored.sort((a, b) => b.pct - a.pct || b.total - a.total);
  return { scored, withoutIngredients: recipes.length - withIng.length };
}

// ---------- Importar semana (Comida/Cena) desde el PDF de la dietista ----------
function openImportWeekSheet() {
  let parsedDays = null;
  let status = "";
  let startDate = dateStrFor(0); // por defecto, hoy = Día 1

  const render = () => {
    const html = `
      <div class="overlay" id="ovW">
        <div class="sheet">
          <h3>Importar semana (PDF)</h3>
          <div class="field"><label>PDF del plan (la tabla semanal, ej. página 2 de DietoPro)</label>
            <input type="file" id="w-file" accept="application/pdf">
          </div>
          <div class="field"><label>¿Qué fecha es el "Día 1" del PDF?</label>
            <input type="date" id="w-start" value="${startDate}">
          </div>
          ${status ? `<div class="tip">${status}</div>` : ""}
          ${!parsedDays ? `
            <button class="btn btn-primary btn-block" id="w-analyze" style="margin-top:6px;">Analizar PDF</button>
          ` : `
            <div style="font-size:12px;color:var(--text-soft);margin-bottom:10px;">Revisa y corrige antes de confirmar.</div>
            <div id="w-list">
              ${parsedDays.map((d, i) => {
                const date = new Date(startDate + "T00:00:00");
                date.setDate(date.getDate() + i);
                const label = date.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
                return `
                <div class="meal-card">
                  <div class="slot-label">Día ${d.dayNum} — ${label}</div>
                  <div class="field" style="margin-bottom:8px;"><label>Desayuno</label><input type="text" data-day="${i}" data-slot="desayuno" value="${escapeHtml(d.desayuno||"")}"></div>
                  <div class="field" style="margin-bottom:8px;"><label>Comida</label><input type="text" data-day="${i}" data-slot="comida" value="${escapeHtml(d.comida)}"></div>
                  <div class="field" style="margin-bottom:0;"><label>Cena</label><input type="text" data-day="${i}" data-slot="cena" value="${escapeHtml(d.cena)}"></div>
                </div>`;
              }).join("")}
            </div>
          `}
          <div class="sheet-actions" style="margin-top:14px;">
            <button class="btn btn-secondary" id="w-cancel">Cancelar</button>
            ${parsedDays ? `<button class="btn btn-primary" id="w-confirm">Añadir al menú</button>` : ""}
          </div>
        </div>
      </div>`;
    $("#modalRoot").innerHTML = html;
    $("#w-cancel").addEventListener("click", closeSheet);
    $("#ovW").addEventListener("click", e => { if (e.target.id === "ovW") closeSheet(); });
    $("#w-start")?.addEventListener("change", e => { startDate = e.target.value; render(); });

    $("#w-analyze")?.addEventListener("click", async () => {
      const file = $("#w-file").files[0];
      if (!file) { status = "⚠️ Elige antes un fichero PDF."; render(); return; }
      status = "Analizando PDF…";
      render();
      try {
        const buf = await file.arrayBuffer();
        const result = await extractWeeklyMenuFromPdf(buf);
        if (!result.ok) {
          status = "⚠️ No he encontrado la tabla semanal (Día 1...7) en este PDF. ¿Es la página correcta?";
          parsedDays = null;
          render();
          return;
        }
        parsedDays = result.days;
        status = `✅ Semana detectada en la página ${result.page}. Revisa cada día antes de confirmar.`;
      } catch (e) {
        status = "⚠️ Error leyendo el PDF: " + (e.message || e);
        parsedDays = null;
      }
      render();
    });

    $$('#w-list input[data-day]').forEach(inp => {
      inp.addEventListener("input", () => {
        parsedDays[Number(inp.dataset.day)][inp.dataset.slot] = inp.value;
      });
    });

    $("#w-confirm")?.addEventListener("click", () => {
      openConfirm("Añadir al menú", "Se rellenarán Comida y Cena de estos 7 días. Si un día ya tenía algo planificado, se sobrescribirá.", "Confirmar", () => {
        parsedDays.forEach((d, i) => {
          const date = new Date(startDate + "T00:00:00");
          date.setDate(date.getDate() + i);
          const dateStr = date.toISOString().slice(0, 10);
          if (d.desayuno) setMealSlot(dateStr, "desayuno", { recipeId: null, freeText: d.desayuno });
          if (d.comida) setMealSlot(dateStr, "comida", { recipeId: null, freeText: d.comida });
          if (d.cena) setMealSlot(dateStr, "cena", { recipeId: null, freeText: d.cena });
        });
        closeSheet();
      });
    });
  };
  render();
}

function openSuggestionsSheet() {
  const { scored, withoutIngredients } = computeRecipeMatches();
  const dayLabel = labelFor(selectedDayOffset).dname;
  const dateStr = dateStrFor(selectedDayOffset);

  const rows = scored.map(s => {
    const full = s.pct === 1;
    const badgeColor = full ? "var(--primary)" : s.pct > 0 ? "var(--accent)" : "var(--text-soft)";
    return `
      <div class="product-row" style="align-items:flex-start;">
        <div class="product-info">
          <div class="product-name">${escapeHtml(s.recipe.name)}</div>
          <div class="product-meta" style="margin-bottom:4px;">
            <span class="chip" style="background:${badgeColor};color:white;">${s.haveCount}/${s.total} en casa</span>
          </div>
          ${s.missing.length ? `<div style="font-size:12px;color:var(--text-soft);">Falta: ${s.missing.map(escapeHtml).join(", ")}</div>` : ""}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <button class="btn btn-secondary" data-act="sug-slot" data-rid="${s.recipe.id}" data-slot="desayuno" style="padding:8px 10px;font-size:12.5px;">Desayuno</button>
          <button class="btn btn-secondary" data-act="sug-slot" data-rid="${s.recipe.id}" data-slot="comida" style="padding:8px 10px;font-size:12.5px;">Comida</button>
          <button class="btn btn-secondary" data-act="sug-slot" data-rid="${s.recipe.id}" data-slot="cena" style="padding:8px 10px;font-size:12.5px;">Cena</button>
        </div>
      </div>`;
  }).join("");

  const html = `
    <div class="overlay" id="ovS">
      <div class="sheet">
        <h3>Qué puedo cocinar — ${escapeHtml(dayLabel)}</h3>
        ${scored.length === 0
          ? emptyState("💡", "Sin recetas evaluables", "Vincula ingredientes a tus recetas desde \"Gestionar recetas\" para que pueda calcular qué podéis cocinar con lo que tenéis.")
          : `<div style="font-size:12.5px;color:var(--text-soft);margin-bottom:10px;">Ordenadas de más a menos aprovechamiento de tu despensa actual.</div>${rows}`}
        ${withoutIngredients > 0 ? `<div style="font-size:11.5px;color:var(--text-soft);margin-top:6px;">${withoutIngredients} receta(s) sin ingredientes vinculados no se muestran aquí.</div>` : ""}
        <div class="sheet-actions" style="margin-top:14px;">
          <button class="btn btn-secondary btn-block" id="s-close">Cerrar</button>
        </div>
      </div>
    </div>`;
  $("#modalRoot").innerHTML = html;
  $("#s-close").addEventListener("click", closeSheet);
  $("#ovS").addEventListener("click", e => { if (e.target.id === "ovS") closeSheet(); });
  $$('[data-act="sug-slot"]').forEach(b => b.addEventListener("click", () => {
    const r = recipes.find(x => x.id === b.dataset.rid);
    if (!r) return;
    const dishes = getDishes(dateStr, b.dataset.slot);
    dishes.push({ recipeId: r.id, recipeName: r.name });
    saveDishes(dateStr, b.dataset.slot, dishes);
    closeSheet();
  }));
}

// ---------- Ideas guardadas (enlaces de inspiración: web, Instagram, TikTok, YouTube...) ----------
function detectSource(url) {
  const u = url.toLowerCase();
  if (u.includes("instagram.com")) return { id: "instagram", label: "Instagram", icon: "📸" };
  if (u.includes("tiktok.com")) return { id: "tiktok", label: "TikTok", icon: "🎵" };
  if (u.includes("youtube.com") || u.includes("youtu.be")) return { id: "youtube", label: "YouTube", icon: "▶️" };
  if (u.includes("pinterest.")) return { id: "pinterest", label: "Pinterest", icon: "📌" };
  return { id: "web", label: "Web", icon: "🌐" };
}

// Extracción "mejor esfuerzo" de datos schema.org/Recipe en páginas web normales.
// Nunca funciona con Instagram/TikTok/Pinterest/YouTube (no exponen esos datos ni son accesibles así).
// Depende de un proxy CORS público gratuito (allorigins.win) que no controlamos: puede fallar sin que sea un bug.
async function tryExtractRecipe(url) {
  const src = detectSource(url);
  if (src.id !== "web") {
    return { ok: false, reason: "social" };
  }
  let html;
  try {
    const proxied = "https://api.allorigins.win/raw?url=" + encodeURIComponent(url);
    const resp = await fetch(proxied, { signal: AbortSignal.timeout(12000) });
    if (!resp.ok) return { ok: false, reason: "fetch" };
    html = await resp.text();
  } catch (e) {
    return { ok: false, reason: "fetch" };
  }

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      let data;
      try { data = JSON.parse(s.textContent); } catch (e) { continue; }
      const candidates = Array.isArray(data) ? data : (data["@graph"] || [data]);
      for (const item of candidates) {
        const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
        if (types && types.includes("Recipe")) {
          let ingredients = item.recipeIngredient || item.ingredients || [];
          if (typeof ingredients === "string") ingredients = [ingredients];
          return { ok: true, name: item.name || "", ingredients };
        }
      }
    }
    return { ok: false, reason: "no-schema" };
  } catch (e) {
    return { ok: false, reason: "parse" };
  }
}

function matchesPantry(insp) {
  return (insp.tags || []).some(t =>
    products.some(p => p.stock > 0 && (
      p.name.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(p.name.toLowerCase())
    ))
  );
}

let inspirationFilter = "";
let inspirationOnlyPantry = false;

function openInspirationSheet() {
  const render = () => {
    let list = inspirations;
    if (inspirationFilter.trim()) {
      const f = inspirationFilter.trim().toLowerCase();
      list = list.filter(i => i.title.toLowerCase().includes(f) || (i.tags || []).some(t => t.toLowerCase().includes(f)));
    }
    if (inspirationOnlyPantry) list = list.filter(matchesPantry);

    const html = `
      <div class="overlay" id="ovI">
        <div class="sheet">
          <h3>Ideas guardadas</h3>
          <div class="field"><label>Filtrar por alimento (ej. pollo, legumbres…)</label>
            <input type="text" id="i-filter" value="${escapeHtml(inspirationFilter)}" placeholder="Escribe un alimento">
          </div>
          <div class="check-field"><input type="checkbox" id="i-onlypantry" ${inspirationOnlyPantry?"checked":""}><label for="i-onlypantry" style="margin:0;">Solo con alimentos que tengo en casa ahora</label></div>
          <div id="iList">
            ${list.length === 0
              ? `<p style="font-size:13px;color:var(--text-soft);">${inspirations.length === 0 ? "Aún no has guardado ninguna idea." : "Nada coincide con ese filtro."}</p>`
              : list.map(i => {
                  const src = detectSource(i.url);
                  return `
                  <div class="product-row" style="align-items:flex-start;">
                    <div class="product-info">
                      <div class="product-name">${src.icon} ${escapeHtml(i.title || i.url)}</div>
                      <div class="product-meta" style="flex-wrap:wrap;gap:4px;">
                        ${(i.tags||[]).map(t => `<span class="chip">${escapeHtml(t)}</span>`).join("")}
                        ${matchesPantry(i) ? `<span class="chip" style="background:var(--primary);color:white;">con lo que tienes</span>` : ""}
                      </div>
                      ${(i.extractedIngredients||[]).length ? `<div style="font-size:11.5px;color:var(--text-soft);margin-top:4px;">${(i.extractedIngredients||[]).slice(0,5).map(escapeHtml).join(", ")}${i.extractedIngredients.length>5?"…":""}</div>` : ""}
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                      <a href="${escapeHtml(i.url)}" target="_blank" rel="noopener" class="btn btn-secondary" style="padding:8px 10px;font-size:12.5px;text-decoration:none;text-align:center;">Abrir</a>
                      <button class="btn btn-secondary" data-act="use-insp" data-id="${i.id}" style="padding:8px 10px;font-size:12.5px;">Usar receta</button>
                      <button class="mini-link" data-act="del-insp" data-id="${i.id}" style="color:var(--danger);font-size:12px;">Eliminar</button>
                    </div>
                  </div>`;
                }).join("")}
          </div>
          <button class="mini-link" id="i-addNew" style="margin-top:6px;">+ Guardar un enlace nuevo</button>
          <div class="sheet-actions" style="margin-top:14px;">
            <button class="btn btn-secondary btn-block" id="i-close">Cerrar</button>
          </div>
        </div>
      </div>`;
    $("#modalRoot").innerHTML = html;
    $("#i-close").addEventListener("click", closeSheet);
    $("#ovI").addEventListener("click", e => { if (e.target.id === "ovI") closeSheet(); });
    $("#i-filter").addEventListener("input", e => { inspirationFilter = e.target.value; render(); });
    $("#i-onlypantry").addEventListener("change", e => { inspirationOnlyPantry = e.target.checked; render(); });
    $("#i-addNew").addEventListener("click", openAddInspirationSheet);
    $$('[data-act="use-insp"]').forEach(b => b.addEventListener("click", () => {
      const insp = inspirations.find(x => x.id === b.dataset.id);
      if (!insp) return;
      const notes = (insp.extractedIngredients||[]).length ? "Ingredientes (sin vincular a inventario):\n" + insp.extractedIngredients.join("\n") : "";
      openRecipeEditor({ name: insp.title, url: insp.url, ingredients: [], notes });
    }));
    $$('[data-act="del-insp"]').forEach(b => b.addEventListener("click", () => {
      const insp = inspirations.find(x => x.id === b.dataset.id);
      openConfirm("Eliminar idea", `¿Eliminar "${insp?.title || insp?.url}"?`, "Eliminar", () => {
        deleteInspiration(b.dataset.id);
        closeSheet();
        openInspirationSheet();
      }, true);
    }));
  };
  render();
}

function openAddInspirationSheet() {
  let extracted = { ingredients: [] };
  let statusMsg = "";

  const render = () => {
    const html = `
      <div class="overlay" id="ovA">
        <div class="sheet">
          <h3>Guardar un enlace</h3>
          <div class="field"><label>Enlace (web, Instagram, TikTok, YouTube…)</label>
            <input type="text" id="a-url" placeholder="https://..." value="${escapeHtml($("#a-url")?.value || "")}">
          </div>
          <button class="btn btn-secondary btn-block" id="a-extract" style="margin-bottom:14px;">🔍 Intentar rellenar automáticamente</button>
          ${statusMsg ? `<div class="tip" style="margin-bottom:14px;">${statusMsg}</div>` : ""}
          <div class="field"><label>Título (para reconocerlo luego)</label>
            <input type="text" id="a-title" placeholder="Ej. Pollo al curry" value="${escapeHtml($("#a-title")?.value || "")}">
          </div>
          <div class="field"><label>Alimentos que lleva (separados por comas)</label>
            <input type="text" id="a-tags" placeholder="pollo, arroz, curry" value="${escapeHtml($("#a-tags")?.value || "")}">
          </div>
          ${extracted.ingredients.length ? `
            <div class="tip"><b>Ingredientes detectados en la web:</b><br>${extracted.ingredients.map(escapeHtml).join(", ")}</div>
          ` : ""}
          <div class="sheet-actions">
            <button class="btn btn-secondary" id="a-cancel">Cancelar</button>
            <button class="btn btn-primary" id="a-save">Guardar</button>
          </div>
        </div>
      </div>`;
    $("#modalRoot").innerHTML = html;
    $("#a-cancel").addEventListener("click", () => openInspirationSheet());
    $("#ovA").addEventListener("click", e => { if (e.target.id === "ovA") openInspirationSheet(); });

    $("#a-extract").addEventListener("click", async () => {
      const url = $("#a-url").value.trim();
      if (!url) { $("#a-url").focus(); return; }
      $("#a-extract").textContent = "Buscando…";
      $("#a-extract").disabled = true;
      const result = await tryExtractRecipe(url);
      if (result.ok) {
        if (result.name) $("#a-title").value = result.name;
        if (result.ingredients.length) {
          extracted = { ingredients: result.ingredients };
          const short = result.ingredients.slice(0, 6).map(i => i.split(",")[0].trim().toLowerCase());
          $("#a-tags").value = Array.from(new Set(short)).join(", ");
        }
        statusMsg = "✅ Encontrado y rellenado. Revisa que tenga sentido antes de guardar.";
      } else {
        const messages = {
          social: "⚠️ Esta red social no permite extracción automática — rellena el título y las etiquetas a mano.",
          fetch: "⚠️ No he podido acceder a la página (puede que el servicio intermediario esté caído). Rellena a mano.",
          "no-schema": "⚠️ Esta web no incluye la receta en un formato que pueda leer automáticamente. Rellena a mano.",
          parse: "⚠️ La página respondió pero no he podido interpretarla. Rellena a mano."
        };
        statusMsg = messages[result.reason] || messages.fetch;
      }
      render();
    });

    $("#a-save").addEventListener("click", async () => {
      const url = $("#a-url").value.trim();
      if (!url) { $("#a-url").focus(); return; }
      const title = $("#a-title").value.trim() || url;
      const tags = $("#a-tags").value.split(",").map(t => t.trim()).filter(Boolean);
      await addInspiration({ url, title, tags, source: detectSource(url).id, extractedIngredients: extracted.ingredients });
      openInspirationSheet();
    });
  };
  render();
}

// ==================================================================
// RENDER: COMPRA
// ==================================================================
function renderCompra() {
  const needed = products.filter(needsRestock);
  const total = needed.length;
  const checkedCount = needed.filter(p => shoppingChecked[p.id]).length;
  $("#shopProgressBar").style.width = total ? `${Math.round(checkedCount/total*100)}%` : "0%";
  $("#shopBadge").style.display = total > 0 ? "flex" : "none";
  $("#shopBadge").textContent = total;

  if (total === 0) {
    $("#shopList").innerHTML = emptyState("✅", "Nada que comprar", "Marca productos como \"necesario para la compra\" desde el Inventario y aparecerán aquí.");
    $("#btnConfirmPurchase").style.display = "none";
    return;
  }
  $("#btnConfirmPurchase").style.display = "block";

  const byZone = {};
  needed.forEach(p => { (byZone[p.zone] ||= []).push(p); });
  let html = "";
  ZONES.forEach(zone => {
    if (!byZone[zone]) return;
    html += `<div class="zone-group"><div class="zone-title">${escapeHtml(zone)}</div>`;
    byZone[zone].forEach(p => {
      const on = !!shoppingChecked[p.id];
      const stockLabel = fmtQty(p);
      html += `
        <div class="shop-row ${on?"checked":""}" data-id="${p.id}">
          <div class="checkbox ${on?"on":""}" data-id="${p.id}">${on ? "✓" : ""}</div>
          <div class="product-info">
            <div class="product-name">${escapeHtml(p.name)}</div>
            <div class="product-meta">tienes ${fmtQty(p)}</div>
          </div>
          <div class="shop-needed">${stockLabel}</div>
        </div>`;
    });
    html += `</div>`;
  });
  $("#shopList").innerHTML = html;
}

$("#shopList").addEventListener("click", e => {
  const box = e.target.closest(".checkbox");
  if (!box) return;
  setShoppingChecked(box.dataset.id, !shoppingChecked[box.dataset.id]);
});

$("#btnConfirmPurchase").addEventListener("click", () => {
  const needed = products.filter(p => needsRestock(p) && shoppingChecked[p.id]);
  if (needed.length === 0) {
    openConfirm("Nada marcado", "Marca los productos que has comprado antes de confirmar.", "Entendido", closeSheet);
    return;
  }
  openConfirm("Confirmar compra", `Se quitarán ${needed.length} producto(s) de la lista y quedará registrado en el historial. Recuerda actualizar el stock con +/− en el Inventario cuando los guardes.`, "Confirmar", () => {
    const items = needed.map(p => ({ name: p.name }));
    needed.forEach(p => updateProduct(p.id, { needsBuy: false }));
    addHistoryEntry({ items, type: "purchase" });
    clearShoppingCheckedFor(needed.map(p => p.id));
    closeSheet();
  });
});

$("#btnWhatsapp").addEventListener("click", () => {
  const needed = products.filter(needsRestock);
  if (needed.length === 0) return;
  const byZone = {};
  needed.forEach(p => { (byZone[p.zone] ||= []).push(p); });
  let text = "🛒 Lista de la compra:\n";
  ZONES.forEach(zone => {
    if (!byZone[zone]) return;
    text += `\n${zone}:\n`;
    byZone[zone].forEach(p => { text += `- ${p.name}\n`; });
  });
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
});

// ==================================================================
// EXPORTAR TICKET COMO ARCHIVO ÚNICO (imagen con fecha, foto y detalle)
// ==================================================================
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function buildTicketCardBlob(entry) {
  const width = 720;
  const pad = 36;
  const d = entry.createdAt?.toDate ? entry.createdAt.toDate() : new Date();
  const dateLabel = d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
  const items = entry.items || [];

  let photoImg = null;
  let photoH = 0;
  if (entry.photo) {
    try {
      photoImg = await loadImage(entry.photo);
      const maxW = width - pad * 2;
      photoH = Math.min(420, photoImg.height * (maxW / photoImg.width));
    } catch (e) {}
  }

  const rowH = 34;
  const headerH = 118;
  const total = items.reduce((s, it) => s + (parseFloat((it.price || "0").replace(",", ".")) || 0), 0);
  const height = headerH + (photoImg ? photoH + 24 : 0) + items.length * rowH + 90 + pad;

  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");

  // Fondo
  ctx.fillStyle = "#FBFAF6";
  ctx.fillRect(0, 0, width, height);

  // Cabecera
  ctx.fillStyle = "#2F5233";
  ctx.fillRect(0, 0, width, headerH);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "600 26px Georgia, serif";
  ctx.fillText("Despensa — Ticket", pad, 48);
  ctx.font = "400 15px sans-serif";
  ctx.fillStyle = "#E7EEE3";
  ctx.fillText(dateLabel, pad, 78);
  ctx.fillStyle = "#E8A33D";
  ctx.font = "600 15px sans-serif";
  ctx.fillText(`${items.length} producto(s)`, pad, 102);

  let y = headerH + 20;

  if (photoImg) {
    const maxW = width - pad * 2;
    ctx.drawImage(photoImg, pad, y, maxW, photoH);
    y += photoH + 24;
  }

  ctx.font = "400 16px sans-serif";
  items.forEach(it => {
    ctx.fillStyle = "#23241F";
    ctx.fillText(it.name, pad, y + 22);
    if (it.price) {
      ctx.textAlign = "right";
      ctx.fillText(it.price + " €", width - pad, y + 22);
      ctx.textAlign = "left";
    }
    ctx.strokeStyle = "#E4DFD3";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, y + 32);
    ctx.lineTo(width - pad, y + 32);
    ctx.stroke();
    y += rowH;
  });

  if (total > 0) {
    y += 14;
    ctx.font = "700 19px sans-serif";
    ctx.fillStyle = "#2F5233";
    ctx.fillText("Total", pad, y + 22);
    ctx.textAlign = "right";
    ctx.fillText(total.toFixed(2).replace(".", ",") + " €", width - pad, y + 22);
    ctx.textAlign = "left";
  }

  ctx.font = "400 12px sans-serif";
  ctx.fillStyle = "#A6A296";
  ctx.fillText("Guardado desde Despensa", pad, height - 16);

  return new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
}

async function exportTicket(entry) {
  const d = entry.createdAt?.toDate ? entry.createdAt.toDate() : new Date();
  const fileDate = d.toISOString().slice(0, 10);
  const filename = `ticket-despensa-${fileDate}.jpg`;
  const blob = await buildTicketCardBlob(entry);
  const file = new File([blob], filename, { type: "image/jpeg" });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) { /* usuario canceló, seguimos con la alternativa */ }
  }
  // Alternativa: abrir en pestaña nueva para guardar manualmente (mantener pulsado → guardar imagen)
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
}

// ==================================================================
// RENDER: HISTORIAL
// ==================================================================
function renderHistorial() {
  const visibleHistory = history.filter(h => h.type !== "cooked");
  if (visibleHistory.length === 0) {
    $("#histList").innerHTML = emptyState("🕓", "Sin compras registradas", "Cuando confirmes una compra, quedará aquí.");
    return;
  }
  $("#histList").innerHTML = visibleHistory.map(h => {
    const d = h.createdAt?.toDate ? h.createdAt.toDate() : new Date();
    const dateLabel = d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
    const isTicket = h.type === "ticket";
    const isCooked = h.type === "cooked";
    let headLabel, countLabel, rows;
    if (isCooked) {
      headLabel = `🍳 ${dateLabel} — ${escapeHtml(h.slotLabel || "")}`;
      countLabel = "";
      rows = `${(h.dishNames||[]).length ? `<div style="font-weight:600;margin-bottom:6px;">${escapeHtml((h.dishNames||[]).join(", "))}</div>` : ""}${(h.items || []).map(it => `<div>${escapeHtml(it.name)} — ${fmtNum(it.amount)} ${escapeHtml(it.unit||"")}</div>`).join("")}`;
    } else if (isTicket) {
      headLabel = `🧾 ${dateLabel}`;
      countLabel = `${(h.items||[]).length} producto(s)`;
      rows = (h.items || []).map(it => `<div>${escapeHtml(it.name)}${it.price ? " — " + escapeHtml(it.price) + " €" : ""}</div>`).join("");
    } else {
      headLabel = dateLabel;
      countLabel = `${(h.items||[]).length} producto(s)`;
      rows = (h.items || []).map(it => `<div>✓ ${escapeHtml(it.name)}</div>`).join("");
    }
    return `
      <div class="hist-entry" data-id="${h.id}">
        <div class="hist-head">
          <span class="hist-date">${headLabel}</span>
          <span style="display:flex;align-items:center;gap:8px;">
            <span class="hist-count">${countLabel}</span>
            ${isTicket ? `<button class="mini-link" data-act="export-ticket" data-id="${h.id}">Guardar</button>` : ""}
            ${isCooked ? `<button class="mini-link" data-act="repeat-cooked" data-id="${h.id}">🔁 Repetir hoy</button>` : ""}
            <button class="dish-remove" data-act="delete-entry" data-id="${h.id}" title="Eliminar esta entrada">×</button>
          </span>
        </div>
        <div class="hist-body">
          ${h.photo ? `<img src="${h.photo}" style="width:100%;border-radius:10px;margin-bottom:8px;">` : ""}
          ${rows}
        </div>
      </div>`;
  }).join("");
}
$("#histList").addEventListener("click", e => {
  const deleteBtn = e.target.closest('[data-act="delete-entry"]');
  if (deleteBtn) {
    e.stopPropagation();
    const entry = history.find(h => h.id === deleteBtn.dataset.id);
    if (!entry) return;
    openConfirm("Eliminar entrada", "¿Eliminar esta entrada del historial? No se puede deshacer.", "Eliminar", () => {
      deleteHistoryEntry(entry.id);
      closeSheet();
    }, true);
    return;
  }
  const repeatBtn = e.target.closest('[data-act="repeat-cooked"]');
  if (repeatBtn) {
    e.stopPropagation();
    const entry = history.find(h => h.id === repeatBtn.dataset.id);
    if (!entry) return;
    openConfirm(
      "Repetir hoy",
      `Se añadirá "${(entry.dishNames||[]).join(", ") || "este plato"}" a ${MEAL_SLOTS.find(s=>s.id===entry.slot)?.label || entry.slot} de hoy.`,
      "Añadir",
      () => {
        const todayStr = dateStrFor(0);
        const dishes = getDishes(todayStr, entry.slot);
        (entry.dishNames || []).forEach(name => dishes.push({ recipeId: null, freeText: name }));
        saveDishes(todayStr, entry.slot, dishes);
        closeSheet();
      }
    );
    return;
  }
  const exportBtn = e.target.closest('[data-act="export-ticket"]');
  if (exportBtn) {
    e.stopPropagation();
    const entry = history.find(h => h.id === exportBtn.dataset.id);
    if (!entry) return;
    exportBtn.textContent = "Generando…";
    exportTicket(entry).finally(() => { exportBtn.textContent = "Guardar"; });
    return;
  }
  const head = e.target.closest(".hist-head");
  if (!head) return;
  head.nextElementSibling.classList.toggle("open");
});

// ==================================================================
// BANNER DE RECORDATORIOS (descongelar)
// ==================================================================
$("#btnClearHistory").addEventListener("click", () => {
  const visible = history.filter(h => h.type !== "cooked");
  if (visible.length === 0) return;
  openConfirm(
    "Borrar historial",
    `Se eliminarán las ${visible.length} entrada(s) del historial (compras y tickets). No se puede deshacer.`,
    "Borrar todo",
    () => {
      visible.forEach(h => deleteHistoryEntry(h.id));
      closeSheet();
    },
    true
  );
});

// ==================================================================
// RENDER GLOBAL
// ==================================================================
function renderAll() {
  updateSyncStatus();
  renderInventario();
  renderMenu();
  renderCompra();
  renderHistorial();
}
renderAll();
