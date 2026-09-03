# Playbook propuesto: QA Computer Use por rol

Route slot `computer-use`, ejecutado por un runner neutral sobre el candidato
integrado y juzgado por separado. Un testing agent cloud sólo es válido si
satisface el contrato repo-local.

## Cuándo es obligatorio

Cualquier cambio materialmente visible: UI, navegación, permisos observables,
formularios, estados vacíos y mensajes de error user-facing. En cambios de roles
o permisos la grabación cubre **un caso permitido y un caso denegado por rol**.

## Procedimiento

1. Validar el plan hash, origen, candidato y acciones autorizadas.
2. Iniciar sesión con el usuario QA del rol bajo prueba, desde el perfil de
   navegador persistente; nunca con credenciales de producción.
3. Anotar la grabación de forma estructurada: `setup` para preparación,
   `test_start` por escenario en estilo «It should …» y `assertion` consolidada
   con `passed`, `failed` o `untested`.
4. Ejercitar el camino dorado del rol y después el acceso denegado esperado.
5. Repetir por cada rol afectado. Un rol sin grabar es un rol sin evidencia.

## Prohibiciones

- El runner no emite PASS, FAIL, BLOCKED ni INCONCLUSIVE: devuelve acciones,
  observaciones, capturas, video, estados inesperados y errores.
- No se graba contra datos de producción ni con secretos live de Stripe.
- No se usan mocks para simular el comportamiento bajo prueba.
- En NutriPlan y The Barber Central no se usa Playwright, Cypress ni otro
  harness como sustituto de Computer Use.

## Salida

Video más capturas clave, adjuntos al PR y referenciados por la review
intent-aware y la adversarial.
