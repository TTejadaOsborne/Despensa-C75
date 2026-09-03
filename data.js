import {
  db, collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, addDoc,
  query, orderBy, serverTimestamp
} from "./firebase-config.js";

// Orden real del recorrido en Mercadona Las Tablas
export const ZONES = [
  "Platos preparados",
  "Bebidas",
  "Frutas y verduras",
  "Patatas fritas y verdura congelada",
  "Chocolate, helados y congelados",
  "Pescadería",
  "Huevos, arroz y pasta",
  "Carnes",
  "Embutidos y quesos",
  "Baño",
  "Leche y yogures",
  "Pan y desayuno",
  "Café y zumos",
  "Limpieza",
  "Otros"
];

export const LOCATIONS = ["Nevera", "Despensa", "Congelador", "Otros"];

export const MEAL_SLOTS = [
  { id: "comida", label: "Comida" },
  { id: "cena", label: "Cena" }
];

const productsCol = collection(db, "products");
const recipesCol = collection(db, "recipes");
const menuCol = collection(db, "menu");
const historyCol = collection(db, "history");

// --- Productos ---
export function listenProducts(cb) {
  return onSnapshot(productsCol, snap => {
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    items.sort((a, b) => ZONES.indexOf(a.zone) - ZONES.indexOf(b.zone) || a.name.localeCompare(b.name, "es"));
    cb(items);
  });
}

export async function addProduct(p) {
  return addDoc(productsCol, {
    name: p.name,
    zone: p.zone || "Otros",
    location: p.location || "Despensa",
    stock: Number(p.stock) || 0,
    min: Number(p.min) || 1,
    needsDefrost: !!p.needsDefrost,
    defrostHours: Number(p.defrostHours) || 24,
    trackShopping: p.trackShopping !== false,
    updatedAt: serverTimestamp()
  });
}

export async function updateProduct(id, patch) {
  return updateDoc(doc(db, "products", id), { ...patch, updatedAt: serverTimestamp() });
}

export async function deleteProduct(id) {
  return deleteDoc(doc(db, "products", id));
}

export async function adjustStock(id, delta) {
  // Lectura optimista: el llamador pasa el valor ya calculado
  return updateDoc(doc(db, "products", id), { stock: delta, updatedAt: serverTimestamp() });
}

// --- Recetas ---
export function listenRecipes(cb) {
  return onSnapshot(recipesCol, snap => {
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    items.sort((a, b) => a.name.localeCompare(b.name, "es"));
    cb(items);
  });
}

export async function addRecipe(r) {
  return addDoc(recipesCol, {
    name: r.name,
    ingredients: r.ingredients || [], // [{productId, name, qty}]
    notes: r.notes || "",
    updatedAt: serverTimestamp()
  });
}

export async function updateRecipe(id, patch) {
  return updateDoc(doc(db, "recipes", id), { ...patch, updatedAt: serverTimestamp() });
}

export async function deleteRecipe(id) {
  return deleteDoc(doc(db, "recipes", id));
}

// --- Menú semanal (doc id = YYYY-MM-DD) ---
export function listenMenu(cb) {
  return onSnapshot(menuCol, snap => {
    const byDate = {};
    snap.forEach(d => { byDate[d.id] = d.data(); });
    cb(byDate);
  });
}

export async function setMealSlot(dateStr, slot, value) {
  // value: { recipeId, recipeName, freeText }
  return setDoc(doc(db, "menu", dateStr), { [slot]: value }, { merge: true });
}

export async function clearMealSlot(dateStr, slot) {
  return setDoc(doc(db, "menu", dateStr), { [slot]: null }, { merge: true });
}

// --- Histórico de compras ---
export function listenHistory(cb) {
  const q = query(historyCol, orderBy("createdAt", "desc"));
  return onSnapshot(q, snap => {
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    cb(items);
  });
}

export async function addHistoryEntry(entry) {
  // entry: { items: [...], type: 'purchase' | 'ticket', photo?: base64 string }
  return addDoc(historyCol, { ...entry, createdAt: serverTimestamp() });
}
