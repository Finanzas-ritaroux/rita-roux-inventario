# Inventario Rita Roux Café

Sistema web de gestión de inventario para la cafetería: productos/recetas, stock por ingrediente, entradas de mercadería (con o sin factura), mermas, costos y márgenes — con descuento automático de stock cuando se sincronizan las ventas de Toteat.

Es un sitio 100% estático (HTML/CSS/JS, sin build, sin backend propio) que usa **Google Sheets como base de datos** y **Google Drive** para guardar adjuntos de facturas. Pensado para alojarse en GitHub Pages, igual que los demás sistemas de Rita Roux.

## Fase actual: Fase 1

| Módulo | Archivo | Qué hace |
|---|---|---|
| Inicio | `inicio.html` | Dashboard: alertas de stock bajo, valor de inventario, accesos rápidos |
| Productos y Recetas | `productos-recetas.html` | CRUD de productos e ingredientes por receta (hoja `Recetas`, compartida con el editor de `Reportes toteat`) |
| Stock | `stock.html` | Stock actual por ingrediente (calculado desde el log de movimientos), umbrales mínimos, botón de sincronización de ventas Toteat |
| Entradas | `entradas.html` | Recepción de mercadería: factura XML (DTE, lectura automática), factura manual + adjunto, o sin factura (pendiente, asociable después) |
| Mermas | `mermas.html` | Registro de pérdidas/roturas/caducidad con motivo |
| Costos | `costos.html` | Costo por producto, margen vs. precio oficial de Toteat, evolución de costo de insumos |

**Fase 2 (siguiente):** conteo físico (comparar teórico vs. real y ajustar), lista de compras automática, maestro de proveedores con historial.
**Fase 3 (después):** módulo de eventos (descuento a centro de costo de eventos), lectura por IA de fotos/PDF de boletas sin factura electrónica, posible sincronización automática programada.

## Cómo funciona (arquitectura)

- **Sin backend propio.** Para leer ventas de Toteat, este sistema llama directo al proxy que ya está en producción para "Reportes toteat" (`https://web-production-12ac3.up.railway.app/api/sales`), que ya tiene CORS abierto. No hay credenciales de Toteat en este repositorio.
- **Google Sheets es la fuente de verdad del stock**, no Toteat: Toteat trae su propio módulo de inventario, pero no se usa porque nunca se le han registrado compras ni conteos físicos (quedaría con saldos negativos sin sentido). Aquí el stock se calcula sumando un log de movimientos (`Movimientos`): entradas, ventas, mermas y ajustes de conteo.
- **Misma hoja que las Recetas de la cafetería.** Se reutiliza el Google Sheet "Rita Roux — Recetas Cafetería" (pestaña `Recetas` ya existente) y se le agregan pestañas nuevas: `Ingredientes`, `Movimientos`, `Facturas`, `EntradasPendientes`, `VentasProcesadas`, `Configuracion`. Se crean solas la primera vez que alguien se conecta (botón "Conectar" → Google).

## Configuración pendiente (antes de usarlo)

Son 3 tareas, en este orden. Las dos primeras las hace una sola vez quien administre las cuentas de Rita Roux (probablemente Gerardo); la tercera la hace quien vaya a usar el sistema día a día.

---

### TAREA 1 — Terminar el proyecto de Google Cloud (OAuth)

Esto le da permiso al sistema para leer/escribir el Google Sheet y guardar archivos en Drive. Es el **mismo proyecto y mismo Client ID** que quedó pendiente para el editor de Recetas de la cafetería (`Reportes toteat/gsheets-cafeteria.js`) — termínalo una sola vez y sirve para los dos sistemas.

**1.1 — Crear (o entrar a) un proyecto de Google Cloud**

