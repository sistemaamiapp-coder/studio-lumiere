// Worker do Cloudflare: API (função edge) em /api e /functions/v1/app,
// arquivos do site como assets estáticos e upload do portfólio no KV.
import { application } from '../functions/routes.mjs';
import { createD1Db } from './d1-db.mjs';
import { createKvStorage } from './kv-storage.mjs';

const API_PREFIX = '/functions/v1/app';
const UPLOAD_RE = /^\/functions\/v1\/app\/__upload\/(.+)$/;
const UPLOAD_PATH_RE = /^portfolio\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_UPLOAD = 8 * 1024 * 1024;

async function adminFromCookie(request, db) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)lum_session=([^;]+)/);
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  const session = (await db.from('sessions').select('user_id,expires_at').eq('token', token).limit(1)).data?.[0];
  if (!session || new Date(session.expires_at) < new Date()) return null;
  const user = (await db.from('users').select('id,role').eq('id', session.user_id).limit(1)).data?.[0];
  return user && user.role === 'admin' ? user : null;
}

async function handleUpload(request, env, db) {
  if (request.method !== 'PUT') return new Response('método inválido', { status: 405 });
  const match = new URL(request.url).pathname.match(UPLOAD_RE);
  if (!match) return new Response('caminho inválido', { status: 400 });
  const objectPath = decodeURIComponent(match[1]);
  if (!UPLOAD_PATH_RE.test(objectPath)) return new Response('caminho inválido', { status: 400 });

  const admin = await adminFromCookie(request, db);
  if (!admin) return new Response('não autorizado', { status: 401 });

  const type = request.headers.get('content-type') || '';
  if (!UPLOAD_TYPES.includes(type)) return new Response('formato não suportado', { status: 415 });
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_UPLOAD) return new Response('arquivo grande demais', { status: 413 });

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_UPLOAD) {
    return new Response('arquivo inválido', { status: 413 });
  }
  await env.MEDIA.put(objectPath, bytes, { metadata: { type } });
  return new Response(null, { status: 200 });
}

async function serveAsset(request, env, url) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('método inválido', { status: 405 });
  const candidates = [];
  if (url.pathname === '/') candidates.push('/index.html');
  else candidates.push(url.pathname);
  if (!/\.[a-z0-9]+$/i.test(url.pathname)) candidates.push(`${url.pathname}.html`);

  for (const path of candidates) {
    const assetUrl = new URL(path, url.origin);
    const response = await env.ASSETS.fetch(new Request(assetUrl, { method: request.method, headers: request.headers }));
    if (response.status !== 404) return response;
  }
  return new Response('Página não encontrada', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const db = createD1Db(env.DB);
    const storage = createKvStorage(env.MEDIA);

    if (url.pathname.startsWith(`${API_PREFIX}/__upload/`)) {
      return handleUpload(request, env, db);
    }

    if (url.pathname.startsWith(`${API_PREFIX}/`) || url.pathname === API_PREFIX) {
      return application({ db, storage })(request);
    }

    if (url.pathname.startsWith('/api/')) {
      const rewritten = new URL(request.url);
      rewritten.pathname = `${API_PREFIX}${url.pathname}`;
      return application({ db, storage })(new Request(rewritten, request));
    }

    return serveAsset(request, env, url);
  }
};
