# `listo`, `registro` y `smoke` (Development System 4.4.0)

Una página para agentes. El modelo elige cómo trabaja; estos tres comandos deciden si un PR puede fusionarse a
`develop` y si `develop` puede pasar a `main`. Todo lo que deciden está en GitHub, así que cualquier hilo reconstruye el
estado. Córrelos desde el checkout del repositorio del PR (o pasa `--repo`).

## Los tres niveles

El nivel lo deciden las rutas, nunca el agente. Las reglas viven en `config/niveles.json` de cada repositorio y se
leen de la punta de la rama base del PR, no del PR: un cambio no puede bajarse el nivel editando ese archivo. Sin el
archivo, todo es normal y `listo` lo avisa. En un movimiento cuentan el nombre nuevo y el anterior.

- **Crítico**: algún archivo cae en `critico.rutas`, o en las `rutas` de una regla de `critico.contenido` y su
  contenido coincide con el `patron` (por ejemplo, exporta una función pública del backend). También sube a crítico la
  etiqueta `nivel:critico` (o `--subir critico`). Antes de fusionar: una lectura independiente, sus casos necesarios
  recorridos de verdad y un registro completo.
- **Mecánico**: todos los archivos caen en `mecanico.rutas`, o están en `mecanico.soloBaja` y su JSON solo baja
  números (por ejemplo, un baseline de lint). Sin lectura.
- **Normal**: todo lo demás, incluido lo desconocido. Se fusiona sin esperar lectura y queda **sin verificar** hasta la
  lectura por lote, que es obligatoria antes de pasar a `main`.

Para los tres: si el repositorio define `comprobaciones`, que hayan pasado en la punta. El pase se guarda por punta,
sus padres, su árbol y el commit exacto de la base del que salió `config/niveles.json`: otra historia con el mismo
árbol, u otra base, vuelve a correrlas.

## `development-system listo <owner/repo#n>`

```
development-system listo AO-HyS/nutri-plan#772
```

Imprime una línea por parte (PR, nivel y por qué, comprobaciones, smoke, registro o lectura) y publica en la punta el
estado `listo para fusionar`. Resultados:

- `listo` (salida 0): imprime la línea de ciclo del PR y el comando de fusión con `--match-head-commit <punta>`.
  Fusiona con ese comando, no con otro: si la punta cambió, el estado verde ya no vale.
- `falta` (salida 1): dice exactamente qué falta y el comando que lo da.

Opciones: `--subir critico` (pone la etiqueta `nivel:critico`), `--sin-estado` (solo evalúa, sin publicar estado ni
escribir el archivo de ciclo; también sirve con PRs ya fusionados), `--niveles <borrador.json>` (solo con
`--sin-estado`, para probar reglas), `--repo <checkout>`, `--home <dir>`, `--json`.

En 4.4.0 se retiraron `--pedir`, `--barrido` y `--dias`: `listo` ya no usa Codex en GitHub.

### Ciclo de PR

Cada corrida de `listo` (salvo `--sin-estado`, que solo calcula en memoria) actualiza
`~/.development-system/private/listo/ciclo/<owner>-<repo>/<n>.json` con la creación del PR, el primer `listo`, el
primer y último `listo` en verde, y los minutos entre esos hitos (`prAPrimerListoMin`, `primerListoAFusionarMin`,
`prAFusionarMin`). Al cerrar una tarjeta con `development-system tarjeta cerrar --pr <owner/repo#n>`, esos datos se
incorporan al cierre si el archivo existe localmente.

## `development-system registro`

El registro de la lectura es un comentario del PR. Cuenta solo si lo escribe una cuenta del dueño, un miembro o un
colaborador; el más nuevo gana.

```
development-system registro AO-HyS/nutri-plan#772 --sha <punta> --entorno http://localhost:3000 \
  --lector "Sol 6.1" --lectura <hilo de la lectura> --autor "Opus 5.5" --veredicto sin-vivos \
  --necesario "N1: el rol negado no ve la nota" --caso "pass: N1 entré como recepción => 403 y nada escrito"
```

Está **completo** cuando el veredicto es `sin-vivos` (o cada `--vivo` tiene su `--cerrado`), cada `--necesario` tiene
un caso `pass`, ningún caso falló y cada `--no-alcanzado` está cubierto por `--dispensa "<palabras del dueño>"`. Un caso
dispensado sigue diciendo «no alcanzado»: no es un pase ni una aprobación de producción. Se rechaza un lector igual al
autor y un caso cuyo id no está en `--necesario`. Lectura por lote: `--lote <owner/repo> --prs 12,13,14` (un comentario
por PR, cada uno en su punta). `--sin-publicar` imprime el comentario sin publicarlo.

## `development-system smoke`

```
development-system smoke --base http://localhost:3000
```

