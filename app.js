import {
  ZONES, LOCATIONS, MEAL_SLOTS, UNITS, UNIT_MAP,
  listenProducts, addProduct, updateProduct, deleteProduct,
  listenRecipes, addRecipe, updateRecipe, deleteRecipe,
  listenMenu, setMealSlot, clearMealSlot,
  listenHistory, addHistoryEntry
} from "./data.js";
import {
  db, doc, setDoc, onSnapshot, updateDoc
} from "./firebase-config.js";

// ---------- Estado local (reflejo de Firestore, actualizado por listeners) ----------
let products = [];
let recipes = [];
let menuByDate = {};
let history = [];
let shoppingChecked = {}; // { productId: true }
let selectedDayOffset = 0;
let syncFlags = { products: false, recipes: false, menu: false, history: false, shopping: false };

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const escapeHtml = s => (s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
// Un producto entra en "por comprar" solo si está bajo mínimo Y tiene activo el seguimiento de compra.
// trackShopping !== false trata a los productos antiguos (sin este campo aún) como activados, por compatibilidad.
const needsRestock = p => p.stock <= p.min && p.trackShopping !== false;
const unitOf = p => UNIT_MAP[p.unit] || UNIT_MAP.ud;
const fmtNum = n => { const r = Math.round((n + Number.EPSILON) * 100) / 100; return Number.isInteger(r) ? String(r) : String(r); };
const fmtQty = p => { const u = unitOf(p); const n = fmtNum(p.stock); return u.id === "ud" ? n : `${n} ${u.short}`; };
const fmtMin = p => { const u = unitOf(p); const n = fmtNum(p.min); return u.id === "ud" ? `mín. ${n}` : `mín. ${n} ${u.short}`; };

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

function updateSyncStatus() {
  const allOk = Object.values(syncFlags).every(Boolean);
  $("#syncStatus").textContent = allOk ? "Sincronizado con Beatriz" : "Sincronizando…";
}

// ---------- Navegación de pestañas ----------
$$(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});
function switchView(name) {
  $$(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  $$(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + name));
}

// ---------- Fechas ----------
const DOW = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
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
  return { dname: DOW[d.getDay()], dnum: `${d.getDate()}` };
}

// ==================================================================
// RENDER: INVENTARIO
// ==================================================================
let selectMode = false;
let selectedIds = new Set();

