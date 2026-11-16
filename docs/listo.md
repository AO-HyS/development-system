# `listo`, `registro` y `smoke` (Development System 3.1.0)

Una página para agentes. El modelo elige cómo trabaja; estos tres comandos deciden si un PR puede fusionarse a
`develop` y si `develop` puede pasar a `main`. Todo lo que leen está en GitHub, así que cualquier hilo reconstruye el
estado. Córrelos desde el checkout del repositorio del PR (o pasa `--repo`).

## Los tres niveles

El nivel lo deciden las rutas, nunca el agente. Las reglas viven en `config/niveles.json` de cada repositorio y se
leen de la punta de la rama base del PR, no del PR: un cambio no puede bajarse el nivel editando ese archivo. Sin el
archivo, todo es normal y `listo` lo avisa. En un movimiento cuentan el nombre nuevo y el anterior.

- **Crítico**: algún archivo cae en `critico.rutas`, o en las `rutas` de una regla de `critico.contenido` y su
  contenido coincide con el `patron` (por ejemplo, exporta una función pública del backend). También sube a crítico:
  la etiqueta `nivel:critico`, un hallazgo de Codex rechazado que es P0, P1, sin prioridad o de dominio crítico, y el
  reloj de Codex vencido. Antes de fusionar: una lectura independiente, sus casos necesarios recorridos de verdad y un
  registro completo.
- **Mecánico**: todos los archivos caen en `mecanico.rutas`, o están en `mecanico.soloBaja` y su JSON solo baja
  números (por ejemplo, un baseline de lint). Sin lectura.
- **Normal**: todo lo demás, incluido lo desconocido. Se fusiona sin esperar lectura y queda **sin verificar** hasta la
  lectura por lote, que es obligatoria antes de pasar a `main`.

Para los tres: Codex terminado (abajo) y, si el repositorio define `comprobaciones`, que hayan pasado en el árbol de la
punta.

## Codex

Pasa cuando Codex terminó una revisión sobre un commit del PR, los commits posteriores son fusiones limpias de la base
o arreglos citados (`fixes: codex:<id>` en el commit), y cada hilo de Codex está contestado en el hilo: con el commit
del arreglo o con «Rechazado: motivo». No se resuelven conversaciones. Un rechazo crítico se cierra solo con un
registro posterior que lo nombre (`--cubre codex:<id>`).

Un reloj por PR, sin reinicios: 15 minutos desde la primera petición `@codex review` (o desde que se abrió el PR).
Dentro del reloj el resultado es `espera`. Al vencer, o si Codex dice que no puede revisar, se deja Codex y el PR pasa
a crítico.

Codex también lee la punta que se fusiona y suele contestar unos minutos después de la fusión. Esos hilos los lista
`listo --barrido` (abajo) y frenan producción mientras sigan sin contestar.

## `development-system listo <owner/repo#n>`

```
development-system listo AO-HyS/nutri-plan#772
```

Imprime una línea por parte (PR, nivel y por qué, Codex, comprobaciones, smoke, registro o lectura) y publica en la
punta el estado `listo para fusionar`. Resultados:

- `listo` (salida 0): imprime el comando de fusión con `--match-head-commit <punta>`. Fusiona con ese comando, no con
  otro: si la punta cambió, el estado verde ya no vale.
- `espera` (salida 2): Codex sigue dentro de su reloj; dice a qué hora correr `listo` de nuevo.
- `falta` (salida 1): dice exactamente qué falta y el comando que lo da.

Opciones: `--subir critico` (pone la etiqueta), `--pedir` (pide a Codex una vez si nadie lo pidió), `--sin-estado`
(solo evalúa; también sirve con PRs ya fusionados), `--niveles <borrador.json>` (solo con `--sin-estado`, para probar
reglas), `--repo <checkout>`, `--json`.

## `development-system listo --barrido <owner/repo>`

```
development-system listo --barrido AO-HyS/nutri-plan
```

Antes de dar por terminada la tarea. Lee los PRs fusionados en `--head` (por omisión `develop`) en los últimos `--dias`
días (por omisión 14) y lista cada hilo de Codex sin contestar: `#<pr>`, `codex:<id>`, la prioridad, `tardío` si Codex
lo escribió después de la fusión, el archivo, la primera línea del hallazgo y el enlace al comentario. Avisa de los PRs
fusionados hace menos de 10 minutos (Codex puede no haber terminado).

Un hilo de un PR fusionado queda contestado con «Rechazado: motivo» o con un commit que existe en el repositorio, ya
está en la punta de `--head` (o es un commit del mismo PR), es posterior a lo que Codex revisó (desciende del commit
revisado o del commit de fusión del PR, que por sí mismo nunca es el arreglo; un commit de una línea que se separó
antes de la fusión no cuenta: cita el commit de fusión del PR que lo trajo) y toca el archivo del hilo. El arreglo casi siempre vive en un PR posterior:
contesta cuando ese PR ya se fusionó. Un commit que no toca el archivo del hilo no lo contesta; si el arreglo de
verdad está en otro archivo, dilo con «Rechazado: <motivo>».

Un rechazo de un hallazgo P0, P1, sin prioridad o de dominio crítico sigue pendiente (`rechazo crítico sin lectura`),
igual que antes de fusionar, hasta que una lectura independiente registrada después lo nombre:
`development-system registro <owner/repo#n> … --cubre codex:<id>`.

No publica estados ni escribe nada y no necesita `config/niveles.json`. Salida 0 sin pendientes, 1 con alguno. No se
combina con un PR, `--produccion`, `--pedir`, `--subir`, `--niveles` ni `--base`.

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
fusión; los mecánicos no. Cualquier PR del rango, sea cual sea su nivel, con un hilo de Codex sin contestar (la misma
lectura que `--barrido`) queda pendiente por `hilo de Codex sin contestar`, y `siguiente` nombra `listo --barrido`. La
punta de `develop` necesita `smoke` en `success`. Imprime lo pendiente agrupado por motivo
y publica `listo para producción` (`success` solo sin pendientes). Pasar a producción sigue necesitando la respuesta
explícita del dueño.

## Entornos y dispensas

- Barber: una fusión a `develop` despliega sola al backend compartido de desarrollo, así que los casos de un cambio
  crítico se recorren antes, en un backend local con datos sembrados.
- NutriPlan: `develop` no despliega solo; se despliega con `pnpm deploy:develop`. El smoke corre contra lo desplegado o
  contra local.
- Una fusión limpia de la rama base dentro del PR no invalida la revisión de Codex ni el registro.
- Una dispensa del dueño (`--dispensa "<sus palabras>"`) deja el caso como «no alcanzado». La comprobación de
  producción la reconoce dentro de su alcance; nunca es una autorización de producción.
