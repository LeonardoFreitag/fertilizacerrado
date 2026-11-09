## Context

`download.py` (Etapa 1 do ETL) planeja os períodos de um intervalo em `plan_periods`: até dois meses (contando `to + 1 dia`) por mês (`AAAA-MM.nc`), acima disso por trimestre civil (`AAAA-Qn.nc`, uma requisição `year/month×3/day 01–31/time×24` das sete variáveis), reaproveitando três mensais em cache e voltando ao mês no trimestre que contém um mês aberto. `fetch_range` percorre os períodos em série e chama `on_progress(i, total)` após cada um; `_ingest_cells` (`cli.py`) transforma isso em heartbeat (`db.touch_run`, na mesma conexão psycopg da run) e, no worker, em `job.updateProgress({periodsDone, periodsTotal})`. `transform.open_hourly(paths)` abre e concatena qualquer lista de NetCDF ao longo de `time` e exige as sete variáveis. O worker BullMQ roda **um job por vez** (`CONCURRENCY = 1`). Em 2026-11 o CDS passou a responder `403 … cost limits exceeded / Your request is too large` às requisições trimestrais; as mensais passam (~220 kB para a bbox de um talhão). Com o spin-up desde fevereiro (motor 2.2.0) o backfill de uma célula nova cobre ≈ 10–12 meses, logo sempre cai no modo trimestral e falha. No dev, o cache da célula de Goiânia foi completado mês a mês (2025-01 → 2026-11) e nenhum trimestral existe.

## Goals / Non-Goals

**Goals:**
- Toda requisição ao CDS cobre **um mês**; o planejamento deixa de depender do tamanho do intervalo.
- Um mês recusado por custo é obtido em **duas requisições por grupos de variáveis** e gravado como **um único** `AAAA-MM.nc` idêntico ao de uma requisição inteira — cache, `open_hourly` e loader intocados.
- Falha definitiva por custo chega ao operador como razão do job e erro da run, com instrução do que fazer.
- Backfill longo em tempo aceitável: até `ERA5_CDS_MAX_CONCURRENT` requisições em voo, progresso e heartbeat por mês.
- Specs, docs e README de operação deixam de falar em trimestre.

**Non-Goals:**
- Reduzir a bbox, as variáveis, as horas ou mudar o dataset/formato.
- Repetição automática de jobs que já falharam por custo; retomada parcial de um mês.
- Mudar o schema, a API Node, o motor ou o frontend (o painel admin só mostra `periodsDone/periodsTotal`, que passam a contar meses).

## Decisions

**1. `plan_periods` só devolve meses; o tipo `Period` fica, sem `kind`.** `plan_periods(date_from, date_to)` = `[Period(y, m) for (y, m) in months_covering(...)]` (sem `today`: a consolidação só importa ao decidir se o cache vale, dentro de `fetch_month`). `Period` passa a `(year, month)` com `label()` `AAAA-MM`; `kind`, `index`, `YearQuarter`, `quarter_of`, `quarter_months`, `quarters_covering`, `cache_path_quarter`, `fetch_quarter` e `MONTHLY_MAX_MONTHS` são removidos. `build_request(bbox, year, month)` aceita só um mês e pede os dias reais (`monthrange`). Alternativa descartada: manter o trimestre como opção por env — nenhum cenário atual o usa e o código morto confundiria a documentação da dissertação.

**2. Divisão por grupos de variáveis só como fallback, decidida pela mensagem do CDS.** `VARIABLE_GROUPS = [[2m_temperature, 2m_dewpoint_temperature, 10m_u…, 10m_v…], [surface_net_solar_radiation, surface_net_thermal_radiation, total_precipitation]]` (4 + 3; a ordem respeita `VARIABLES`). `fetch_month` tenta a requisição inteira; se a exceção do cliente for de custo — `is_cost_error(exc)`: texto da exceção (qualquer classe: `cdsapi` 0.7 relança erros HTTP do CADS como `Exception`/`HTTPError` com a mensagem do serviço) contém, sem distinguir maiúsculas, `cost limits exceeded` ou `request is too large` — baixa cada grupo para `AAAA-MM.g1.nc.part` / `.g2.nc.part` (mesmo `year/month/day/time/area`, `variable` = grupo), abre os dois com `xarray`, `xr.merge` (variáveis disjuntas, mesmas coordenadas), grava `AAAA-MM.nc` com `to_netcdf` e apaga os parciais; loga `CDS recusou AAAA-MM por custo; dividindo em 2 grupos de variáveis`. Qualquer outra exceção é relançada como hoje (licença, chave, rede). Alternativas descartadas: (a) dividir sempre — dobra as requisições para quem não precisa; (b) manter dois arquivos por mês e unir em `open_hourly` — espalha o caso especial pelo transform e pelo cache; (c) dividir por dias (duas quinzenas) — o custo do CDS é dominado por variáveis × horas e a união ao longo do tempo já existe no `open_hourly`, mas quinzenas quebrariam a invariante "um arquivo por mês"; grupos de variáveis mantêm a invariante.

