// ══════════════════════════════════════════════════════════════
// Rita Roux · Inventario Cafetería — Conector Google Sheets & Drive
// Mismo patrón que Nota de Ventas/gsheets.js y Reportes toteat/gsheets-cafeteria.js
// (Google Identity Services, 100% navegador, sin backend propio).
// Reutiliza el MISMO proyecto de Google Cloud y la MISMA hoja que las
// Recetas de la cafetería — la pestaña "Recetas" se comparte, no se duplica.
// ══════════════════════════════════════════════════════════════

// TODO: pegar aquí el Client ID real una vez terminada la configuración en
// Google Cloud Console (Sheets API + Drive API + pantalla de consentimiento +
// orígenes autorizados). Es el MISMO Client ID pendiente de gsheets-cafeteria.js.
const GS_CLIENT_ID = '201013032282-7bddoeini11jk18jh49v5q9nvsp1eb13.apps.googleusercontent.com';
const GS_SHEET_ID  = '1TVmY9QsDNb6yXdgk8XhtkexYHIe4uZWNgkpnULyGHuM'; // Rita Roux — Recetas Cafetería
const GS_SCOPES    = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';

// Proxy ya existente de "Reportes toteat" (Railway) — CORS abierto, se reutiliza
// tal cual para leer ventas de Toteat sin levantar un backend nuevo para este sistema.
const TOTEAT_PROXY_BASE = 'https://web-production-12ac3.up.railway.app';

const TAB = {
  RECETAS:            'Recetas',            // ya existe — compartida con gsheets-cafeteria.js
  INGREDIENTES:       'Ingredientes',
  MOVIMIENTOS:        'Movimientos',
  FACTURAS:           'Facturas',
  ENTRADAS_PENDIENTES:'EntradasPendientes',
  VENTAS_PROCESADAS:  'VentasProcesadas',
  CONFIGURACION:      'Configuracion',
};

const HDR = {
  RECETAS:             ['Id Producto','Nombre Producto','Id Ingrediente','Nombre Ingrediente','Cantidad','Unidad','Costo Kilo','Proveedor'],
  INGREDIENTES:        ['Id Ingrediente','Nombre','Unidad','Stock Minimo','Costo Actual','Proveedor Principal'],
  MOVIMIENTOS:         ['Fecha','Tipo','Id Ingrediente','Nombre Ingrediente','Cantidad','Unidad','Costo Unitario','Referencia','Usuario','Comentario'],
  FACTURAS:            ['Id Factura','Nº Documento','Fecha','Proveedor','Tipo','Total','Estado','URL Adjunto','Items JSON'],
  ENTRADAS_PENDIENTES: ['Id Pendiente','Fecha','Proveedor','Items JSON','Estado','Id Factura Asociada'],
  VENTAS_PROCESADAS:   ['Order Id','Fecha Procesado','Referencia Sync'],
  CONFIGURACION:       ['Clave','Valor'],
};

// Tipos de movimiento (event-sourcing — Movimientos es la única fuente de verdad del stock)
const MOV = { ENTRADA: 'ENTRADA', VENTA: 'VENTA', MERMA: 'MERMA', AJUSTE_CONTEO: 'AJUSTE_CONTEO', SALIDA_EVENTO: 'SALIDA_EVENTO' };

// ─── OAuth (Google Identity Services) — idéntico al patrón de gsheets.js de Eventos ──
let gs_token  = null;
let gs_client = null;
let _gs_cb    = null;
let _gs_refreshTimer = null;

function gsInit(onAuth) {
  _gs_cb = onAuth;
  const cachedTok = localStorage.getItem('rri_tok');
  const cachedExp = parseInt(localStorage.getItem('rri_tok_exp') || '0');
  const hasValidCache = cachedTok && cachedExp > Date.now();

  if (hasValidCache) {
    gs_token = cachedTok;
    setTimeout(() => { if (_gs_cb) _gs_cb(); }, 0);
  }

  _gsLoadClient(() => {
    if (hasValidCache) {
      _gsScheduleRefresh();
    } else if (localStorage.getItem('rri_was_connected')) {
      gs_client.requestAccessToken({ prompt: 'none' });
    } else {
      _gsShowAuthBanner();
    }
  });
}