Corre QuickE2E con `~/.development-system/private/quicke2e-flows/<repositorio>/smoke.json` (o `--flujo`) y publica el
estado `smoke` en el HEAD del checkout si está limpio y en GitHub. Sin flujo, dice qué archivo crear (salida 2). Nunca
frena una fusión a `develop`; sí la de producción.

## `development-system listo --produccion <owner/repo>`

```
development-system listo --produccion AO-HyS/the-barber-central
```

Lee los PRs fusionados en `develop` cuyo commit de fusión está en `main...develop` y es posterior a `desde` de
`config/niveles.json`. Cada PR normal o crítico necesita un registro completo de su última punta o de su commit de
fusión; los mecánicos no. La punta de `develop` necesita `smoke` en `success`. Imprime lo pendiente agrupado por motivo
y publica `listo para producción` (`success` solo sin pendientes). Pasar a producción sigue necesitando la respuesta
explícita del dueño.

## Entornos y dispensas

- Barber: una fusión a `develop` despliega sola al backend compartido de desarrollo, así que los casos de un cambio
  crítico se recorren antes, en un backend local con datos sembrados.
- NutriPlan: `develop` no despliega solo; se despliega con `pnpm deploy:develop`. El smoke corre contra lo desplegado o
  contra local.
- Una fusión limpia de la rama base dentro del PR no invalida el registro de la lectura independiente.
- Desde la instalación de generados sobre 4.2.0, también es limpia la fusión que, encima de la fusión automática de git,
  solo cambia archivos generados que `listo` regenera él mismo y salen idénticos byte a byte. Ver «Generados» abajo.

## Generados

Un repositorio con ledgers que solo se encogen o con código generado reescribe esos archivos en cada fusión de
`develop` en su rama (la `revision` y los totales de un baseline). Antes, ese cambio encima de la fusión automática
invalidaba el registro de la lectura. Ahora el repositorio los declara en `config/niveles.json` (leído de la rama base,
como el resto):

```json
"generados": {
  "rutas": ["packages/config/architecture/baseline.json"],
  "comandos": ["pnpm install --offline --frozen-lockfile --ignore-scripts", "node scripts/quality/run-shared-rules.mjs --write"]
}
```

Para cada fusión de la base cuyo árbol difiere de `git merge-tree --write-tree` solo en prosa o en rutas de
`generados.rutas` (también si git marcó conflicto en ellas), `listo`:

1. abre un worktree temporal en el primer padre (la rama) y pone ahí la fusión automática; un generado en conflicto
   empieza como lo tiene la base;
2. corre `generados.comandos` en orden (20 minutos en total; cualquier salida distinta de 0 falla);
3. compara con el commit cada salida declarada y cada archivo cambiado a mano: que exista o falte igual, el mismo modo
   (100644 o 100755) y los mismos bytes. Uno que no coincide, un enlace, un submódulo, un conflicto fuera de prosa y
   generados, un comando que falla o cualquier otro archivo cambiado a mano deja la fusión sin probar, como antes.

`generados.rutas` es una lista cerrada de rutas exactas: `listo` rechaza comodines, `..` y `config/niveles.json`. Un
comodín como `architecture/*.json` mezclaría archivos de reglas, y `_generated/*` es código que se ejecuta. La copia
del generado que trae el commit nunca entra en la copia temporal: nada del candidato se prueba a sí mismo. Siguen
igual las comprobaciones de dos padres y de que el segundo esté en la base.

La regeneración corre solo después de que todos los demás commits del intervalo pasaron, y con un merge regenerado en el
intervalo ningún archivo queda exento por «sin cambio neto»: el generador que usó el merge es código revisado. Un
generado en conflicto siempre se regenera, aunque el commit haya dejado la versión de git. Los comandos corren como el
operador, igual que `comprobaciones` en la punta: no es una caja de arena. Git y los comandos corren sin ninguna
variable `GIT_*` y sin hooks.

No confía en el mensaje ni en el autor del commit: solo en lo que regenera localmente. Los generadores corren sobre la
fusión automática, que trae solo commits de la rama (juzgados aparte) y de la base. Un pase se guarda por commit,
rutas y comandos en `~/.development-system/private/listo/generados/`; un fallo se vuelve a probar. Corre `listo` desde
el checkout del repositorio después de `git fetch`. Un generador que necesita red o un despliegue (por ejemplo
`convex codegen`, que pide `CONVEX_DEPLOYMENT`) no sirve aquí: deja esa ruta fuera de `generados` y su fusión sigue
pidiendo revisión.
- Una dispensa del dueño (`--dispensa "<sus palabras>"`) deja el caso como «no alcanzado». La comprobación de
  producción la reconoce dentro de su alcance; nunca es una autorización de producción.
