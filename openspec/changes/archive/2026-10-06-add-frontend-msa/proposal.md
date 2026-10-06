## Why

A API do MSA já processa safras, guarda runs reprodutíveis e gera cenários de decisão, mas o técnico só alcança isso por `curl`. Com a fundação do frontend pronta (sessão, propriedades, talhões), falta a parte que justifica o produto e a dissertação: cadastrar cultivares e safras, acompanhar o processamento e **ler o painel agrometeorológico** — janelas fenológicas, Ks e percentis, gráficos da série diária, cenários (a)/(b)/(c) e o registro da decisão. Esta change completa a interface da Fase 1.

## What Changes

- **Cultivares** (`/cultivares`): lista separando **Referência** (`isDefault`, somente leitura, com a nota bibliográfica FAO-56/FAO-33) e **Minhas cultivares**; criar/editar/excluir as próprias. Formulário com os 15 parâmetros agrupados (térmicos, Kc, hídricos, Ky) e as regras cruzadas validadas no cliente (limiares GDA crescentes e menores que o total, `zrIni ≤ zrMax`); 409 `CULTIVAR_IN_USE` explicado e, na edição de cultivar em uso, parâmetros científicos bloqueados com o aviso.
- **Safras** (`/safras`, habilitada na barra lateral): lista com filtros (status; propriedade/talhão), criação (talhão agrupado por propriedade, cultivar visível, emergência não futura, safra `AAAA/AA` sugerida pela emergência, notas), aviso quando o talhão não tem altitude, PATCH de status (concluir/cancelar/reativar) e notas; sem exclusão. Após criar, acompanhamento do processamento disparado (`msaJobId`): polling de `GET /msa` com indicador "processando…" até existir run (ADMIN também vê o estado do job em `/admin/jobs/:queue/:id`).
- **Painel MSA** (`/safras/:id/msa`): cabeçalho (safra, talhão, cultivar, intervalo, status da última run com `missingDates`, `engineVersion`, semente, **Reprocessar** com 202 + polling), linha do tempo F1–F4 construída da série diária, cartões por janela com Ks médio, P10/P50/P90, redução de produtividade, ETc ajustada e chuva acumuladas, dias e **cor por severidade** (Ks ≥ 0,85 ok; 0,70–0,85 atenção; < 0,70 crítico; não alcançada em cinza), **gráficos Recharts** (chuva/ETc/ETc_adj com fundo por janela; Dr × RAW × TAW; Ks diário) com tooltip do dia, **cenários de decisão** (janela, dose base, eficiência base → A, B, C lado a lado com racional; B indisponível com o motivo) e **Registrar decisão** com justificativa obrigatória, lista de decisões, **histórico de runs** com seleção da série de uma run antiga e **exportação CSV** (série diária e resumos) no cliente. PRODUTOR vê tudo, não registra nem reprocessa.
- **Admin** (`/admin`): ações `ingest-latest`, `backfill-region` (bbox + datas) e `process-all`, com feedback do `jobId`, consulta do estado do job e atualização das contagens.
- **Verificação**: unitários (severidade, formatação de percentis, faixas fenológicas a partir da série, CSV, polling, regras cruzadas da cultivar, sugestão de safra); Playwright: agrônomo → talhão na célula de Goiânia em cache → safra com emergência no período em cache → aguarda `SUCCEEDED` → painel com 4 janelas e gráficos → cenários F3 → registrar decisão → aparece na lista → CSV baixado; segundo cenário com ADMIN em `/admin`.
- **Docs**: `docs/modulos/frontend.md` (novas áreas, gráficos, CSV, polling), `docs/modulos/msa.md` (link para o painel).
- Sem mudanças na API.

## Capabilities

### New Capabilities
- `web-cultivars`: lista (referência × próprias), formulário com grupos de parâmetros e regras cruzadas, edição com parâmetros congelados, exclusão.
- `web-harvests`: lista com filtros, criação com avisos, alteração de status/notas, acompanhamento do processamento inicial.
- `web-msa-dashboard`: painel da safra — cabeçalho e reprocessamento, linha do tempo fenológica, cartões por janela com severidade, gráficos, cenários e registro de decisão, histórico de runs, exportação CSV.

### Modified Capabilities
- `web-shell`: entrada **Safras** habilitada (e **Cultivares** adicionada) na barra lateral; página `/admin` passa de somente leitura a operacional (ações de enfileiramento com feedback).

## Impact

- `frontend/`: novas features `cultivars/`, `harvests/`, `msa/`; `features/admin/` ampliada; `lib/msa/` (severidade, faixas, percentis, CSV); nova dependência `recharts`; rotas `/cultivares*`, `/safras*`.
- Sem alteração de backend, banco ou Compose. `docs/modulos/frontend.md` e `docs/modulos/msa.md` atualizados.
- O smoke do Playwright passa a depender do cache do ETL para a célula de Goiânia (como o `e2e-orchestration.sh`).