function _gsLoadClient(onReady) {
  if (gs_client) { onReady(); return; }
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.onload = () => {
    gs_client = google.accounts.oauth2.initTokenClient({
      client_id: GS_CLIENT_ID,
      scope: GS_SCOPES,
      callback: r => {
        if (r.error) { _gsShowAuthBanner(); return; }
        gs_token = r.access_token;
        localStorage.setItem('rri_tok', r.access_token);
        localStorage.setItem('rri_tok_exp', String(Date.now() + 55 * 60 * 1000));
        localStorage.setItem('rri_was_connected', '1');
        const banner = document.getElementById('_gs_banner');
        if (banner) banner.remove();
        document.body.style.paddingTop = '';
        _gsScheduleRefresh();
        if (_gs_cb) _gs_cb();
      }
    });
    onReady();
  };
  document.head.appendChild(s);
}

function _gsScheduleRefresh() {
  clearTimeout(_gs_refreshTimer);
  const exp  = parseInt(localStorage.getItem('rri_tok_exp') || '0');
  const wait = Math.max(exp - Date.now() - 5 * 60 * 1000, 30 * 1000);
  _gs_refreshTimer = setTimeout(() => {
    if (gs_client) gs_client.requestAccessToken({ prompt: 'none' });
  }, wait);
}

function _gsShowAuthBanner() {
  if (document.getElementById('_gs_banner')) return;
  const el = document.createElement('div');
  el.id = '_gs_banner';
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#AA2E19;color:#fff;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;row-gap:4px;gap:10px;padding:8px 12px;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:.3px;text-align:center;box-sizing:border-box';
  el.innerHTML = `<span>Conecta tu cuenta de Google para usar el Inventario —</span>
    <button onclick="gsAuth()" style="padding:5px 16px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;background:#fff;color:#AA2E19;border:none;cursor:pointer;font-family:inherit;border-radius:2px">Conectar →</button>`;
  document.body.insertBefore(el, document.body.firstChild);
  // El banner es position:fixed (no ocupa espacio en el flujo normal) — sin esto
  // tapa el header/nav de la página, que también arranca en top:0.
  document.body.style.paddingTop = el.offsetHeight + 'px';
}

function gsAuth()      { if (gs_client) gs_client.requestAccessToken(); }
function gsConnected() { return !!gs_token; }

// ─── REST contra Google Sheets / Drive ────────────────────────────────────────
function _gsShUrl(path) { return `https://sheets.googleapis.com/v4/spreadsheets/${GS_SHEET_ID}${path}`; }
function _gsHdr()       { return { Authorization: `Bearer ${gs_token}`, 'Content-Type': 'application/json' }; }

