# IMPORTB2B Central — Fase 6.1

Versión acumulativa. No hace falta instalar primero la 6.0.

Incluye Stock, Ventas, Operaciones, Finanzas 5.3/5.4, Catálogo Web, Cliente 360°, Club IMPORTB2B y PDF/Catálogos automáticos.

## Migrar el Club anterior
1. Subí esta versión a GitHub/Netlify.
2. Entrá a **Club → Migrar Club anterior**.
3. Seleccioná los 6 CSV exportados: clients, client_clubs, club_actions, reward_claims, client_events y club_reward_rules.
4. Tocá **Migrar todo**.

El importador fusiona clientes existentes y conserva códigos, tokens, puntos, premios e historial. Los archivos se procesan en el navegador y no se suben al repositorio.

## Generador PDF
Abrí **PDF / Catálogos**. Elegí filtros/productos y generá PDF Clientes o PDF Revendedores.

## Base de datos
Las migraciones de Fase 6 y 6.1 ya fueron aplicadas directamente al proyecto Supabase principal. Los SQL se conservan en `supabase/migrations/` para trazabilidad.
