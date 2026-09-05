// @ts-check
// A bounded development preview. Only synthetic content is served, never files.
import { createServer } from "node:http";
import { buildTechnicalReaderModel, renderTechnicalReaderHtml } from "./t3-reader.mjs";

const markdown = `# Un sistema listo para una prueba real

Astra conduce; OpenCode Go ejecuta. Esta vista de desarrollo utiliza datos de ejemplo para comprobar la lectura, los diagramas y las interacciones del Reader compartido.

## La decisión

**Una plantilla compartida para explicar el resultado.** El contenido conserva su fuente en Markdown; el Reader resuelve tipografía, navegación, diagramas y tema. Esta página no contiene información de cuentas o proyectos privados.

## Así trabajaremos

\`\`\`mermaid title="De la tarea a un resultado verificado"
flowchart LR
  A["Delimitar"] --> M["Implementar"]
  M --> R["Revisar"]
  R --> V["Verificar"]
  V --> P["Entregar"]
  R -->|"corregir"| M
\`\`\`

Las relaciones se pueden inspeccionar con zoom y desplazamiento. La fuente queda disponible como texto.

## Una medición de ejemplo

\`\`\`chart
{"title":"Datos sintéticos para revisar la composición · segundos","type":"bar","labels":["Ejemplo A","Ejemplo B"],"values":[18.737,35.734]}
\`\`\`

Estos valores ilustran la presentación. No son evidencia de rendimiento de esta página.

## Estado de entrega

| Repositorio de ejemplo | Resultado observado |
| --- | --- |
| Proyecto A | Verificación terminada; listo para la revisión de la entrega. |
| Proyecto B | Trabajo en curso; falta comprobar el flujo autenticado. |

## El siguiente paso

Comprobar navegación con teclado, cambio de tema, lectura en móvil, tabla y diagrama. Terminar con una decisión que la evidencia permita sostener.
`;
const html = renderTechnicalReaderHtml(buildTechnicalReaderModel({ presentation: "report", language: "es", productName: "Development System", document: { markdown, type: "Vista de desarrollo", status: "Datos de ejemplo", updatedAt: "4 de septiembre de 2026" } }));
const server = createServer((request, response) => {
  if (request.method !== "GET" || request.url !== "/") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(html);
});
server.listen(43170, "127.0.0.1", () => process.stdout.write("Synthetic Reader preview: http://127.0.0.1:43170/\n"));
