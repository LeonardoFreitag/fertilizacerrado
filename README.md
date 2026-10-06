# FertilizaCerrado

[![CI](https://github.com/LeonardoFreitag/fertilizacerrado/actions/workflows/ci.yml/badge.svg)](https://github.com/LeonardoFreitag/fertilizacerrado/actions/workflows/ci.yml)

Plataforma SaaS agronômica para as grandes culturas do Cerrado brasileiro. Combina análise de solo, reanálise climática (ERA5-Land, com correção de viés por estações) e parâmetros fisiológicos das cultivares para apoiar decisões de calagem e adubação sensíveis ao contexto hídrico real de cada talhão.

A Fase 1 entrega o **Módulo de Software Agrometeorológico (MSA)** — objeto da dissertação de mestrado de Heb Rejane Moreira Pires: balanço hídrico diário (FAO-56), janelas fenológicas por graus-dia, Monte Carlo (P10/P50/P90 do coeficiente de estresse) e cenários de decisão para o técnico agrônomo.

## Como rodar

Pré-requisitos: Docker, Node 20 e pnpm 9 (`corepack enable`).

```bash
cp .env.example .env            # preencha DB_*, REDIS_PASSWORD, JWT_* (≥ 32 caracteres), ADMIN_*
pnpm start                      # docker compose up -d (db, redis, api, worker, etl, frontend, nginx, adminer)
pnpm seed                       # usuário ADMIN e cultivares de referência
```

Interface em <http://localhost> (login com `ADMIN_EMAIL`/`ADMIN_PASSWORD`), API em `http://localhost/api/v1`, Adminer em <http://localhost:8080>. Sem `SMTP_HOST`, os links de verificação de e-mail saem no log da API (`pnpm verify-link`).

Atalhos do `package.json` da raiz: `pnpm stop`, `pnpm logs:api`, `pnpm migrate`, `pnpm test`, `pnpm test:e2e`, `pnpm etl:status`, `pnpm db:backup`, `pnpm db:restore -- backups/<arquivo>.dump`, `pnpm clean` (remove **todos** os volumes, inclusive o cache ERA5).

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `backend/` | API Node 20 + Express 5 + Prisma (PostgreSQL 15 com TimescaleDB e PostGIS), worker BullMQ, motor MSA (`src/modules/msa/engine`) |
| `backend/etl/` | ETL Python 3.12: ingestão ERA5-Land (CDS), observações de estações e correção de viés (Quantile Mapping) |
| `frontend/` | SPA React 18 + Vite + Tailwind: autenticação, propriedades e talhões no mapa, cultivares, safras e o painel do MSA |
| `nginx/`, `docker-compose*.yml` | Proxy, stack de desenvolvimento e de produção |
| `openspec/` | Especificações (OpenSpec): `specs/` vigentes e `changes/archive/` com o histórico de cada entrega |
| `docs/` | Documentação |

## Documentação

- [Arquitetura](docs/arquitetura.md) — visão geral, fases, stack, fluxo de dados
- Módulos: [auth](docs/modulos/auth.md), [propriedades e talhões](docs/modulos/propriedades.md), [MSA](docs/modulos/msa.md), [frontend](docs/modulos/frontend.md)
- MSA: [algoritmos](docs/msa/algoritmos.md), [pipeline ERA5-Land e correção de viés](docs/msa/era5-etl.md), [validação](docs/msa/validacao.md), [questões abertas para a pesquisadora](docs/msa/questoes-abertas.md)
- [ETL](backend/etl/README.md) · [roteiros de ponta a ponta](backend/scripts/e2e/README.md)

## Qualidade

O workflow de CI roda, a cada push e PR em `main`: typecheck e unitários do backend, lint/typecheck/unitários/build do frontend, unitários do ETL e o build das três imagens Docker. Os testes de ponta a ponta (roteiros `bash` e Playwright) exigem a stack inteira e o cache do CDS e rodam localmente.