async function gsGet(range) {
  const r = await fetch(_gsShUrl(`/values/${encodeURIComponent(range)}`), { headers: _gsHdr() });
  return r.json();
}
async function gsAppend(range, values) {
  const r = await fetch(
    _gsShUrl(`/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`),
    { method: 'POST', headers: _gsHdr(), body: JSON.stringify({ values }) }
  );
  return r.json();
}
async function gsUpdate(range, values) {
  const r = await fetch(
    _gsShUrl(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`),
    { method: 'PUT', headers: _gsHdr(), body: JSON.stringify({ values }) }
  );
  return r.json();
}
async function gsClear(range) {
  const r = await fetch(_gsShUrl(`/values/${encodeURIComponent(range)}:clear`), { method: 'POST', headers: { Authorization: `Bearer ${gs_token}` } });
  return r.json();
}

async function gsEnsureTab(nombre, hdr) {
  if (!gsConnected()) return;
  try {
    const meta = await (await fetch(_gsShUrl('?fields=sheets.properties.title'), { headers: _gsHdr() })).json();
    const existe = (meta.sheets || []).some(s => s.properties.title === nombre);
    if (!existe) {
      await fetch(_gsShUrl(':batchUpdate'), {
        method: 'POST', headers: _gsHdr(),
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: nombre } } }] })
      });
    }
    const res = await gsGet(`${nombre}!A1:A1`);
    if (!res.values || !res.values.length) {
      await gsUpdate(`${nombre}!A1`, [hdr]);
    }
  } catch (e) { console.warn('Error asegurando hoja', nombre, e); }
}

// Crea todas las pestañas nuevas del inventario si faltan (Recetas se asume ya existente).
async function invInitSheet() {
  if (!gsConnected()) return;
  await Promise.all([
    gsEnsureTab(TAB.INGREDIENTES, HDR.INGREDIENTES),
    gsEnsureTab(TAB.MOVIMIENTOS, HDR.MOVIMIENTOS),
    gsEnsureTab(TAB.FACTURAS, HDR.FACTURAS),
    gsEnsureTab(TAB.ENTRADAS_PENDIENTES, HDR.ENTRADAS_PENDIENTES),
    gsEnsureTab(TAB.VENTAS_PROCESADAS, HDR.VENTAS_PROCESADAS),
    gsEnsureTab(TAB.CONFIGURACION, HDR.CONFIGURACION),
  ]);
}

// Sube un Blob (foto/PDF de factura) a Drive — mismo patrón que Nota de Ventas/gsheets.js
const _gsDriveFolderCache = {};
async function gsDriveUpload(blob, filename, folderName, mimeType) {
  if (!gsConnected()) return null;
  try {
    let fid = _gsDriveFolderCache[folderName];
    if (!fid) {
      const q  = encodeURIComponent(`name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
      const fl = await (await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`,
        { headers: { Authorization: `Bearer ${gs_token}` } }
      )).json();
      fid = fl.files && fl.files.length ? fl.files[0].id : null;
      if (!fid) {
        const c = await (await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: { Authorization: `Bearer ${gs_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder' })
        })).json();
        fid = c.id;
      }
      _gsDriveFolderCache[folderName] = fid;
    }
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ name: filename, parents: [fid], mimeType: mimeType || 'application/octet-stream' })], { type: 'application/json' }));
    form.append('file', blob, filename);
    const res = await (await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST', headers: { Authorization: `Bearer ${gs_token}` }, body: form
    })).json();
    return res.webViewLink || (res.id ? `https://drive.google.com/file/d/${res.id}/view` : null);
  } catch (e) { console.warn('Error subiendo a Drive:', e); return null; }
}

// ─── RECETAS (pestaña compartida con gsheets-cafeteria.js) ───────────────────
function recetasFilasAObj(rows) {
  const out = {};
  (rows || []).forEach(r => {
    const [pid, prodName, iid, ingName, qty, unit, costoKilo, proveedor] = r;
    if (!pid) return;
    if (!out[pid]) out[pid] = { name: prodName || '', ing: [] };
    out[pid].ing.push({ id: iid || '', name: ingName || '', qty: qty || '0', unit: unit || '', costoKilo: parseFloat(costoKilo) || 0, proveedor: proveedor || '' });
  });
  return out;
}
async function invCargarRecetas() {
  if (!gsConnected()) return {};
  const res = await gsGet(`${TAB.RECETAS}!A2:H`);
  return recetasFilasAObj(res.values || []);
}

function recetasObjAFilas(recetasObj) {
  const rows = [];
  for (const pid in (recetasObj || {})) {
    const prod = recetasObj[pid];
    for (const ing of (prod.ing || [])) {
      rows.push([pid, prod.name || '', ing.id || '', ing.name || '', ing.qty != null ? String(ing.qty) : '', ing.unit || '', ing.costoKilo != null ? ing.costoKilo : '', ing.proveedor || '']);
    }
  }
  return rows;
}

// Reescribe la pestaña Recetas completa (clear+append) — misma estrategia que
// gscGuardarRecetas en Reportes toteat/gsheets-cafeteria.js, así nunca queda una
// fila vieja huérfana después de editar/eliminar un producto o ingrediente.
async function invGuardarRecetas(recetasObj) {
  const rows = recetasObjAFilas(recetasObj);
  await gsClear(`${TAB.RECETAS}!A2:H`);
  if (rows.length) await gsAppend(`${TAB.RECETAS}!A2:H`, rows);
  await invSincronizarIngredientesDesdeRecetas(recetasObj);
}

