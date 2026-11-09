## MODIFIED Requirements

### Requirement: Backfill automático na criação de safra
Ao criar uma safra, o sistema SHALL primeiro avaliar a condição "emergência dentro do lag" sobre a **data de emergência**: se `emergenceDate > hoje − 6`, `planHarvestJobs` SHALL devolver `process-only-lag` e só `msa-process {reason: "BACKFILL"}` é enfileirado, sem consultar a cobertura. Caso contrário o sistema SHALL verificar a cobertura da célula do talhão de `preSeasonStart(emergenceDate)` (último 1º de fevereiro ≤ emergência) a `hoje − 6`: com lacuna, SHALL enfileirar um flow com filho `era5-ingest {kind: "cell", from: preSeasonStart, to: hoje − 6}` e pai `msa-process {reason: "BACKFILL"}`; sem lacuna, SHALL enfileirar só `msa-process {reason: "BACKFILL"}`. A resposta de `POST /api/v1/harvests` MUST incluir `msaJobId` (ou `null` se o enfileiramento falhar, sem desfazer a criação). A decisão MUST ser uma função pura testável. O fluxo semanal não muda.

#### Scenario: Célula sem dados
- **WHEN** a safra é criada para um talhão cuja célula não tem dias no intervalo
- **THEN** a resposta é 201 com `msaJobId`, e `GET /admin/jobs/msa-process/<msaJobId>` mostra o pai aguardando o filho `era5-ingest cell`

#### Scenario: Cobertura só a partir da emergência
- **WHEN** a célula tem todos os dias da emergência (2025-11-01) em diante, mas nenhum de 2025-02-01 a 2025-10-31
- **THEN** é enfileirado o flow com filho `era5-ingest {kind: "cell", from: "2025-02-01"}` e a run resultante só é `SUCCEEDED` depois da ingestão da entressafra

#### Scenario: Emergência dentro do lag
- **WHEN** a safra é criada com emergência em `hoje − 3`, mesmo sem nenhum dia da entressafra em cache
- **THEN** `planHarvestJobs` devolve `process-only-lag`, só `msa-process` é enfileirado e nenhuma ingestão é pedida

#### Scenario: Célula com cobertura completa
- **WHEN** a célula já tem todos os dias do intervalo desde `preSeasonStart`
- **THEN** só `msa-process` é enfileirado, sem ingestão

#### Scenario: Resultado automático
- **WHEN** o flow de backfill conclui
- **THEN** `GET /api/v1/harvests/:id/msa` devolve uma run `SUCCEEDED` com `reason BACKFILL`, `jobId` e `preSeasonFrom = preSeasonStart(emergência)`

#### Scenario: Redis indisponível
- **WHEN** o enfileiramento falha na criação da safra
- **THEN** a safra é criada, a resposta é 201 com `msaJobId: null` e o erro é logado
