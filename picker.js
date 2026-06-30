// ══════════════════════════════════════════════════════════════
// Rita Roux · Inventario — Selector de ingredientes amigable
// Tarjetas grandes + categorías + búsqueda, pensado para usarse en una tablet
// en cocina (dedos, no mouse). Reutilizado por entradas.html e inicio.html.
// Depende de categoriaDeIngrediente() (definida en gsheets.js).
// ══════════════════════════════════════════════════════════════

// Crea el selector dentro de containerEl. onSelect(ingrediente) se llama cada
// vez que se toca una tarjeta (ingrediente = el objeto completo de INGREDIENTES).
function crearPickerIngredientes(containerEl, ingredientesObj, onSelect) {
  let seleccionado = null;
  let categoriaActiva = 'Todas';
  let busqueda = '';

  const categorias = ['Todas', ...new Set(Object.values(ingredientesObj || {}).map(i => categoriaDeIngrediente(i.id).label))]
    .sort((a, b) => a === 'Todas' ? -1 : b === 'Todas' ? 1 : a.localeCompare(b));

  containerEl.innerHTML = `
    <input type="text" class="picker-search" placeholder="🔍 Buscar ingrediente…">
    <div class="picker-cats">${categorias.map(c => `<button type="button" class="picker-cat${c === categoriaActiva ? ' active' : ''}" data-cat="${c}">${c}</button>`).join('')}</div>
    <div class="picker-grid"></div>
    <div class="picker-sel-display" style="display:none;margin-top:10px;padding:10px 14px;background:var(--sage);border-radius:8px;color:#fff;font-size:13px;font-weight:600"></div>
  `;
  const gridEl   = containerEl.querySelector('.picker-grid');
  const searchEl = containerEl.querySelector('.picker-search');
  const selDisplay = containerEl.querySelector('.picker-sel-display');

  function renderGrid() {
    const filtrados = Object.values(ingredientesObj || {}).filter(i => {
      if (categoriaActiva !== 'Todas' && categoriaDeIngrediente(i.id).label !== categoriaActiva) return false;
      if (busqueda && !i.nombre.toLowerCase().includes(busqueda.toLowerCase())) return false;
      return true;
    }).sort((a, b) => a.nombre.localeCompare(b.nombre));

    gridEl.innerHTML = filtrados.map(i => `
      <button type="button" class="picker-card${seleccionado === i.id ? ' sel' : ''}" data-id="${i.id}">
        <div class="picker-ic">${categoriaDeIngrediente(i.id).icon}</div>
        <div class="picker-nm">${i.nombre}</div>
        <div class="picker-un">${i.unidad}</div>
      </button>`).join('') || '<div class="empty">Sin resultados — prueba otra categoría o búsqueda</div>';

    gridEl.querySelectorAll('.picker-card').forEach(b => {
      b.onclick = () => {
        seleccionado = b.dataset.id;
        renderGrid();
        const ing = ingredientesObj[seleccionado];
        // Muestra un aviso claro de qué ingrediente quedó seleccionado
        if (selDisplay && ing) {
          selDisplay.style.display = 'block';
          selDisplay.textContent = `✓ Seleccionado: ${ing.nombre} (${ing.unidad})`;
        }
        onSelect(ing);
      };
    });
  }

  searchEl.oninput = () => { busqueda = searchEl.value; renderGrid(); };
  containerEl.querySelectorAll('.picker-cat').forEach(b => {
    b.onclick = () => {
      categoriaActiva = b.dataset.cat;
      containerEl.querySelectorAll('.picker-cat').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      renderGrid();
    };
  });

  renderGrid();

  return {
    limpiarSeleccion() { seleccionado = null; renderGrid(); if (selDisplay) { selDisplay.style.display = 'none'; selDisplay.textContent = ''; } },
    getSeleccionado() { return seleccionado; },
  };
}
