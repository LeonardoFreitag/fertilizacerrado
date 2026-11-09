# FertilizaCerrado

[![CI](https://github.com/LeonardoFreitag/fertilizacerrado/actions/workflows/ci.yml/badge.svg)](https://github.com/LeonardoFreitag/fertilizacerrado/actions/workflows/ci.yml)

Plataforma SaaS agronômica para as grandes culturas do Cerrado brasileiro. Combina análise de solo, reanálise climática (ERA5-Land, com correção de viés por estações) e parâmetros fisiológicos das cultivares para apoiar decisões de calagem e adubação sensíveis ao contexto hídrico real de cada talhão.

A Fase 1 entrega o **Módulo de Software Agrometeorológico (MSA)** — objeto da dissertação de mestrado de Heb Rejane Moreira Pires: balanço hídrico diário (FAO-56), janelas fenológicas por graus-dia e predição da produtividade da soja frente à produtividade potencial informada por safra (índice do ciclo FAO-33 por janela fenológica).

## Como rodar

Pré-requisitos: Docker, Node 20 e pnpm 9 (`corepack enable`).

```bash
cp .env.example .env            # preencha DB_*, REDIS_PASSWORD, JWT_* (≥ 32 caracteres), ADMIN_*
pnpm start                      # docker compose up -d (db, redis, api, worker, etl, frontend, nginx, adminer)
pnpm seed                       # usuário ADMIN e cultivar de referência (soja)
```

Interface em <http://localhost> (login com `ADMIN_EMAIL`/`ADMIN_PASSWORD`), API em `http://localhost/api/v1`, Adminer em <http://localhost:8080>. Sem `SMTP_HOST`, os links de verificação de e-mail saem no log da API (`pnpm verify-link`).

Atalhos do `package.json` da raiz: `pnpm stop`, `pnpm logs:api`, `pnpm migrate`, `pnpm test`, `pnpm test:e2e`, `pnpm etl:status`, `pnpm db:backup`, `pnpm db:restore -- backups/<arquivo>.dump`, `pnpm manual:capture` e `pnpm manual:pdf` (imagens e PDF do manual do usuário), `pnpm clean` (remove **todos** os volumes, inclusive o cache ERA5).

### Após atualizar para o motor 2.3.0 (momentos de estresse e "Como foi a safra")

A migration `add_stress_timeline` é aditiva (quatro colunas nulas em `msa_runs`). Nada é obrigatório depois do deploy: a seção "Como foi a safra" aparece para as runs 2.2.0 porque a API calcula eventos e perda na leitura a partir da série gravada (com a nota "calculado agora com os parâmetros atuais"). **Processar todas as safras ativas** em `/admin` grava os campos e remove a nota. Opcional no `.env`: `STRESS_KS_THRESHOLD` (0,70) e `STRESS_MIN_DAYS` (3).

### Após atualizar o ETL para requisições mensais ao CDS (2026-11)

O CDS passou a recusar por custo as requisições trimestrais (`cost limits exceeded`); o ETL agora pede sempre um mês por requisição, até `ERA5_CDS_MAX_CONCURRENT` (padrão 2, opcional no `.env`) em paralelo. Não há migration. Reenfileire os backfills que falharam por custo: reprocesse as safras `NEEDS_DATA` (ou crie a safra de novo) ou use **Backfill regional** em `/admin` com `from` em `AAAA-02-01` — um único job cobre o intervalo inteiro. Arquivos `AAAA-Qn.nc` no volume `etl_cache` deixam de ser lidos e podem ser apagados.

### Após atualizar para o motor 2.2.0 (entressafra)

A migration `add_preseason_water_balance` é aditiva (cinco colunas nulas em `msa_runs`). O balanço hídrico de cada safra passa a começar no último 1º de fevereiro anterior à emergência, então:

1. Confira o `.env`: `PRE_SEASON_KC` (padrão 1,0) e `PRE_SEASON_ZR_MODE` (padrão `zrMax`) — os padrões valem se ausentes; os valores são gravados em cada run.
2. Faça o backfill ERA5-Land das células dos talhões **desde fevereiro** — **Backfill regional** em `/admin` com o bbox dos talhões e `from` em `AAAA-02-01`, ou `docker compose run --rm etl backfill --harvest <uuid>` por safra. Até lá, as safras processadas ficam `NEEDS_DATA` com os dias da entressafra agrupados por mês no painel.
3. Depois acione **Processar todas as safras ativas** em `/admin`. As runs antigas (2.1.0) ficam no histórico; o painel mostra "Esta execução não tem entressafra (motor anterior); reprocesse" até a nova run.

### Após atualizar para o motor 2.1.0 (graus-dia de Ometto)

A migration `adopt_ometto_degree_days` é aditiva (coluna `t_upper`, 30 °C na referência e nas cultivares de soja existentes). As janelas fenológicas mudam para a mesma série, então acione **Processar todas as safras ativas** em `/admin`; as runs antigas (2.0.0) ficam no histórico e o painel avisa que os parâmetros da cultivar mudaram até o reprocessamento.

### Após atualizar para o motor 2.0.0 (predição de produtividade)

A migration `refocus_yield_prediction` é destrutiva: descarta as runs do MSA anteriores (motor 1.x, não reproduzíveis), a tabela de decisões e a cultura milho (falha se houver cultivar de milho em uso). Faça backup antes (`pnpm db:backup`) e, depois do deploy, acione **Processar todas as safras ativas** em `/admin` para recalcular as safras com índice do ciclo e produtividade predita.

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

- **[Manual do usuário](docs/manual/README.md)** — passo a passo para agrônomos, produtores e administradores, com as telas ([PDF](docs/manual/manual-completo.pdf))
- [Arquitetura](docs/arquitetura.md) — visão geral, fases, stack, fluxo de dados
- Módulos: [auth](docs/modulos/auth.md), [propriedades e talhões](docs/modulos/propriedades.md), [MSA](docs/modulos/msa.md), [frontend](docs/modulos/frontend.md)
- MSA: [algoritmos](docs/msa/algoritmos.md), [pipeline ERA5-Land e correção de viés](docs/msa/era5-etl.md), [validação](docs/msa/validacao.md), [questões abertas para a pesquisadora](docs/msa/questoes-abertas.md)
- [ETL](backend/etl/README.md) · [roteiros de ponta a ponta](backend/scripts/e2e/README.md)

## Qualidade

O workflow de CI roda, a cada push e PR em `main`: typecheck e unitários do backend, lint/typecheck/unitários/build do frontend, unitários do ETL e o build das três imagens Docker. Os testes de ponta a ponta (roteiros `bash` e Playwright) exigem a stack inteira e o cache do CDS e rodam localmente.
