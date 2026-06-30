// ══════════════════════════════════════════════════════════════
// Rita Roux · Inventario — Puntaje de compras con el PROVEEDOR como eje
// Compartido entre inicio.html (alarma) y lista-compras.html (detalle).
//
// Cómo funciona:
// 1) Cada ingrediente tiene una urgencia propia según qué tan bajo está su stock.
// 2) El PROVEEDOR acumula la urgencia de TODOS sus ingredientes — ese es su puntaje.
// 3) Cuando el puntaje del proveedor supera su umbral, salta la alarma para
//    hacer el pedido a ESE proveedor (no se mira producto por producto).
// 4) El umbral se ajusta por el tiempo de entrega: un proveedor que demora más
//    en entregar tiene un umbral más bajo (se alarma antes), para no quedar sin
//    stock mientras se espera el despacho.
// ══════════════════════════════════════════════════════════════

const URGENCIA_STOCK         = { 'Agotado': 100, 'Bajo mínimo': 70, 'Cerca del mínimo': 40 };
const UMBRAL_ITEM            = 40;   // bajo este puntaje, un producto individual no aparece en el detalle
const PESO_BONO_PROVEEDOR    = 0.25; // cuánto "contagia" la urgencia de un producto a los demás del mismo proveedor
const UMBRAL_BASE_PROVEEDOR  = 100;  // umbral de alarma si el proveedor entrega el mismo día (tiempo entrega = 0)
const AJUSTE_POR_DIA_ENTREGA = 8;    // cada día de plazo de entrega baja el umbral en esto
const UMBRAL_MIN_PROVEEDOR   = 30;   // piso — nunca bajar de aquí aunque el plazo sea muy largo

function estadoIngredienteCompras(stock, minimo, seguimiento) {
  if (seguimiento === 'NO_CONTAR') return 'No se sigue';
  if (!minimo) return 'Sin mínimo';
  if (stock <= 0) return 'Agotado';
  if (stock < minimo) return 'Bajo mínimo';
  if (stock < minimo * 1.3) return 'Cerca del mínimo';
  return 'OK';
}

function umbralProveedor(tiempoEntregaDias) {
  const dias = tiempoEntregaDias || 0;
  return Math.max(UMBRAL_MIN_PROVEEDOR, UMBRAL_BASE_PROVEEDOR - dias * AJUSTE_POR_DIA_ENTREGA);
}

function slugProveedor(nombre) {
  return (nombre || 'sin-proveedor').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sin-proveedor';
}

// Devuelve un arreglo de proveedores, cada uno con su puntaje, umbral, alarma
// (true/false) e ítems sugeridos — ordenados primero los que están en alarma.
function calcularComprasSugeridas(ingredientesObj, stockObj, proveedoresObj) {
  const urgenciaPropia = {};
  Object.values(ingredientesObj).forEach(i => {
    const est = estadoIngredienteCompras(stockObj[i.id] || 0, i.stockMinimo, i.seguimiento);
    urgenciaPropia[i.id] = URGENCIA_STOCK[est] || 0;
  });

  // Puntaje del proveedor = suma de la urgencia de TODOS sus productos (eje central).
  const puntajeProveedor = {};
  Object.values(ingredientesObj).forEach(i => {
    const prov = i.proveedor || 'Sin proveedor';
    puntajeProveedor[prov] = (puntajeProveedor[prov] || 0) + urgenciaPropia[i.id];
  });

  // Detalle de productos a mostrar dentro de cada proveedor (igual lógica de bono que antes).
  const itemsPorProveedor = {};
  Object.values(ingredientesObj).forEach(i => {
    if (i.seguimiento === 'NO_CONTAR') return;
    const prov = i.proveedor || 'Sin proveedor';
    const bono = (puntajeProveedor[prov] - urgenciaPropia[i.id]) * PESO_BONO_PROVEEDOR;
    const score = Math.round(urgenciaPropia[i.id] + bono);
    if (score < UMBRAL_ITEM) return;
    const stockAct = stockObj[i.id] || 0;
    const sugerida = i.stockMinimo ? Math.max(0, Math.round((i.stockMinimo - stockAct) * 100) / 100) : 0;
    (itemsPorProveedor[prov] = itemsPorProveedor[prov] || []).push({
      idIngrediente: i.id, nombre: i.nombre, unidad: i.unidad,
      motivo: urgenciaPropia[i.id] >= UMBRAL_ITEM ? 'Urgente' : 'Por proveedor',
      score, cantidadSugerida: sugerida,
    });
  });

  return Object.keys(itemsPorProveedor).map(nombre => {
    const meta = (proveedoresObj || {})[nombre] || {};
    const puntaje = Math.round(puntajeProveedor[nombre] || 0);
    const umbral = umbralProveedor(meta.tiempoEntregaDias);
    return {
      nombre, slug: slugProveedor(nombre), puntaje, umbral, alarma: puntaje >= umbral,
      tiempoEntregaDias: meta.tiempoEntregaDias || 0, diasQueEntrega: meta.diasQueEntrega || '',
      items: itemsPorProveedor[nombre].sort((a, b) => b.score - a.score),
    };
  }).sort((a, b) => (b.alarma - a.alarma) || (b.puntaje - a.puntaje));
}
