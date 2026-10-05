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
| Auth | Autenticação JWT, roles, recuperação de senha |
| Usuários | Gestão de perfis por role |
| Propriedades e Talhões | Cadastro geoespacial (PostGIS) de fazendas e talhões |

### Fase 1 — Módulo Agrometeorológico (MSA)
Produto principal da dissertação. Processa dados ERA5-Land e entrega suporte à decisão por janela fenológica.

| Módulo | Responsabilidade |
|---|---|
| Cultivares | Parâmetros fenológicos e fisiológicos de soja e milho |
| Safras | Vínculo talhão + cultivar + data de emergência |
| Motor MSA | ETL ERA5-Land, ET₀ FAO-56, balanço hídrico, GDA, Monte Carlo |
| Suporte à Decisão | Cenários a/b/c, perfis de risco P10/P50/P90 |

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
| Frontend | React + TailwindCSS | Interface do técnico agrônomo |
| Proxy / LB | Nginx 1.25 | Reverse proxy, rate limiting, TLS |
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
[BullMQ / Redis]  scheduler semanal (seg 02:00 BRT) · backfill ao criar safra · admin
  flow: era5-ingest (Python) → msa-process (Node)
        │
        ▼
[Processo worker Node.js / TypeScript]  (a API só enfileira)
  ├── Acúmulo de GDA → Projeção das janelas F1–F4
  ├── ET₀ diária (FAO-56 Penman-Monteith)
  ├── Balanço hídrico diário (TAW, RAW, Dr, Ks)
  └── Motor de Monte Carlo (1.000 iterações)
        │  P10 / P50 / P90 por janela fenológica → msa_runs (reason, jobId)
        ▼
[React Frontend]
  ├── Painel de janelas fenológicas e histórico hídrico
  ├── Indicador de estresse por janela (Ks médio)
  └── Painel de escolha do técnico: cenário a / b / c
```

---

## Conceito Operacional — Decisão Oportuna

O MSA **não opera em tempo real**. Trabalha com o conceito de **Suporte à Decisão Oportuno por Janelas Operacionais Retrospectivas**:

- Os dados ERA5-Land têm lag nativo de ~5 dias pela API Copernicus
- O processamento ocorre em **cron jobs semanais** (batch)
- As recomendações são calculadas para **janelas fenológicas consolidadas** (F1, F2, F3, F4)
- O técnico recebe a análise antes de abrir a próxima janela de manejo, com tempo hábil para planejar a operação de campo

Essa abordagem reflete a realidade agrícola do Cerrado: as operações dependem de planejamento logístico, disponibilidade de maquinário e condições edafoclimáticas — não de respostas instantâneas.

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
├── frontend/
├── nginx/
├── infra/
├── docs/
│   ├── arquitetura.md             ← este arquivo
│   ├── modulos/
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
| `docs/arquitetura.md` | Todos | Visão macro do sistema |
| `docs/modulos/*.md` | Desenvolvedor / orientador | Endpoints, modelos de dados, regras de negócio |
| `docs/msa/algoritmos.md` | Heb / banca | Fórmulas matemáticas com referência ao código |
| `docs/msa/era5-etl.md` | Heb / desenvolvedor | Pipeline de ingestão e correção dos dados |
| `docs/msa/validacao.md` | Heb / banca | Protocolo e métricas de validação científica |
| JSDoc inline | Desenvolvedor | Rastreabilidade equação → função TypeScript |
