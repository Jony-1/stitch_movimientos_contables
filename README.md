# Stitch - Movimientos contables (versión local)

Este repositorio contiene una versión estática del panel de movimientos contables y facturas diseñada para desarrollo local y demostraciones. No requiere servidor ni base de datos — usa `localStorage` en el navegador para simular una base de datos y `sessionStorage` para un login temporal.

## Resumen

- Frontend estático: HTML, CSS (Tailwind vía CDN), y un único script central `js/app.js` que consolida la lógica: seed de datos, helpers DB (localStorage), CRUD básicos, renderers por página y manejo de modales.
- Objetivo: prototipo local para probar flujos (movimientos, facturas, usuarios/solicitudes) y facilitar la extensión hacia un backend real.

## Estructura del proyecto

Raíz del workspace (lo relevante):

- `index.html` — página principal / landing
- `dashboard.html` — panel principal
- `movimientos.html` — página para listar/crear/editar movimientos
- `facturas.html` — página para listar/crear/visualizar facturas
- `reportes.html` — página con tarjetas de totales (Ingresos / Gastos / Resultado)
- `configuraciones.html` — administración de usuarios / solicitudes
- `partials/` — contiene `header.html` (partial inyectado dinámicamente en `#app-header`)
- `assets/` — estilos y recursos (si existen)
- `js/app.js` — script central con la mayor parte de la lógica

> Nota: el repositorio puede contener más archivos; en este README se describen los puntos esenciales que afectan al flujo de la app.

## Requisitos

- Navegador moderno (Chrome, Edge, Firefox)
- Para servir los archivos localmente (recomendado): Python, Node.js o Live Server en VSCode. No es obligatorio pero es mejor para evitar problemas con fetch de `partials/header.html`.

## Cómo correr localmente

Opciones rápidas (elige una):

1) Usar Python 3 (desde la raíz donde están los HTML):

```powershell
python -m http.server 8000
# abrir http://localhost:8000/reportes.html
```

2) Usar http-server de npm (si tienes node):

```powershell
npx http-server . -p 8000
# abrir http://localhost:8000/reportes.html
```

3) Usar Live Server en VSCode: botón derecho sobre `index.html` → "Open with Live Server".

Abrir la página deseada en el navegador (por ejemplo `reportes.html`, `facturas.html`, `movimientos.html`).

## Flow y uso básico

- Login temporal: en la página de login (si existe un formulario), hay credenciales temporales incluidas en el script. Los valores por defecto:
  - Usuario: `natalia@demo.com`
  - Contraseña: `demo1234`
  - Tras iniciar sesión se guarda `sessionStorage.stitch_user` y se redirige a `dashboard.html`.

- Base de datos simulada:
  - Key: `localStorage.stitch_db`
  - Estructura (ejemplo):
    {
      movements: [ { id, date, type, category, description, amount, status }, ... ],
      invoices: [ { id, number, party, date, dueDate, amount, status }, ... ],
      users: [ ... ],
      requests: [ ... ]
    }

- Acciones implementadas actualmente en `js/app.js` (resumen):
  - Seed de datos al cargar si `stitch_db` no existe.
  - CRUD básico de movements (add/update/delete) y render en `movimientos.html`.
  - CRUD parcial de invoices: crear, listar, ver detalle y eliminar.
  - Gestión de users/requests: funciones get/add/update/delete y render para `configuraciones.html`.
  - Render de `reportes.html`: calcula ingresos/gastos/resultado a partir de `movements` y actualiza las tarjetas (ahora con selectores scopeados para no romper el sidebar).
  - Manejo de modales: helpers `showModal()` / `hideModal()` y wiring genérico para abrir/cerrar mediante atributos `data-modal-target`, `data-modal-close`, `data-modal-backdrop`.

## Selectores y puntos de integración importantes

- Placeholder del header compartido: `#app-header`. El partial `partials/header.html` es inyectado ahí y dispara `document` event `app:header-loaded`.
- Modal nuevo movimiento: `#new-movement-modal` — el formulario dentro debe contener inputs con ids `#date`, `#category`, `#description`, `#amount` y radio `name="type"` (ingreso/gasto).
- Modal factura: `#modal-invoice`, form con `#inv-number`, `#inv-party`, `#inv-date`, `#inv-due`, `#inv-amount`, `#inv-status` y botones `#inv-save` / `#inv-cancel`.
- Modal usuario: `#modal-user`, form con `#user-name`, `#user-email`, `#user-role`, `#user-active`, botones `#user-save` / `#user-cancel`.
- Tablas: el script espera encontrar `main table tbody` en páginas de listados para renderizar filas.

Si vas a modificar HTML, mantener estos IDs y clases facilita que `js/app.js` funcione sin cambios.

## Depuración y comprobaciones rápidas

- Abrir DevTools → Console: si hay errores, el script intenta manejar fallos silenciosamente; revisa la consola para ver mensajes y advertencias (por ejemplo "Sanity checks — advertencias detectadas").
- Revisar `localStorage.stitch_db` en DevTools → Application para ver/editar los datos.
- Si el `partials/header.html` no carga, verifica que estés sirviendo archivos vía HTTP y no vía `file://` (algunas APIs fetch requieren servidor).

## Notas de desarrollo (decisiones importantes)

- `js/app.js` está envuelto en `document.addEventListener('DOMContentLoaded', ...)` para garantizar que los modales y elementos inyectados al final del HTML existan cuando el script se ejecute.
- `renderReports()` fue ajustado para usar selectores con scope `.layout-content-container` y evitar sobreescribir elementos del sidebar (problema detectado: valores aparecían en el sidebar debido a selectores muy amplios).
- El script incluye helpers genéricos para modales (atributos `data-modal-target`, `data-modal-close`) que permiten añadir nuevos modales sin escribir JS adicional.

## Tareas pendientes recomendadas

- Implementar CRUD completo de facturas: marcar como pagada, editar, relacionarlas con movimientos para impacto contable.
- Añadir IDs explícitos en las tarjetas de `reportes.html` (por ejemplo `#report-ingresos`, `#report-gastos`, `#report-resultado`) y modificar `renderReports()` para escribir por ID — así se evita cualquier dependencia heurística sobre el texto.
- Mejorar la UI de usuarios en `configuraciones.html` y añadir validaciones.
- Añadir tests simples (unitarios de funciones utilitarias) o harness que permita ejecutar pequeñas comprobaciones JS en Node con JSDOM.

## Cómo contribuir / modificar

- Mantén las firmas de funciones públicas de `js/app.js` o extrae la lógica a módulos si quieres refactorizar.
- Si añades HTML, sigue usando los IDs mencionados para compatibilidad.
- Para agregar estilos locales, edita/crea `assets/styles.css` y enlázalo en las páginas.

## Ejemplos rápidos (flujos)

- Crear movimiento (UI): `movimientos.html` → botón "Nuevo movimiento" → formulario modal → Guardar → ver la nueva fila en la tabla y actualizar `reportes.html`.
- Crear factura: `facturas.html` → "Nueva factura" → completar campos → Guardar → la tabla se refresca; luego puedes Ver detalle.

## Contacto / soporte

Si quieres que implemente alguna de las tareas pendientes (CRUD facturas, usuarios, IDs en reportes, tests), dime cuál y lo hago. Puedo además guiarte en pruebas manuales (paso a paso) o aplicar los cambios directamente en los archivos.

---

_Fecha de generación:_ 20 de noviembre de 2025
