## Why

O CDS passou a recusar as requisições trimestrais do ETL (`403 … cost limits exceeded / Your request is too large`): o custo de uma requisição cresce com variáveis × horas × dias, e três meses de 24 passos horários das sete variáveis ultrapassam o limite atual, enquanto um mês (~220 kB para a bbox de um talhão) passa. `add-preseason-water-balance` triplicou o volume de backfill por safra (desde o último 1º de fevereiro), então toda célula nova em produção cai nesse erro no primeiro backfill e a safra fica `NEEDS_DATA`. O contorno manual (pedir mês a mês pelo backfill regional em blocos de dois meses) já funciona no dev; esta change o torna o comportamento padrão e remove o modo trimestral, que só existia para economizar requisições e agora é inviável.

## What Changes

- `backend/etl/era5/download.py`: `plan_periods` devolve **sempre períodos mensais** — remover `quarters_covering`, `quarter_months`, `quarter_of`, `fetch_quarter`, `cache_path_quarter`, `Period.kind == "quarter"`, `YearQuarter` e `MONTHLY_MAX_MONTHS`; `build_request` só para um mês (`year`, `month`, dias reais do mês); cache e nomes de arquivo mensais (`AAAA-MM.nc`) inalterados. Arquivos trimestrais (`AAAA-Qn.nc`) já em cache deixam de ser lidos — os meses que só eles cobriam voltam a ser pedidos por mês (uma vez; o loader já trabalha com os mensais).
- **Tratamento do erro de custo**: se o CDS recusar um mês por custo ("cost limits exceeded" / "request is too large"), a requisição é **dividida em dois grupos de variáveis** (térmicas/vento × radiação/precipitação), cada metade baixada para um arquivo parcial e as duas **unidas num único NetCDF mensal** no cache (mesmo nome `AAAA-MM.nc`, mesmo conteúdo que uma requisição inteira), com log explícito; recusa de uma metade ⇒ erro definitivo `CdsCostError` com mensagem acionável (mês, bbox, mensagem do CDS, o que fazer), que fecha a run `FAILED` e falha o job `era5-ingest` com essa razão. Outros erros do CDS (licença, chave) continuam propagados como hoje, sem divisão.
- **Concorrência**: até `ERA5_CDS_MAX_CONCURRENT` (padrão 2, mínimo 1) requisições simultâneas ao CDS por run, para o backfill de ~10–12 meses não virar fila serial; os meses em cache não ocupam vaga; `on_progress(concluídos, total)` chamado **por mês**, na thread da run (o heartbeat `updated_at` e o `updateProgress` do BullMQ continuam saindo de uma só thread).
- Testes do ETL (`backend/etl/tests/test_download.py`, `test_config` se houver): `plan_periods` só meses (intervalo longo, intervalo de dois meses, mês aberto), `build_request` de um mês, divisão por grupos de variáveis com união no cache, segunda recusa ⇒ `CdsCostError` com a mensagem, erro não relacionado a custo ⇒ sem divisão, progresso por mês com concorrência > 1, `ERA5_CDS_MAX_CONCURRENT` lido e validado.
- Docs: `docs/msa/era5-etl.md` (Etapa 1: por mês, custo do CDS, divisão por variáveis, concorrência, heartbeat; tabela de limitações), `backend/etl/README.md` (operação: backfill de célula nova ≈ 10–12 requisições mensais; variável nova; arquivos `AAAA-Qn.nc` antigos podem ser apagados), `.env.example` e `docker-compose*.yml` (`ERA5_CDS_MAX_CONCURRENT`), `docs/msa/validacao.md`/`roteiro-validacao.md` (onde dizem "por trimestre"), `CLAUDE.md` (parágrafo do ETL).

## Capabilities

### New Capabilities
<!-- nenhuma -->

### Modified Capabilities
- `era5-ingestion`: requirement "Download por mês com cache" passa a exigir requisições **sempre mensais** (sem trimestre), a divisão por grupos de variáveis ao exceder o custo, o erro de custo acionável e a concorrência configurável (`ERA5_CDS_MAX_CONCURRENT`).
- `msa-orchestration`: requirement "Requisições ao CDS por trimestre" **removido** (o backfill por célula e o regional passam a ser ingeridos por mês); cenário "Backfill regional" e propósito ajustados.

## Impact

- `backend/etl/era5/download.py`, `config.py` (`Settings.cds_max_concurrent`), `cli.py` (`_ingest_cells` repassa a concorrência; comentário do heartbeat), `worker.py` (nada estrutural: o `CdsCostError` já vira `failedReason`), testes do ETL; `.env.example`, `docker-compose.yml`, `docker-compose.prod.yml`.
- **Sem** mudança de schema, API, motor (`ENGINE_VERSION` segue 2.2.0) ou frontend. Cache mensal existente continua válido; arquivos trimestrais ficam órfãos (podem ser removidos à mão).
- Custo operacional: mais requisições ao CDS por backfill (uma por mês em vez de uma por trimestre), cada uma pequena e aceita; a fila do CDS decide o tempo total.

## Non-goals

- Mudar variáveis, resolução, dataset ou formato; correção de viés; dia local (questão #2); mudar a bbox por requisição; retomar automaticamente jobs que já falharam por custo (o operador reenfileira pelo painel ou pela criação da safra).
