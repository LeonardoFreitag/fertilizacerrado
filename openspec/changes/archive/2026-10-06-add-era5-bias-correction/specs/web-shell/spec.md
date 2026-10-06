## ADDED Requirements

### Requirement: Administração de estações e correção de viés
`/admin` SHALL ter a seção **Estações e correção de viés** com: upload de CSV de observações (arquivo, formato `bdmep|generic`, metadados da estação para o genérico) via `POST /admin/stations/upload` → 202 com o job na lista "Jobs desta sessão"; tabela de estações (`GET /admin/stations`: código, nome, fonte, observações, período); tabela de calibrações (`GET /admin/qm/calibrations`: célula, estação, período, anos, distância, ativa); botões **Calibrar todas as células** (`{auto: true}`, com confirmação) e **Calibrar célula** (lat, lon, estação); e a nota de que após calibrar é preciso reprocessar as safras (atalho para "Processar todas as safras ativas").

#### Scenario: Upload pela página
- **WHEN** o admin escolhe um CSV genérico, informa os metadados e envia
- **THEN** a resposta 202 aparece na lista de jobs e, ao concluir, a tabela de estações mostra a nova estação

#### Scenario: Calibrar todas
- **WHEN** o admin confirma "Calibrar todas as células"
- **THEN** `POST /admin/qm/calibrate {auto: true}` responde 202 e o job aparece na lista
