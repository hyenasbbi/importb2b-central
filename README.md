# IMPORTB2B Central — Fase 6.2

Versión acumulativa sobre Fase 6.1. Mantiene Cliente 360°, Club migrado y todos los módulos anteriores.

Incluye Stock, Ventas, Operaciones, Finanzas 5.3/5.4, Catálogo Web, Cliente 360°, Club IMPORTB2B y PDF/Catálogos automáticos.

## Migrar el Club anterior
1. Subí esta versión a GitHub/Netlify.
2. Entrá a **Club → Migrar Club anterior**.
3. Seleccioná los 6 CSV exportados: clients, client_clubs, club_actions, reward_claims, client_events y club_reward_rules.
4. Tocá **Migrar todo**.

El importador fusiona clientes existentes y conserva códigos, tokens, puntos, premios e historial. Los archivos se procesan en el navegador y no se suben al repositorio.

## Generador PDF 6.2
Abrí **PDF / Catálogos**. La selección comienza vacía: marcá únicamente los productos que quieras exportar. **Seleccionar visibles** respeta los filtros y **Limpiar selección** borra toda la selección. El PDF de clientes usa el logo PNG transparente, sin bloque negro, con marca limpia en portada y esquina superior izquierda de las hojas internas.

## Base de datos
Las migraciones de Fase 6 y 6.1 ya fueron aplicadas directamente al proyecto Supabase principal. Los SQL se conservan en `supabase/migrations/` para trazabilidad.
