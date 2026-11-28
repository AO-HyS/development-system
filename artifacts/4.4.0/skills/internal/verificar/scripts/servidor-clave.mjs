#!/usr/bin/env node
// @ts-check
// Hands the password of a LOCAL synthetic test account only to a page of the local product, so a model driving the
// browser can sign in without the password passing through the chat, a brief or a tool argument.
// It is a convenience for test accounts, alive for one task; it is not a boundary against the agent, which could read
// the file. Real credentials go only through the owner's `browse secrets add`.
// Usage: node servidor-clave.mjs <file-with-the-password> <allowed-origin> [port=3499]
import fs from 'node:fs';
import http from 'node:http';

const [file, origin, port = '3499'] = process.argv.slice(2);
if (!file || !origin) {
  console.error('uso: servidor-clave.mjs <archivo-con-la-clave> <origen-permitido> [puerto]');
  process.exit(2);
}
let delivered = 0;
http.createServer((request, response) => {
  const from = request.headers.origin ?? '';
  if (request.url !== '/clave' || from !== origin) {
    response.writeHead(403).end('no');
    console.log(`rechazado ${request.url} origen=${from || '-'}`);
    return;
  }
  response.writeHead(200, { 'Access-Control-Allow-Origin': origin, 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  response.end(fs.readFileSync(file, 'utf8').trim());
  console.log(`entregada ${++delivered}`);
}).listen(Number(port), '127.0.0.1', () => console.log(`listo en 127.0.0.1:${port} para ${origin} (pid ${process.pid})`));
