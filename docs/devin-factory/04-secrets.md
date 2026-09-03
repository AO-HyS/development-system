# Inventario de secrets

Snapshot histórico de la preparación del 2 de septiembre de 2026: se observó
`LINEAR_API_KEY` a nivel org. Es un dato de disponibilidad que debe revalidarse;
este documento no lee, crea ni modifica secrets. Ningún blueprint incluido se
ha enviado a Devin.

Reglas:

- Los snapshots ven secrets de org, enterprise y repo. **No** ven secrets
  personales ni de sesión: un blueprint que los referencie falla en el build.
- Alcance mínimo y cuenta de servicio dedicada por proveedor.
- Nada de claves live de pagos ni de producción en la fábrica.
- Los `.env` de los repos no se editan ni se comitean; el inventario abajo sólo
  nombra variables ya declaradas en cada `.env.example`.

## Inventario propuesto

| Secret | Alcance | Repos | Necesario para | Prioridad |
| --- | --- | --- | --- | --- |
| `LINEAR_API_KEY` | org | todos | confirmar y mover tickets | guardado |
| `CONVEX_DEPLOY_KEY_PREVIEW` | repo | los 5 | codegen y deploy de preview de Convex | P0 |
| `CLOUDFLARE_API_TOKEN_PREVIEW` | repo | `nutri-plan`, `the-barber-central`, `eteria`, `aohys.com` | `deploy:preview`, wrangler | P1 |
| `CLOUDFLARE_ACCOUNT_ID` | org | cuatro repos Cloudflare | wrangler | P1 |
| `VERCEL_TOKEN_PREVIEW` | repo | `casa-roca` | provider preflight si su release train lo requiere | P1 |
| `POSTHOG_PERSONAL_API_KEY` | org | los 5 | lectura de eventos/insights en QA | P2 |
| `POSTHOG_PROJECT_ID_<producto>` | repo | los 5 | scoping de consultas | P2 |
| `STRIPE_TEST_SECRET_KEY` | repo | `nutri-plan`, `the-barber-central` | flujos de pago en test mode | P2 |
| `RESEND_API_KEY_TEST` | repo | `nutri-plan`, `the-barber-central`, `aohys.com` | verificar email sin enviar a clientes | P3 |
| `BETTER_AUTH_SECRET_DEV` | repo | los 5 | levantar auth local para QA | P1 |
| `QA_USER_<rol>_PASSWORD` | repo | `nutri-plan` primero | login determinista por rol en Computer Use | P0 para el piloto de roles |

`CONVEX_DEPLOY_KEY` de producción, tokens de Cloudflare con permisos de
producción, claves live de Stripe y credenciales de App Store quedan **fuera**
de la fábrica.

## Secuencia de aprovisionamiento

1. Revalidar integración Linear; NUTRI-118 fue confirmado en el snapshot de
   preparación, pero la disponibilidad del secret no se hereda por documento.
2. Credenciales de QA por rol para `nutri-plan` — desbloquean la evidencia de
   video del piloto.
3. Convex preview + Better Auth dev — desbloquean QA con datos reales.
4. Cloudflare preview para cuatro repos y Vercel preview para Casa Roca — cada
   uno mediante el release train del producto.
5. PostHog y Stripe test — enriquecen evidencia; no bloquean el piloto.

Guardar un secret es una escritura de proveedor independiente. Requiere
autorización explícita para el repo, proveedor y duración; esta propuesta no la
concede.
