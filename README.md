# Studio Lumière — agenda, clientes e financeiro

Sistema de gestão para estúdio de cílios e unhas: agendamento online 24h, agenda do dia,
ficha das clientes, controle de manutenção, sinal via Pix e financeiro — tudo em português,
com painel administrativo em tempo real (WebSocket).

## Requisitos

- Node.js **24** (o banco usa `node:sqlite`, nativo a partir do Node 22.5)
- npm

## Rodando localmente

```bash
npm ci
npm start
```

- Site: http://localhost:3000
- Agendamento: http://localhost:3000/agendar
- Painel: http://localhost:3000/admin.html

O banco (`data/studio.db`) é criado e populado com dados de demonstração no primeiro start.
Acessos iniciais:

| Perfil  | E-mail                 | Senha        |
| ------- | ---------------------- | ------------ |
| Estúdio | `studio@lumiere.com.br`| `lumiere2026`|
| Cliente | `cliente@demo.com`     | `demo1234`   |

## Personalizando o estúdio

Tudo que é da marca fica em [`server/config.js`](server/config.js): nome, WhatsApp, Instagram,
chave Pix, percentual do sinal, horário de funcionamento, regras de cancelamento e os acessos
iniciais. As imagens do site e do portfólio ficam em `public/img/`; as fotos enviadas pelo
painel são gravadas em `uploads/`.

## Variáveis de ambiente

| Variável            | Padrão          | Uso                                             |
| ------------------- | --------------- | ----------------------------------------------- |
| `PORT`              | `3000`          | Porta HTTP                                      |
| `LUMIERE_DATA_DIR`  | `./data`        | Pasta do SQLite (usada pelo teste para isolar)  |

## Testes

```bash
npm test
```

O teste de fumaça sobe o servidor com um banco temporário e exercita login, agenda,
disponibilidade, agendamento online, Pix, painel e permissões. O mesmo roteiro roda no
GitHub Actions a cada push/PR (`.github/workflows/ci.yml`).

## Estrutura

```
server/        API Express, banco SQLite, Pix, disponibilidade, WebSocket
public/        site público e painel (JS puro, sem build)
scripts/       teste de fumaça
uploads/       fotos enviadas pelo painel (não versionadas)
data/          banco SQLite (não versionado)
```
