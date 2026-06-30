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
  LISTA_COMPRAS:      'ListaCompras',
  PROVEEDORES:        'Proveedores',
  QUIEBRES_STOCK:     'QuiebresStock',
  NOTIFICACIONES:     'Notificaciones',
  CONTEO_FISICO:      'ConteoFisico',
};

const HDR = {
  RECETAS:             ['Id Producto','Nombre Producto','Id Ingrediente','Nombre Ingrediente','Cantidad','Unidad','Costo Kilo','Proveedor'],
  // Ingredientes: columna H = Estacion (BARRA | COCINA | GAZON | TODOS).
  // NOTA: la columna G (Categoria Seguimiento) estuvo mal leída antes — arreglado: ahora lee A2:H.
  INGREDIENTES:        ['Id Ingrediente','Nombre','Unidad','Stock Minimo','Costo Actual','Proveedor Principal','Categoria Seguimiento','Estacion'],
  MOVIMIENTOS:         ['Fecha','Tipo','Id Ingrediente','Nombre Ingrediente','Cantidad','Unidad','Costo Unitario','Referencia','Usuario','Comentario'],
  FACTURAS:            ['Id Factura','Nº Documento','Fecha','Proveedor','Tipo','Total','Estado','URL Adjunto','Items JSON'],
  ENTRADAS_PENDIENTES: ['Id Pendiente','Fecha','Proveedor','Items JSON','Estado','Id Factura Asociada'],
  VENTAS_PROCESADAS:   ['Order Id','Fecha Procesado','Referencia Sync'],
  CONFIGURACION:       ['Clave','Valor'],
  LISTA_COMPRAS:       ['Id Item','Id Ingrediente','Nombre Ingrediente','Proveedor','Motivo','Score','Cantidad Sugerida','Cantidad Ajustada','Unidad','Estado','Fecha Generado','Fecha Resuelto'],
  PROVEEDORES:         ['Nombre','Tiempo Entrega Dias','Dias Que Entrega','Telefono','Contacto'],
  QUIEBRES_STOCK:      ['Id Quiebre','Fecha Inicio','Id Ingrediente','Nombre Ingrediente','Proveedor','Fecha Fin','Duracion Dias','Estado'],
  NOTIFICACIONES:  ['Id','Fecha','Hora','Usuario','Rol','Id Ingrediente','Nombre Ingrediente','Cantidad','Unidad','Mensaje'],
  CONTEO_FISICO:   ['Id','Fecha','Hora','Usuario','Rol','Id Ingrediente','Nombre Ingrediente','Cantidad Fisica','Unidad','Stock Calculado','Varianza','Varianza Pct','Estado'],
};

// Tipos de movimiento (event-sourcing — Movimientos es la única fuente de verdad del stock)
const MOV = { ENTRADA: 'ENTRADA', VENTA: 'VENTA', MERMA: 'MERMA', AJUSTE_CONTEO: 'AJUSTE_CONTEO', SALIDA_EVENTO: 'SALIDA_EVENTO' };

// Categoría de seguimiento por ingrediente — para que Joshua priorice qué contar.
// CRITICO: se cuenta seguido (caro o de alta rotación). NORMAL: seguimiento normal.
// NO_CONTAR: nunca genera alerta ni pide conteo (ej. sal, pimienta, especias).
const SEGUIMIENTO = { CRITICO: 'CRITICO', NORMAL: 'NORMAL', NO_CONTAR: 'NO_CONTAR' };

// Categoría visual por prefijo del Id Ingrediente (ver Info Toteat.md) — usada por
// el picker amigable (picker.js) y por el default automático de seguimiento.
const CATEGORIA_PREFIJO = {
  CAF:  { label: 'Café e Infusiones',        icon: '☕' },
  LAC:  { label: 'Lácteos',                  icon: '🥛' },
  FRV:  { label: 'Frutas y Verduras',        icon: '🥬' },
  FVR:  { label: 'Frutas y Verduras',        icon: '🥦' },
  ABA:  { label: 'Abarrotes',                icon: '🛒' },
  SEM:  { label: 'Semillas y Frutos Secos',  icon: '🌰' },
  EMB:  { label: 'Embutidos',                icon: '🥓' },
  QUE:  { label: 'Quesos',                   icon: '🧀' },
  CAR:  { label: 'Carnes y Pescados',        icon: '🥩' },
  CON:  { label: 'Condimentos y Especias',   icon: '🧂' },
  PAN:  { label: 'Panes',                    icon: '🍞' },
  BEB:  { label: 'Bebidas',                  icon: '🥤' },
  BOLL: { label: 'Pastelería',               icon: '🧁' },
  SUB:  { label: 'Preparaciones',            icon: '🍲' },
  SR:   { label: 'Preparaciones',            icon: '🍲' },
};
function categoriaDeIngrediente(id) {
  const prefijo = ((id || '').match(/^[A-Za-z]+/) || [''])[0].toUpperCase();
  return CATEGORIA_PREFIJO[prefijo] || { label: 'Otros', icon: '📦' };
}
// Default razonable al crear un ingrediente nuevo: condimentos/especias nacen
// "No contar" (Joshua puede cambiarlo igual desde Stock si alguno sí le importa).
function seguimientoDefaultPorId(id) {
  const prefijo = ((id || '').match(/^[A-Za-z]+/) || [''])[0].toUpperCase();
  return prefijo === 'CON' ? SEGUIMIENTO.NO_CONTAR : SEGUIMIENTO.NORMAL;
}

