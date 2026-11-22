# Studio Paula Souza — agenda, clientes e financeiro

Sistema do estúdio de cílios e unhas: agendamento online 24h, agenda do dia, ficha das
clientes, controle de manutenção, sinal via Pix e financeiro — em português, com painel
administrativo.

**Clientes não têm login.** A cliente marca, consulta, confirma, cancela e avisa o Pix
usando o **nome completo + WhatsApp** informados no agendamento.

## Endereços

| Página                | Endereço                          |
| --------------------- | --------------------------------- |
| Site                  | `/`                               |
| Agendamento           | `/agendar`                        |
| Minha conta           | `/minha-conta`                    |
| Painel do estúdio     | `/admin.html`                     |

No ambiente publicado o endereço é o do Worker no Cloudflare (veja os logs do GitHub
Actions em **Publicar**). O teste local usa `http://localhost:3000`.

## Rodando localmente

```bash
npm ci
npm start          # API + site em http://localhost:3000 (banco em memória)
```

`npm run dev` sobe o Worker com banco D1 e KV locais, mais próximo da produção:

```bash
npm run db:local
npm run dev
```

Acessos do painel: `studio@paulasouza.com.br` e a senha de `LUMIERE_ADMIN_PASSWORD`
(sem ela, o primeiro start gera uma senha e mostra no console).

## Publicação automática

Cada push na `main` dispara **CI** (teste de fumaça) e **Publicar** (deploy no Cloudflare).

O deploy cria os recursos que faltarem e aplica a estrutura do banco:

- Worker `studio-paula-souza` (API + site)
- Banco **D1** `studio-paula-souza`
- KV `studio-paula-souza-media` (fotos do portfólio)
- Segredo `LUMIERE_ADMIN_PASSWORD` (senha do painel no primeiro acesso)

Secrets do repositório (Settings → Secrets and variables → Actions):

| Secret                    | Para que serve                                            |
| ------------------------- | --------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`    | Publicar o Worker                                         |
| `CLOUDFLARE_ACCOUNT_ID`   | Conta do Cloudflare                                       |
| `LUMIERE_ADMIN_PASSWORD`  | Senha do painel (usada só na criação da conta do estúdio) |
| `LUMIERE_PIX_KEY`         | Chave Pix do estúdio (opcional)                           |

Sem `CLOUDFLARE_API_TOKEN` a publicação fica desativada e o CI continua verde.

## Testes

```bash
npm test                                   # fluxo completo no servidor local
npm run check:live https://seu-endereco    # páginas, API pública e login do painel
SMOKE_TARGET=https://seu-endereco SMOKE_ADMIN_PASSWORD=... npm test
```

## Dados

- Clientes, agenda, financeiro e configurações ficam no banco D1 (Cloudflare).
- Fotos publicadas pelo painel ficam no KV; as imagens fixas do site em `public/img/`.
- Os dados de demonstração são criados uma única vez, no primeiro acesso ao sistema.

## Estrutura

```
functions/     API completa (roda no Cloudflare e no Node local)
serverless/    Worker, banco D1, arquivos no KV e estrutura do banco
server/        adaptador local que usa functions/ (npm start)
public/        site público e painel (JS puro, sem build)
dev/           banco e storage em memória para testes
scripts/       teste de fumaça, check do site publicado e deploy
```
