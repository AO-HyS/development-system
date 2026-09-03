# Propuesta de Software Factory cloud-first con Devin

Diseño operativo **no publicado** que explora una capa cloud-first sobre el
contrato canónico **1.5.16**, con prioridad **velocidad > correctness > costo**.
Este bundle no instala un harness, no crea blueprints remotos, no cambia el
router y no publica `config/1.6.0`, `artifacts/1.6.0` ni
`manifests/1.6.0.json`.

La política ejecutable actual sigue en 1.5.16. En particular, el trabajo
mecánico usa su cadena ordenada Devin SWE-1.7 → Factory GLM 5.3 Flash → Devin
Gemini 3.8 Flash con disponibilidad demostrada → Codex Luna Max por el servicio
priority/fast. Fable 5.1 queda reservado para juicio de alto valor, con Sol
XHigh como fallback. Esta propuesta sólo estudia cómo alojar esas lanes en
sesiones cloud sin darles autoridad de lifecycle.

| Documento | Contenido |
| --- | --- |
| [01-architecture.md](01-architecture.md) | Arquitectura propuesta, routing 1.5.16, topología Fusion, Scout/Ship, reviews y gates |
| [02-capability-preservation.md](02-capability-preservation.md) | Matriz de preservación por capacidad: Convex, PostHog, Stripe, Cloudflare, Vercel, Computer Use |
| [03-blueprints.md](03-blueprints.md) | Blueprints de entorno por repo canónico (borradores en `reference/blueprints/`) |
| [04-secrets.md](04-secrets.md) | Inventario y alcance de secrets, sin valores |
| [05-browser-profile.md](05-browser-profile.md) | Perfil de navegador persistente y evidencia de video |
| [06-metrics.md](06-metrics.md) | Contrato de métricas sobre measurement v2 |
| [07-pilot-nutriplan-roles.md](07-pilot-nutriplan-roles.md) | Candidato de piloto: NUTRI-118 como spec de la iniciativa, sin ejecución autorizada por este documento |
| [reference/playbooks/](reference/playbooks/) | Playbooks operativos de Scout, Ship, review adversarial y QA grabado |

Decisión propuesta asociada:
[ADR 0019](../adr/0019-cloud-first-devin-software-factory.md).

## Estado de evidencia

Cada afirmación de este bundle está etiquetada:

- `verified`: observado en la preparación fechada del documento; debe
  revalidarse si puede haber cambiado.
- `documented`: documentado por Devin pero no ejecutado aquí.
- `proposed`: diseño nuestro, sin ejecución todavía.

No se declara ninguna capacidad como operativa por aparecer en un marketplace.

## Repos canónicos

| Producto | Repositorio | Alcance canónico |
| --- | --- | --- |
| NutriPlan Digital | `AO-HyS/nutri-plan` | core |
| The Barber Central | `AO-HyS/the-barber-central` | core |
| Casa Roca | `AO-HyS/casa-roca` | core |
| ETERIA | `AO-HyS/eteria` | core |
| AO HyS | `AO-HyS/aohys.com` | core; el nombre corto `aohys` no es el repo canónico |

Los blueprints incluidos son referencias versionadas, no estado remoto. La
preparación real de los repos se entrega por sus adapters 1.5.16 y sus propios
release trains.

## Frontera de skills

Un worker cloud no necesita copiar el catálogo global completo. El orquestador
canónico conserva descomposición, autorización, integración y juicio; resuelve
la ruta y entrega al worker sólo el plan, las reglas del repo, las skills
repo-locales requeridas por la capacidad y el alcance exacto. Instalar skills
de más aumenta arranque y riesgo de instrucciones contradictorias sin mejorar
el trabajo mecánico.
