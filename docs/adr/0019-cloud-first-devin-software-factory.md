# ADR 0019: Cloud-first Devin software factory

- Status: Proposed
- Date: 2026-09-03

## Context

El contrato 1.5.16 describe un lifecycle con gates humanos, un planner puro sin
autoridad de despacho, review adversarial, evidencia de navegador y capacidades
detectadas por stack. También fija una cadena rápida cross-harness para trabajo
mecánico y una cadena separada para juicio de alto valor. El arranque de
entorno, el login de QA y parte del paralelismo todavía pueden depender de la
máquina del operador.

Los cinco productos canónicos (`nutri-plan`, `the-barber-central`, `casa-roca`,
`eteria`, `aohys.com`) comparten forma —monorepo pnpm y Convex— pero no
toolchain ni proveedor web: declaran distintas versiones de pnpm y Node;
cuatro usan Cloudflare para sus superficies web y Casa Roca usa Vercel.
Homogeneizarlos rompería productos; ignorar la diferencia rompería snapshots.

La prioridad declarada es velocidad, luego correctness, luego costo. El cuello
de botella dominante hoy no es la calidad del modelo sino el tiempo de arranque,
el login manual de QA y la serialización de trabajo independiente.

## Proposed decision

Evaluar una capa de ejecución cloud-first sin publicarla todavía:

1. 1.5.16 continúa siendo el contrato instalado y el objetivo de rollback. La
   propuesta no crea artefactos, manifiestos ni configuración 1.6.0. Una futura
   versión semántica sólo se justifica después de un piloto con receipts
   positivos y comparables.
2. Codex/T3 Code conservan lifecycle, descomposición, integración y juicio. Una
   sesión Devin puede alojar ejecución subordinada, pero no se convierte en el
   orquestador contractual ni decide gates.
3. Se definen dos fases de delivery, `Scout` (descubrimiento read-only, sin
   permiso de escritura ni de PR) y `Ship` (writer único con checks focalizados
   y PR sin merge). Son nombres de fase de esta fábrica, no APIs de Devin.
4. Scout, Ship, búsqueda, edición, generación de código, evidencia y checks
   focalizados obedecen la cadena rápida 1.5.16. Fusion puede ser una topología
   de sesión, pero no sustituye la selección exacta de modelo ni sus receipts.
5. La review de alto valor obedece su ruta separada: Factory Fable 5.1 XHigh,
   Devin Fable 5.1 XHigh y Codex Sol XHigh; Sol Max sólo aparece en una escalada
   crítica explícita. Devin Review es una señal adicional y un resultado
   omitido por cuota no cuenta como review ejecutada.
6. Todo cambio materialmente visible exige evidencia Computer Use autorizada
   por el repo. Un video del testing agent puede ser insumo, pero no reemplaza
   el mecanismo de aceptación repo-local; en NutriPlan y The Barber Central no
   se usa Playwright o Cypress como sustituto.
7. Las capacidades se preservan por producto y se activan por detección de
   stack, nunca globalmente. Cloudflare aplica a cuatro repos y Vercel a Casa
   Roca; ambos siguen bajo el release train del producto.
8. La velocidad se compra con snapshots calientes por repo, perfil de navegador
   persistente, checks focalizados por lane y una sola barrera de certificación
   e integración por candidato.
9. Las métricas se emiten en measurement v2 con `harness: "devin"` y cohortes
   `baseline`/`treatment`; ninguna ruta cloud reemplaza a la local sin evidencia
   comparable.
10. El worker recibe sólo las reglas y skills necesarias para su capacidad; el
    catálogo global permanece con el orquestador.

## Consequences

- Los gates humanos, el planner puro y la frontera de autorización se conservan
  íntegros: la nube cambia dónde corre el trabajo, no quién autoriza.
- Cada repo necesita su propio blueprint; no existe un blueprint org único
  viable dada la divergencia de toolchain.
- La disponibilidad de secrets y modelos es estado de runtime; ningún snapshot
  documental la confirma. Sin usuarios QA por rol no hay evidencia suficiente
  para un piloto de autorización.
- Fable es caro y limitado, por lo que sólo se intenta en juicio que lo amerite;
  el trabajo mecánico permanece en la cadena rápida.
- Cada capacidad sigue exigiendo evidencia de runtime: aparecer en un
  marketplace o en un blueprint no la vuelve operativa.
- Mientras este ADR siga `Proposed`, sus blueprints no se publican y no cambian
  el comportamiento de 1.5.16.