**3. Segunda recusa ⇒ `CdsCostError` (subclasse de `RuntimeError`).** Mensagem: `CDS recusou a requisição de AAAA-MM para a bbox (N, W, S, E) mesmo dividida por variáveis (custo acima do limite do serviço). Reduza a área (menos talhões por backfill) ou aguarde a revisão dos limites do CDS. Mensagem do CDS: …`. `_ingest_cells` já fecha a run `FAILED` com `f"{type(exc).__name__}: {exc}"` e relança; no worker o BullMQ grava a mensagem em `failedReason`, exibida por `GET /admin/jobs/era5-ingest/:id` e no painel admin. Sem retentativa automática (BullMQ `attempts` segue o atual): o erro é determinístico para a mesma bbox.

**4. Concorrência por `ThreadPoolExecutor` dentro de `fetch_range`, limitada por `Settings.cds_max_concurrent`.** `fetch_range(client, bbox, date_from, date_to, cache_dir, today=None, on_progress=None, max_concurrent=1)` submete um `fetch_month` por mês ao executor (`max_workers = max_concurrent`), consome `as_completed` na thread chamadora e chama `on_progress(concluídos, total)` **ali** — `db.touch_run` (conexão psycopg da run) e o `call_soon_threadsafe` do worker continuam saindo de uma única thread. Meses em cache retornam imediatamente e liberam a vaga. A lista devolvida fica **em ordem cronológica** (os resultados são reordenados pelos meses planejados) para `open_hourly` continuar recebendo os arquivos ordenados. A primeira exceção cancela os futuros pendentes (`shutdown(cancel_futures=True)`) e é relançada; downloads em voo terminam ou falham sozinhos — seus `.part` são sobrescritos na próxima run. `LazyCdsClient` cria o `cdsapi.Client` sob um `threading.Lock` (dupla checagem) — o cliente é reentrante para `retrieve` (uma sessão `requests` por chamada no CADS). `cli.py` repassa `settings.cds_max_concurrent`; CLI `ingest`/`backfill` usam o mesmo valor. Alternativa descartada: concorrência no BullMQ (`CONCURRENCY > 1`) — multiplicaria runs e conexões e não acelera um único backfill.

**5. `ERA5_CDS_MAX_CONCURRENT` em `Settings.from_env`.** Inteiro ≥ 1, padrão 2; valor inválido (`0`, negativo, não numérico) ⇒ `ConfigError` com a variável no texto, como as demais. Declarada em `.env.example` (bloco do CDS) e repassada no `docker-compose.yml`/`.prod.yml` ao serviço `etl` (`${ERA5_CDS_MAX_CONCURRENT:-2}`). O limite real do CDS por usuário é de poucas requisições simultâneas; 2 é conservador e cabe no `CONCURRENCY = 1` do worker (por worker = por run).

**6. Arquivos trimestrais antigos.** Não são lidos nem apagados pelo código. Em produção não há nenhum (a feature nunca completou um backfill desde fevereiro); no dev não há. O README de operação registra `rm /data/cache/bbox-*/*-Q*.nc` como limpeza opcional.

**7. Progresso e heartbeat.** `periodsTotal` = número de meses; `periodsDone` cresce a cada mês concluído (cache ou CDS). A documentação de `updated_at` passa de "período (mês/trimestre)" a "mês". O painel admin não muda.

