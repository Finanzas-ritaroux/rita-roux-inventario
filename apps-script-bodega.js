// ══════════════════════════════════════════════════════════════
// Rita Roux — Apps Script Backend para Estación de Bodega
// ══════════════════════════════════════════════════════════════
// CÓMO CONFIGURAR (una sola vez, lo hace Gerardo o Joshua):
//
// 1. Ir a script.google.com → "Nuevo proyecto"
// 2. Pegar TODO este código en el editor, reemplazando el código vacío
// 3. En la línea SHEET_ID, pegar el ID de la hoja (ya está correcto abajo)
// 4. Menú "Implementar" → "Nueva implementación"
//    - Tipo: Aplicación web
//    - Ejecutar como: YO (tu cuenta @ritaroux.cl)
//    - Quién puede acceder: CUALQUIER PERSONA
// 5. Autorizar cuando Google lo pida (da acceso al Sheet, no al Gmail)
// 6. Copiar la URL de implementación (termina en /exec) y pegarla
//    en la variable APPS_SCRIPT_URL de estacion.html
// 7. Desde el dashboard de inventario, ir a Configuración → Estación
//    y establecer el PIN de 4 dígitos que usará el tablet
//
// SEGURIDAD: el tablet nunca ve credenciales de Google — solo el PIN.
// El PIN viaja cifrado con HTTPS. Nadie puede leer tu Gmail desde el tablet.
// ══════════════════════════════════════════════════════════════

const SHEET_ID = '1TVmY9QsDNb6yXdgk8XhtkexYHIe4uZWNgkpnULyGHuM';

// ── Handler principal ────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const res  = procesarAccion(body);
    return jsonResp(res);
  } catch (err) {
    return jsonResp({ ok: false, error: String(err) });
  }
}

// GET para verificar que el script funciona (no necesita PIN)
function doGet(e) {
  return ContentService.createTextOutput('Rita Roux Bodega API · OK').setMimeType(ContentService.MimeType.TEXT);
}

function jsonResp(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

// PIN eliminado — el acceso al tablet se gestiona a nivel de red (WiFi de la cafetería)
// o con el bloqueo de pantalla de Android, no con un PIN en la app.

// ── Acciones ─────────────────────────────────────────────────────────────────
function procesarAccion(data) {
  const accion = data.accion;

  // ── Acciones que no necesitan PIN (solo lectura básica) ────────────────────
  if (accion === 'getIngredientes') {
    const ss   = SpreadsheetApp.openById(SHEET_ID);
    const hoja = ss.getSheetByName('Ingredientes');
    if (!hoja) return { ok: false, error: 'Hoja Ingredientes no encontrada' };
    const lr   = hoja.getLastRow();
    if (lr < 2) return { ok: true, data: [] };
    const rows = hoja.getRange(2, 1, lr - 1, 8).getValues();
    return { ok: true, data: rows.filter(r => r[0]) };
  }

  if (accion === 'getConfig') {
    const ss   = SpreadsheetApp.openById(SHEET_ID);
    const hoja = ss.getSheetByName('Configuracion');
    if (!hoja) return { ok: true, data: {} };
    const lr   = hoja.getLastRow();
    if (lr < 2) return { ok: true, data: {} };
    const rows = hoja.getRange(2, 1, lr - 1, 2).getValues();
    const cfg  = {};
    rows.filter(r => r[0]).forEach(r => { cfg[r[0]] = r[1]; });
    return { ok: true, data: cfg };
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);

  // ── Registrar entrada de mercadería ───────────────────────────────────────
  if (accion === 'registrarEntrada') {
    const hoja = ss.getSheetByName('Movimientos');
    if (!hoja) return { ok: false, error: 'Hoja Movimientos no encontrada' };
    // tipoMovimiento viene como 'ENTRADA' o 'SALIDA_BODEGA' desde la app del tablet
    const tipo = data.tipoMovimiento || 'ENTRADA';
    hoja.appendRow([
      data.fecha, tipo, data.idIngrediente, data.nombreIngrediente,
      data.cantidad, data.unidad, data.costoUnitario || '',
      data.referencia || `Estación ${data.rol}`, data.usuario, ''
    ]);
    // Notificación
    const notif = ss.getSheetByName('Notificaciones');
    if (notif) {
      notif.appendRow([
        data.id || Utilities.getUuid(),
        data.fecha, data.hora || '', data.usuario, data.rol,
        data.idIngrediente, data.nombreIngrediente,
        data.cantidad, data.unidad,
        `${data.usuario} ha agregado ${data.cantidad} ${data.unidad} de ${data.nombreIngrediente} al inventario`
      ]);
    }
    return { ok: true };
  }

  // ── Registrar conteo físico ───────────────────────────────────────────────
  if (accion === 'registrarConteo') {
    let hoja = ss.getSheetByName('ConteoFisico');
    if (!hoja) {
      hoja = ss.insertSheet('ConteoFisico');
      hoja.getRange(1, 1, 1, 13).setValues([[
        'Id','Fecha','Hora','Usuario','Rol',
        'Id Ingrediente','Nombre Ingrediente','Cantidad Fisica','Unidad',
        'Stock Calculado','Varianza','Varianza Pct','Estado'
      ]]);
    }
    hoja.appendRow([
      data.id || Utilities.getUuid(),
      data.fecha, data.hora || '', data.usuario, data.rol,
      data.idIngrediente, data.nombreIngrediente,
      data.cantidadFisica, data.unidad,
      data.stockCalculado, data.varianza, data.varianzaPct, data.estado
    ]);
    // Actualizar fecha último conteo para esta estación en Configuracion
    actualizarConfig(ss, `ultimo_conteo_${(data.rol||'').toLowerCase()}`, data.fecha);
    return { ok: true };
  }

  // ── Registrar múltiples movimientos de una vez (entrada masiva por proveedor) ──
  if (accion === 'registrarEntradaMasiva') {
    const hojaMovs  = ss.getSheetByName('Movimientos');
    const hojaNotif = ss.getSheetByName('Notificaciones');
    if (!hojaMovs) return { ok: false, error: 'Hoja Movimientos no encontrada' };
    const movs = data.movimientos || [];
    for (const m of movs) {
      hojaMovs.appendRow([
        m.fecha, m.tipo, m.idIngrediente, m.nombreIngrediente,
        m.cantidad, m.unidad, m.costoUnitario || '',
        m.referencia || '', m.usuario || '', m.comentario || ''
      ]);
    }
    if (hojaNotif && data.mensaje) {
      hojaNotif.appendRow([
        Utilities.getUuid(), data.fecha || '', data.hora || '',
        data.usuario || '', data.proveedor || '',
        '', data.proveedor || '', movs.length, '',
        data.mensaje
      ]);
    }
    return { ok: true, registrados: movs.length };
  }

  return { ok: false, error: `Acción desconocida: ${accion}` };
}

// Actualiza o crea una clave en la hoja Configuracion
function actualizarConfig(ss, clave, valor) {
  const hoja = ss.getSheetByName('Configuracion');
  if (!hoja) return;
  const lr = hoja.getLastRow();
  if (lr >= 2) {
    const vals = hoja.getRange(2, 1, lr - 1, 2).getValues();
    const idx  = vals.findIndex(r => r[0] === clave);
    if (idx >= 0) { hoja.getRange(idx + 2, 2).setValue(valor); return; }
  }
  hoja.appendRow([clave, valor]);
}