1. Entra a [console.cloud.google.com](https://console.cloud.google.com/) con la cuenta de Gmail que va a administrar esto (idealmente la cuenta de Rita Roux, no una personal).
2. Si es tu primera vez ahí, Google te va a pedir aceptar los términos de servicio — acepta.
3. Arriba a la izquierda, al lado del logo "Google Cloud", hay un selector de proyecto. Si ya existe un proyecto de un intento anterior para Recetas Cafetería, **selecciónalo y úsalo** (no crear uno nuevo). Si no existe ninguno:
   - Click en el selector → **"Proyecto nuevo"**.
   - Nombre: por ejemplo `Rita Roux Sistemas` (el nombre no afecta el funcionamiento).
   - Click **"Crear"** y espera unos 15-30 segundos (aparece un aviso de campana arriba a la derecha cuando termina).
   - Verifica que el selector de proyecto, arriba, muestre el proyecto recién creado.

**1.2 — Habilitar las dos APIs que se necesitan**

1. Menú ☰ (arriba a la izquierda) → **"APIs y servicios"** → **"Biblioteca"**.
2. Escribe en el buscador **"Google Sheets API"** → entra al resultado → botón azul **"Habilitar"**.
3. Vuelve a la Biblioteca (flecha atrás) → escribe **"Google Drive API"** → entra → **"Habilitar"**.

**1.3 — Configurar la Pantalla de Consentimiento OAuth**

1. Menú ☰ → **"APIs y servicios"** → **"Pantalla de consentimiento de OAuth"**.
2. Tipo de usuario: **"Externo"** → Crear.
3. "Información de la aplicación":
   - Nombre de la app: `Rita Roux — Sistemas Internos`.
   - Correo de asistencia al usuario: el de Finanzas (`Finanzas@ritaroux.cl`).
   - Más abajo, en "Información de contacto del desarrollador": el mismo correo.
   - **"Guardar y continuar"**.
4. "Permisos" (Scopes): click **"Agregar o quitar permisos"** → en el buscador del modal, tilda:
   - `.../auth/spreadsheets` (Google Sheets API)
   - `.../auth/drive.file` (Google Drive API)
   - Click **"Actualizar"** → **"Guardar y continuar"**.
5. "Usuarios de prueba" (⚠ paso clave): click **"Agregar usuarios"** y escribe el Gmail de **cada persona** que va a usar el Inventario o las Recetas (Gerardo, Joshua, etc.). Sin esto, esas cuentas no podrán conectarse. → **"Guardar y continuar"**.
6. "Resumen" → **"Volver al panel"**.

> **Nota sobre "app no verificada":** mientras el proyecto esté en modo "Prueba" (no publicado), al conectar por primera vez Google va a mostrar una pantalla de advertencia tipo *"Google no verificó esta app"*. Es normal para un sistema interno de pocas personas — click en **"Avanzado"** y luego en **"Ir a [nombre de la app] (no seguro)"** para continuar. No hace falta pasar por la verificación pública de Google.

**1.4 — Crear el Client ID**

1. Menú ☰ → **"APIs y servicios"** → **"Credenciales"**.
2. Click **"+ Crear credenciales"** → **"ID de cliente de OAuth"**.
3. Tipo de aplicación: **"Aplicación web"**.
4. Nombre: `Inventario y Recetas Rita Roux`.
5. "Orígenes de JavaScript autorizados" → click **"+ Agregar URI"** una vez por cada uno de estos (se pueden agregar los que falten más adelante, sin perder lo ya hecho):
   - `http://localhost:8765` (para cuando se prueba el Reporte de Toteat en este mismo computador)
   - La URL de GitHub Pages **una vez que exista** (Tarea 2) — solo el dominio, ej. `https://finanzas-ritaroux.github.io` (sin la ruta del repo)
6. "URIs de redireccionamiento autorizados": dejar vacío.
7. Click **"Crear"**.
8. Se abre un modal con un **"ID de cliente"** (termina en `.apps.googleusercontent.com`) — esto es lo único que se necesita. El "Secreto de cliente" que aparece al lado **no se usa**, se puede ignorar.
9. Copia el ID de cliente completo.

**1.5 — Pasarme el Client ID**

Una vez que lo tengas, pásamelo y yo lo dejo pegado en los 2 archivos que lo necesitan: `Inventario Rita Roux/gsheets.js` (constante `GS_CLIENT_ID`) y `Reportes toteat/gsheets-cafeteria.js` (constante `GSC_CLIENT_ID`) — deben quedar exactamente iguales.

**1.6 — Compartir el Google Sheet con cada persona**

1. Abre el Sheet: `https://docs.google.com/spreadsheets/d/1TVmY9QsDNb6yXdgk8XhtkexYHIe4uZWNgkpnULyGHuM/edit`
2. Botón **"Compartir"** (arriba a la derecha).
3. Agrega el mismo Gmail de cada persona que pusiste como "usuario de prueba" en el paso 1.3, con permiso **"Editor"**.
4. **"Enviar"**.

---

### TAREA 2 — Crear el repositorio en GitHub y publicarlo

No hay credenciales de git funcionando en esta máquina, así que se sube por la página web de GitHub (no se necesita instalar nada).

**2.1 — Crear el repositorio**

1. Entra a [github.com](https://github.com) con la cuenta que administra los repos de Rita Roux.
2. Click en el **"+"** (arriba a la derecha) → **"New repository"**.
3. "Owner": elige la organización `finanzas-ritaroux` (la misma de los otros 2 sistemas) si tienes acceso ahí; si no, tu cuenta personal.
4. "Repository name": `rita-roux-inventario`.
5. "Visibility": **Private** (igual que los otros repos de Rita Roux).
6. **No** tildes "Add a README file" (ya viene uno en la carpeta).
7. Click **"Create repository"**.

**2.2 — Subir los archivos**

1. En la página del repo nuevo, busca el link **"uploading an existing file"** (o el botón **"Add file" → "Upload files"** en la barra de arriba).
2. Abre en el explorador de Windows la carpeta `C:\Users\ealvs\OneDrive\Escritorio\Claude Code\Inventario Rita Roux\`.
3. Selecciona **todos** los archivos (Ctrl+A): `inicio.html`, `productos-recetas.html`, `stock.html`, `entradas.html`, `mermas.html`, `costos.html`, `gsheets.js`, `toteat-sync.js`, `theme.css`, `README.md`.
4. Arrástralos a la zona que dice "Drag files here to add them to your repository" y espera que termine de subir cada uno.
5. Abajo, en "Commit changes", déjalo con el mensaje por defecto o escribe algo como `Primera versión del sistema de inventario`.
6. Click **"Commit changes"**.

**2.3 — Activar GitHub Pages (publicar el sitio)**

1. En el repo, pestaña **"Settings"**.
2. Menú lateral izquierdo → **"Pages"** (bajo "Code and automation").
3. "Build and deployment" → "Source": **"Deploy from a branch"**.
4. "Branch": elige `main` y la carpeta `/ (root)` → **"Save"**.
5. Espera 1-2 minutos y refresca la página — va a aparecer un aviso verde con la URL: algo como `https://finanzas-ritaroux.github.io/rita-roux-inventario/`.
6. Como no hay un `index.html`, hay que entrar directo a un archivo, por ejemplo: `https://finanzas-ritaroux.github.io/rita-roux-inventario/inicio.html`.

**2.4 — ⚠️ NO OLVIDAR: volver a Google Cloud con la URL real**

Sin este paso, el sistema funciona en este computador (`localhost`) pero **no va a poder conectarse a Google desde la URL pública de GitHub Pages** — va a quedar pegado en el banner rojo de "Conectar" para siempre.

1. Ve a [console.cloud.google.com](https://console.cloud.google.com/) → menú ☰ → **"APIs & Services"** → **"Credentials"** / **"Credenciales"**.
2. Click en el nombre del Client ID que ya creamos (`Inventario y Recetas Rita Roux`).
3. En **"Authorized JavaScript origins"** / **"Orígenes de JavaScript autorizados"**, click **"+ ADD URI"** / **"+ Agregar URI"** y agrega la URL real de GitHub Pages — **solo el dominio**, ej. `https://finanzas-ritaroux.github.io` (sin `/rita-roux-inventario/inicio.html`, esa parte no va).
4. Click **"SAVE"** / **"Guardar"** (abajo del todo).

**Para actualizar archivos más adelante:** o me pides a mí que actualice el archivo local y luego repites "Add file → Upload files" con el mismo nombre (GitHub pregunta si quieres reemplazarlo), o editas directo en GitHub abriendo el archivo y usando el ícono de lápiz ("Edit this file").

---

### TAREA 3 — Definir stock mínimo y cargar el stock físico inicial

Esto se hace **después** de que las Tareas 1 y 2 estén listas y puedas conectarte con Google desde el sistema. Lo hace quien vaya a operar el inventario en el día a día (probablemente Joshua, con apoyo de Gerardo).

**3.1 — Hacer un conteo físico real primero**

Antes de tocar el sistema, cuenta físicamente lo que hay hoy en bodega/cocina/barra y anótalo en un papel o Excel (ingrediente, cantidad, unidad). Sugerencia para no demorar días en esto: empieza solo con los 15-20 ingredientes más caros o de mayor rotación (café, leche, palta, huevos, pan, queso, etc.) — el resto se puede ir cargando de a poco después, la primera vez que se reciba o use cada uno.

**3.2 — Conectar el sistema con Google**

1. Abre `inicio.html` (en GitHub Pages, una vez publicado).
2. Arriba va a aparecer un banner rojo: **"Conecta tu cuenta de Google para usar el Inventario"** → click **"Conectar →"**.
3. Elige la cuenta de Gmail (debe ser una de las agregadas como "usuario de prueba" en la Tarea 1.3 y con acceso al Sheet en la 1.6).
4. Si aparece la pantalla "Google no verificó esta app": click **"Avanzado"** → **"Ir a [nombre de la app] (no seguro)"** → confirmar acceso a Sheets/Drive.

**3.3 — Definir el stock mínimo de cada ingrediente**

1. Ve a la pestaña **"Stock"**.
2. En la columna **"Stock Mínimo"** hay un casillero editable por cada ingrediente — escribe ahí la cantidad bajo la cual quieres recibir una alerta.
   - Criterio sugerido: cuánto se consume normalmente en 2-3 días, así da tiempo a reponer antes de quedar en cero.
3. El valor se guarda solo al salir del casillero (no hay botón "Guardar" para esto).

**3.4 — Cargar el stock físico inicial**

1. En esa misma tabla de Stock, cada fila tiene un botón **"Ajustar"**.
2. Click en "Ajustar" → aparece una ventana pidiendo el stock físico real.
3. Escribe la cantidad que contaron en el paso 3.1 (ej. `12.5` si son 12,5 kilos) → Aceptar.
4. El sistema calcula la diferencia contra lo que tenía registrado (será 0 la primera vez) y deja el stock en el número real al instante.
5. Repite para cada ingrediente contado. Los que no se cuenten todavía van a mostrar "Sin mínimo" o stock en 0 hasta que se carguen — no es un error, es la limitación esperada de la Fase 1 (ver más abajo).

> Si esta carga inicial termina siendo para muchos ingredientes (decenas), avísame y te construyo antes una pantalla de "carga masiva" (pegar una lista en vez de ingrediente por ingrediente) — hoy no existe porque no sabía cuántos ingredientes ibas a cargar de una sola vez.

## Limitaciones conocidas (Fase 1)

- **El stock parte de cero.** Como nunca ha existido un conteo real, hay que cargar el stock inicial a mano (Tarea 3 arriba) antes de que las alertas tengan sentido.
- **Modificadores no cambian el ingrediente descontado.** Si un cliente pide "Leche de Avena" en vez de la leche por defecto de la receta, el sistema sigue descontando el ingrediente por defecto — la sustitución no se refleja todavía (mejora futura).
- **Lectura de fotos/PDF de boletas:** solo se suben a Drive como respaldo, no se leen automáticamente (eso es Fase 3, requiere IA). Las facturas electrónicas XML (DTE) sí se leen automático.
- **Sincronización de Toteat es manual** (botón en Stock), no programada — hay que entrar y apretar el botón periódicamente.
- **Sin login ni roles:** cualquiera con el link y acceso al Sheet puede editar cualquier cosa, igual que los demás sistemas Rita Roux.

## Archivos

- `gsheets.js` — conector a Google Sheets/Drive (OAuth, lectura/escritura de todas las pestañas).
- `toteat-sync.js` — descarga ventas del proxy de Reportes Toteat y descuenta stock según receta, con deduplicado.
- `theme.css` — estilos compartidos por todas las páginas (paleta sage/cream, misma identidad que Reportes Toteat).
