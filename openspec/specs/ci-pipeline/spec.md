# ci-pipeline Specification

## Purpose
Integração contínua no GitHub Actions: jobs independentes de backend, frontend, ETL e build das imagens Docker, com cache, concorrência por branch, badge e README da raiz. Playwright e roteiros e2e ficam fora do CI.

## Requirements

### Requirement: Workflow de integração contínua
O repositório SHALL ter `.github/workflows/ci.yml` disparado em `push` e `pull_request` para `main`, com `concurrency` por branch cancelando execuções anteriores, e quatro jobs independentes: **backend** (Node 20, pnpm via corepack com cache do store, `pnpm install --frozen-lockfile`, `prisma generate`, `typecheck`, `vitest`, com variáveis de ambiente fictícias que satisfaçam o schema Zod), **frontend** (install, `lint`, `typecheck`, `vitest`, `build`), **etl** (Python 3.12 com cache do pip, `pip install -r requirements.txt`, `pytest` sem os testes marcados `integration`) e **docker** (build das imagens `backend/`, `frontend/` e `backend/etl/` sem push, com cache do buildx). Playwright e os roteiros e2e MUST NOT fazer parte do workflow.

#### Scenario: Push em main
- **WHEN** um commit é enviado para `main`
- **THEN** os quatro jobs rodam em paralelo e o workflow fica verde quando todos passam

#### Scenario: Execução antiga cancelada
- **WHEN** dois pushes seguidos chegam ao mesmo branch
- **THEN** a execução do primeiro é cancelada e só a do segundo termina

#### Scenario: Quebra de Dockerfile
- **WHEN** um Dockerfile deixa de construir
- **THEN** o job `docker` falha sem que nenhuma imagem seja publicada

### Requirement: README da raiz com badge
O repositório SHALL ter `README.md` na raiz descrevendo o projeto em poucos parágrafos, como subir a stack (`pnpm start`, `.env` a partir de `.env.example`, seed), os atalhos do `package.json` e links para `docs/` (arquitetura, módulos, MSA), com o badge de status do workflow `ci.yml`.

#### Scenario: Badge
- **WHEN** o README é renderizado no GitHub
- **THEN** exibe o badge "CI" apontando para o workflow

#### Scenario: Onboarding
- **WHEN** um desenvolvedor novo lê o README
- **THEN** encontra os passos para rodar a stack e os links da documentação
