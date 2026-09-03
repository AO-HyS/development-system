# Playbook: Ship (writer único)

Fase propuesta de `implementation`, con un solo writer por lane. Buscar,
crear archivos, generar y editar código, recolectar evidencia y ejecutar checks
focalizados usan la cadena rápida 1.5.16; no se reserva Fable para esta fase.

## Precondición

Plan de Scout aprobado en el gate `Implement Preview`, con superficies
propietarias explícitas. Sin ese gate no se escribe.

## Procedimiento

1. Rama no interactiva desde la base indicada por el plan, con nombre único
   aceptado por la política del repo.
2. Implementar sólo las superficies propietarias de la lane. Cualquier archivo
   fuera de ellas exige volver al plan, no ampliarlo en caliente.
3. Respetar las reglas del repo de producto: `pnpm`, sin `any`, sin
   `@ts-ignore`, sin `eslint-disable` ad hoc, sin hard delete, UI en español e
   identificadores en inglés, `getOrgUser(ctx)` y `hasPermission()` donde
   aplique.
4. Ejecutar los checks focalizados de la lane, no la certificación completa.
5. Abrir PR sin merge. El PR describe el cambio, no la sesión.
6. Ejecutar la certificación integrada una sola vez sobre el candidato
   integrado, cuando la política del repo lo exija.

## Prohibiciones

- No mergear, publicar release, desplegar a producción ni activar
  infraestructura de pago.
- No usar mocks, stubs ni fixtures para hacer pasar QA funcional.
- No modificar tests para que pasen salvo petición explícita.
- No editar `.env`.
- Nunca más de un writer por superficie: los conflictos se resuelven en el
  orquestador, no en paralelo.

## Salida

PR abierto, checks focalizados en verde, evidencia lista para las tres capas de
review.
