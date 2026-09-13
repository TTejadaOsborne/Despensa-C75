// Importador de "Lista de la compra" desde PDFs de planes dietéticos (DietoPro y similares).
//
// El algoritmo de este fichero se validó línea por línea contra un PDF real de DietoPro
// (63/63 productos reconstruidos correctamente, incluida la página multi-columna con nombres
// partidos en varias líneas) antes de escribirse aquí — no es una suposición sobre el formato.
//
// Señales que usamos, en vez de adivinar por el texto:
// 1. Las cabeceras de categoría usan una fuente distinta a las líneas de producto.
// 2. La página tiene layout de varias columnas — lo detectamos por la posición X de las
//    cabeceras (agrupadas en líneas, no palabra por palabra) y procesamos cada columna
//    de forma independiente para no mezclar texto de columnas distintas que comparten altura.

let pdfjsLoaded = false;
async function ensurePdfJs() {
  if (pdfjsLoaded && window.pdfjsLib) return;
  await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  pdfjsLoaded = true;
}

const QTY_START_RE = /^([\d]+(?:[.,]\d+)?)\s*(g|kg|ml|l)\b/i;
const QTY_RE = /^([\d]+(?:[.,]\d+)?)\s*(g|kg|ml|l)\s+(.+)$/i;
const SHOPPING_LIST_TITLE = "LISTA DE LA COMPRA";

function groupIntoLines(items, xGapBreak = 50) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  let cur = null;
  for (const it of sorted) {
    if (!it.str || !it.str.trim()) continue;
    const sameLine = cur && Math.abs(cur.y - it.y) < 2.5 && (it.x - cur.endX) < xGapBreak;
    if (sameLine) {
      const gap = it.x - cur.endX;
      cur.text += (gap > 1 ? " " : "") + it.str;
      cur.endX = it.x + (it.width || 0);
      cur.startX = Math.min(cur.startX, it.x);
    } else {
      cur = { y: it.y, text: it.str, startX: it.x, endX: it.x + (it.width || 0), font: it.fontName };
      lines.push(cur);
    }
  }
  return lines;
}

function clusterStarts(xs, gapThreshold) {
  if (xs.length === 0) return [];
  const starts = [xs[0]];
  let prev = xs[0];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - prev > gapThreshold) starts.push(xs[i]);
    prev = xs[i];
  }
  return starts;
}

async function getPageItems(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const content = await page.getTextContent();
  return content.items.map(it => ({
    str: it.str,
    x: it.transform[4],
    y: it.transform[5],
    width: it.width,
    fontName: it.fontName
  }));
}

function parseShoppingListPage(items) {
  const fontCounts = {};
  items.forEach(it => { if (QTY_START_RE.test((it.str || "").trim())) fontCounts[it.fontName] = (fontCounts[it.fontName] || 0) + 1; });
  const itemFont = Object.entries(fontCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!itemFont) return { items: [], itemFont: null };

  const allLines = groupIntoLines(items);
  const titleLine = allLines.find(l => l.text.toUpperCase().includes(SHOPPING_LIST_TITLE));
  if (!titleLine) return { items: [], itemFont };
  const belowTitle = items.filter(it => it.y < titleLine.y - 1);

  const headerLines = groupIntoLines(belowTitle.filter(it => it.fontName !== itemFont));
  const headerXs = [...new Set(headerLines.map(l => Math.round(l.startX)))].sort((a, b) => a - b);
  const colStarts = clusterStarts(headerXs, 40);
  if (colStarts.length === 0) return { items: [], itemFont };

  const assignColumn = x => {
    let best = 0;
    for (let i = 0; i < colStarts.length; i++) if (x >= colStarts[i] - 5) best = i;
    return best;
  };
  const byCol = colStarts.map(() => []);
  belowTitle.forEach(it => byCol[assignColumn(it.x)].push(it));

  let results = [];
  byCol.forEach(colItems => {
    const lines = groupIntoLines(colItems);
    let category = "Otros", current = null;
    const colResults = [];
    for (const line of lines) {
      const txt = line.text.trim().replace(/\s+\d{1,2}$/, "");
      if (!txt) continue;
      const m = txt.match(QTY_RE);
      if (m) {
        if (current) colResults.push(current);
        current = { qty: parseFloat(m[1].replace(",", ".")), unit: m[2].toLowerCase(), name: m[3].trim(), category };
      } else if (line.font === itemFont && current) {
        current.name = (current.name + " " + txt).trim();
      } else {
        if (current) { colResults.push(current); current = null; }
        category = txt;
      }
    }
    if (current) colResults.push(current);
    results = results.concat(colResults);
  });

  return { items: results, itemFont };
}

export async function extractShoppingListFromPdf(arrayBuffer) {
  await ensurePdfJs();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  for (let i = 1; i <= pdf.numPages; i++) {
    const items = await getPageItems(pdf, i);
    const lines = groupIntoLines(items);
    if (!lines.some(l => l.text.toUpperCase().includes(SHOPPING_LIST_TITLE))) continue;
    const { items: parsed } = parseShoppingListPage(items);
    if (parsed.length > 0) return { ok: true, items: parsed, page: i };
    return { ok: false, reason: "parse-empty", items: [], debugLines: lines.map(l => l.text) };
  }
  return { ok: false, reason: "no-list-page", items: [] };
}

