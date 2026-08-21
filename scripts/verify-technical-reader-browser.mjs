// @ts-nocheck -- This executable drives Chrome through its runtime CDP protocol; browser behavior is its acceptance boundary.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const readerModulePath = join(process.cwd(), "artifacts/1.5.10/skills/internal/working-backwards/scripts/t3-reader.mjs");
const { buildTechnicalReaderModel, renderTechnicalReaderHtml } = await import(pathToFileURL(readerModulePath).href);

const candidates = [
  process.env.DEVELOPMENT_SYSTEM_CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const browser = candidates.find((candidate) => existsSync(candidate));
assert.ok(browser, "Technical Reader browser acceptance requires Chrome or Chromium");

const directory = mkdtempSync(join(tmpdir(), "technical-reader-browser-"));
const reportPath = join(directory, "offline-reader-acceptance.html");
const profilePath = join(directory, "chrome-profile");

function waitForDevTools(child) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error(`Chrome did not expose DevTools. ${stderr}`)), 10_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      const endpoint = /DevTools listening on (ws:\/\/\S+)/u.exec(stderr)?.[1];
      if (!endpoint) return;
      clearTimeout(timeout);
      resolve(endpoint);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited before DevTools was ready (${code}). ${stderr}`));
    });
  });
}

async function connectCdp(endpoint) {
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not connect to Chrome DevTools")), { once: true });
  });
  let id = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result ?? {});
      return;
    }
    events.push(message);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    id += 1;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { socket, send, events };
}

async function waitForRendered(send, sessionId) {
  const deadline = Date.now() + 10_000;
  let lastObservation = null;
  while (Date.now() < deadline) {
    const evaluation = await send("Runtime.evaluate", {
      expression: `JSON.stringify({
        rendered: [...document.querySelectorAll('[data-mermaid]')].filter((node) => node.dataset.rendered === 'true').length,
        svg: document.querySelectorAll('[data-mermaid] svg').length,
        loading: document.querySelectorAll('[data-diagram-loading]').length,
        resources: performance.getEntriesByType('resource').map((entry) => entry.name),
        bodyFontSize: getComputedStyle(document.body).fontSize,
      })`,
      returnByValue: true,
    }, sessionId);
    const observation = JSON.parse(evaluation.result.value);
    lastObservation = observation;
    if (observation.rendered === 5 && observation.svg >= 5) return observation;
    await send("Runtime.evaluate", {
      expression: `document.querySelector('[data-mermaid][data-rendered="false"]')?.scrollIntoView({ block: 'center' })`,
    }, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Mermaid did not render all five SVG diagrams before the deadline: ${JSON.stringify(lastObservation)}`);
}

