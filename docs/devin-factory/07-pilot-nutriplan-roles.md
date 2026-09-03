# Piloto: roles en NutriPlan (NUTRI-118 / NUTRI-108)

Estado de esta propuesta: **ticket confirmado en el snapshot del 2 de
septiembre de 2026**, sin piloto ejecutado ni autorizado por este documento.

## Confirmación (verified, API de Linear)

| Ticket | Título | Estado | Etiquetas |
| --- | --- | --- | --- |
| `NUTRI-118` | Spec: simplificar roles y capacidades de acceso | Backlog | `ready-for-agent` |
| `NUTRI-108` | Grillar y resolver el modelo de dominio de NutriPlan | Done | `Type: Docs`, `wayfinder:grilling` |

El ticket de roles es **NUTRI-118**. `NUTRI-108` es un grilling de dominio ya
cerrado y sólo aparece como relacionado.

`NUTRI-118` no es un ticket de implementación: es la **spec de la iniciativa**,
con 13 hijos ya desglosados (`NUTRI-119` … `NUTRI-131`). Reemplaza las
decisiones de `NUTRI-82` y define cuatro roles canónicos (Administrador,
Nutriólogo, Recepcionista, Paciente), propietario como relación y no como rol, y
tres capacidades ampliables (Administrar organización, Trabajar con pacientes,
Dar consulta), retirando roles personalizados, matriz de permisos, asignaciones
por paciente y alcances clínicos parciales.

Consecuencia para un piloto futuro: primero se revalida el estado de Linear y
se elige un hijo dependency-ready; no se ejecuta `NUTRI-118` completo.

| Candidato | Por qué | Contra |
| --- | --- | --- |
| `NUTRI-119` Expandir el contrato canónico de acceso | base de la iniciativa, desbloquea al resto | poca superficie visible, evidencia de video pobre |
| `NUTRI-121` Gestionar equipo con roles y capacidades canónicas | superficie visible por rol, ejercita video y review intent-aware | probablemente depende de `NUTRI-119` |

## Por qué este piloto es el correcto

Un cambio de roles ejercita, en un solo ticket, todo lo que la fábrica promete:

- Convex con `getOrgUser(ctx)`, scope por `organizationId` y `hasPermission()`.
- Review intent-aware: un cambio de permisos se juzga contra la intención del
  ticket, no sólo contra el estilo.
- Review adversarial: los defectos de autorización son exactamente los que una
  review complaciente deja pasar.
- Evidencia de video por rol, incluyendo el caso denegado.
- Nada de mocks: QA contra datos reales en Convex, como exige el repo.

## Plan de ejecución propuesto

1. Elegir el hijo de `NUTRI-118` que abre el piloto y verificar sus
   dependencias y criterios de aceptación en Linear.
2. Blueprint de `nutri-plan` enviado y snapshot construido.
3. Secrets mínimos: usuarios de QA por rol, Convex preview, Better Auth dev.
4. Perfil de navegador con un usuario por rol afectado.
5. Scout read-only mediante la cadena rápida 1.5.16: superficies, contratos de
   permisos afectados y nivel de QA.
6. Gate humano de `Implement Preview`.
7. Ship: writer único mediante la misma cadena rápida, `pnpm quality:changed`,
   PR sin merge.
8. Devin Review como señal adicional + review adversarial con la cadena de
   juicio 1.5.16 y contexto limpio.
9. Computer Use repo-local: caso permitido y denegado por rol, con runner
   neutral y juicio separado.
10. `pnpm quality:certify` una sola vez sobre el candidato integrado.
11. Registro measurement v2 con `cohort: treatment`, `harness: devin`.
12. Gate humano final. Sin merge, release ni deploy sin autorización exacta.

## Criterio de éxito del piloto

- El ticket confirmado se implementa sin saltarse ningún gate.
- La review adversarial produce al menos un hallazgo clasificado, o queda
  registrado que no encontró nada tras un intento real de falsificación.
- Existe video por cada rol afectado.
- El scorecard v2 tiene un registro completo comparable contra la ruta local.
