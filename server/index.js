// Servidor local: publica os arquivos de public/ e roda a API da função edge
// (functions/routes.mjs) com banco e storage em memória.
// Uso: node server/index.js  (PORT=3000 por padrão)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { application } from '../functions/routes.mjs';
import { createFakeDb } from '../dev/fake-db.mjs';
import { createFakeStorage } from '../dev/fake-storage.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const port = Number(process.env.PORT || 3000);
const API_BASE = '/functions/v1/app';

const db = createFakeDb();
const storage = createFakeStorage();
const handle = application({ db, storage });

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf'
};

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

async function toWebRequest(request, body) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value != null) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  return new Request(`http://127.0.0.1:${port}${request.url}`, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : body
  });
}

async function sendWebResponse(response, res) {
  const headers = {};
  response.headers.forEach((value, name) => { headers[name] = value; });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function serveStatic(pathname, res) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end('Requisição inválida');
    return;
  }
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  if (relative.startsWith('..')) {
    res.writeHead(403).end('Acesso negado');
    return;
  }
  const candidates = [];
  if (!relative || relative.endsWith('/')) candidates.push(join(relative, 'index.html'));
  else {
    candidates.push(relative);
    if (!extname(relative)) candidates.push(`${relative}.html`);
  }

  for (const candidate of candidates) {
    const file = join(publicDir, candidate);
    try {
      const info = await stat(file);
      if (!info.isFile()) continue;
      let body = await readFile(file);
      const type = types[extname(file).toLowerCase()] || 'application/octet-stream';
      if (type.startsWith('text/html')) {
        body = Buffer.from(body.toString('utf8').replace('</head>', `  <script>window.__API_BASE=${JSON.stringify(API_BASE)};</script>\n</head>`));
      }
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
      return;
    } catch { /* tenta o próximo candidato */ }
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Página não encontrada');
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);

  const upload = url.pathname.match(/^\/functions\/v1\/app\/__upload\/(.+)$/);
  if (upload && request.method === 'PUT') {
    const objectPath = decodeURIComponent(upload[1]);
    if (!/^portfolio\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(objectPath)) {
      response.writeHead(400).end('invalid path');
      return;
    }
    const bytes = new Uint8Array(await readBody(request));
    await storage.upload(objectPath, bytes, { contentType: request.headers['content-type'] || 'application/octet-stream' });
    response.writeHead(200).end();
    return;
  }

  if (url.pathname.startsWith(API_BASE)) {
    try {
      const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await readBody(request);
      const webRequest = await toWebRequest(request, body);
      await sendWebResponse(await handle(webRequest), response);
    } catch (error) {
      console.error('[api] erro inesperado', error);
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Erro inesperado no servidor.' }));
    }
    return;
  }

  await serveStatic(url.pathname, response);
});

server.listen(port, () => {
  console.log(`Studio Paula Souza em http://127.0.0.1:${port}`);
});
