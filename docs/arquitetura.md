# FertilizaCerrado — Arquitetura do Sistema

## Visão Geral

O **FertilizaCerrado** é uma plataforma SaaS agronômica voltada para as grandes culturas do Cerrado brasileiro. Seu objetivo central é integrar dados de análise de solo, dados agrometeorológicos de reanálise e parâmetros fisiológicos das culturas para gerar **recomendações de calagem e adubação** sensíveis ao contexto climático real de cada talhão.

A plataforma é desenvolvida em fases incrementais, sendo a **Fase 1** dedicada ao Módulo de Software Agrometeorológico (MSA), objeto da dissertação de mestrado de Heb Rejane Moreira Pires.

---

## Fases do Projeto

### Fase 0 — Fundação
Infraestrutura base sem a qual nenhum módulo de domínio pode operar.

| Módulo | Responsabilidade |
|---|---|
| Auth | Autenticação JWT, roles, verificação e recuperação de senha, reenvio de verificação |
| Usuários | Administração de contas (ativar/desativar, roles, último admin), perfil próprio, troca de senha — `docs/modulos/usuarios.md` |
| Propriedades e Talhões | Cadastro geoespacial (PostGIS) de fazendas e talhões |

**Status: completa.** Qualidade contínua: CI do GitHub Actions (`.github/workflows/ci.yml` — typecheck e unitários do backend, lint/typecheck/unitários/build do frontend, unitários do ETL, build das três imagens). Backup: `pnpm db:backup`/`db:restore` em dev (`backend/scripts/db/`), serviço `backup` diário (03:30 BRT, volume `db_backups`) em produção; envio para S3 na Fase 2 de infra.

### Fase 1 — Módulo Agrometeorológico (MSA)
Produto principal da dissertação. Processa dados ERA5-Land e prediz a produtividade da soja frente à produtividade potencial informada por safra, com base no estresse hídrico por janela fenológica.

| Módulo | Responsabilidade |
|---|---|
| Cultivares | Parâmetros fenológicos e fisiológicos de soja (única cultura da Fase 1); nova cultivar nasce da referência tabelada |
| Safras | Vínculo talhão + cultivar + data de emergência + produtividade potencial (Ym, sc/ha) |
| Motor MSA | ETL ERA5-Land, ET₀ FAO-56, balanço hídrico, GDA, Ks médio e redução de produtividade por janela (FAO-33) |
| Predição de produtividade | Índice do ciclo FAO-33 (Π das janelas alcançadas), Ym por safra, produtividade predita em sc/ha |
| Entressafra (spin-up) | Balanço de cada safra começa no último 1º de fevereiro ≤ emergência, com o solo na capacidade de campo e sem cultura (Kc e Zr constantes, `PRE_SEASON_*`); a depleção na emergência é calculada, não assumida (motor 2.2.0, `docs/msa/algoritmos.md` §5) |

### Fase 2 — Plataforma Core
| Módulo | Responsabilidade |
|---|---|
| Análise de Solo | Importação e interpretação de laudos de laboratório |
| Recomendação | Motor de calagem e adubação integrado ao histórico hídrico do MSA |

### Fase 3 — Complementar
| Módulo | Responsabilidade |
|---|---|
| Alertas | Notificações de janelas fenológicas críticas e veranicos |
| Relatórios | Geração de laudos PDF para o técnico responsável |

---

## Stack Tecnológica