function renderInventario() {
  const total = products.length;
  const low = products.filter(needsRestock).length;
  const frozen = products.filter(p => p.location === "Congelador").length;
  $("#invMetrics").innerHTML = `
    <div class="metric"><div class="num">${total}</div><div class="label">Productos</div></div>
    <div class="metric ${low > 0 ? "warn" : ""}"><div class="num">${low}</div><div class="label">Por comprar</div></div>
    <div class="metric"><div class="num">${frozen}</div><div class="label">En congelador</div></div>
  `;

  if (products.length === 0) {
    $("#invList").innerHTML = emptyState("🧺", "Tu despensa está vacía", "Pulsa el botón + para añadir tu primer producto.");
    $("#invSelectBar").innerHTML = "";
    return;
  }

  // Barra de selección múltiple
  if (selectMode) {
    const n = selectedIds.size;
    $("#invSelectBar").innerHTML = `
      <div class="tip" style="display:flex;align-items:center;gap:10px;margin:0 0 12px;">
        <div style="flex:1;font-size:13px;"><b>${n}</b> seleccionado(s)</div>
        <button class="mini-link" id="selCancel">Cancelar</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:14px;">
        <button class="btn btn-secondary" id="selTrackOff" style="flex:1;font-size:13px;padding:10px;" ${n===0?"disabled":""}>Desactivar seguimiento</button>
        <button class="btn btn-secondary" id="selTrackOn" style="flex:1;font-size:13px;padding:10px;" ${n===0?"disabled":""}>Activar seguimiento</button>
      </div>`;
    $("#selCancel").addEventListener("click", () => { selectMode = false; selectedIds.clear(); renderInventario(); });
    $("#selTrackOff").addEventListener("click", () => bulkSetTracking(false));
    $("#selTrackOn").addEventListener("click", () => bulkSetTracking(true));
  } else {
    $("#invSelectBar").innerHTML = `
      <div style="text-align:right;margin-bottom:10px;">
        <button class="mini-link" id="selStart">Seleccionar varios</button>
      </div>`;
    $("#selStart").addEventListener("click", () => { selectMode = true; renderInventario(); });
  }

  const byZone = {};
  products.forEach(p => { (byZone[p.zone] ||= []).push(p); });

  let html = "";
  ZONES.forEach(zone => {
    if (!byZone[zone]) return;
    html += `<div class="zone-group"><div class="zone-title">${escapeHtml(zone)}</div>`;
    byZone[zone].forEach(p => {
      const low = needsRestock(p);
      const checked = selectedIds.has(p.id);
      html += `
        <div class="product-row ${low ? "low" : ""}" data-id="${p.id}">
          ${selectMode ? `<div class="checkbox ${checked ? "on" : ""}" data-select="${p.id}">${checked ? "✓" : ""}</div>` : ""}
          <div class="product-info">
            <div class="product-name">${escapeHtml(p.name)}</div>
            <div class="product-meta">
              <span class="chip">${escapeHtml(p.location)}</span>
              ${p.needsDefrost ? `<span class="chip frost">❄️ ${p.defrostHours}h antes</span>` : ""}
              ${p.trackShopping === false ? `<span class="chip" style="background:#EDEAE0;color:var(--text-soft);">sin seguimiento</span>` : `<span>${fmtMin(p)}</span>`}
            </div>
            ${p.note ? `<div style="font-size:11.5px;color:var(--text-soft);font-style:italic;margin-top:2px;">${escapeHtml(p.note)}</div>` : ""}
          </div>
          ${selectMode ? "" : `
          <div class="stepper">
            <button data-act="dec" data-id="${p.id}">−</button>
            <span class="val">${fmtQty(p)}</span>
            <button data-act="inc" data-id="${p.id}">+</button>
          </div>`}
        </div>`;
    });
    html += `</div>`;
  });
  $("#invList").innerHTML = html;
}

function bulkSetTracking(value) {
  const ids = Array.from(selectedIds);
  if (ids.length === 0) return;
  openConfirm(
    value ? "Activar seguimiento" : "Desactivar seguimiento",
    `Se aplicará a ${ids.length} producto(s) seleccionado(s).`,
    "Aplicar",
    () => {
      ids.forEach(id => updateProduct(id, { trackShopping: value }));
      selectMode = false;
      selectedIds.clear();
      closeSheet();
      renderInventario();
    }
  );
}

$("#invList").addEventListener("click", e => {
  if (selectMode) {
    const row = e.target.closest(".product-row");
    if (!row) return;
    const id = row.dataset.id;
    if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
    renderInventario();
    return;
  }
  const btn = e.target.closest("button[data-act]");
  if (btn) {
    const p = products.find(x => x.id === btn.dataset.id);
    if (!p) return;
    const step = unitOf(p).step;
    const raw = btn.dataset.act === "inc" ? p.stock + step : Math.max(0, p.stock - step);
    const next = Math.round((raw + Number.EPSILON) * 100) / 100;
    updateProduct(p.id, { stock: next });
    return;
  }
  const row = e.target.closest(".product-row");
  if (row) openProductSheet(products.find(x => x.id === row.dataset.id));
});
let pressTimer = null;
$("#invList").addEventListener("touchstart", e => {
  if (selectMode) return;
  const row = e.target.closest(".product-row");
  if (!row) return;
  pressTimer = setTimeout(() => openProductSheet(products.find(x => x.id === row.dataset.id)), 480);
});
$("#invList").addEventListener("touchend", () => clearTimeout(pressTimer));
$("#invList").addEventListener("touchmove", () => clearTimeout(pressTimer));

$("#fabAdd").addEventListener("click", () => openProductSheet(null));