// ─── INGREDIENTES (maestro) ───────────────────────────────────────────────────
async function invCargarIngredientes() {
  if (!gsConnected()) return {};
  const res = await gsGet(`${TAB.INGREDIENTES}!A2:F`);
  const out = {};
  (res.values || []).forEach(r => {
    const [id, nombre, unidad, stockMin, costoActual, proveedor] = r;
    if (!id) return;
    out[id] = { id, nombre: nombre || '', unidad: unidad || '', stockMinimo: parseFloat(stockMin) || 0, costoActual: parseFloat(costoActual) || 0, proveedor: proveedor || '' };
  });
  return out;
}

// Si la pestaña Ingredientes está vacía, la siembra con los IDs únicos de Recetas.
async function invSembrarIngredientesSiVacio(recetasObj) {
  const actuales = await invCargarIngredientes();
  if (Object.keys(actuales).length) return actuales;
  return invSincronizarIngredientesDesdeRecetas(recetasObj, actuales);
}

// Agrega a Ingredientes cualquier Id Ingrediente presente en Recetas que todavía
// no exista en el maestro (uso continuo, no solo la primera vez) — así un
// ingrediente nuevo agregado desde productos-recetas.html queda disponible de
// inmediato en Stock/Entradas/Mermas sin tener que crearlo dos veces.
async function invSincronizarIngredientesDesdeRecetas(recetasObj, actualesYaCargados) {
  const actuales = actualesYaCargados || await invCargarIngredientes();
  const nuevos = {};
  Object.values(recetasObj || {}).forEach(prod => (prod.ing || []).forEach(i => {
    if (!i.id || actuales[i.id] || nuevos[i.id]) return;
    nuevos[i.id] = [i.id, i.name, i.unit, '', i.costoKilo || '', i.proveedor || ''];
  }));
  const rows = Object.values(nuevos);
  if (rows.length) await gsAppend(`${TAB.INGREDIENTES}!A2:F`, rows);
  return invCargarIngredientes();
}

async function invGuardarIngrediente(ing) {
  const res = await gsGet(`${TAB.INGREDIENTES}!A2:F`);
  const rows = res.values || [];
  const idx = rows.findIndex(r => r[0] === ing.id);
  const fila = [ing.id, ing.nombre, ing.unidad, ing.stockMinimo, ing.costoActual, ing.proveedor];
  if (idx >= 0) {
    await gsUpdate(`${TAB.INGREDIENTES}!A${idx + 2}:F${idx + 2}`, [fila]);
  } else {
    await gsAppend(`${TAB.INGREDIENTES}!A2:F`, [fila]);
  }
}

// ─── MOVIMIENTOS (ledger — única fuente de verdad del stock) ─────────────────
async function invCargarMovimientos() {
  if (!gsConnected()) return [];
  const res = await gsGet(`${TAB.MOVIMIENTOS}!A2:J`);
  return (res.values || []).map(r => ({
    fecha: r[0] || '', tipo: r[1] || '', idIngrediente: r[2] || '', nombreIngrediente: r[3] || '',
    cantidad: parseFloat(r[4]) || 0, unidad: r[5] || '', costoUnitario: parseFloat(r[6]) || 0,
    referencia: r[7] || '', usuario: r[8] || '', comentario: r[9] || '',
  }));
}

async function invAgregarMovimientos(movs) {
  if (!movs || !movs.length) return;
  const rows = movs.map(m => [m.fecha, m.tipo, m.idIngrediente, m.nombreIngrediente, m.cantidad, m.unidad, m.costoUnitario || '', m.referencia || '', m.usuario || '', m.comentario || '']);
  await gsAppend(`${TAB.MOVIMIENTOS}!A2:J`, rows);
}