| Camada | Tecnologia | Justificativa |
|---|---|---|
| API Backend | Node.js 20 + TypeScript + Express | Tipagem estrita, ecossistema maduro |
| ORM | Prisma 5 | Migrations versionadas, type-safety |
| Banco de dados | PostgreSQL 15 + PostGIS + TimescaleDB — imagem `timescale/timescaledb-ha:pg15` | Dados geoespaciais (talhões) e séries temporais (ERA5-Land); uma única imagem traz as duas extensões |
| Fila / Concorrência | BullMQ 5 (Node) + `bullmq` (PyPI) + Redis 7 (`noeviction`) | Processo `worker` (filas `msa-process`, `msa-weekly`, scheduler semanal) separado das réplicas da API; flows ligam o ingest Python ao processamento Node |
| Pipeline ETL | Python 3.12 (cdsapi, xarray, netCDF4, pandas, psycopg, bullmq) em contêiner próprio (`backend/etl`, serviço `etl` sempre no ar como worker da fila `era5-ingest`) | Download no CDS por mês/trimestre com cache, agregação diária e carga por célula na hipertabela `era5_daily_data` |
| Frontend | React 18 + Vite + TypeScript + TailwindCSS (react-router, TanStack Query, react-hook-form/zod, react-leaflet + geoman) | SPA em `frontend/` (`docs/modulos/frontend.md`); em dev, serviço `frontend` (Vite) atrás do Nginx; em prod, estáticos copiados para a imagem do nginx (`fertiliza-web`) |
| Proxy / LB | Nginx 1.25 | Reverse proxy da API, rate limiting, TLS; serve a SPA (dev: proxy para o Vite com WebSocket; prod: estáticos com fallback `index.html`) |
| Containers | Docker + Docker Compose | Ambiente reprodutível |
| Gerenciador pacotes | pnpm | Economia de espaço em disco, lockfile estrito |
| Nuvem (produção) | AWS (EC2 → ECS Fargate → EKS) | Escala gradual conforme demanda |

---

## Fluxo de Dados — MSA

```
[Copernicus CDS API]
        │  ERA5-Land NetCDF/GRIB (lag ~5 dias)
        ▼
[Pipeline ETL Python]
  ├── Extração espacial por polígono do talhão (PostGIS)
  ├── Correção de viés (Quantile Mapping calibrado com INMET)
  └── Carga em lote → PostgreSQL / TimescaleDB
        │
        ▼
[BullMQ / Redis]  scheduler semanal (seg 02:00 BRT) · backfill ao criar safra (cobertura desde o último 1º de fevereiro ≤ emergência) · admin
  flow: era5-ingest (Python) → msa-process (Node)
        │
        ▼
[Processo worker Node.js / TypeScript]  (a API só enfileira)
  ├── Entressafra (spin-up): balanço sem cultura de 1º de fevereiro à véspera da emergência → depleção na emergência
  ├── Acúmulo de GDA (desde a emergência) → Projeção das janelas F1–F4
  ├── ET₀ diária (FAO-56 Penman-Monteith)
  ├── Balanço hídrico diário (TAW, RAW, Dr, Ks)
  ├── Resumo por janela F1–F4 (Ks médio, redução Ky·(1−Ks̄))
  └── Índice do ciclo (Π das janelas alcançadas) → produtividade predita = Ym × índice
        │  série diária (dias PRE + cultura), resumos, índice, predita, depleção na emergência → msa_runs (reason, jobId, cultivarSnapshot, preSeason*)
        ▼
[React Frontend — SPA atrás do mesmo Nginx (/ → SPA, /api → API)]
  ├── Autenticação (token em memória + refresh por cookie HttpOnly), propriedades e talhões no mapa
  ├── Bloco Produtividade: Ym, redução por janela, índice do ciclo, produtividade predita (sc/ha), cartão "Água no solo na emergência"
  ├── Painel de janelas fenológicas e histórico hídrico (gráficos com alternador "Mostrar entressafra")
  └── Indicador de estresse por janela (Ks médio)
```

---

## Conceito Operacional — Predição Retrospectiva de Produtividade por Janelas

O MSA **não opera em tempo real**. Trabalha com o conceito de **predição retrospectiva de produtividade por janelas fenológicas**:

- Os dados ERA5-Land têm lag nativo de ~5 dias pela API Copernicus
- O processamento ocorre em **cron jobs semanais** (batch); cada run é determinística e reproduzível (`cultivarSnapshot`, `ENGINE_VERSION`)
- O balanço hídrico de cada safra **não começa na emergência**: começa no último 1º de fevereiro anterior a ela, com o solo na capacidade de campo, e atravessa a entressafra sem cultura (spin-up, Thornthwaite-Mather) — por isso a cobertura ERA5-Land exigida ao criar a safra, e o backfill, partem de fevereiro, e a run informa com quanta água o talhão entrou na safra
- O estresse hídrico é consolidado por **janela fenológica** (F1, F2, F3, F4): Ks médio e redução de produtividade Ky·(1 − Ks̄) de cada janela, combinadas no índice do ciclo FAO-33
- A saída é a **produtividade predita** (sc/ha) frente à **produtividade potencial** (Ym) informada pelo agrônomo na safra; enquanto o ciclo não termina, as janelas não alcançadas entram sem estresse e a predição é marcada como parcial
- A predição é **atualizada a cada semana**, à medida que novas janelas são alcançadas, e consolidada ao fim do ciclo

O agrônomo usa a predição como apoio ao planejamento e à discussão com o produtor; o sistema **não gera cenários de adubação** nem registra decisões — essa camada foi removida em 2026-11-02 (ver `docs/msa/questoes-abertas.md`). Essa abordagem reflete a realidade agrícola do Cerrado: as operações dependem de planejamento logístico, disponibilidade de maquinário e condições edafoclimáticas — não de respostas instantâneas.

---

## Estrutura de Pastas

```
FertilizaCerrado/
├── backend/
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── users/
│   │   │   ├── properties/        # Propriedades e Talhões
│   │   │   ├── cultivars/
│   │   │   ├── harvests/          # Safras
│   │   │   ├── jobs/              # Filas BullMQ: flows, ids, enfileiramento, /admin/jobs
│   │   │   ├── msa/
│   │   │   │   └── engine/        # Motor de cálculo: funções puras (GDA, ET₀, Kc, balanço, FAO-33)
│   │   │   ├── soil-analysis/
│   │   │   └── recommendations/
│   │   ├── middleware/
│   │   ├── utils/
│   │   ├── config/
│   │   ├── server.ts              # Processo API (réplicas)
│   │   └── worker.ts              # Processo worker (1 réplica): consumidores BullMQ + scheduler
│   ├── prisma/
│   ├── etl/                       # Serviço Python 3.12 (contêiner próprio): worker era5-ingest + CLI → TimescaleDB
│   └── Dockerfile
├── frontend/                      # SPA React + Vite (src/app, lib, components, features; e2e Playwright; Dockerfile → nginx)
├── nginx/
├── infra/
├── docs/
│   ├── arquitetura.md             ← este arquivo
│   ├── modulos/                   # auth, propriedades, msa, frontend
│   └── msa/
├── openspec/
├── docker-compose.yml
└── docker-compose.prod.yml
```

---

## Documentação por Camada

| Documento | Audiência | Propósito |
|---|---|---|
| `openspec/changes/*/proposal.md` | Equipe técnica | Decisões de design antes da implementação |
| `docs/manual/` | Agrônomo / produtor / administrador / banca | Manual do usuário passo a passo, com as telas, e `manual-completo.pdf` |
| `docs/arquitetura.md` | Todos | Visão macro do sistema |
| `docs/modulos/*.md` | Desenvolvedor / orientador | Endpoints, modelos de dados, regras de negócio |
| `docs/msa/algoritmos.md` | Heb / banca | Fórmulas matemáticas com referência ao código |
| `docs/msa/era5-etl.md` | Heb / desenvolvedor | Pipeline de ingestão e correção dos dados |
| `docs/msa/validacao.md` | Heb / banca | Protocolo e métricas de validação científica |
| JSDoc inline | Desenvolvedor | Rastreabilidade equação → função TypeScript |