function openProductSheet(product) {
  const editing = !!product;
  const p = product || { name: "", zone: ZONES[0], location: "Despensa", stock: 1, min: 1, unit: "ud", note: "", needsDefrost: false, defrostHours: 24, trackShopping: true };
  const html = `
    <div class="overlay" id="ov">
      <div class="sheet">
        <h3>${editing ? "Editar producto" : "Añadir producto"}</h3>
        <div class="field"><label>Nombre</label><input type="text" id="f-name" value="${escapeHtml(p.name)}" placeholder="Ej. Leche entera"></div>
        <div class="field-row">
          <div class="field"><label>Ubicación en casa</label>
            <select id="f-location">${LOCATIONS.map(l => `<option ${l===p.location?"selected":""}>${l}</option>`).join("")}</select>
          </div>
          <div class="field"><label>Zona Mercadona</label>
            <select id="f-zone">${ZONES.map(z => `<option ${z===p.zone?"selected":""}>${escapeHtml(z)}</option>`).join("")}</select>
          </div>
        </div>
        <div class="field"><label>Unidad de medida</label>
          <select id="f-unit">${UNITS.map(u => `<option value="${u.id}" ${(p.unit||"ud")===u.id?"selected":""}>${u.label}</option>`).join("")}</select>
        </div>
        <div class="field-row">
          <div class="field"><label>Stock actual</label><input type="number" id="f-stock" value="${p.stock}" min="0" step="any"></div>
          <div class="field"><label>Mínimo (avisa al llegar aquí)</label><input type="number" id="f-min" value="${p.min}" min="0" step="any"></div>
        </div>
        <div class="field"><label>Nota (opcional) — ej. "cada bolsa lleva 4 filetes"</label>
          <input type="text" id="f-note" value="${escapeHtml(p.note || "")}" placeholder="Contenido de cada unidad, si ayuda a recordarlo">
        </div>
        <div class="check-field"><input type="checkbox" id="f-track" ${p.trackShopping !== false ? "checked" : ""}><label for="f-track" style="margin:0;">Avisar y añadir a la lista de la compra cuando falte</label></div>
        <div class="check-field"><input type="checkbox" id="f-frost" ${p.needsDefrost?"checked":""}><label for="f-frost" style="margin:0;">Hay que sacarlo del congelador con antelación</label></div>
        <div class="field" id="f-frost-hours-wrap" style="display:${p.needsDefrost?"block":"none"};">
          <label>Horas de antelación</label><input type="number" id="f-frost-hours" value="${p.defrostHours}" min="1">
        </div>
        <div class="sheet-actions">
          ${editing ? `<button class="btn btn-danger" id="f-delete">Eliminar</button>` : ""}
          <button class="btn btn-secondary" id="f-cancel">Cancelar</button>
          <button class="btn btn-primary" id="f-save">Guardar</button>
        </div>
      </div>
    </div>`;
  $("#modalRoot").innerHTML = html;
  $("#f-frost").addEventListener("change", e => {
    $("#f-frost-hours-wrap").style.display = e.target.checked ? "block" : "none";
  });
  $("#f-cancel").addEventListener("click", closeSheet);
  $("#ov").addEventListener("click", e => { if (e.target.id === "ov") closeSheet(); });
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
    const patch = {
      name,
      location: $("#f-location").value,
      zone: $("#f-zone").value,
      unit: $("#f-unit").value,
      stock: Number($("#f-stock").value) || 0,
      min: Number($("#f-min").value) || 0,
      note: $("#f-note").value.trim(),
      needsDefrost: $("#f-frost").checked,
      defrostHours: Number($("#f-frost-hours").value) || 24,
      trackShopping: $("#f-track").checked
    };
    if (editing) updateProduct(p.id, patch); else addProduct(patch);
    closeSheet();
  });
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
function renderMenu() {
  let tabs = "";
  for (let i = 0; i < 7; i++) {
    const l = labelFor(i);
    tabs += `<button class="day-tab ${i===selectedDayOffset?"active":""}" data-offset="${i}">
      <span class="dname">${l.dname}</span><span class="dnum">${l.dnum}</span>
    </button>`;
  }
  $("#dayTabs").innerHTML = tabs;
  $$(".day-tab").forEach(b => b.addEventListener("click", () => { selectedDayOffset = Number(b.dataset.offset); renderMenu(); }));

  const dateStr = dateStrFor(selectedDayOffset);
  const dayData = menuByDate[dateStr] || {};
  let html = `<div class="section-head" style="margin-top:2px;"><button class="mini-link" id="btnSuggest">💡 Qué puedo cocinar</button><button class="mini-link" id="btnManageRecipes">Gestionar recetas</button></div>`;
  MEAL_SLOTS.forEach(slot => {
    const meal = dayData[slot.id];
    const name = meal ? (meal.recipeName || meal.freeText) : null;
    const frostItems = meal && meal.recipeId ? frostWarningsFor(meal.recipeId) : [];
    html += `
      <div class="meal-card" data-slot="${slot.id}">
        <div class="slot-label">${slot.label}</div>
        <div class="meal-name">${name ? escapeHtml(name) : `<span class="meal-empty">Sin planificar</span>`}</div>
        ${frostItems.length ? `<div class="frost-note">❄️ Sacar del congelador: ${frostItems.map(escapeHtml).join(", ")}</div>` : ""}
        <div class="meal-actions">
          <button class="btn btn-secondary" data-act="edit-meal" data-slot="${slot.id}">${name ? "Cambiar" : "Planificar"}</button>
          ${name ? `<button class="btn btn-secondary" data-act="clear-meal" data-slot="${slot.id}">Quitar</button>` : ""}
        </div>
      </div>`;
  });
  $("#menuBody").innerHTML = html;

  $("#btnManageRecipes")?.addEventListener("click", openRecipesSheet);
  $("#btnSuggest")?.addEventListener("click", openSuggestionsSheet);
  $$('[data-act="edit-meal"]').forEach(b => b.addEventListener("click", () => openMealSheet(dateStr, b.dataset.slot)));
  $$('[data-act="clear-meal"]').forEach(b => b.addEventListener("click", () => clearMealSlot(dateStr, b.dataset.slot)));
}

