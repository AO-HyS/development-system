# Preservación de capacidades por producto

La fábrica preserva capacidades, no instala plugins por defecto. Una capacidad
se considera disponible sólo con evidencia de ejecución en el repo objetivo; la
presencia en un marketplace no es evidencia.

## Stack observado (verified, clonado en modo lectura)

| Repo | pnpm | node | Backend | Web | Deploy | Observabilidad | Pagos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `nutri-plan` | 10.30.3 | >=20 | Convex 1.43 | TanStack Start + Astro + Expo | Cloudflare (wrangler 4.78) | PostHog (+ proxy app) | Stripe (`STRIPE_*`) |
| `the-barber-central` | 9.15.0 | >=22.12 | Convex 1.43 | TanStack Start + Astro | Cloudflare (wrangler 4.110) | PostHog, Sentry | Stripe (skill `barber-stripe`) |
| `casa-roca` | 10.26.2 | >=22 | Convex 1.43 | Next 16, público + dashboard | Vercel (`casa-roca-public`, `casa-roca-dashboard`) | PostHog | no observado |
| `eteria` | 11.7.0 | >=24 | Convex 1.43 | TanStack Start + Expo/iOS | Cloudflare Pages/R2/Stream | PostHog | no observado |
| `aohys.com` | 11.7.0 | >=24 | Convex 1.43 | TanStack Start + site | Cloudflare Pages/Images | PostHog | no observado |

Hallazgo corregido: cuatro repos usan Cloudflare (Workers, Pages, R2, Images o
Stream), mientras Casa Roca usa Vercel para sus superficies pública y dashboard.
El release train de cada producto, no la fábrica, decide si el diff requiere
deploy y a qué proveedor.

## Matriz de capacidades

| Capacidad | Necesidad real | Implementación en la fábrica | Activación | Estado |
| --- | --- | --- | --- | --- |
| Convex | los 5 repos | CLI de Convex en blueprint + reglas repo-locales (`lint:convex`, `nutriplan-convex`, `convex-security-check`); sin entrada en el marketplace MCP inspeccionado | siempre en blueprint; deploy sólo con `CONVEX_DEPLOY_KEY` autorizada | `verified` (repo) / `proposed` (MCP) |
| PostHog | los 5 repos | integración MCP de PostHog para consultar eventos/insights durante QA; scripts repo-locales (`audit:posthog-env`, `observability:*`) | por repo, sólo lectura | `documented` |
| Stripe | `nutri-plan`, `the-barber-central` | integración MCP de Stripe en **test mode** exclusivamente | sólo en esos dos repos | `documented` |
| Cloudflare | `nutri-plan`, `the-barber-central`, `eteria`, `aohys.com` | wrangler del repo; conector sólo cuando esté instalado y autorizado | por repo; deploy mediante su release train | `verified` (repo) / `runtime-required` (conector) |
| Vercel | `casa-roca` | proyectos público y dashboard del repo; CLI/conector sólo cuando esté disponible y autorizado | deploy selectivo mediante su release train | `verified` (repo) / `runtime-required` (conector) |
| Computer Use | cambios visibles | capability repo-local, runner neutral y juicio separado | por superficie y plan ligado al SHA | `verified` |

## Routing por capacidad

El repo detectado determina el conjunto activo, no una configuración global:

1. Se leen `package.json`, `convex.json`, `.env.example` y `AGENTS.md` del repo.
2. Se derivan capacidades presentes (Convex, PostHog, Stripe, Cloudflare, Expo/iOS).
3. El orquestador carga sólo las reglas y skills repo-locales validadas para
   esas capacidades; el worker no recibe el catálogo global completo.
4. Toda capacidad no detectada queda inactiva, sin fallback silencioso.

## Reglas de seguridad por capacidad

- Convex: nunca hard delete; scope multi-tenant por `organizationId`; QA contra
  datos reales, sin mocks para "pasar" QA (regla propia de `nutri-plan`).
- Stripe: sólo claves de test; ninguna operación live desde la fábrica.
- Cloudflare: tokens con alcance mínimo por proyecto; deploy de producción es
  hard stop.
- PostHog: sólo lectura; nunca exportar PHI/PII a herramientas externas.
- Computer Use: los perfiles de navegador no se comparten entre productos con
  datos sensibles distintos. En NutriPlan y The Barber Central no se acepta
  Playwright, Cypress ni otro harness como sustituto de Computer Use.