**8. Testes com cliente falso.** `FakeClient(fail_full=set(), fail_groups=set(), error_text=…)` grava, para cada `retrieve`, um NetCDF mínimo **real** (xarray, 2 passos de tempo, grade 2×2, só as variáveis pedidas) — necessário porque a união usa xarray. Casos: mês inteiro ok (1 chamada, arquivo com 7 variáveis); recusa de custo ⇒ 3 chamadas, `AAAA-MM.nc` com as 7 variáveis, sem `.part`; recusa também de um grupo ⇒ `CdsCostError` com `AAAA-MM` e o texto do CDS; erro de licença ⇒ relançado tal e qual com 1 chamada; `fetch_range` com `max_concurrent=3` e cliente com `sleep` curto ⇒ caminhos em ordem cronológica, `on_progress` chamado `total` vezes com valores 1..total; `plan_periods(2025-11-01, 2026-09-29)` ⇒ onze meses `2025-11 … 2026-09`, mais `2026-10` pelo `to + 1`; `Settings.from_env` com `ERA5_CDS_MAX_CONCURRENT=0` ⇒ `ConfigError`.

**9. Escrita atômica do cache.** Todo `AAAA-MM.nc` — vindo de uma requisição inteira ou da união dos grupos — nasce como arquivo temporário **no mesmo diretório** (`AAAA-MM.nc.part` para o download direto; `AAAA-MM.g1.nc.part`/`.g2.nc.part` para os grupos e `AAAA-MM.merge.part` para o `to_netcdf` da união) e só é renomeado para o nome final (`Path.replace`, atômico no mesmo sistema de arquivos) depois de completo. `_cached` só olha `AAAA-MM.nc`, logo uma thread interrompida ou uma falha no merge nunca deixa um arquivo que seja lido como cache válido; `.part` órfãos são sobrescritos na próxima tentativa. Teste: falha simulada no merge ⇒ `AAAA-MM.nc` inexistente e `_cached` falso.

**10. Verificação no dev exercita o CDS real.** Além do backfill regional desde 2025-02 servido pelo cache, pede-se um mês ainda não cacheado da célula de Goiânia (um mês de 2024) para confirmar que a requisição mensal é aceita e grava `2024-MM.nc`; o fallback por grupos fica coberto só pelo `FakeClient`, pois não há como forçar o erro de custo no CDS real.

## Risks / Trade-offs

- **Mais requisições ao CDS (≈ 4× por backfill)** → cada uma é pequena e aceita; a concorrência 2 compensa parte do tempo; o cache por `(bbox, mês)` amortiza para as safras seguintes.
- **Mensagem de custo pode mudar de texto** → `is_cost_error` casa dois fragmentos e, se não casar, o erro propaga como hoje (sem divisão): o pior caso é o comportamento atual, não um erro silencioso; o fragmento é uma constante única fácil de atualizar.
- **União por xarray de grupos com coordenadas ligeiramente diferentes** (`expver` presente só em um) → a união é feita sobre os datasets **normalizados** pela mesma `_normalize` do transform (função exposta como `transform.normalize`), que já reduz `expver`; teste cobre um grupo com `expver`.
- **Threads e psycopg** → nenhum acesso ao banco sai das threads do executor (só `retrieve` e I/O de arquivo); `on_progress` roda na thread chamadora.
- **Limite de simultaneidade do CDS** → se o serviço recusar por "too many requests", a exceção propaga e o operador reduz `ERA5_CDS_MAX_CONCURRENT` para 1 (documentado).
- **Specs e docs com "trimestre"** → removidos nesta change (`msa-orchestration`, `era5-ingestion`, `era5-etl.md`, READMEs, `validacao.md`, `roteiro-validacao.md`).

## Migration Plan

1. Merge; CI (unitários do ETL e build da imagem `etl`).
2. `.env` opcionalmente com `ERA5_CDS_MAX_CONCURRENT` (padrão 2 se ausente); `docker compose up -d --build etl`.
3. Reenfileirar os backfills que falharam por custo: criar/reprocessar as safras `NEEDS_DATA` ou **Backfill regional** no painel admin com `from` em `AAAA-02-01` — agora um único job cobre o intervalo inteiro.
4. Rollback: imagem anterior; o cache mensal é compatível nos dois sentidos.

## Open Questions

- Nenhuma de domínio. O limite de custo do CDS é externo e pode voltar a mudar; se um mês inteiro passar a ser recusado mesmo dividido, a próxima alavanca é a bbox (um talhão por backfill), já sugerida na mensagem de erro.