// Estación por defecto según el prefijo del SKU:
// BARRA (Sergio) — café, tés, lácteos para cafés.
// COCINA (Kari/Pao/Sara) — todo lo de cocina: frutas, carnes, abarrotes, etc.
// GAZON (meseros: Shuler/Camila/Part Time) — bebidas envasadas y bollería/pasteles.
// TODOS — visible a todos, incluido Jefatura (Joshua/Gerardo).
const ESTACION = { BARRA: 'BARRA', COCINA: 'COCINA', GAZON: 'GAZON', TODOS: 'TODOS' };
function estacionPorId(id) {
  const p = ((id || '').match(/^[A-Za-z]+/) || [''])[0].toUpperCase();
  if (['CAF','LAC'].includes(p))                                    return ESTACION.BARRA;
  if (['BEB','BOL','BOLL'].includes(p))                            return ESTACION.GAZON;
  if (['FRV','FVR','ABA','EMB','QUE','CAR','CON','PAN','SEM','SUB','SR'].includes(p)) return ESTACION.COCINA;
  return ESTACION.TODOS;
}

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
    gsEnsureTab(TAB.LISTA_COMPRAS, HDR.LISTA_COMPRAS),
    gsEnsureTab(TAB.PROVEEDORES, HDR.PROVEEDORES),
    gsEnsureTab(TAB.QUIEBRES_STOCK, HDR.QUIEBRES_STOCK),
    gsEnsureTab(TAB.NOTIFICACIONES, HDR.NOTIFICACIONES),
    gsEnsureTab(TAB.CONTEO_FISICO,  HDR.CONTEO_FISICO),
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
  const res = await gsGet(`${TAB.INGREDIENTES}!A2:H`);  // H = columna Estacion (nueva)
  const out = {};
  (res.values || []).forEach(r => {
    const [id, nombre, unidad, stockMin, costoActual, proveedor, seguimiento, estacion] = r;
    if (!id) return;
    out[id] = {
      id, nombre: nombre || '', unidad: unidad || '', stockMinimo: parseFloat(stockMin) || 0,
      costoActual: parseFloat(costoActual) || 0, proveedor: proveedor || '',
      seguimiento: seguimiento || seguimientoDefaultPorId(id),
      estacion: estacion || '',  // '' = sin asignar todavía (se auto-asigna en estacion.html)
    };
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
    nuevos[i.id] = [i.id, i.name, i.unit, '', i.costoKilo || '', i.proveedor || '', seguimientoDefaultPorId(i.id), estacionPorId(i.id)];
  }));
  const rows = Object.values(nuevos);
  if (rows.length) await gsAppend(`${TAB.INGREDIENTES}!A2:H`, rows);
  return invCargarIngredientes();
}

