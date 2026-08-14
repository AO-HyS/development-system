// @ts-nocheck -- This executable drives Chrome through its runtime CDP protocol; browser behavior is its acceptance boundary.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const readerModulePath = join(process.cwd(), "artifacts/1.5.5/skills/internal/working-backwards/scripts/t3-reader.mjs");
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
  User->>Reader: Open file directly
  Reader-->>User: Render an SVG offline
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
    await cdp.send("Page.navigate", { url: reportUrl }, sessionId);
    const observation = await waitForRendered(cdp.send, sessionId);
    const interaction = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const figure = document.querySelector('[data-mermaid]');
        figure.scrollIntoView({ block: 'center' });
        await new Promise((resolve) => setTimeout(resolve, 50));
        const beforeZoom = figure.querySelector('svg').style.transform;
        figure.querySelector('[data-action="zoom-in"]').click();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const afterZoom = figure.querySelector('svg').style.transform;
        figure.querySelector('[data-action="expand"]').click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const viewport = figure.querySelector('.diagram-viewport').getBoundingClientRect();
        const fullscreenButton = figure.querySelector('[data-action="fullscreen"]').getBoundingClientRect();
        return JSON.stringify({
          expanded: figure.classList.contains('is-expanded'),
          beforeZoom,
          afterZoom,
          viewport: { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height },
          fullscreenButton: { x: fullscreenButton.x, y: fullscreenButton.y, width: fullscreenButton.width, height: fullscreenButton.height },
        });
      })()`,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    const interactionEvidence = JSON.parse(interaction.result.value);
    const center = {
      x: interactionEvidence.viewport.x + interactionEvidence.viewport.width / 2,
      y: interactionEvidence.viewport.y + interactionEvidence.viewport.height / 2,
    };
    const transform = async () => {
      const result = await cdp.send("Runtime.evaluate", {
        expression: "document.querySelector('[data-mermaid] svg').style.transform",
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
      expression: "document.fullscreenElement?.matches('[data-mermaid]') === true || document.querySelector('[data-mermaid]').classList.contains('is-fullscreen-fallback')",
      returnByValue: true,
    }, sessionId);
    await cdp.send("Runtime.evaluate", {
      expression: "document.fullscreenElement ? document.exitFullscreen() : undefined",
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);

    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    const responsive = await cdp.send("Runtime.evaluate", {
      expression: `JSON.stringify({
        narrow: matchMedia('(max-width: 64rem)').matches,
        mobileTools: getComputedStyle(document.querySelector('.mobile-reader-tools')).display,
        artifactsRail: getComputedStyle(document.querySelector('.artifacts-rail')).display,
        tocRail: getComputedStyle(document.querySelector('.toc-rail')).display,
      })`,
      returnByValue: true,
    }, sessionId);
    await cdp.send("Emulation.clearDeviceMetricsOverride", {}, sessionId);

    const networkRequests = cdp.events.filter((event) => event.method === "Network.requestWillBeSent" && /^https?:/iu.test(event.params?.request?.url ?? ""));
    const browserErrors = cdp.events.filter((event) => event.method === "Runtime.exceptionThrown" || (event.method === "Log.entryAdded" && event.params?.entry?.level === "error"));
    const responsiveEvidence = JSON.parse(responsive.result.value);

    assert.equal(observation.rendered, 5);
    assert.equal(observation.svg >= 5, true);
    assert.equal(observation.loading, 0);
    assert.deepEqual(observation.resources, []);
    assert.equal(observation.bodyFontSize, "19px");
    assert.equal(interactionEvidence.expanded, true);
    assert.notEqual(interactionEvidence.afterZoom, interactionEvidence.beforeZoom);
    assert.notEqual(afterWheel, beforeWheel);
    assert.notEqual(afterDrag, beforeDrag);
    assert.notEqual(afterPinch, beforePinch);
    assert.equal(fullscreen.result.value, true);
    assert.equal(responsiveEvidence.narrow, true);
    assert.notEqual(responsiveEvidence.mobileTools, "none");
    assert.equal(responsiveEvidence.artifactsRail, "none");
    assert.equal(responsiveEvidence.tocRail, "none");
    assert.deepEqual(networkRequests, []);
    assert.deepEqual(browserErrors, []);

    process.stdout.write(`${JSON.stringify({
      operation: "technical-reader-browser-acceptance",
      status: "healthy",
      browser,
      diagrams: 5,
      renderedSvg: true,
      zoomPanPinchExpandFullscreen: true,
      responsive: true,
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
