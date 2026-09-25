# IMPORTB2B Central — Fase 6.2

## PDF selectivo
- La selección inicia vacía: el PDF no agrega todo el catálogo automáticamente.
- Solo se exportan los productos marcados.
- Seleccionar visibles respeta búsqueda, categoría y filtro de stock.
- Limpiar selección elimina toda la selección, incluso productos ocultos por filtros.
- Los botones de exportación muestran cuántos productos serán incluidos y quedan deshabilitados con 0 seleccionados.

## Branding PDF
- Nuevo activo `assets/img/logo-importb2b-transparent.png` en PNG con transparencia.
- Portada con logo limpio sin rectángulo negro.
- Hojas internas con logo pequeño en esquina superior izquierda y categoría en esquina superior derecha.
- El logo se recorta automáticamente por transparencia antes de insertarlo al PDF.
- Si un logo futuro viniera sin alpha, el generador elimina solamente el fondo negro antes de renderizarlo.

## Base de datos
No requiere migraciones de Supabase. Es una actualización de frontend/exportación.
