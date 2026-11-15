# `listo`, `registro` y `smoke` (Development System 3.0.0)

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
- Una fusión limpia de la rama base dentro del PR no invalida la revisión de Codex ni el registro.
- Una dispensa del dueño (`--dispensa "<sus palabras>"`) deja el caso como «no alcanzado». La comprobación de
  producción la reconoce dentro de su alcance; nunca es una autorización de producción.