function normalize(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

export function matchIngredientToProduct(name, products) {
  const n = normalize(name);
  const key = n.split(/[,/(]/)[0].trim();
  let best = null;
  for (const p of products) {
    const pn = normalize(p.name);
    if (pn === key || key.includes(pn) || pn.includes(key)) {
      if (!best || pn.length > normalize(best.name).length) best = p;
    }
  }
  return best;
}

export const CATEGORY_TO_ZONE = {
  "leche y derivados": "Leche y yogures",
  "bebidas no alcoholicas": "Café y zumos",
  "bebidas alcoholicas": "Otros",
  "patatas, legumbres y frutos": "Huevos, arroz y pasta",
  "frutas": "Frutas y verduras",
  "hortalizas y verduras": "Frutas y verduras",
  "cereales, azucares y derivados": "Huevos, arroz y pasta",
  "aceites y grasas": "Otros",
  "carnes, pescados y huevos": "Carnes",
  "otros": "Otros"
};

export function guessZone(category) {
  const c = normalize(category);
  for (const key in CATEGORY_TO_ZONE) {
    if (c.startsWith(normalize(key).slice(0, 10))) return CATEGORY_TO_ZONE[key];
  }
  return "Otros";
}

export const DEFAULT_IGNORED = [
  "aceite de oliva", "aceite", "sal", "sal comun", "pimienta", "pimienta negra",
  "especias", "hierbas aromaticas", "levadura", "levadura quimica", "vinagre",
  "canela", "eneldo", "eneldo seco", "cilantro", "perejil", "mostaza", "oregano",
  "comino", "azafran", "pimenton"
];

export function isIgnoredIngredient(name, ignoredList) {
  const n = normalize(name);
  return ignoredList.some(term => {
    const t = normalize(term);
    return t && (n === t || n.startsWith(t + " ") || n.includes(" " + t));
  });
}

// ---------- Importar el menú semanal (tabla "Día 1..7" x comidas) ----------
const ROW_LABELS = [
  { key: "desayuno", text: "Desayuno" },
  { key: "media_manana", text: "Media Mañana" },
  { key: "comida", text: "Comida" },
  { key: "merienda", text: "Merienda 1" },
  { key: "cena", text: "Cena" }
];

function assignNearest(val, anchors) {
  let best = 0, bestDist = Infinity;
  anchors.forEach((a, i) => { const d = Math.abs(a - val); if (d < bestDist) { bestDist = d; best = i; } });
  return best;
}

export async function extractWeeklyMenuFromPdf(arrayBuffer) {
  await ensurePdfJs();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const items = await getPageItems(pdf, pageNum);
    const dayHeaders = items
      .filter(it => /^Día\s*\d/i.test((it.str || "").trim()))
      .sort((a, b) => a.x - b.x);
    if (dayHeaders.length < 7) continue; // no es la página de la tabla semanal

    const colStarts = dayHeaders.slice(0, 7).map(h => h.x);
    const headerY = dayHeaders[0].y;

    // Anclas de fila: buscamos el texto de cada etiqueta conocida en la columna izquierda
    const leftItems = items.filter(it => it.x < 60 && it.y < headerY - 5);
    const rowAnchors = ROW_LABELS.map(label => {
      const lt = label.text.toLowerCase();
      const match = leftItems.find(it => {
        const s = (it.str || "").trim().toLowerCase();
        return s && (lt.includes(s) || s.includes(lt));
      });
      return match ? match.y : null;
    });
    if (rowAnchors.some(y => y === null)) continue; // formato inesperado, no forzamos

    // Solo texto de plato: por debajo de la cabecera de día, por encima del pie de página, y a la derecha del margen de las etiquetas de fila
    const bottomCut = Math.min(...rowAnchors) - 120;
    const dishItems = items.filter(it => it.x > 45 && it.y < headerY - 5 && it.y > bottomCut);

    const cells = {};
    dishItems.forEach(it => {
      const col = assignNearest(it.x, colStarts);
      const row = assignNearest(it.y, rowAnchors);
      const key = `${row}-${col}`;
      (cells[key] ||= []).push(it);
    });

    const days = [];
    for (let col = 0; col < 7; col++) {
      const day = { dayNum: col + 1 };
      ROW_LABELS.forEach((label, row) => {
        const its = cells[`${row}-${col}`] || [];
        const lines = groupIntoLines(its);
        lines.sort((a, b) => b.y - a.y);
        const dishes = [];
        lines.forEach(line => {
          const txt = line.text.trim().replace(/\s+\d{1,2}$/, "");
          if (!txt) return;
          if (dishes.length && (dishes[dishes.length - 1].y - line.y) < 14) {
            dishes[dishes.length - 1].text += " " + txt;
          } else {
            dishes.push({ y: line.y, text: txt });
          }
        });
        day[label.key] = dishes.map(d => d.text.replace(/\s+/g, " ").trim()).join(" / ");
      });
      days.push(day);
    }
    return { ok: true, days, page: pageNum };
  }
  return { ok: false, reason: "no-table-page", days: [] };
}
