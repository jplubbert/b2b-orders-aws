# Pedidos B2B (demo)

Demo de pedidos B2B: el almacenero ve el catálogo, confirma un pedido y sigue su estado; el
distribuidor ve los pedidos de todos los almacenes y cambia su estado desde la misma app.
Spec, plan y decisiones en `spec/`; instrucciones para agentes en `AGENTS.md`.

## Preparar
- `npm ci`
- Una vez por cuenta: `npm run bootstrap:dev`
- Desplegar `dev` (perfil `default`, `us-east-1`): `npm run deploy:dev` — escribe `.env.dev` y siembra
  catálogo y usuarios (`almacen1@demo.test`, `almacen2@demo.test`, `distribuidor@demo.test`).
  La contraseña de demo es `DEMO_PASSWORD` en `.env.dev`.
- App: `npm run app` y abrir el código QR con Expo Go en el teléfono.

## Guion de la demo (corte 3, ≤3 minutos)
Sin `order:set-status`: el distribuidor cambia el estado desde la app (REQ-009..011). Con un solo
teléfono se cierra sesión entre roles (botón de cuenta → "Cerrar sesión"); con dos, cada rol en el suyo.

1. **Almacenero confirma.** Iniciar sesión como `almacen1@demo.test` → Catálogo. Agregar 2 Yerba y
   5 Arroz → "Ver carrito" → "Confirmar pedido". Anotar el N° de "Pedido confirmado N° …".
2. **Lo ve "Recibido".** "Mis pedidos" → el pedido nuevo aparece primero con la etiqueta "Recibido".
   Botón de cuenta → "Cerrar sesión".
3. **Distribuidor filtra.** Iniciar sesión como `distribuidor@demo.test` → panel "Pedidos" con los
   pedidos de todos los almacenes (N°, "Almacén C-ALMACEN1", fecha, total, estado). Tocar el
   filtro "Recibido" → solo los pedidos recibidos.
4. **Pasa a "Enviado".** Tocar el pedido del paso 1 → "Pedido <N°>" con el almacén, las líneas
   ($4.500 y $1.300), total $15.500 y estado. En "Cambiar estado" tocar "Enviado" → la etiqueta pasa a
   "Enviado" (sin confirmación). Volver: con el filtro "Recibido" el pedido ya no aparece; "Todos" lo
   muestra como "Enviado". Botón de cuenta → "Cerrar sesión".
5. **Almacenero lo ve "Enviado".** Iniciar sesión como `almacen1@demo.test` → "Mis pedidos"
   (deslizar hacia abajo para refrescar) → el pedido figura "Enviado".

`npm run order:set-status <id> <estado>` sigue disponible para pruebas y soporte, pero la demo no lo usa.

## Comandos
- Pruebas: `npm test` · Aceptación contra `dev`: `npm run test:acceptance` · Humo: `npm run smoke`
- Lint y tipos: `npm run lint` y `npm run typecheck`
- Protocolo: `npm run check:spec`
