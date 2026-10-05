## 1. Talhão: altitude e solo

- [x] 1.1 Adicionar `altitudeM`, `thetaFC`, `thetaWP` (`Float?`) ao model `Field`; incluir as colunas no `INSERT`/`UPDATE` cru e no `SELECT` de `property.repository.ts`, nos DTOs `create-field`/`update-field` (faixas, anuláveis no `PATCH`), na validação cruzada `thetaFC > thetaWP` sobre o estado resultante no service e na resposta `FieldResponse`; testes dos DTOs
- [x] 1.2 Atualizar `e2e-properties.sh` com os novos campos (cadastro, `PATCH`, limpar, teores invertidos) e `docs/modulos/propriedades.md`

## 2. Persistência

- [x] 2.1 Adicionar ao `schema.prisma` os enums `MsaRunStatus` e `MsaScenario`, os models `MsaRun`, `MsaDailyResult`, `MsaPhaseSummary`, `MsaDecision` e `latestRunId` em `Harvest` (relações nomeadas), e `ENGINE_VERSION` em `engine/index.ts`
- [x] 2.2 Gerar e aplicar a migration `add_field_site_params_and_msa_tables`

## 3. Service e repositório MSA

- [x] 3.1 Implementar `msa.repository.ts`: carregar safra com talhão e cultivar, criar run (com série e resumos em transação) e atualizar `latestRunId`, criar run `NEEDS_DATA`/`FAILED`, listar runs, buscar run da safra, série diária, criar/listar decisões
- [x] 3.2 Implementar `msa.service.ts`: `processHarvest` (escopo, altitude, intervalo com truncamento por `gdaTotal`, cobertura, semente, `runMonteCarlo`, snapshots, gravação, `FAILED`), `getLatest`, `getDaily`, `listRuns`, `decisionScenarios`, `recordDecision`, `listDecisions`
- [x] 3.3 Testes unitários do service com `era5.repository` e `msa.repository` simulados: altitude ausente sem run, lacuna ⇒ `NEEDS_DATA` sem chamar o motor, truncamento por `gdaTotal`, emergência no lag, snapshot fiel e `soilDefaults`, mesma semente ⇒ resumos idênticos, semente gerada e gravada, erro do motor ⇒ `FAILED`, `PHASE_NOT_REACHED`, `SCENARIO_UNAVAILABLE`

## 4. API

- [x] 4.1 DTOs (`process` query `seed`, `decision` query, `decisions` body, params) e `msa.controller.ts`
- [x] 4.2 `msa.routes.ts` (`mergeParams`, `authorize` por rota) montado em `harvest.routes.ts` sob `/:id/msa`
- [x] 4.3 `pnpm typecheck`, `pnpm build`, `pnpm test`

## 5. Ponta a ponta e documentação

- [x] 5.1 `backend/scripts/e2e/e2e-msa.sh`: usuários, propriedade, talhão com altitude, safra; 150 dias de `syntheticSeason(150, 2026)` inseridos via SQL para a célula; `POST /process` 201; `GET /`, `/daily`, `/runs`; remover 2 dias ⇒ `NEEDS_DATA` e `latestRunId` inalterado; repor e reprocessar com `?seed` igual ⇒ resumos idênticos; `GET /decision` F3; `POST /decisions` A e B; B em F4 ⇒ 422; 403 do produtor; 422 sem altitude; README dos roteiros
- [x] 5.2 Rodar `e2e-msa.sh`, `e2e-properties.sh` e os demais roteiros sem falhas
- [x] 5.3 Atualizar `docs/modulos/msa.md` (seções 3 e 4, endpoints definitivos, persistência, regras de intervalo/`NEEDS_DATA`/snapshots/`latestRunId`, referências de implementação) e `docs/arquitetura.md` se necessário
