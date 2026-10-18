# Pedidos B2B — demo

**Una app de teléfono para que el almacenero le pida mercadería a su distribuidor sin llamadas ni mensajes, y para
que el distribuidor gestione esos pedidos desde la misma app.**

Hoy el pedido se hace por teléfono o mensajería: el almacenero no ve precios ni total antes de pedir, y para saber
si su pedido salió tiene que preguntar. Con esta demo, el almacenero arma el pedido con precios vigentes, ve el
total antes de confirmar y sigue el estado solo; el distribuidor recibe pedidos ordenados y los avanza con un toque.

## Estado al 18 de octubre de 2026

| | |
|---|---|
| **Estado general** | Demo funcionando de punta a punta, probada en el teléfono y aceptada por el responsable. |
| **Alcance entregado** | 3 etapas cerradas: pedido del almacenero, diseño para presentación comercial y panel del distribuidor. |
| **Calidad** | 41 pruebas automáticas de aceptación contra el entorno real, todas en verde; además, pruebas de humo y unitarias. |
| **Entorno** | Cuenta AWS propia y aislada para la demo; acceso del equipo con credenciales temporales (IAM Identity Center), sin llaves de administrador guardadas. |
| **Costo** | Sin costos fijos: todo se cobra por uso. Con el uso de una demo se estima en centavos de dólar al mes (ver [Costos](#costos)). |

## Qué muestra la demo (3 minutos)

1. **El almacenero pide.** Entra con su usuario, ve el catálogo con precios, agrega productos y confirma. La app le
   muestra el número de pedido y el total.
2. **Ve el estado sin preguntar.** En "Mis pedidos" aparece su pedido como *Recibido*.
3. **El distribuidor gestiona.** Entra con su usuario en la misma app, ve los pedidos de todos los almacenes, filtra
   los *Recibidos* y pasa el pedido a *Enviado*.
4. **El almacenero se entera.** Vuelve a su sesión y ve el pedido *Enviado*.

Guion detallado, toque a toque, en [Guion de la demo](#guion-de-la-demo).

## Qué no incluye (a propósito)

La demo prueba el recorrido central del pedido. Quedó fuera, y es candidato para próximas etapas:

- Pagos y facturación; control de stock.
- Catálogo y precios administrados desde la app (hoy se cargan por script).
- Notificaciones al cambiar el estado; cancelar o editar un pedido.
- Varios distribuidores, listas de precios por cliente, varios usuarios por almacén.
- Registro de usuarios y recuperación de contraseña; publicación en las tiendas de apps.

## Riesgos y límites conocidos

- **Es una demo, no producción**: un solo entorno, usuarios de prueba y datos sembrados.
- **Escala**: el panel del distribuidor lee todos los pedidos de una vez; está bien para decenas o cientos y hay que
  rediseñarlo antes de superar unos 1.000 pedidos.
- **Un solo distribuidor**: el modelo de permisos lo asume.

## Cómo está construida

App de teléfono (React Native con Expo) sobre servicios administrados de AWS, sin servidores propios:

```
Teléfono (Expo)  ──login──▶  Cognito (usuarios y roles: almacenero / distribuidor)
       │
       └──API GraphQL──▶  AppSync  ──▶  Lambda (reglas del negocio)  ──▶  DynamoDB (catálogo y pedidos)
```

Los precios y el total se calculan en el servidor, no en el teléfono. Toda la infraestructura se crea con un
comando (AWS CDK) y se puede borrar entera.

## Costos

Todos los servicios se cobran por uso y no hay máquinas encendidas: sin uso, el costo es prácticamente cero. Con el
tráfico de una demo, el gasto esperado queda en centavos de dólar al mes, mayormente dentro de la capa gratuita de AWS.
**Es una estimación**: la cifra real no está medida porque Cost Explorer no está activado en la organización. Para
medirla: AWS Billing → Cost Explorer → filtrar por la cuenta [REDACTED_AWS_ACCOUNT_DEMO].

## Cómo se trabajó

El proyecto se desarrolló con agentes de IA siguiendo un protocolo con controles en cada paso: cada cambio queda
ligado a un requisito y a una decisión registrada, una revisión independiente lo valida antes de que el responsable
lo acepte, y las pruebas de aceptación corren contra el entorno real. Requisitos, decisiones y bitácora en `spec/`.

---

## Para el equipo técnico

### Preparar y desplegar

- Dependencias: `npm ci`
- Una vez por cuenta: `npm run bootstrap:dev`
- Desplegar `dev` (perfil `pedidos-demo` → cuenta [REDACTED_AWS_ACCOUNT_DEMO], `us-east-1`; DEC-014, DEC-017): `npm run deploy:dev`.
  Escribe `.env.dev` y siembra el catálogo y los usuarios `almacen1@demo.test`, `almacen2@demo.test` y
  `distribuidor@demo.test`, con la contraseña `DEMO_PASSWORD` de `.env.dev`. Requiere `aws sso login --sso-session pepe`.
- App: `npm run app` y abrir el código QR con Expo Go.

### Comandos

- Pruebas: `npm test` · Aceptación contra `dev`: `npm run test:acceptance` · Humo: `npm run smoke`
- Lint y tipos: `npm run lint` y `npm run typecheck` · Protocolo: `npm run check:spec`
- Cambiar el estado de un pedido sin la app (pruebas y soporte): `npm run order:set-status -- <id> <estado>`

Instrucciones para agentes en `AGENTS.md`; spec, plan y decisiones en `spec/`.

### Guion de la demo

Con un solo teléfono se cierra sesión entre roles (botón de cuenta → "Cerrar sesión"); con dos, cada rol en el suyo.

1. **Almacenero confirma.** Iniciar sesión como `almacen1@demo.test` → Catálogo. Agregar 2 Yerba y 5 Arroz →
   "Ver carrito" → "Confirmar pedido". Anotar el N° de "Pedido confirmado N° …".
2. **Lo ve "Recibido".** "Mis pedidos" → el pedido nuevo aparece primero con la etiqueta "Recibido". Botón de cuenta
   → "Cerrar sesión".
3. **Distribuidor filtra.** Iniciar sesión como `distribuidor@demo.test` → panel "Pedidos" con los pedidos de todos
   los almacenes (N°, "Almacén C-ALMACEN1", fecha, total, estado). Tocar el filtro "Recibido".
4. **Pasa a "Enviado".** Tocar el pedido del paso 1 → "Pedido <N°>" con el almacén, las líneas ($4.500 y $1.300),
   total $15.500 y estado. En "Cambiar estado" tocar "Enviado" (sin confirmación). Volver: con "Recibido" el pedido
   ya no aparece; con "Todos" figura "Enviado". Botón de cuenta → "Cerrar sesión".
5. **Almacenero lo ve "Enviado".** Iniciar sesión como `almacen1@demo.test` → "Mis pedidos" (deslizar hacia abajo
   para refrescar) → el pedido figura "Enviado".
