## MODIFIED Requirements

### Requirement: Download por mês com cache
`download.py` SHALL calcular a bounding box das células distintas de `era5_cells` (ou da célula indicada, ou da bbox informada), expandida 0,1° em cada direção e alinhada à grade, e requisitar ao dataset `reanalysis-era5-land` do CDS as variáveis horárias `2m_temperature`, `2m_dewpoint_temperature`, `10m_u_component_of_wind`, `10m_v_component_of_wind`, `surface_net_solar_radiation`, `surface_net_thermal_radiation` e `total_precipitation`, em NetCDF (`data_format: netcdf`, `download_format: unarchived`), cobrindo `[from, to + 1 dia]` **sempre por mês civil**, qualquer que seja o tamanho do intervalo: `plan_periods` SHALL devolver um período por mês de `months_covering(from, to)` e cada requisição ao CDS MUST cobrir um único `(bbox, ano, mês)` com os dias reais do mês e as 24 horas. Não há requisição nem arquivo trimestral; arquivos `AAAA-Qn.nc` existentes no cache MUST ser ignorados. O arquivo de cada `(bbox, mês)` MUST ser gravado em `ETL_CACHE_DIR` como `cache/<bbox>/AAAA-MM.nc` e reutilizado em execuções seguintes sem nova requisição (mês consolidado — último dia + 6 dias já passou — vale para sempre; mês aberto, só no dia em que foi baixado). Todo arquivo mensal MUST ser escrito em arquivo temporário no mesmo diretório e renomeado para `AAAA-MM.nc` só quando completo: um download interrompido ou uma união falha MUST NOT deixar um `AAAA-MM.nc` parcial que `_cached` aceite.

#### Scenario: Bounding box das células
- **WHEN** `era5_cells` tem células em (−16,7; −49,3) e (−16,2; −48,8)
- **THEN** a área requisitada é `[−16,1, −49,4, −16,8, −48,7]` (N, W, S, E)

#### Scenario: Mês seguinte para o último dia
- **WHEN** o intervalo termina em 30/11
- **THEN** o pipeline também obtém o mês de dezembro (ao menos o passo 00 UTC de 01/12) para fechar os acumulados de 30/11

#### Scenario: Intervalo longo pedido por mês
- **WHEN** o intervalo é 2025-02-01 a 2025-10-25 (backfill de uma safra desde o spin-up)
- **THEN** `plan_periods` devolve nove períodos mensais, `2025-02` a `2025-10`, e cada requisição ao CDS traz `year 2025`, um único `month` e os dias daquele mês

#### Scenario: Cache
- **WHEN** o mesmo `(bbox, mês)` é requisitado pela segunda vez
- **THEN** nenhuma requisição é feita ao CDS e o arquivo em cache é usado

#### Scenario: Trimestral antigo no cache
- **WHEN** o cache da bbox tem `2025-Q4.nc` e não tem `2025-10.nc`
- **THEN** outubro de 2025 é requisitado ao CDS como mês e gravado como `2025-10.nc`; o arquivo trimestral não é lido

#### Scenario: Download interrompido não vira cache
- **WHEN** a gravação de `2025-11.nc` é interrompida antes de completar (thread cancelada, falha na união dos grupos)
- **THEN** não existe `2025-11.nc` no cache (só um `.part`), e a próxima execução requisita o mês de novo

#### Scenario: Erro do CDS
- **WHEN** o CDS responde erro não relacionado a custo (licença não aceita, chave inválida)
- **THEN** a run termina `FAILED` com a mensagem do CDS e o comando encerra com código 1, sem dividir a requisição

## ADDED Requirements

### Requirement: Divisão por grupos de variáveis ao exceder o custo do CDS
Quando o CDS recusar a requisição de um mês por custo (resposta cuja mensagem contém `cost limits exceeded` ou `request is too large`), `fetch_month` SHALL repetir o mês em **duas requisições** com grupos disjuntos de variáveis — `2m_temperature`, `2m_dewpoint_temperature`, `10m_u_component_of_wind`, `10m_v_component_of_wind` e `surface_net_solar_radiation`, `surface_net_thermal_radiation`, `total_precipitation` — mesmos `year/month/day/time/area`, e MUST unir os dois NetCDF num único `cache/<bbox>/AAAA-MM.nc` com as sete variáveis, removendo os parciais, de modo que o cache, a transformação e a carga não distingam um mês dividido de um mês inteiro. A divisão MUST ser registrada em log. Se uma das metades também for recusada por custo, `fetch_month` SHALL lançar `CdsCostError` com mensagem que identifique o mês, a bbox e a mensagem do CDS e indique a ação (reduzir a área do backfill); a run MUST terminar `FAILED` com essa mensagem e o job `era5-ingest` MUST falhar com ela em `failedReason`. Erros não relacionados a custo MUST NOT disparar a divisão.

#### Scenario: Mês dividido e unido
- **WHEN** o CDS recusa por custo a requisição inteira de `2025-11` e aceita as duas metades
- **THEN** são feitas três requisições ao CDS, o cache passa a ter `2025-11.nc` com as sete variáveis e nenhum arquivo parcial, e a ingestão prossegue como se o mês tivesse vindo inteiro

#### Scenario: Metade recusada
- **WHEN** o CDS recusa por custo também uma das metades de `2025-11`
- **THEN** `fetch_month` lança `CdsCostError` citando `2025-11`, a bbox e a mensagem do CDS; a run fica `FAILED` com essa mensagem e o job `era5-ingest` tem `failedReason` com ela

#### Scenario: Erro de licença não divide
- **WHEN** o CDS responde 403 por licença não aceita
- **THEN** a exceção é propagada após uma única requisição, sem tentativa por grupos

### Requirement: Concorrência das requisições ao CDS
`fetch_range` SHALL obter os meses planejados com até `ERA5_CDS_MAX_CONCURRENT` requisições simultâneas ao CDS (`Settings.cds_max_concurrent`, inteiro ≥ 1, padrão 2; valor inválido ⇒ `ConfigError` ao iniciar), devolvendo os arquivos em ordem cronológica, e MUST chamar `on_progress(concluídos, total)` uma vez por mês concluído (em cache ou baixado), na thread que chamou `fetch_range`, de modo que o heartbeat `updated_at` da run e o progresso `periodsDone/periodsTotal` do job avancem por mês. A primeira falha MUST interromper a submissão de novos meses e ser propagada.

#### Scenario: Backfill com dois downloads em voo
- **WHEN** `ERA5_CDS_MAX_CONCURRENT=2` e o intervalo tem seis meses sem cache
- **THEN** no máximo duas requisições estão em andamento a cada instante, `on_progress` é chamado seis vezes com `concluídos` de 1 a 6 e `total` 6, e os caminhos devolvidos vêm do mês mais antigo ao mais recente

#### Scenario: Meses em cache não ocupam vaga
- **WHEN** quatro dos seis meses já estão em cache
- **THEN** só os dois meses faltantes vão ao CDS e `on_progress` ainda conta seis conclusões

#### Scenario: Concorrência inválida
- **WHEN** `ERA5_CDS_MAX_CONCURRENT=0`
- **THEN** `Settings.from_env` lança `ConfigError` citando a variável