// Stock actual por ingrediente = suma de cantidades (signo ya viene incluido en cada movimiento)
function invCalcularStock(movimientos) {
  const stock = {};
  (movimientos || []).forEach(m => {
    if (!m.idIngrediente) return;
    stock[m.idIngrediente] = (stock[m.idIngrediente] || 0) + m.cantidad;
  });
  return stock;
}

// ─── FACTURAS ──────────────────────────────────────────────────────────────────
async function invCargarFacturas() {
  if (!gsConnected()) return [];
  const res = await gsGet(`${TAB.FACTURAS}!A2:I`);
  return (res.values || []).map(r => ({
    id: r[0] || '', numeroDocumento: r[1] || '', fecha: r[2] || '', proveedor: r[3] || '',
    tipo: r[4] || '', total: parseFloat(r[5]) || 0, estado: r[6] || '', urlAdjunto: r[7] || '',
    items: (() => { try { return JSON.parse(r[8] || '[]'); } catch (e) { return []; } })(),
  }));
}
async function invAgregarFactura(f) {
  await gsAppend(`${TAB.FACTURAS}!A2:I`, [[f.id, f.numeroDocumento, f.fecha, f.proveedor, f.tipo, f.total, f.estado || 'Registrada', f.urlAdjunto || '', JSON.stringify(f.items || [])]]);
}

// ─── ENTRADAS PENDIENTES (mercadería sin factura) ────────────────────────────
async function invCargarEntradasPendientes() {
  if (!gsConnected()) return [];
  const res = await gsGet(`${TAB.ENTRADAS_PENDIENTES}!A2:F`);
  return (res.values || []).map((r, i) => ({
    fila: i + 2, id: r[0] || '', fecha: r[1] || '', proveedor: r[2] || '',
    items: (() => { try { return JSON.parse(r[3] || '[]'); } catch (e) { return []; } })(),
    estado: r[4] || 'Pendiente', idFacturaAsociada: r[5] || '',
  }));
}
async function invAgregarEntradaPendiente(e) {
  await gsAppend(`${TAB.ENTRADAS_PENDIENTES}!A2:F`, [[e.id, e.fecha, e.proveedor || '', JSON.stringify(e.items || []), 'Pendiente', '']]);
}
async function invResolverEntradaPendiente(fila, idFactura) {
  await gsUpdate(`${TAB.ENTRADAS_PENDIENTES}!E${fila}:F${fila}`, [['Resuelta', idFactura]]);
}

// ─── VENTAS PROCESADAS (dedup de orderId de Toteat ya descontados) ──────────
async function invOrdenesProcesadas() {
  if (!gsConnected()) return new Set();
  const res = await gsGet(`${TAB.VENTAS_PROCESADAS}!A2:A`);
  return new Set((res.values || []).map(r => String(r[0])));
}
async function invMarcarOrdenesProcesadas(orderIds, refSync) {
  if (!orderIds || !orderIds.length) return;
  const rows = orderIds.map(id => [String(id), new Date().toISOString(), refSync || '']);
  await gsAppend(`${TAB.VENTAS_PROCESADAS}!A2:C`, rows);
}

// ─── CONFIGURACION (clave/valor simple) ──────────────────────────────────────
async function invCargarConfig() {
  if (!gsConnected()) return {};
  const res = await gsGet(`${TAB.CONFIGURACION}!A2:B`);
  const out = {};
  (res.values || []).forEach(r => { if (r[0]) out[r[0]] = r[1]; });
  return out;
}
async function invGuardarConfig(clave, valor) {
  const res = await gsGet(`${TAB.CONFIGURACION}!A2:B`);
  const rows = res.values || [];
  const idx = rows.findIndex(r => r[0] === clave);
  if (idx >= 0) await gsUpdate(`${TAB.CONFIGURACION}!A${idx + 2}:B${idx + 2}`, [[clave, valor]]);
  else await gsAppend(`${TAB.CONFIGURACION}!A2:B`, [[clave, valor]]);
}

// ─── Util ─────────────────────────────────────────────────────────────────────
function invNuevoId(prefijo) {
  return `${prefijo}-${Date.now().toString(36).toUpperCase()}`;
}
