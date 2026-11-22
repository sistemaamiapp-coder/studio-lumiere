// Publica o sistema no Cloudflare (Worker + D1 + KV) criando os recursos
// que ainda não existirem. Roda no GitHub Actions a cada push na main.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wranglerBin = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const DB_NAME = 'studio-paula-souza';
const KV_TITLE = 'studio-paula-souza-media';

function wrangler(args, { input, allowFailure = false } = {}) {
  const result = spawnSync(process.execPath, [wranglerBin, ...args], {
    cwd: root,
    encoding: 'utf8',
    input,
    env: process.env
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`wrangler ${args.join(' ')} falhou:\n${result.stderr || result.stdout}`);
  }
  return result;
}

function jsonArray(output) {
  const start = Math.min(...['[', '{'].map(ch => {
    const index = output.indexOf(ch);
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  }));
  if (!Number.isFinite(start)) return [];
  const parsed = JSON.parse(output.slice(start));
  const list = Array.isArray(parsed) ? parsed : parsed.result || [];
  return Array.isArray(list) ? list : [];
}

function ensureD1() {
  const listed = jsonArray(wrangler(['d1', 'list', '--json']).stdout);
  const found = listed.find(row => row.name === DB_NAME);
  if (found) return found.uuid;
  const created = wrangler(['d1', 'create', DB_NAME]).stdout;
  const id = created.match(/database_id\s*=\s*"([0-9a-f-]{36})"/)?.[1];
  if (!id) throw new Error(`não foi possível ler o id do banco criado:\n${created}`);
  return id;
}

function ensureKv() {
  const listed = jsonArray(wrangler(['kv', 'namespace', 'list']).stdout);
  const found = listed.find(row => (row.title || row.name) === KV_TITLE);
  if (found) return found.id;
  const created = wrangler(['kv', 'namespace', 'create', KV_TITLE]).stdout;
  const id = created.match(/"?id"?\s*[:=]\s*"([0-9a-f]{32})"/)?.[1];
  if (!id) throw new Error(`não foi possível ler o id do KV criado:\n${created}`);
  return id;
}

function main() {
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    const who = wrangler(['whoami'], { allowFailure: true });
    if (who.status !== 0) {
      throw new Error('Sem credencial do Cloudflare. Defina CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID.');
    }
  }

  const databaseId = ensureD1();
  const kvId = ensureKv();
  console.log(`Banco D1: ${databaseId}`);
  console.log(`KV de imagens: ${kvId}`);

  const generated = readFileSync(path.join(root, 'wrangler.toml'), 'utf8')
    .replace(/database_id = "[^"]*"/, `database_id = "${databaseId}"`)
    .replace(/^id = "[^"]*"$/m, `id = "${kvId}"`);
  const configPath = path.join(root, 'wrangler.deploy.toml');
  writeFileSync(configPath, generated);

  wrangler(['d1', 'execute', DB_NAME, '--remote', '--file', path.join(root, 'serverless', 'schema.sql'), '--yes', '--config', configPath]);
  console.log('Estrutura do banco aplicada.');

  const secrets = {
    LUMIERE_ADMIN_PASSWORD: process.env.LUMIERE_ADMIN_PASSWORD,
    LUMIERE_PIX_KEY: process.env.LUMIERE_PIX_KEY
  };
  for (const [name, value] of Object.entries(secrets)) {
    if (!value) continue;
    wrangler(['secret', 'put', name, '--config', configPath], { input: `${value}\n` });
    console.log(`Segredo ${name} atualizado.`);
  }

  const result = wrangler(['deploy', '--config', configPath]);
  const output = `${result.stdout}\n${result.stderr}`;
  const url = output.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
  if (!url) throw new Error(`publicação concluída, mas sem endereço no retorno:\n${output}`);
  writeFileSync(path.join(root, '.deploy-url'), `${url}\n`);
  console.log(`Publicado em ${url}`);
}

main();
