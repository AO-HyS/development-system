# Contrato de métricas

La propuesta no estrena formato de métricas: un piloto emitiría registros
[measurement v2](../measurement-v2.md) con `harness: "devin"`. Así la ruta cloud
se compararía contra la ruta local sin publicar un roster 1.6.0. La selección de
modelo y sus intentos deben reflejar los receipts de la política 1.5.16.

## Cohortes

| Cohorte | Ruta |
| --- | --- |
| `baseline` | ejecución actual (harness local `codex`) |
| `treatment` | fábrica cloud-first en Devin |

Comparación agrupada por `repository/capability/routeSlot`, que es como el
scorecard v2 ya compara rutas.

## Slots que emite la fábrica

`orchestration`, `discovery` (Scout), `implementation` (Ship), `verification`,
`review-intent`, `review-adversarial`, `browser-qa`, `security`.

Cada agente reportaría `role`, `routeSlot`, `harness: devin`, modelo solicitado
y resuelto, `durationMs`, `result`, `evidenceStatus` e `integrityStatus`. Un
fallback sin receipt no puede registrarse como modelo resuelto.

## Indicadores por prioridad

**Velocidad (primera prioridad)**

- `timeToVerifiedMs` derivado (`verifiedAt - startedAt`), no autoreportado.
- `durationMs` por slot, con foco en `discovery` e `implementation`.
- `waitMs`: tiempo bloqueado en gates humanos y en aprovisionamiento.
- Tiempo de arranque de sesión (proxy directo del valor del blueprint).

**Correctness (segunda)**

- `quality.firstAttempt.passed` y `quality.final.passed`.
- `reviews`, `corrections`, `correctionMs`, `regressions`, `reopens`.
- `escapedDefects`: defectos detectados después del gate final.
- Tasa de hallazgos `blocker`/`high` encontrados por la review adversarial y no
  por Devin Review: mide si la capa independiente aporta valor real.
- Cobertura de evidencia: proporción de cambios visibles con video.

**Costo (tercera)**

- `tokens` y `costUsd` por slot, con `null` cuando el harness no los reporte;
  cero nunca sustituye a dato faltante.
- Consumo y fallbacks de Fable 5.1 separados del trabajo mecánico, para evitar
  gastar su cuota cara en búsqueda, edición o ejecución de tests.
- Número de sesiones hijas por iniciativa.
- Ejecuciones de `quality:certify` por candidato (objetivo: exactamente una).

## Reglas de integridad

- Un run con contaminación de entorno se marca
  `integrityStatus: capability-contaminated` y no cuenta como fallo de modelo.
- Un tratamiento sin `timeToVerifiedMs` conocido no puede reemplazar a un
  baseline que sí lo tiene.
- La frontera de privacidad de v2 se respeta sin excepción: nada de prompts,
  transcripts, secretos, datos clínicos ni rutas de sistema en los registros.

## Criterio de adopción

La ruta cloud reemplaza a la local para un `routeSlot` sólo cuando, con al menos
el umbral de muestras del scorecard, mejora `timeToVerifiedMs` sin empeorar
first-pass ni `escapedDefects`. Costo entra como desempate, no como veto, salvo
que exceda el tope acordado por iniciativa.