async function invGuardarIngrediente(ing) {
  const res = await gsGet(`${TAB.INGREDIENTES}!A2:H`);
  const rows = res.values || [];
  const idx = rows.findIndex(r => r[0] === ing.id);
  const estacion = ing.estacion || (rows[idx] ? rows[idx][7] || '' : estacionPorId(ing.id));
  const fila = [ing.id, ing.nombre, ing.unidad, ing.stockMinimo, ing.costoActual, ing.proveedor, ing.seguimiento || SEGUIMIENTO.NORMAL, estacion];
  if (idx >= 0) {
    await gsUpdate(`${TAB.INGREDIENTES}!A${idx + 2}:H${idx + 2}`, [fila]);
  } else {
    await gsAppend(`${TAB.INGREDIENTES}!A2:H`, [fila]);
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

// ─── LISTA DE COMPRAS SUGERIDA ────────────────────────────────────────────────
// Cada fila queda guardada en el Sheet apenas se sugiere — nada vive solo en
// memoria del navegador, así no se pierde si se cierra la pestaña o cambia de equipo.
async function invCargarListaCompras() {
  if (!gsConnected()) return [];
  const res = await gsGet(`${TAB.LISTA_COMPRAS}!A2:L`);
  return (res.values || []).map((r, i) => ({
    fila: i + 2, id: r[0] || '', idIngrediente: r[1] || '', nombre: r[2] || '', proveedor: r[3] || '',
    motivo: r[4] || '', score: parseFloat(r[5]) || 0, cantidadSugerida: parseFloat(r[6]) || 0,
    cantidadAjustada: parseFloat(r[7]) || 0, unidad: r[8] || '', estado: r[9] || 'Sugerido',
    fechaGenerado: r[10] || '', fechaResuelto: r[11] || '',
  }));
}

async function invAgregarItemsListaCompras(items) {
  if (!items || !items.length) return;
  const rows = items.map(i => [i.id, i.idIngrediente, i.nombre, i.proveedor, i.motivo, i.score, i.cantidadSugerida, i.cantidadAjustada, i.unidad, i.estado || 'Sugerido', i.fechaGenerado || new Date().toISOString(), '']);
  await gsAppend(`${TAB.LISTA_COMPRAS}!A2:L`, rows);
}

async function invActualizarItemListaCompras(fila, cambios) {
  // Lee la fila actual para no pisar columnas que no cambiaron.
  const res = await gsGet(`${TAB.LISTA_COMPRAS}!A${fila}:L${fila}`);
  const r = (res.values || [[]])[0];
  const actual = {
    id: r[0] || '', idIngrediente: r[1] || '', nombre: r[2] || '', proveedor: r[3] || '', motivo: r[4] || '',
    score: r[5] || '', cantidadSugerida: r[6] || '', cantidadAjustada: r[7] || '', unidad: r[8] || '',
    estado: r[9] || 'Sugerido', fechaGenerado: r[10] || '', fechaResuelto: r[11] || '',
  };
  const final = { ...actual, ...cambios };
  await gsUpdate(`${TAB.LISTA_COMPRAS}!A${fila}:L${fila}`, [[final.id, final.idIngrediente, final.nombre, final.proveedor, final.motivo, final.score, final.cantidadSugerida, final.cantidadAjustada, final.unidad, final.estado, final.fechaGenerado, final.fechaResuelto]]);
}

// ─── PROVEEDORES (tiempo de entrega, para ajustar el umbral de alarma) ───────
async function invCargarProveedores() {
  if (!gsConnected()) return {};
  const res = await gsGet(`${TAB.PROVEEDORES}!A2:E`);
  const out = {};
  (res.values || []).forEach(r => {
    const [nombre, tiempoEntrega, diasQueEntrega, telefono, contacto] = r;
    if (!nombre) return;
    out[nombre] = { nombre, tiempoEntregaDias: parseFloat(tiempoEntrega) || 0, diasQueEntrega: diasQueEntrega || '', telefono: telefono || '', contacto: contacto || '' };
  });
  return out;
}

async function invGuardarProveedor(prov) {
  const res = await gsGet(`${TAB.PROVEEDORES}!A2:E`);
  const rows = res.values || [];
  const idx = rows.findIndex(r => r[0] === prov.nombre);
  const fila = [prov.nombre, prov.tiempoEntregaDias || 0, prov.diasQueEntrega || '', prov.telefono || '', prov.contacto || ''];
  if (idx >= 0) await gsUpdate(`${TAB.PROVEEDORES}!A${idx + 2}:E${idx + 2}`, [fila]);
  else await gsAppend(`${TAB.PROVEEDORES}!A2:E`, [fila]);
}

// Asegura que todo proveedor que aparece en Ingredientes tenga una fila propia
// (con tiempo de entrega en 0 hasta que alguien lo complete) — así nunca falta
// uno en la pantalla de configuración, aunque nunca se haya tocado antes.
async function invSembrarProveedoresDesdeIngredientes(ingredientesObj) {
  const actuales = await invCargarProveedores();
  const nombres = new Set(Object.values(ingredientesObj || {}).map(i => i.proveedor).filter(Boolean));
  const nuevos = [];
  nombres.forEach(n => { if (!actuales[n]) nuevos.push([n, 0, '', '', '']); });
  if (nuevos.length) await gsAppend(`${TAB.PROVEEDORES}!A2:E`, nuevos);
  return nuevos.length ? invCargarProveedores() : actuales;
}

// ─── QUIEBRES DE STOCK (historial por proveedor, para análisis futuro) ───────
async function invCargarQuiebresStock() {
  if (!gsConnected()) return [];
  const res = await gsGet(`${TAB.QUIEBRES_STOCK}!A2:H`);
  return (res.values || []).map((r, i) => ({
    fila: i + 2, id: r[0] || '', fechaInicio: r[1] || '', idIngrediente: r[2] || '', nombreIngrediente: r[3] || '',
    proveedor: r[4] || 'Sin proveedor', fechaFin: r[5] || '', duracionDias: parseFloat(r[6]) || 0, estado: r[7] || 'Abierto',
  }));
}
async function invAgregarQuiebreStock(q) {
  await gsAppend(`${TAB.QUIEBRES_STOCK}!A2:H`, [[q.id, q.fechaInicio, q.idIngrediente, q.nombreIngrediente, q.proveedor, '', '', 'Abierto']]);
}
async function invCerrarQuiebreStock(fila, fechaFin, duracionDias) {
  await gsUpdate(`${TAB.QUIEBRES_STOCK}!F${fila}:H${fila}`, [[fechaFin, duracionDias, 'Cerrado']]);
}

// Detecta automáticamente cuándo un ingrediente entra/sale de quiebre (stock <= 0)
// y deja el registro guardado en el Sheet — se llama cada vez que se carga Inicio
// o Stock, así el historial queda completo sin que nadie tenga que registrarlo a mano.
async function invSincronizarQuiebresStock(ingredientesObj, stockObj) {
  const quiebres = await invCargarQuiebresStock();
  const abiertos = {};
  quiebres.forEach(q => { if (q.estado === 'Abierto') abiertos[q.idIngrediente] = q; });

  for (const i of Object.values(ingredientesObj || {})) {
    if (i.seguimiento === 'NO_CONTAR') continue;
    const stock = stockObj[i.id] || 0;
    const abierto = abiertos[i.id];
    if (stock <= 0 && !abierto) {
      await invAgregarQuiebreStock({ id: invNuevoId('QB'), fechaInicio: new Date().toISOString(), idIngrediente: i.id, nombreIngrediente: i.nombre, proveedor: i.proveedor || 'Sin proveedor' });
    } else if (stock > 0 && abierto) {
      const dias = Math.max(0, Math.round((Date.now() - new Date(abierto.fechaInicio).getTime()) / 86400000 * 10) / 10);
      await invCerrarQuiebreStock(abierto.fila, new Date().toISOString(), dias);
    }
  }
}

// ─── NOTIFICACIONES (actividad de bodega visible para Joshua en inicio.html) ──
async function invAgregarNotificacion(n) {
  await gsAppend(`${TAB.NOTIFICACIONES}!A2:J`, [[
    invNuevoId('NOT'), n.fecha || new Date().toISOString().slice(0,10), n.hora || new Date().toTimeString().slice(0,5),
    n.usuario || '', n.rol || '', n.idIngrediente || '', n.nombreIngrediente || '',
    n.cantidad || '', n.unidad || '', n.mensaje || '',
  ]]);
}
async function invCargarNotificaciones(limit) {
  if (!gsConnected()) return [];
  const res = await gsGet(`${TAB.NOTIFICACIONES}!A2:J`);
  const rows = (res.values || []).map(r => ({
    id: r[0]||'', fecha: r[1]||'', hora: r[2]||'', usuario: r[3]||'', rol: r[4]||'',
    idIngrediente: r[5]||'', nombreIngrediente: r[6]||'', cantidad: r[7]||'', unidad: r[8]||'', mensaje: r[9]||'',
  }));
  rows.reverse(); // más recientes primero
  return limit ? rows.slice(0, limit) : rows;
}

// Auto-asigna la estación a todos los ingredientes que todavía no tienen una.
// Se llama desde estacion.html la primera vez que alguien abre la app de estación.
async function invSeedEstaciones() {
  const res = await gsGet(`${TAB.INGREDIENTES}!A2:H`);
  const rows = res.values || [];
  const sinEstacion = rows.map((r, i) => ({ idx: i, r })).filter(({ r }) => r[0] && !r[7]);
  if (!sinEstacion.length) return 0;
  for (const { idx, r } of sinEstacion) {
    r[7] = estacionPorId(r[0]);
    await gsUpdate(`${TAB.INGREDIENTES}!H${idx + 2}:H${idx + 2}`, [[r[7]]]);
  }
  return sinEstacion.length;
}

// ─── CONTEO FÍSICO ────────────────────────────────────────────────────────────
async function invCargarConteoFisico(limit) {
  if (!gsConnected()) return [];
  const res = await gsGet(`${TAB.CONTEO_FISICO}!A2:M`);
  const rows = (res.values || []).map(r => ({
    id: r[0]||'', fecha: r[1]||'', hora: r[2]||'', usuario: r[3]||'', rol: r[4]||'',
    idIngrediente: r[5]||'', nombreIngrediente: r[6]||'',
    cantidadFisica: parseFloat(r[7])||0, unidad: r[8]||'',
    stockCalculado: parseFloat(r[9])||0, varianza: parseFloat(r[10])||0,
    varianzaPct: parseFloat(r[11])||0, estado: r[12]||'',
  }));
  rows.reverse();
  return limit ? rows.slice(0, limit) : rows;
}

// ── Umbral de varianza por unidad de medida ─────────────────────────────────
// Para unidades de peso/volumen (kg, L, g…) un ±5% es normal por diferencias de
// medición. Para unidades enteras (UN, pza…) no debería haber diferencia.
const UMBRAL_VARIANZA = { kg:5, l:5, lt:5, ml:5, g:5, gr:5, gl:5, un:0, und:0, unid:0, pza:0, pieza:0 };
const UMBRAL_DEFAULT  = 5; // % para unidades no reconocidas

function invUmbralDeUnidad(u) {
  const k = (u||'').toLowerCase().trim();
  return k in UMBRAL_VARIANZA ? UMBRAL_VARIANZA[k] : UMBRAL_DEFAULT;
}

function invEstadoVarianza(varianzaPct, unidad) {
  const tol = invUmbralDeUnidad(unidad);
  const abs = Math.abs(varianzaPct||0);
  if (abs <= tol)       return { estado: 'OK',            cls: 'ok',  emoji: '🟢' };
  if (abs <= tol * 2.5) return { estado: 'Revisar',       cls: 'warn',emoji: '🟡' };
  return                       { estado: 'Discrepancia',  cls: 'bad', emoji: '🔴' };
}

// ── Triangulación (dashboard) ────────────────────────────────────────────────
// Compara A (entradas registradas) vs B (stock calculado = entradas - ventas Toteat)
// vs C (conteo físico) con el umbral de tolerancia por tipo de unidad.
// Retorna un arreglo de {ingrediente, entradas, stockCalculado, conteoFisico, varianza, varianzaPct, estado}
function invTriangular(ingredientesObj, movimientosArr, conteoFisicoArr) {
  const stockCalc = invCalcularStock(movimientosArr);
  // Últimos conteos físicos por ingrediente (el más reciente)
  const ultimoConteo = {};
  [...conteoFisicoArr].reverse().forEach(c => {
    if (!ultimoConteo[c.idIngrediente]) ultimoConteo[c.idIngrediente] = c;
  });
  const entradas = {};
  movimientosArr.filter(m => m.tipo === 'ENTRADA').forEach(m => {
    entradas[m.idIngrediente] = (entradas[m.idIngrediente]||0) + m.cantidad;
  });

  return Object.values(ingredientesObj)
    .filter(i => i.seguimiento !== 'NO_CONTAR')
    .map(i => {
      const calc  = stockCalc[i.id] || 0;
      const fis   = ultimoConteo[i.id] ? ultimoConteo[i.id].cantidadFisica : null;
      const ent   = entradas[i.id] || 0;
      const var_  = fis !== null ? fis - calc : null;
      const varPct = (fis !== null && calc) ? Math.round(Math.abs(var_/calc)*1000)/10 : null;
      const est   = varPct !== null ? invEstadoVarianza(varPct, i.unidad) : null;
      return {
        id: i.id, nombre: i.nombre, unidad: i.unidad, proveedor: i.proveedor,
        entradas: ent, stockCalculado: calc,
        conteoFisico: fis, varianza: var_, varianzaPct: varPct,
        estado: est, fechaConteo: ultimoConteo[i.id]?.fecha || null,
        usuarioConteo: ultimoConteo[i.id]?.usuario || null,
      };
    })
    .sort((a,b) => {
      // Primero los que tienen discrepancia, luego por nombre
      const p = { Discrepancia:0, Revisar:1, OK:2, null:3 };
      const pa = p[a.estado?.estado] ?? 3;
      const pb = p[b.estado?.estado] ?? 3;
      return pa !== pb ? pa-pb : a.nombre.localeCompare(b.nombre);
    });
}

// ─── Util ─────────────────────────────────────────────────────────────────────
function invNuevoId(prefijo) {
  return `${prefijo}-${Date.now().toString(36).toUpperCase()}`;
}
