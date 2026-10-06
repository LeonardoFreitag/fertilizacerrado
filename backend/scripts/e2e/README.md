# Roteiros de ponta a ponta

Scripts `bash` + `curl` que exercitam a API real contra a stack do Docker Compose, conferindo respostas HTTP e o estado do banco/Redis. Complementam os testes unitários (`pnpm test`), que não tocam em infraestrutura.

| Script | Cobre |
|---|---|
| `e2e-auth.sh` | Cadastro, verificação de e-mail, login, refresh com rotação, logout, recuperação de senha, limite de tentativas no Redis, CORS/helmet |
| `e2e-properties.sh` | CRUD de propriedades e talhões, escopo por role, validação GeoJSON/PostGIS, célula ERA5-Land, soft delete |
| `e2e-cultivars-harvests.sh` | Cultivares (referência via seed, faixas de validação, visibilidade, congelamento em uso), safras (safra ativa única, criações simultâneas, escopo, transições de status), exclusão de talhão com safras |
| `e2e-msa.sh` | Processamento MSA por safra: 150 dias sintéticos inseridos via SQL, `process` assíncrono (202) e síncrono (`?sync=true`, só ADMIN: 201/200 `NEEDS_DATA`/422; 403 para agrônomo), truncamento pelo GDA, reprodutibilidade com a mesma semente, consultas, cenários e registro de decisões. Para os serviços `worker` e `etl` durante a execução |
| `e2e-qm.sh` | Correção de viés: fixture sintética (10 anos de ERA5 na célula de Goiânia + estação a ~10 km com viés conhecido), upload pela API (job `station-import`), calibração pela API (job `qm-calibrate`), aplicação, recalibração (uma ativa), PBIAS corrigido < 2 %, `qm validate` (Caso 4), reprocessamento síncrono com `qmCalibrationId`/`qmCalibration` na run. Remove estação, observações, calibrações e linhas sintéticas ao final e devolve `tp_corrected = tp_raw` às linhas reais |
| `e2e-orchestration.sh` | Filas BullMQ: `/admin/jobs` (403/200, contagens, `nextRun` do semanal), backfill automático na criação de safra (flow `era5-ingest cell` no ETL Python → `msa-process BACKFILL` no worker Node, servido pelo cache do ETL), `msaJobId`, 202 + `jobId`, `process-all`, worker parado/religado com job pendente, run órfã do ETL. `ingest-latest` real no CDS só com `ERA5_E2E_CDS=1` |
| `e2e-era5.sh` | **Opcional, exige `CDS_API_KEY` no `.env`** (pula com aviso sem ela): `ingest` real de 3 dias no CDS medindo a fila (~10 min observados), cache + upsert idempotente, `status`, série lida pelo Node alimentando `runDailyBalance`. O `backfill` completo (uma requisição por mês desde a emergência) só roda com `ERA5_E2E_BACKFILL=1` |

## Pré-requisitos

- Stack no ar: `docker compose up -d` na raiz do repositório (API em `localhost:3000`, Nginx em `localhost:80`), incluindo os serviços `worker` e `etl` para o `e2e-orchestration.sh`.
- Para o `e2e-orchestration.sh`: cache do ETL (volume `etl_cache`) com os meses da célula de teste (−16,7; −49,3), de 2025-10 até o mês corrente — populado por uma ingestão real anterior (`e2e-era5.sh` com `ERA5_E2E_BACKFILL=1` ou `docker compose run --rm etl ingest --from … --to …`). Sem `ERA5_E2E_CDS=1`, o roteiro trata o cache como baixado hoje (`touch`) para não ir ao CDS.
- `.env` na raiz com `ADMIN_EMAIL` e `ADMIN_PASSWORD` definidos e o seed executado: `cd backend && pnpm prisma db seed`. Os roteiros de propriedades e de cultivares/safras fazem login com esse administrador, e o de cultivares/safras depende das duas cultivares de referência criadas pelo seed.
- Sem `SMTP_HOST` no `.env`: os roteiros leem os links de verificação e de recuperação de senha no log da API (`docker compose logs api`). Os links apontam para as páginas do frontend (`${FRONTEND_URL}/verificar-email/<token>` e `/redefinir-senha?token=<token>`); os roteiros extraem o token e chamam a API diretamente.
- No host: `bash`, `curl`, `node`, `shasum` e `docker compose`.

## Como rodar

```bash
bash backend/scripts/e2e/e2e-auth.sh
bash backend/scripts/e2e/e2e-properties.sh
bash backend/scripts/e2e/e2e-cultivars-harvests.sh
bash backend/scripts/e2e/e2e-msa.sh
bash backend/scripts/e2e/e2e-orchestration.sh
bash backend/scripts/e2e/e2e-era5.sh          # opcional, exige CDS_API_KEY
```

Rode-os em sequência, não em paralelo: compartilham o banco.

Os testes do frontend (Playwright) ficam em `frontend/e2e/` e rodam com `cd frontend && pnpm e2e`, também contra a stack de dev (ver `docs/modulos/frontend.md`). O `msa.spec.ts` depende, como o `e2e-orchestration.sh`, do cache do ETL para a célula (−16,7; −49,3) e dos serviços `worker` e `etl` no ar; cria um agrônomo, uma propriedade e uma safra que ficam no banco (os roteiros bash os removem).

Cada linha sai como `PASS` ou `FAIL` com o esperado e o obtido; o final mostra `FALHAS: N`. Para ver só o que falhou:

```bash
bash backend/scripts/e2e/e2e-properties.sh | grep -v '^PASS'
```

## Efeitos colaterais

- **Dados**: no início, cada roteiro apaga `harvests`, `properties`, `fields`, `era5_cells`, as cultivares que não são de referência e todos os usuários que não sejam `ADMIN`, e limpa o Redis. Não rode contra um banco com dados que importam.
- **Redis**: o `e2e-auth.sh` para e religa o serviço `redis` para testar o comportamento com o Redis indisponível.
- **Workers**: `e2e-cultivars-harvests.sh` e `e2e-msa.sh` param `worker` e `etl` no início (a criação de safras enfileiraria backfills reais no CDS e runs extras), limpam as filas `era5-ingest` e `msa-process` no Redis e religam os dois ao sair. `e2e-orchestration.sh` para e religa o `worker` e reinicia o `etl` para testar recuperação, e limpa as mesmas filas ao final. O scheduler semanal (`msa-weekly`) não é tocado.
- **Correção de viés**: `e2e-qm.sh` calibra a célula (−16,7; −49,3) e corrige temporariamente as linhas reais dela; ao final remove a calibração e reaplica (`qm apply`), devolvendo `tp_corrected = tp_raw`. Para o `worker` durante o reprocessamento síncrono e o religa.
- **ERA5 real**: `e2e-orchestration.sh` grava, via ETL, os dias reais da célula (−16,7; −49,3) de 2025-11-01 a hoje−6 em `era5_daily_data` (ficam no banco); `e2e-msa.sh` sobrescreve parte deles com a série sintética e, ao limpar, remove só as linhas `source = 'synthetic'`.
- Os usuários de teste criados ficam no banco ao final (o próximo roteiro os remove).
