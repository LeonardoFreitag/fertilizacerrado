## ADDED Requirements

### Requirement: Calibração registrada na run
Ao processar uma safra (inline ou pelo worker), o sistema SHALL ler a calibração QM ativa da célula do talhão e gravar `qmCalibrationId` na run (nulo quando a célula não tem calibração). `GET /msa`, `GET /msa/runs` e o resultado do processamento MUST expor `qmCalibrationId` e `qmCalibration: { stationCode, stationName, years, distanceKm } | null`. A série usada no balanço MUST continuar vindo de `tp_corrected`.

#### Scenario: Célula calibrada
- **WHEN** a célula tem calibração ativa com a estação 83423 e 10 anos
- **THEN** a run grava `qmCalibrationId` e `GET /msa` devolve `qmCalibration.stationCode = "83423"`, `years = 10`

#### Scenario: Célula sem calibração
- **WHEN** a célula não tem calibração
- **THEN** `qmCalibrationId` é nulo e `qmCalibration` é nulo

#### Scenario: Recalibração não altera runs antigas
- **WHEN** a célula é recalibrada e `qm apply` roda depois de uma run
- **THEN** a run antiga mantém o `qmCalibrationId` original; só uma run nova referencia a nova calibração
