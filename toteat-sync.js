// ══════════════════════════════════════════════════════════════
// Rita Roux · Inventario — Sincronización de ventas Toteat
// Reutiliza el proxy YA EN PRODUCCIÓN de "Reportes toteat" (Railway, CORS
// abierto) — no se levanta ningún backend nuevo para este sistema.
// Toteat se usa SOLO como fuente de ventas (para descontar stock vía receta);
// nunca como fuente de "stock" (ver hallazgo documentado: /api/inventorystate
// de Toteat no tiene compras ni conteos físicos registrados, no es confiable).
//
// LIMITACIÓN CONOCIDA (Fase 1): el descuento usa siempre los ingredientes POR
// DEFECTO de la receta (hoja "Recetas"). Si el cliente elige un modificador
// (ej. "Leche Avena" en vez de "Leche"), ese cambio no se refleja todavía en
// qué ingrediente se descuenta — siempre se descuenta el ingrediente por
// defecto de la receta. Mejorarlo requeriría mapear `lineReference` de cada
// línea de modificador contra el producto padre, igual que ya hace
// `Reporte semanal.html` para el COSTO en pesos (no para la IDENTIDAD del
// ingrediente) — queda como mejora futura, no bloquea Fase 1.
// ══════════════════════════════════════════════════════════════

function _toteatFmtFecha(yyyyMmDd) { return (yyyyMmDd || '').replaceAll('-', ''); }

async function toteatFetchVentas(fechaIni, fechaFin) {
  const ini = _toteatFmtFecha(fechaIni);
  const end = _toteatFmtFecha(fechaFin);
  const res = await fetch(`${TOTEAT_PROXY_BASE}/api/sales?ini=${ini}&end=${end}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} al consultar Toteat`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.msg || 'Error de la API de Toteat');
  return json.data || [];
}

// Sincroniza un rango de fechas: descuenta stock según receta por cada producto
// vendido (deduplicado por orderId, omitiendo lo ya procesado en syncs anteriores).
async function toteatSincronizarVentas(fechaIni, fechaFin, recetasObj, ingredientesObj, onProgress) {
  const log = m => { if (onProgress) onProgress(m); };

  log('Descargando ventas desde Toteat…');
  const ordenesRaw = await toteatFetchVentas(fechaIni, fechaFin);

  log('Revisando órdenes ya procesadas…');
  const procesadas = await invOrdenesProcesadas();

  const seenIds = new Set();
  const ordenesNuevas = [];
  for (const o of ordenesRaw) {
    const oid = String(o.orderId);
    if (seenIds.has(oid) || procesadas.has(oid)) continue; // dedup split-payment + dedup contra syncs anteriores
    seenIds.add(oid);
    ordenesNuevas.push(o);
  }

  if (!ordenesNuevas.length) {
    return { ordenesEnRango: ordenesRaw.length, ordenesNuevas: 0, consumo: [], productosSinReceta: [] };
  }

  log(`Calculando consumo de ingredientes de ${ordenesNuevas.length} órdenes nuevas…`);
  const consumoMap = {}; // idIngrediente -> {nombre, unidad, cantidad}
  const sinRecetaMap = {}; // pid -> {nombre, cantidad}

  for (const o of ordenesNuevas) {
    for (const p of (o.products || [])) {
      const pid = String(p.id || '');
      const qtyVendida = p.quantity || 0;
      if (!pid || qtyVendida <= 0) continue;
      const receta = recetasObj[pid];
      if (!receta) {
        if (!sinRecetaMap[pid]) sinRecetaMap[pid] = { nombre: p.name || pid, cantidad: 0 };
        sinRecetaMap[pid].cantidad += qtyVendida;
        continue;
      }
      for (const ing of (receta.ing || [])) {
        if (!ing.id) continue;
        const qtyIng = parseFloat(String(ing.qty).replace(',', '.')) || 0;
        if (!consumoMap[ing.id]) consumoMap[ing.id] = { nombre: ing.name, unidad: ing.unit, cantidad: 0, costoKilo: ing.costoKilo || 0 };
        consumoMap[ing.id].cantidad += qtyIng * qtyVendida;
      }
    }
  }

  const refSync = `VENTA-SYNC-${new Date().toISOString().slice(0, 19)}`;
  const movs = Object.entries(consumoMap).map(([idIng, c]) => {
    const ingMaestro = (ingredientesObj || {})[idIng];
    const costo = (ingMaestro && ingMaestro.costoActual) || c.costoKilo || '';
    return {
      fecha: new Date().toISOString(),
      tipo: MOV.VENTA,
      idIngrediente: idIng,
      nombreIngrediente: c.nombre,
      cantidad: -Math.abs(c.cantidad),
      unidad: c.unidad,
      costoUnitario: costo, // costo vigente al momento de la venta — queda fijo en el ledger para no distorsionar el histórico si el costo cambia después
      referencia: refSync,
      usuario: 'Sync Toteat',
      comentario: `Ventas ${fechaIni} a ${fechaFin} (${ordenesNuevas.length} órdenes)`,
    };
  });

  log('Guardando movimientos de stock…');
  await invAgregarMovimientos(movs);

  log('Marcando órdenes como procesadas…');
  await invMarcarOrdenesProcesadas(ordenesNuevas.map(o => o.orderId), refSync);

  return {
    ordenesEnRango: ordenesRaw.length,
    ordenesNuevas: ordenesNuevas.length,
    consumo: Object.entries(consumoMap).map(([id, c]) => ({ id, ...c })),
    productosSinReceta: Object.entries(sinRecetaMap).map(([id, c]) => ({ id, ...c })),
  };
}