async function stopBrowser(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

let child = null;
let cdp = null;

try {
  const markdown = `---
working_backwards_role: implementation-report
working_backwards_status: completed
title: Offline Reader acceptance
summary: Mermaid must render from file without a server or network request.
---

# Offline Reader acceptance

## Delivery flow

\`\`\`mermaid
flowchart LR
  A[Markdown] --> B{Valid}
  B -->|Yes| C[Offline Reader]
\`\`\`

\`\`\`mermaid
gantt
  title Release progress
  dateFormat YYYY-MM-DD
  section Reader
  Definition :done, v1, 2026-08-10, 2d
  Browser acceptance :active, v2, after v1, 2d
\`\`\`

\`\`\`mermaid
sequenceDiagram
  actor A as Alejandro
  participant D as Definition Router
  participant W as Working Backwards
  participant P as Parallel Work
  participant R as Release Train
  A->>D: Describe la funcionalidad normalmente
  D->>W: Product Grill por Topics
  W-->>A: Future Customer Story breve
  A->>W: Aprobar o corregir
  W->>W: Technical Grill + contratos + tickets
  W-->>A: Handoff privado e Implement Preview
  A->>P: Autorizar el slice
  P->>R: Integrar candidato y validar superficies afectadas
  R-->>A: Preview, producción, smoke y rollback verificables
\`\`\`

## Progress

\`\`\`mermaid
timeline
  title Reader delivery
  Definition : Complete
  Browser acceptance : Complete
\`\`\`

\`\`\`mermaid
architecture-beta
  group library(cloud)[Private Library]
  service source(database)[Markdown] in library
  service reader(server)[Reader] in library
  source:R -- L:reader
\`\`\`

## Architecture evidence

| Dimension | Current evidence | Direction |
| --- | --- | --- |
| file-placement | Dashboard uses screens, lib and global types while backend capabilities live in one large content module. | Keep capability ownership explicit and place tests beside the behavior they prove. |
| frontend-composition | Route-level screens currently own forms, mutations, state, toasts and presentation at once. | Separate orchestration from reusable view composition without inventing a universal component layer. |
| backend-contracts | Public Convex functions have validators but publication dispatch still needs an explicit receipt and idempotency boundary. | Preserve typed validators and add bounded capability contracts where real evidence requires them. |
`;
  const model = buildTechnicalReaderModel({
    language: "en",
    productName: "Development System",
    workflow: {
      id: "reader-browser-acceptance",
      name: "Technical Reader browser acceptance",
      slug: "technical-reader-browser-acceptance",
      implementationAuthorized: true,
      reportStatusLabel: "Delivery complete",
      gateLabel: "Verification complete",
    },
    document: {
      type: "Implementation report",
      status: "Completed",
      markdown,
    },
    artifacts: [],
  });
  writeFileSync(reportPath, renderTechnicalReaderHtml(model), { mode: 0o600 });

  child = spawn(browser, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-breakpad",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-gpu",
    "--no-default-browser-check",
    "--no-first-run",
    `--user-data-dir=${profilePath}`,
    "--remote-debugging-port=0",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const endpoint = await waitForDevTools(child);
  cdp = await connectCdp(endpoint);
  try {
    const reportUrl = pathToFileURL(reportPath).href;
    const target = await cdp.send("Target.createTarget", { url: "about:blank" });
    const attachment = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const sessionId = attachment.sessionId;
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Log.enable", {}, sessionId);
    await cdp.send("Network.enable", {}, sessionId);
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await cdp.send("Page.navigate", { url: reportUrl }, sessionId);
    const observation = await waitForRendered(cdp.send, sessionId);
    const interaction = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const figure = [...document.querySelectorAll('[data-mermaid]')].find((candidate) => candidate.querySelector('[data-diagram-source]')?.textContent?.trim().startsWith('sequenceDiagram'));
        figure.scrollIntoView({ block: 'center' });
        await new Promise((resolve) => setTimeout(resolve, 50));
        const measure = () => {
          const viewport = figure.querySelector('.diagram-viewport').getBoundingClientRect();
          const svg = figure.querySelector('svg');
          const svgRect = svg.getBoundingClientRect();
          const textHeights = [...svg.querySelectorAll('text')]
            .map((node) => node.getBoundingClientRect().height)
            .filter((height) => Number.isFinite(height) && height > 0);
          return {
            viewport: { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height },
            svg: { width: svgRect.width, height: svgRect.height },
            viewportWidthUse: Math.min(svgRect.width, viewport.width) / viewport.width,
            requiresHorizontalPan: svgRect.width > viewport.width,
            renderedScale: svgRect.width / svg.viewBox.baseVal.width,
            minimumTextHeight: Math.min(...textHeights),
            fitScale: Number(figure.dataset.fitScale || '0'),
          };
        };
        const beforeZoom = figure.querySelector('svg').style.transform;
        figure.querySelector('[data-action="zoom-in"]').click();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const afterZoom = figure.querySelector('svg').style.transform;
        figure.querySelector('[data-action="fit"]').click();
        await new Promise((resolve) => setTimeout(resolve, 220));
        const afterFit = figure.querySelector('svg').style.transform;
        const inlineFitMetrics = measure();
        figure.querySelector('[data-action="reset"]').click();
        await new Promise((resolve) => setTimeout(resolve, 220));
        const afterReset = figure.querySelector('svg').style.transform;
        figure.querySelector('[data-action="expand"]').click();
        await new Promise((resolve) => setTimeout(resolve, 220));
        const expandedMetrics = measure();
        const fullscreenButton = figure.querySelector('[data-action="fullscreen"]').getBoundingClientRect();
        return JSON.stringify({
          expanded: figure.classList.contains('is-expanded'),
          beforeZoom,
          afterZoom,
          afterFit,
          afterReset,
          inlineFitMetrics,
          expandedMetrics,
          fullscreenButton: { x: fullscreenButton.x, y: fullscreenButton.y, width: fullscreenButton.width, height: fullscreenButton.height },
        });
      })()`,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    const interactionEvidence = JSON.parse(interaction.result.value);
    const center = {
      x: interactionEvidence.expandedMetrics.viewport.x + interactionEvidence.expandedMetrics.viewport.width / 2,
      y: interactionEvidence.expandedMetrics.viewport.y + interactionEvidence.expandedMetrics.viewport.height / 2,
    };
    const transform = async () => {
      const result = await cdp.send("Runtime.evaluate", {
        expression: `[...document.querySelectorAll('[data-mermaid]')].find((candidate) => candidate.querySelector('[data-diagram-source]')?.textContent?.trim().startsWith('sequenceDiagram')).querySelector('svg').style.transform`,
        returnByValue: true,
      }, sessionId);
      return result.result.value;
    };

    const beforeWheel = await transform();
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: center.x, y: center.y, deltaX: 0, deltaY: -160 }, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const afterWheel = await transform();

    const beforeDrag = afterWheel;
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: center.x, y: center.y, button: "left", buttons: 1, clickCount: 1 }, sessionId);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: center.x + 60, y: center.y + 35, button: "left", buttons: 1 }, sessionId);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: center.x + 60, y: center.y + 35, button: "left", buttons: 0, clickCount: 1 }, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const afterDrag = await transform();

    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 }, sessionId);
    const beforePinch = afterDrag;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: center.x - 20, y: center.y }, { x: center.x + 20, y: center.y }],
    }, sessionId);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: center.x - 65, y: center.y }, { x: center.x + 65, y: center.y }],
    }, sessionId);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const afterPinch = await transform();
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false }, sessionId);

    const full = interactionEvidence.fullscreenButton;
    const fullX = full.x + full.width / 2;
    const fullY = full.y + full.height / 2;
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: fullX, y: fullY, button: "left", buttons: 1, clickCount: 1 }, sessionId);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: fullX, y: fullY, button: "left", buttons: 0, clickCount: 1 }, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const fullscreen = await cdp.send("Runtime.evaluate", {
      expression: "document.fullscreenElement?.matches('[data-mermaid]') === true || [...document.querySelectorAll('[data-mermaid]')].some((candidate) => candidate.classList.contains('is-fullscreen-fallback'))",
      returnByValue: true,
    }, sessionId);
    const fullscreenMeasurement = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const figure = document.fullscreenElement?.matches('[data-mermaid]')
          ? document.fullscreenElement
          : [...document.querySelectorAll('[data-mermaid]')].find((candidate) => candidate.classList.contains('is-fullscreen-fallback'));
        const viewport = figure.querySelector('.diagram-viewport').getBoundingClientRect();
        const svg = figure.querySelector('svg');
        const svgRect = svg.getBoundingClientRect();
        const textHeights = [...svg.querySelectorAll('text')]
          .map((node) => node.getBoundingClientRect().height)
          .filter((height) => Number.isFinite(height) && height > 0);
        return JSON.stringify({
          viewport: { width: viewport.width, height: viewport.height },
          viewportWidthUse: Math.min(svgRect.width, viewport.width) / viewport.width,
          renderedScale: svgRect.width / svg.viewBox.baseVal.width,
          minimumTextHeight: Math.min(...textHeights),
          fitScale: Number(figure.dataset.fitScale || '0'),
        });
      })()`,
      returnByValue: true,
    }, sessionId);
    const fullscreenEvidence = JSON.parse(fullscreenMeasurement.result.value);
    if (process.env.DEVELOPMENT_SYSTEM_READER_SCREENSHOT) {
      const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }, sessionId);
      writeFileSync(process.env.DEVELOPMENT_SYSTEM_READER_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
    }
    await cdp.send("Runtime.evaluate", {
      expression: "document.fullscreenElement ? document.exitFullscreen() : undefined",
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        document.querySelectorAll('.is-expanded,.is-fullscreen-fallback').forEach((node) => node.classList.remove('is-expanded', 'is-fullscreen-fallback'));
        document.querySelectorAll('[data-action="expand"],[data-action="fullscreen"]').forEach((button) => button.setAttribute('aria-pressed', 'false'));
        document.body.classList.remove('has-reader-overlay');
        window.scrollTo(0, 0);
      })()`,
      returnByValue: true,
    }, sessionId);

    const measureResponsive = async (width, height, mobile) => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile }, sessionId);
      await new Promise((resolve) => setTimeout(resolve, 80));
      const result = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const root = document.documentElement;
          const topbar = document.querySelector('.reader-topbar').getBoundingClientRect();
          const tableScroll = document.querySelector('.table-scroll');
          const table = document.querySelector('.data-table');
          const firstCell = table?.querySelector('tbody td');
          if (tableScroll) tableScroll.scrollLeft = tableScroll.scrollWidth;
          return JSON.stringify({
            width: innerWidth,
            rootClientWidth: root.clientWidth,
            rootScrollWidth: root.scrollWidth,
            rootScrollLeft: root.scrollLeft,
            topbar: { left: topbar.left, right: topbar.right, width: topbar.width },
            mobileTools: getComputedStyle(document.querySelector('.mobile-reader-tools')).display,
            mobileToolCount: document.querySelectorAll('.mobile-reader-tools details').length,
            artifactsRail: getComputedStyle(document.querySelector('.artifacts-rail')).display,
            tocRail: getComputedStyle(document.querySelector('.toc-rail')).display,
            reportState: getComputedStyle(document.querySelector('.report-state')).display,
            authorityState: getComputedStyle(document.querySelector('.authority-state')).display,
            tableClientWidth: tableScroll?.clientWidth ?? 0,
            tableScrollWidth: tableScroll?.scrollWidth ?? 0,
            tableDisplay: table ? getComputedStyle(table).display : '',
            firstCellDisplay: firstCell ? getComputedStyle(firstCell).display : '',
            bodyFontSize: getComputedStyle(document.body).fontSize,
          });
        })()`,
        returnByValue: true,
      }, sessionId);
      if (process.env.DEVELOPMENT_SYSTEM_READER_RESPONSIVE_SCREENSHOT_DIR) {
        mkdirSync(process.env.DEVELOPMENT_SYSTEM_READER_RESPONSIVE_SCREENSHOT_DIR, { recursive: true });
        await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const table = document.querySelector('.table-scroll');
            if (table) {
              document.documentElement.style.scrollBehavior = 'auto';
              table.scrollLeft = 0;
              table.scrollIntoView({ behavior: 'instant', block: 'center' });
            }
          })()`,
          returnByValue: true,
        }, sessionId);
        await new Promise((resolve) => setTimeout(resolve, 50));
        const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }, sessionId);
        writeFileSync(
          join(process.env.DEVELOPMENT_SYSTEM_READER_RESPONSIVE_SCREENSHOT_DIR, `reader-${width}x${height}.png`),
          Buffer.from(screenshot.data, "base64"),
        );
      }
      return JSON.parse(result.result.value);
    };
    const tabletLandscape = await measureResponsive(1280, 800, true);
    const tabletPortrait = await measureResponsive(820, 1180, true);
    const phone = await measureResponsive(390, 844, true);
    const panelInteraction = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const details = [...document.querySelectorAll('.mobile-reader-tools details')];
        details[0].querySelector('summary').click();
        const firstOpen = details.map((item) => item.open);
        details[1].querySelector('summary').click();
        const secondOpen = details.map((item) => item.open);
        details[2].querySelector('summary').click();
        const thirdOpen = details.map((item) => item.open);
        const panel = details[2].querySelector('.mobile-panel').getBoundingClientRect();
        return JSON.stringify({ firstOpen, secondOpen, thirdOpen, panel: { left: panel.left, right: panel.right, bottom: panel.bottom, width: panel.width } });
      })()`,
      returnByValue: true,
    }, sessionId);
    const panelEvidence = JSON.parse(panelInteraction.result.value);
    await cdp.send("Emulation.clearDeviceMetricsOverride", {}, sessionId);

    const networkRequests = cdp.events.filter((event) => event.method === "Network.requestWillBeSent" && /^https?:/iu.test(event.params?.request?.url ?? ""));
    const browserErrors = cdp.events.filter((event) => event.method === "Runtime.exceptionThrown" || (event.method === "Log.entryAdded" && event.params?.entry?.level === "error"));

    assert.equal(observation.rendered, 5);
    assert.equal(observation.svg >= 5, true);
    assert.equal(observation.loading, 0);
    assert.deepEqual(observation.resources, []);
    assert.equal(observation.bodyFontSize, "19px");
    assert.equal(interactionEvidence.expanded, true);
    assert.equal(interactionEvidence.expandedMetrics.viewport.width / 1440 >= 0.95, true);
    assert.equal(interactionEvidence.expandedMetrics.viewport.height / 900 >= 0.72, true);
    assert.equal(interactionEvidence.expandedMetrics.viewportWidthUse >= 0.75, true);
    assert.equal(interactionEvidence.expandedMetrics.renderedScale >= 0.875, true);
    assert.equal(interactionEvidence.expandedMetrics.minimumTextHeight >= 13, true);
    assert.equal(interactionEvidence.expandedMetrics.fitScale >= 0.875, true);
    assert.equal(interactionEvidence.inlineFitMetrics.requiresHorizontalPan, true);
    assert.equal(interactionEvidence.inlineFitMetrics.renderedScale >= 0.875, true);
    assert.equal(interactionEvidence.inlineFitMetrics.minimumTextHeight >= 13, true);
    assert.equal(interactionEvidence.inlineFitMetrics.fitScale >= 0.875, true);
    assert.notEqual(interactionEvidence.afterZoom, interactionEvidence.beforeZoom);
    assert.notEqual(interactionEvidence.afterFit, interactionEvidence.afterZoom);
    assert.notEqual(interactionEvidence.afterReset, interactionEvidence.afterFit);
    assert.notEqual(afterWheel, beforeWheel);
    assert.notEqual(afterDrag, beforeDrag);
    assert.notEqual(afterPinch, beforePinch);
    assert.equal(fullscreen.result.value, true);
    assert.equal(fullscreenEvidence.viewport.width / 1440 >= 0.98, true);
    assert.equal(fullscreenEvidence.viewport.height / 900 >= 0.78, true);
    assert.equal(fullscreenEvidence.viewportWidthUse >= 0.75, true);
    assert.equal(fullscreenEvidence.renderedScale >= 0.875, true);
    assert.equal(fullscreenEvidence.minimumTextHeight >= 13, true);
    assert.equal(fullscreenEvidence.fitScale >= 0.875, true);
    for (const evidence of [tabletLandscape, tabletPortrait, phone]) {
      assert.equal(evidence.rootScrollWidth <= evidence.rootClientWidth + 1, true, `root overflow at ${evidence.width}px`);
      assert.equal(evidence.rootScrollLeft, 0, `table scrolling moved the page at ${evidence.width}px`);
      assert.equal(evidence.topbar.left >= 0 && evidence.topbar.right <= evidence.rootClientWidth + 1, true, `topbar overflow at ${evidence.width}px`);
      assert.notEqual(evidence.mobileTools, "none");
      assert.equal(evidence.mobileToolCount, 3);
      assert.equal(evidence.artifactsRail, "none");
      assert.equal(evidence.tocRail, "none");
      assert.equal(evidence.reportState, "none");
      assert.equal(evidence.authorityState, "none");
    }
    assert.equal(tabletLandscape.tableScrollWidth > tabletLandscape.tableClientWidth, true);
    assert.equal(tabletPortrait.tableScrollWidth > tabletPortrait.tableClientWidth, true);
    assert.equal(phone.tableScrollWidth <= phone.tableClientWidth + 1, true);
    assert.equal(phone.tableDisplay, "block");
    assert.equal(phone.firstCellDisplay, "grid");
    assert.deepEqual(panelEvidence.firstOpen, [true, false, false]);
    assert.deepEqual(panelEvidence.secondOpen, [false, true, false]);
    assert.deepEqual(panelEvidence.thirdOpen, [false, false, true]);
    assert.equal(panelEvidence.panel.left >= 0 && panelEvidence.panel.right <= 390, true);
    assert.equal(panelEvidence.panel.bottom <= 844, true);
    assert.deepEqual(networkRequests, []);
    assert.deepEqual(browserErrors, []);

    process.stdout.write(`${JSON.stringify({
      operation: "technical-reader-browser-acceptance",
      status: "healthy",
      browser,
      diagrams: 5,
      renderedSvg: true,
      zoomPanPinchExpandFullscreen: true,
      inline: interactionEvidence.inlineFitMetrics,
      expanded: interactionEvidence.expandedMetrics,
      fullscreen: fullscreenEvidence,
      responsive: { tabletLandscape, tabletPortrait, phone, panel: panelEvidence },
      networkRequests: 0,
      bodyFontSize: observation.bodyFontSize,
      source: "file://",
    })}\n`);
  } finally {
    cdp.socket.close();
    cdp = null;
    await stopBrowser(child);
    child = null;
  }
} finally {
  if (cdp) cdp.socket.close();
  await stopBrowser(child);
  rmSync(directory, { recursive: true, force: true });
}