function frostWarningsFor(recipeId) {
  const r = recipes.find(x => x.id === recipeId);
  if (!r) return [];
  const names = [];
  (r.ingredients || []).forEach(ing => {
    const p = products.find(x => x.id === ing.productId);
    if (p && p.needsDefrost && p.location === "Congelador") names.push(p.name);
  });
  return names;
}

function openMealSheet(dateStr, slotId) {
  const current = (menuByDate[dateStr] || {})[slotId];
  const html = `
    <div class="overlay" id="ov">
      <div class="sheet">
        <h3>${MEAL_SLOTS.find(s=>s.id===slotId).label} — ${escapeHtml(labelFor(selectedDayOffset).dname)}</h3>
        <div class="field"><label>Elegir receta guardada</label>
          <select id="m-recipe">
            <option value="">— Ninguna —</option>
            ${recipes.map(r => `<option value="${r.id}" ${current?.recipeId===r.id?"selected":""}>${escapeHtml(r.name)}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>O escribe algo suelto (sin receta guardada)</label>
          <input type="text" id="m-free" placeholder="Ej. Cenar fuera, pizza congelada…" value="${current && !current.recipeId ? escapeHtml(current.freeText||"") : ""}">
        </div>
        <div class="sheet-actions">
          <button class="btn btn-secondary" id="m-cancel">Cancelar</button>
          <button class="btn btn-primary" id="m-save">Guardar</button>
        </div>
      </div>
    </div>`;
  $("#modalRoot").innerHTML = html;
  $("#m-cancel").addEventListener("click", closeSheet);
  $("#ov").addEventListener("click", e => { if (e.target.id === "ov") closeSheet(); });
  $("#m-recipe").addEventListener("change", () => { if ($("#m-recipe").value) $("#m-free").value = ""; });
  $("#m-free").addEventListener("input", () => { if ($("#m-free").value) $("#m-recipe").value = ""; });
  $("#m-save").addEventListener("click", () => {
    const rid = $("#m-recipe").value;
    const free = $("#m-free").value.trim();
    if (!rid && !free) { closeSheet(); return; }
    const value = rid
      ? { recipeId: rid, recipeName: recipes.find(r => r.id === rid)?.name || "" }
      : { recipeId: null, freeText: free };
    setMealSlot(dateStr, slotId, value);
    closeSheet();
  });
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
              <div class="product-meta">${(r.ingredients||[]).length} ingrediente(s)</div>
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

function openRecipeEditor(recipe) {
  const editing = !!recipe;
  const ingredients = recipe ? [...(recipe.ingredients||[])] : [];
  const render = () => {
    const html = `
      <div class="overlay" id="ov2">
        <div class="sheet">
          <h3>${editing ? "Editar receta" : "Nueva receta"}</h3>
          <div class="field"><label>Nombre</label><input type="text" id="re-name" value="${escapeHtml(recipe?.name||"")}" placeholder="Ej. Salmón con verduras"></div>
          <div class="field"><label>Ingredientes de tu despensa (opcional, activa el aviso de descongelado)</label>
            <div id="ingRows">
              ${ingredients.map((ing, i) => `
                <div class="ing-row" data-i="${i}">
                  <select data-f="productId">
                    <option value="">— Elige producto —</option>
                    ${products.map(p => `<option value="${p.id}" ${ing.productId===p.id?"selected":""}>${escapeHtml(p.name)}</option>`).join("")}
                  </select>
                  <input type="text" data-f="qty" placeholder="Cantidad" value="${escapeHtml(ing.qty||"")}">
                  <button data-act="rm-ing" data-i="${i}">×</button>
                </div>`).join("")}
            </div>
            <button class="mini-link" id="re-addIng">+ Añadir ingrediente</button>
          </div>
          <div class="field"><label>Notas (opcional)</label><textarea id="re-notes">${escapeHtml(recipe?.notes||"")}</textarea></div>
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
    $("#re-addIng").addEventListener("click", () => { ingredients.push({ productId: "", qty: "" }); render(); });
    $$('[data-act="rm-ing"]').forEach(b => b.addEventListener("click", () => { ingredients.splice(Number(b.dataset.i), 1); render(); }));
    $$('.ing-row').forEach(row => {
      row.querySelectorAll("[data-f]").forEach(inp => {
        inp.addEventListener("change", () => {
          const i = Number(row.dataset.i);
          ingredients[i][inp.dataset.f] = inp.value;
          if (inp.dataset.f === "productId") {
            const prod = products.find(p => p.id === inp.value);
            ingredients[i].name = prod ? prod.name : "";
          }
        });
      });
    });
    if (editing) {
      $("#re-delete").addEventListener("click", () => {
        openConfirm("Eliminar receta", `¿Eliminar "${recipe.name}"? Los días de menú que la usan quedarán vacíos.`, "Eliminar", () => {
          deleteRecipe(recipe.id);
          closeSheet();
        }, true);
      });
    }
    $("#re-save").addEventListener("click", () => {
      const name = $("#re-name").value.trim();
      if (!name) { $("#re-name").focus(); return; }
      const cleanIng = ingredients.filter(i => i.productId).map(i => ({ productId: i.productId, name: i.name, qty: i.qty||"" }));
      const patch = { name, ingredients: cleanIng, notes: $("#re-notes").value.trim() };
      if (editing) updateRecipe(recipe.id, patch); else addRecipe(patch);
      closeSheet();
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
    setMealSlot(dateStr, b.dataset.slot, { recipeId: r.id, recipeName: r.name });
    closeSheet();
  }));
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
    $("#shopList").innerHTML = emptyState("✅", "Nada que comprar", "Cuando un producto baje de su mínimo, aparecerá aquí.");
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
      html += `
        <div class="shop-row ${on?"checked":""}" data-id="${p.id}">
          <div class="checkbox ${on?"on":""}" data-id="${p.id}">${on ? "✓" : ""}</div>
          <div class="product-info">
            <div class="product-name">${escapeHtml(p.name)}</div>
            <div class="product-meta">tienes ${fmtQty(p)} · repón a ${fmtNum(p.min)}${unitOf(p).id!=="ud" ? " "+unitOf(p).short : ""}</div>
          </div>
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
  openConfirm("Confirmar compra", `Se repondrán ${needed.length} producto(s) a su cantidad mínima y se guardará en el historial.`, "Confirmar", () => {
    const items = needed.map(p => ({ name: p.name, from: p.stock, to: p.min, unit: unitOf(p).id !== "ud" ? unitOf(p).short : "" }));
    needed.forEach(p => updateProduct(p.id, { stock: p.min }));
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
// ESCANEAR TICKET (foto + texto pegado desde Live Text del iPhone)
// ==================================================================
const TICKET_IGNORE = /total|subtotal|\biva\b|tarjeta|efectivo|cambio|fecha|hora|ticket|cif|operaci[oó]n|gracias|mercadona|n\.?\s?factura|autorizaci[oó]n|contactless|bizum|c[oó]digo|art[ií]culos|importe|descuento\s*total/i;

function parseTicketText(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const priceRe = /(\d{1,3}(?:[.,]\d{2}))\s*€?\s*$/;
  const items = [];
  lines.forEach(line => {
    if (TICKET_IGNORE.test(line)) return;
    const m = line.match(priceRe);
    if (!m) return;
    const priceStr = m[1].replace(".", ",");
    let name = line.slice(0, m.index).trim();
    name = name.replace(/^\d+\s*(x|ud\.?|uds\.?)?\s*/i, "").trim();
    if (name.length < 2) return;
    items.push({ name, price: priceStr });
  });
  return items;
}

function compressImageFile(file, maxBytes = 650000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      let width = img.width, height = img.height;
      const maxDim = 1100;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      let quality = 0.75;
      let dataUrl = canvas.toDataURL("image/jpeg", quality);
      while (dataUrl.length > maxBytes && quality > 0.25) {
        quality -= 0.1;
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      }
      resolve(dataUrl);
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

$("#btnScanTicket").addEventListener("click", openScanTicketSheet);

function openScanTicketSheet() {
  let photoData = null;
  let detected = [];

  const render = () => {
    const html = `
      <div class="overlay" id="ovT">
        <div class="sheet">
          <h3>Escanear ticket</h3>
          <div class="field">
            <label>1. Foto del ticket (opcional, se guarda en el histórico)</label>
            <input type="file" id="t-photo" accept="image/*" capture="environment">
            ${photoData ? `<img src="${photoData}" style="width:100%;border-radius:10px;margin-top:8px;">` : ""}
          </div>
          <div class="field">
            <label>2. Pega aquí el texto del ticket — ábrelo en Fotos, toca el icono Live Text (rayitas amarillas) → Seleccionar todo → Copiar</label>
            <textarea id="t-text" placeholder="Pega el texto copiado del ticket…" style="min-height:100px;"></textarea>
          </div>
          <button class="btn btn-secondary btn-block" id="t-detect" style="margin-bottom:14px;">Detectar productos</button>
          ${detected.length ? `
            <div class="field"><label>3. Revisa antes de guardar (borra lo que no sea producto)</label></div>
            <div id="t-items">
              ${detected.map((it, i) => `
                <div class="ing-row" data-i="${i}">
                  <input type="text" data-f="name" value="${escapeHtml(it.name)}">
                  <input type="text" data-f="price" value="${escapeHtml(it.price)}" style="flex:0 0 70px;">
                  <button data-act="rm-t" data-i="${i}">×</button>
                </div>`).join("")}
            </div>
          ` : ""}
          <div class="sheet-actions">
            <button class="btn btn-secondary" id="t-cancel">Cancelar</button>
            <button class="btn btn-primary" id="t-save" ${detected.length === 0 && !photoData ? "disabled" : ""}>Guardar en historial</button>
          </div>
        </div>
      </div>`;
    $("#modalRoot").innerHTML = html;

    $("#t-cancel").addEventListener("click", closeSheet);
    $("#ovT").addEventListener("click", e => { if (e.target.id === "ovT") closeSheet(); });

    $("#t-photo").addEventListener("change", async e => {
      const file = e.target.files[0];
      if (!file) return;
      photoData = await compressImageFile(file);
      render();
    });

    $("#t-detect").addEventListener("click", () => {
      const text = $("#t-text").value;
      detected = parseTicketText(text);
      if (detected.length === 0) {
        openConfirm("Sin resultados", "No he podido detectar líneas con precio en ese texto. Puedes añadir productos a mano tras guardar, o revisar que el texto pegado sea el correcto.", "Entendido", () => render());
        return;
      }
      render();
    });

    $$('[data-act="rm-t"]').forEach(b => b.addEventListener("click", () => { detected.splice(Number(b.dataset.i), 1); render(); }));
    $$("#t-items .ing-row").forEach(row => {
      row.querySelectorAll("[data-f]").forEach(inp => {
        inp.addEventListener("input", () => { detected[Number(row.dataset.i)][inp.dataset.f] = inp.value; });
      });
    });

    $("#t-save").addEventListener("click", () => {
      addHistoryEntry({
        type: "ticket",
        items: detected.map(d => ({ name: d.name, price: d.price })),
        photo: photoData || null
      });
      closeSheet();
    });
  };
  render();
}

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
  if (history.length === 0) {
    $("#histList").innerHTML = emptyState("🕓", "Sin compras registradas", "Cuando confirmes una compra, quedará aquí.");
    return;
  }
  $("#histList").innerHTML = history.map(h => {
    const d = h.createdAt?.toDate ? h.createdAt.toDate() : new Date();
    const dateLabel = d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
    const isTicket = h.type === "ticket";
    const rows = (h.items || []).map(it =>
      isTicket
        ? `<div>${escapeHtml(it.name)}${it.price ? " — " + escapeHtml(it.price) + " €" : ""}</div>`
        : `<div>${escapeHtml(it.name)} — ${it.from} → ${it.to}${it.unit ? " " + escapeHtml(it.unit) : ""}</div>`
    ).join("");
    return `
      <div class="hist-entry" data-id="${h.id}">
        <div class="hist-head">
          <span class="hist-date">${isTicket ? "🧾 " : ""}${dateLabel}</span>
          <span style="display:flex;align-items:center;gap:8px;">
            <span class="hist-count">${(h.items||[]).length} producto(s)</span>
            ${isTicket ? `<button class="mini-link" data-act="export-ticket" data-id="${h.id}">Guardar</button>` : ""}
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
function computeFrostReminders() {
  const items = [];
  [0, 1].forEach(offset => {
    const dateStr = dateStrFor(offset);
    const dayData = menuByDate[dateStr] || {};
    MEAL_SLOTS.forEach(slot => {
      const meal = dayData[slot.id];
      if (!meal || !meal.recipeId) return;
      const names = frostWarningsFor(meal.recipeId);
      names.forEach(name => {
        items.push({ name, when: offset === 0 ? "hoy" : "mañana", meal: slot.label.toLowerCase() });
      });
    });
  });
  return items;
}

function renderBanner() {
  const items = computeFrostReminders();
  const todayKey = dateStrFor(0);
  const dismissKey = "despensa_banner_dismissed_" + todayKey;
  if (items.length === 0 || localStorage.getItem(dismissKey)) {
    $("#bannerZone").innerHTML = "";
    return;
  }
  const list = items.map(i => `${escapeHtml(i.name)} (para la ${i.meal} de ${i.when})`).join(", ");
  $("#bannerZone").innerHTML = `
    <div class="banner">
      <span class="icon">❄️</span>
      <div>
        <strong>Saca esto del congelador</strong>
        ${list}
      </div>
      <button class="dismiss" id="bannerDismiss">×</button>
    </div>`;
  $("#bannerDismiss").addEventListener("click", () => {
    localStorage.setItem(dismissKey, "1");
    $("#bannerZone").innerHTML = "";
  });
}

// ==================================================================
// RENDER GLOBAL
// ==================================================================
function renderAll() {
  updateSyncStatus();
  renderInventario();
  renderMenu();
  renderCompra();
  renderHistorial();
  renderBanner();
}
renderAll();
