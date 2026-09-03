# Blueprints de entorno

Los blueprints son la palanca número uno de velocidad: cada minuto de setup se
paga en cada sesión. El objetivo es que una sesión arranque con dependencias
instaladas, toolchain correcta y navegador listo.

Los borradores viven en [`reference/blueprints/`](reference/blueprints/) y **no
están enviados**. Su presencia en Git no demuestra que Devin los haya aceptado
ni que un snapshot exista. Cada blueprint debe revalidarse en una sesión del
repo antes de cualquier futura escritura de proveedor.

## Hallazgos verificados que condicionan todos los blueprints

1. **Toolchain por repo, no global.** Los cinco repos declaran `packageManager`
   distinto (pnpm 9.15.0 / 10.26.2 / 10.30.3 / 11.7.0) y `engines.node` distinto
   (>=20, >=22, >=24). Un blueprint org único rompería al menos dos repos.
2. **Corepack bundled falla.** `corepack prepare pnpm@<v> --activate` con el
   corepack que trae Node 22.12.0 falla con
   `Cannot find matching keyid`. Se corrige con `npm i -g corepack@latest`
   (verificado: corepack 0.36.0 activa pnpm 10.30.3 sin error). Todo blueprint
   debe actualizar corepack antes de preparar pnpm.
3. **Node por defecto de la VM es 20.18.1**; `eteria` y `aohys.com` piden
   `node >= 24`, así que necesitan instalación explícita de Node.
4. **Hooks de git en `prepare`.** `husky` (nutri-plan, casa-roca, eteria,
   aohys.com) y `scripts/hooks/install.mjs` (the-barber-central) corren en
   `pnpm install`; no hace falta un paso extra.
5. **El proveedor es repo-local.** NutriPlan, The Barber Central, ETERIA y
   aohys.com despliegan superficies web en Cloudflare; Casa Roca usa Vercel.

## Estructura estándar

```yaml
initialize: |
  # Node de la versión que pide el repo + corepack actualizado + pnpm fijado
maintenance: |
  pnpm install --frozen-lockfile
knowledge:
  - name: lint / test / typecheck / quality
```

Reglas:

- `initialize` es idempotente y no arranca servicios; Convex dev, wrangler dev y
  cualquier runner interno se levantan dentro de la sesión, no en el snapshot.
- `maintenance` sólo instala dependencias incrementales.
- Una suite e2e existente puede conservar sus dependencias para checks internos,
  pero no convierte Playwright en evidencia de aceptación. NutriPlan y The
  Barber Central usan Computer Use como único mecanismo de aceptación visible.
- Ningún blueprint debe referenciar variables de secrets que no existan a nivel
  org o repo. Su disponibilidad se revalida antes de publicarlo.

## Matriz por repo

| Repo | Node | pnpm | Extra en `initialize` | Checks rápidos |
| --- | --- | --- | --- | --- |
| `nutri-plan` | 22.12.0 | 10.30.3 | — | `pnpm quality:changed` |
| `the-barber-central` | 22.12.0 | 9.15.0 | — | `pnpm quality:changed` |
| `casa-roca` | 22.x | 10.26.2 | Vercel CLI sólo si el release train lo requiere | `pnpm quality:changed` |
| `eteria` | 24.x | 11.7.0 | — | `pnpm quality:changed` |
| `aohys.com` | 24.x | 11.7.0 | — | `pnpm quality:changed` |

`quality:certify` nunca va en el blueprint: es la barrera única del candidato
integrado, no un paso de arranque.

## Orden de despliegue propuesto

1. `nutri-plan` como piloto acotado, después de confirmar usuarios QA y
   autorización exacta.
2. Comparar contra el baseline antes de tocar otro repo.
3. Sólo si mejora tiempo-a-verificado sin degradar correctness: expandir a
   `the-barber-central`, `casa-roca`, `eteria` y `aohys.com`.
4. Evaluar `development-system` al final; no necesita blueprint para publicar
   esta propuesta documental.

Cada envío requiere: instalar en esa sesión, correr el check rápido del repo, y
sólo entonces `update_environment_config`.
