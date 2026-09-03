# Playbook: Scout (descubrimiento read-only)

Fase propuesta sobre una lane `discovery`, sin acceso de escritura. El
orquestador resuelve la cadena rápida 1.5.16 y exige un receipt antes de afirmar
que Devin SWE-1.7 u otro fallback ejecutó el trabajo.

## Cuándo

Antes de cualquier implementación no trivial en un repo canónico, y siempre
antes del gate `Implement Preview`.

## Procedimiento

1. Confirmar el ticket en Linear por API o integración: identificador, estado,
   etiquetas, criterios de aceptación, dependencias y padres. No inferir el
   ticket por el título de la sesión.
2. Leer `AGENTS.md` del repo y sólo la skill repo-local que el orquestador haya
   seleccionado para la capacidad; no instalar el catálogo global en el worker.
3. Mapear las superficies afectadas: rutas, handlers de Convex, permisos,
   componentes, contratos de entorno y tests que las cubren.
4. Identificar la capacidad requerida por el cambio y verificarla contra el
   adapter 1.5.16 y la configuración del repo. Una capacidad no demostrada no
   se usa.
5. Declarar si el cambio es materialmente visible. Si lo es, el plan debe
   incluir la lane de QA grabada y los usuarios de prueba por rol.
6. Emitir el plan: objetivo, alcance exacto, superficies propietarias por lane,
   dependencias, checks focalizados, condición de parada y evidencia requerida.

## Prohibiciones

- No editar archivos, no crear ramas, no abrir PRs, no ejecutar migraciones.
- No ejecutar suites completas ni certificación.
- No tocar `.env` ni secretos.
- No declarar una integración operativa por existir en un marketplace.

## Salida

Plan con `dispatchAuthorized: false`. La ejecución espera el gate humano
`Implement Preview`.
