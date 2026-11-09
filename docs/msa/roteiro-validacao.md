# MSA — Roteiro de Execução da Validação

> **Para quem:** pesquisadora e orientação. Não exige conhecimento de programação,
> só copiar comandos no Terminal e abrir CSVs numa planilha.
> **O que é:** o passo a passo prático do protocolo descrito em
> [`validacao.md`](validacao.md). Lá está o *porquê* (métricas, critérios,
> referências); aqui está o *como*: quais arquivos preparar, em que formato,
> que comando rodar, o que sai e como ler o resultado.
>
> Os exemplos de saída das Fases 1, 4 e 6 foram obtidos rodando os scripts reais
> do projeto. Os marcados como **ilustrativo** mostram só o formato.

---

## Visão geral

A validação responde a uma pergunta por fase. Cada fase testa uma peça da
cadeia, da mais simples para a mais complexa, e uma fase só faz sentido depois
que a anterior foi aprovada: se a ET₀ estiver errada, o balanço hídrico também
estará.

| Fase | Pergunta | Compara | Ferramenta | Situação |
|---|---|---|---|---|
| 0 | O ambiente está pronto? | — | testes automatizados | pronta |
| 1 | A ET₀ calculada está correta? | MSA × CROPWAT 8.0 | `pnpm msa:validate-et0` | pronta |
| 2 | O balanço hídrico diário está correto? A produtividade predita se aproxima da colhida? Com quanta água o talhão entrou na safra? | MSA × CROPWAT 8.0; predita × observada; depleção na emergência × Thornthwaite-Mather | exportação + planilha; `pnpm msa:validate-preseason` | parcial (sem script para Dr/Ks) |
| 4 | A correção de viés melhora a chuva do ERA5? | ERA5 bruto e corrigido × INMET | `etl qm validate` | pronta; faltam dados reais |
| 5 | Os resultados são reproduzíveis? | run original × reprocessamento | painel + exportação | pronta |
| 6 | Quanto o método de graus-dia desloca as janelas F1–F4? | residual × Ometto × Ometto com TB | `pnpm msa:validate-gda` | pronta (descritiva, sem critério) |

> A antiga **Fase 3 (convergência do Monte Carlo)** foi removida em 2026-11-02, junto
> com o módulo estocástico do motor (ver `questoes-abertas.md`, registro da reunião
> com o professor Adilson). A numeração das Fases 4 e 5 foi mantida para não quebrar
> referências em notas e no manual.

**Ordem recomendada:** 0 → 1 → 6 → 4 → 2 → 5.
A Fase 2 vem depois da 4 porque o balanço deve ser validado com a chuva já corrigida,
e depois da 6 porque as datas das janelas que entram no CROPWAT dependem do método
de graus-dia (a Fase 6 é descritiva e pode rodar a qualquer momento).

```
                 ┌────────────┐
 ERA5-Land ─────►│  Fase 4    │  chuva corrigida (Quantile Mapping)
 INMET (BDMEP) ─►│  QM        │────────┐
                 └────────────┘        ▼
 CLIMWAT ──► Fase 1: ET₀ ──► Fase 2: balanço hídrico e produtividade ──► Fase 5: reprodução
             (Penman-Monteith)   (Dr, Ks; Ya = Ym × índice do ciclo)
                                        ▲
 Tmax/Tmin ─► Fase 6: graus-dia ────────┘  datas das janelas F1–F4 (Ometto × residual)
```

---

## Preparação (uma vez)

### Ambiente

No Terminal do Mac, na pasta do projeto:

```bash
cd ~/NodeProjects/FertilizaCerrado
pnpm start          # sobe a stack (banco, API, ETL, interface)
pnpm status         # todos os serviços devem aparecer como running/healthy
```

A Fase 1 e a parte sintética da Fase 6 rodam direto no Mac, sem banco. As Fases 2,
4 e 5, e a Fase 6 com a célula real (`--cell`), precisam da stack no ar.

### Pasta de trabalho

Crie uma pasta `validacao/` na raiz do projeto para guardar entradas e saídas:

```
validacao/
├── entrada/        dados recebidos (CROPWAT, BDMEP, séries exportadas)
├── saida/          CSVs gerados pelos scripts
└── notas.md        registro de cada execução (data, comando, resultado)
```

```bash
mkdir -p validacao/entrada validacao/saida
```

> Sugestão: versionar `validacao/` no Git. Para a banca, poder mostrar o arquivo
> exato que gerou cada número vale mais do que o número em si. Os dados do INMET
> são públicos; não há restrição para versioná-los.

### Convenções que valem para todas as fases

- **CSVs de entrada dos scripts:** separador vírgula, **ponto** decimal, primeira
  linha com os nomes das colunas, sem aspas. Exportando do Excel em pt-BR, use
  "CSV (separado por vírgulas)" e confira se os decimais saíram com ponto. Em
  geral, é mais seguro preparar o arquivo no Numbers ou no Google Planilhas
  configurado em inglês.
- **CSVs exportados pela interface** (painel MSA): separador **ponto e vírgula**,
  vírgula decimal, codificação UTF-8 com BOM. Abrem direto no Excel pt-BR, mas
  precisam ser convertidos antes de entrar num script.
- **Datas:** `AAAA-MM-DD` (ex.: `2025-11-03`).
- **Dia:** o ERA5-Land é agregado por dia **UTC** (questão aberta nº 2). Ao
  parear com dados de estação, lembre que o dia da estação é o dia local (UTC−3).
- **Sinal do PBIAS — atenção:** o script de ET₀ (Fases 1 e 2) usa
  Σ(O − S)/ΣO, a convenção de Moriasi et al. (2007) descrita em `validacao.md`:
  **positivo = o modelo subestima**. O script do Quantile Mapping (Fase 4) usa
  Σ(S − O)/ΣO: **positivo = o modelo superestima**. Os critérios usam o valor
  absoluto e não são afetados, mas a interpretação do sinal sim. Isso precisa
  ser unificado antes de ir para a dissertação (ver "Pendências").

---

## Fase 0 — Ambiente e testes automatizados

**Objetivo:** garantir que o código que vai ser validado é o mesmo que passou nos
testes. Não é validação científica; é a checagem de que nada quebrou.

```bash
pnpm test           # testes unitários do backend e da interface
```

**Resultado esperado:** todos os testes passando (o backend tem mais de 240).
Entre eles estão a reprodução dos Exemplos 17 e 18 do FAO-56, os cinco casos de
graus-dia de Ometto (Tb 10 °C, TB 30 °C: 28/18 → 13; 34/20 → 16,43; 32/31 → 20,
o teto), os invariantes do balanço hídrico (Ks entre 0 e 1, Dr entre 0 e TAW,
GDA do dia entre 0 e TB − Tb) e o índice de produtividade do ciclo (entre 0 e 1;
casos de referência do FAO-33, como F2 0,90/Ky 0,8 e F3 0,80/Ky 1,0 → 0,736).

**Registrar no `notas.md`:** a data e o identificador do código usado
(`git log -1 --oneline`, por exemplo `3831940 ...`). Toda a validação deve citar
esse identificador; ele é a "versão" do sistema validada.

---

## Fase 1 — ET₀ (Penman-Monteith FAO-56) × CROPWAT 8.0

**Pergunta:** a ET₀ calculada pelo MSA é igual à do software de referência da FAO
para os mesmos dados de entrada?

**Por que importa:** a ET₀ é a base de todo o resto. Um erro aqui se propaga para
ETc, balanço hídrico, Ks e produtividade predita.

### 1.1 Teste de fumaça (antes dos dados reais)

Confirma que o script funciona, usando os exemplos resolvidos do próprio FAO-56.

```bash
cd backend
pnpm msa:validate-et0 -- scripts/validation/examples/fao56-examples.csv
```

**Saída real:**

```
ET₀ FAO-56 — 2 observação(ões) de fao56-examples.csv

  fao56-ex18-uccle-6jul            ET0 3.88  ref 3.90  erro -0.02 mm/dia
  fao56-ex17-bangkok-april         ET0 5.76  ref 5.72  erro +0.04 mm/dia

Métricas (docs/msa/validacao.md):
  RMSE  0.028 mm/dia   (≤ 0.5)   OK
  R²    1.000          (≥ 0.95)   OK
  NSE   0.999          (≥ 0.8)   OK
  PBIAS -0.16 %        (|x| ≤ 10)  OK

  Aviso: com menos de 3 observações, R² e NSE não são informativos.

Comparação gravada em scripts/validation/examples/fao56-examples.comparison.csv
```

O aviso é esperado: com dois pontos, R² e NSE não têm valor estatístico.
O teste mostra apenas que as fórmulas reproduzem o livro.

### 1.2 Preparar os dados do CROPWAT

1. No CROPWAT 8.0, abra **Climate/ETo** e carregue a estação de Goiânia do
   CLIMWAT 2.0 (ou digite os dados da estação escolhida, questão aberta nº 7).
2. Anote, para cada mês, as colunas que o CROPWAT mostra: temperatura mínima e
   máxima, umidade, vento, insolação (horas de sol) e a **ETo** calculada.
3. Monte o CSV `validacao/entrada/et0-cropwat-goiania.csv`.

**Conversões necessárias:**

| CROPWAT mostra | Coluna no CSV | Conversão |
|---|---|---|
| Min Temp (°C) | `tmin` | nenhuma |
| Max Temp (°C) | `tmax` | nenhuma |
| Humidity (%) | `rhmean` | nenhuma (umidade relativa média) |
| Wind (km/dia) | `u2` | **dividir por 86,4** para obter m/s (o CLIMWAT já está a 2 m) |
| Sun (horas) | `n` | nenhuma |
| Rad (MJ/m²/dia) | — | não usar; o script calcula a partir de `n`, como o CROPWAT |
| ETo (mm/dia) | `et0_reference` | nenhuma |
| Altitude, Latitude da estação | `altitude`, `lat` | Goiânia: 741 m, −16,63 |
| Mês | `doy` | dia do ano do dia 15 do mês (jan 15, fev 46, mar 74, abr 105, mai 135, jun 166, jul 196, ago 227, set 258, out 288, nov 319, dez 349) |

**Formato do arquivo** (cabeçalho obrigatório na primeira linha):

```csv
id,lat,altitude,doy,tmax,tmin,rhmean,u2,n,et0_reference
goiania-jan,-16.63,741,15,29.5,18.9,77,1.20,5.6,4.10
goiania-fev,-16.63,741,46,29.8,18.8,76,1.15,6.1,4.15
...
goiania-dez,-16.63,741,349,29.4,19.0,78,1.25,5.2,4.00
```

> **Ilustrativo:** os números acima mostram o formato; não são os dados do CLIMWAT.
> Use os valores que o CROPWAT exibir.

Colunas aceitas pelo script, para outras fontes de dados:

| Grupo | Use uma das opções | Unidade |
|---|---|---|
| Identificação (opcional) | `id` ou `date` (`date` também fornece o `doy`) | — |
| Temperatura (obrigatória) | `tmax` e `tmin` (`tmean` opcional) | °C |
| Umidade | `tdew`, `ea`, `rhmean`, ou `rhmax` + `rhmin` | °C, kPa, % |
| Vento | `u2` (a 2 m) ou `u10` (a 10 m, convertido pela Eq. 47) | m/s |
| Radiação | `rn`, `rs` ou `n` (`rs` e `n` exigem `lat` e `doy`/`date`) | MJ/m²/dia, h |
| Local (obrigatório) | `altitude` | m |
| Referência (obrigatória) | `et0_reference` | mm/dia |

### 1.3 Rodar

```bash
cd backend
pnpm msa:validate-et0 -- ../validacao/entrada/et0-cropwat-goiania.csv \
  --out ../validacao/saida/et0-cropwat-goiania.comparison.csv
```

### 1.4 Ler a saída

No Terminal aparecem uma linha por mês (ET₀ do MSA, referência, erro) e as quatro
métricas com **OK** ou **FALHA**.

O CSV de comparação traz, por linha, todos os valores intermediários. Isso permite
localizar de onde vem uma diferença sem abrir o código:

| Coluna | Significado | Equação FAO-56 |
|---|---|---|
| `id` | identificação da linha | — |
| `tmax`, `tmin`, `tmean` | temperaturas usadas | — |
| `ea` | pressão de vapor atual (kPa) | 14, 17 ou 19 |
| `tdew` | ponto de orvalho equivalente (°C) | inversa da 11 |
| `u2` | vento a 2 m (m/s) | 47 |
| `rn` | saldo de radiação (MJ/m²/dia) | 35–40 |
| `altitude`, `pressure` | altitude e pressão atmosférica (kPa) | 7 |
| `gamma` | constante psicrométrica (kPa/°C) | 8 |
| `delta` | declividade da curva de vapor (kPa/°C) | 13 |
| `es` | pressão de vapor de saturação (kPa) | 12 |
| `et0` | ET₀ calculada pelo MSA (mm/dia) | 6 |
| `et0_reference` | ET₀ do CROPWAT (mm/dia) | — |
| `error` | `et0 − et0_reference` (mm/dia) | — |

Exemplo real (do teste de fumaça):

```csv
id,tmax,tmin,tmean,ea,tdew,u2,rn,altitude,pressure,gamma,delta,es,et0,et0_reference,error
fao56-ex18-uccle-6jul,21.5000,12.3000,16.9000,1.4086,12.0654,2.0793,13.2832,100.0000,100.1235,0.0666,0.1221,1.9975,3.8805,3.9000,-0.0195
```

### 1.5 Critério e interpretação

| Métrica | Critério | Se falhar, suspeite de |
|---|---|---|
| RMSE | ≤ 0,5 mm/dia | erro de unidade (vento em km/dia, radiação em W/m²) |
| R² | ≥ 0,95 | linhas trocadas ou meses fora de ordem |
| NSE | ≥ 0,80 | combinação de viés e dispersão |
| \|PBIAS\| | ≤ 10 % (meta do Caso 1: ≤ 5 %) | diferença sistemática, como altitude ou latitude erradas |

Diferenças de poucos centésimos são esperadas: o CROPWAT arredonda valores
intermediários e calcula a radiação mensal a partir da insolação.

**Para a dissertação:** uma tabela com mês, ET₀ CROPWAT, ET₀ MSA e erro; um
gráfico de dispersão MSA × CROPWAT com a reta 1:1; e as quatro métricas.

---

## Fase 2 — Balanço hídrico diário × CROPWAT 8.0 e produtividade predita × observada

**Pergunta:** a depleção da água no solo (Dr) e o coeficiente de estresse (Ks),
calculados dia a dia, coincidem com o CROPWAT para a mesma safra? E a produtividade
predita pelo MSA (Ym × índice do ciclo) se aproxima da produtividade colhida?

> **Situação:** ainda não existe um script dedicado. A comparação é feita numa
> planilha, com as fórmulas abaixo. Um script `msa:validate-balance` pode ser
> criado depois (ver "Pendências").

### 2.1 Escolher a safra

Uma safra de soja com:

- talhão com polígono, altitude, capacidade de campo e ponto de murcha informados;
- data de emergência conhecida;
- série ERA5-Land completa no período — **inclusive a entressafra**, desde o 1º de fevereiro anterior à emergência, pois é aí que o balanço começa desde o motor 2.2.0 (o painel não pode estar em "Sem processamento do MSA");
- de preferência, chuva já corrigida (selo "Chuva corrigida" no painel, depois da Fase 4);
- para o passo 2.5, **produtividade potencial** (Ym, sc/ha) informada na safra
  ("Produtividade potencial (sc/ha)", no cadastro ou na edição da safra) e a
  **produtividade observada** (colhida, sc/ha) anotada em `notas.md` — o sistema
  ainda não guarda a produtividade observada.

### 2.2 Exportar do MSA

**a) Resultado do balanço.** No painel da safra (`/safras/<id>`), botão
**Exportar série diária**. Por padrão o arquivo traz só os dias de cultura (da
emergência em diante); com a caixa **Mostrar entressafra** marcada, acima dos
gráficos, ele inclui também os dias da entressafra com `Fase = PRE` — exporte
**as duas versões** (a segunda serve ao passo 2.6). Colunas (separador `;`,
vírgula decimal):

```
Data;Fase;GDA do dia;GDA acumulado;Zr (m);ET0 (mm);Kc;ETc (mm);Chuva (mm);Dr (mm);Ks;ETc ajustada (mm);TAW (mm);RAW (mm)
```

**b) Clima usado**, para alimentar o CROPWAT com os mesmos dados. Abra o banco
e exporte a série da célula do talhão (a célula aparece no detalhe do talhão):

```bash
pnpm db:shell
```

```sql
\copy (SELECT time AS date, t2m_max AS tmax, t2m_min AS tmin, t2m_mean AS tmean,
              d2m_mean AS tdew, u2, rn, tp_corrected AS precipitation
       FROM era5_daily_data
       WHERE cell_lat = -16.7 AND cell_lon = -49.3
         AND time BETWEEN '2025-02-01' AND '2026-02-28'
       ORDER BY time) TO '/tmp/safra-clima.csv' CSV HEADER
\q
```

```bash
docker compose cp db:/tmp/safra-clima.csv validacao/entrada/safra-clima.csv
```

Formato resultante:

```csv
date,tmax,tmin,tmean,tdew,u2,rn,precipitation
2025-02-01,30.4,20.1,24.6,19.2,1.35,12.8,6.4
...
```

> **Ilustrativo** quanto aos valores. O intervalo começa em 1º de fevereiro
> para cobrir a entressafra (passo 2.6); para o CROPWAT (2.3) use só os dias da
> emergência em diante.

### 2.3 Rodar no CROPWAT

1. Entre no CROPWAT com a ET₀ e a chuva da safra. Use a ET₀ da coluna
   `ET0 (mm)` exportada pelo painel, para isolar o balanço hídrico das
   diferenças de ET₀, que já foram tratadas na Fase 1.
2. **Crop:** soja com os mesmos parâmetros da cultivar do MSA (Kc 0,20 / 1,15 / 0,50,
   p = 0,50, Zr 0,30 → 0,95 m, durações das fases tiradas das datas F1–F4 da
   linha do tempo do painel).
3. **Soil:** água disponível total = 1000 × (θFC − θWP) mm/m. Com os padrões
   0,28 e 0,12, são 160 mm/m. **Depleção inicial = a depleção na emergência
   calculada pelo MSA** — o valor "X de Y mm esgotados" do cartão **Água no solo
   na emergência** (bloco Produtividade), ou `emergenceDepletionMm` em
   `GET /harvests/<id>/msa` —, para que os dois balanços partam do mesmo ponto.
   (Antes do motor 2.2.0 esse valor era 0, solo na capacidade de campo.)
4. Gere a tabela diária do balanço (**Irrigation Schedule**, opção sem irrigação)
   e exporte para planilha.

> O CROPWAT trabalha com fases em dias, e o MSA com graus-dia (método de Ometto,
> com base superior de 30 °C — Fase 6). Fixar no CROPWAT as mesmas datas de
> transição que o MSA calculou elimina essa diferença da comparação.
> Diferenças restantes no modo como cada software interpola a chuva e a ET₀ devem
> ser descritas como fonte de discrepância.

### 2.4 Comparar na planilha

Coloque lado a lado, alinhados por data: `Dr MSA` (S) × `Dr CROPWAT` (O), e
depois `Ks MSA` × `Ks CROPWAT`. Supondo S na coluna B e O na coluna C, linhas 2 a 151
(fórmulas do Excel em português):

| Métrica | Fórmula |
|---|---|
| RMSE | `=RAIZ(SOMAXMY2(B2:B151;C2:C151)/CONT.NÚM(C2:C151))` |
| R² | `=RQUAD(B2:B151;C2:C151)` |
| NSE | `=1-SOMAXMY2(C2:C151;B2:B151)/DESVQ(C2:C151)` |
| PBIAS (convenção Moriasi) | `=(SOMA(C2:C151)-SOMA(B2:B151))/SOMA(C2:C151)*100` |

**Critério:** NSE ≥ 0,80 para Dr.

**Para a dissertação:** gráfico de Dr ao longo da safra com as duas curvas e as
linhas de RAW e TAW, e as métricas de Dr e Ks.

### 2.5 Produtividade predita × observada

Só é possível quando a safra tem Ym informada (sem ela a run grava o índice do
ciclo, mas não a produtividade predita) e a produtividade colhida é conhecida.

1. No painel da safra, confira no bloco **Produtividade** a Ym usada na run, o
   índice do ciclo, "N de 4 janelas" e a produtividade predita. Se a Ym foi
   informada depois da última run, reprocesse a safra: a predição faz parte da
   run e não é recalculada ao editar a safra.
2. Exporte **Resumo por janela**. O CSV traz, por janela, `ks_medio`,
   `reducao_pct` (Ky · (1 − Ks̄) em %) e, repetidos em todas as linhas,
   `indice_ciclo`, `ym_sc_ha` e `predita_sc_ha`.
3. Calcule o erro relativo na planilha, com a predita em B2 e a observada em C2:

   | Métrica | Fórmula |
   |---|---|
   | Erro relativo | `=(B2-C2)/C2` |

   É a mesma conta de `relativeError()` em `backend/scripts/validation/metrics.ts`:
   positivo = o MSA superestimou a produtividade.

**Critério:** não há critério de aceitação fixo nesta etapa (`validacao.md`,
Caso 2). Registre em `notas.md`, por safra: código, Ym, índice do ciclo, janelas
alcançadas, predita, observada e erro relativo. A predição é um valor único,
sem faixa de incerteza; a discussão da dissertação deve tratar isso como limitação.

**Para a dissertação:** tabela por janela (dias, Ks̄, Ky, Ky · (1 − Ks̄), fator) do
talhão escolhido e a tabela predita × observada com o erro relativo, uma linha por
safra histórica.

### 2.6 Depleção na emergência × Thornthwaite-Mather

Desde o motor 2.2.0 o balanço não começa na emergência com o solo cheio: começa
no 1º de fevereiro anterior, atravessa a entressafra sem cultura (Kc 1,0, Zr 0,95 m
por padrão) e chega à emergência com a depleção **calculada** (`algoritmos.md` §5).
Este passo confere esse valor contra o balanço climatológico clássico e mede
quanto ele depende do Kc da entressafra (questão aberta nº 11). É **descritivo**:
não há critério de aceitação.

**a) Anotar o que o MSA calculou.** No bloco **Produtividade** do painel, cartão
**Água no solo na emergência**: a frase "O talhão entrou na safra com N % da água
disponível", "Depleção na emergência: X de Y mm esgotados", "Chuva nos 30 dias
anteriores" e "Período do balanço: entressafra 01/02/AAAA → véspera (Kc, Zr)".
Os mesmos números vêm em `GET /harvests/<id>/msa` (`emergenceDepletionMm`,
`emergenceDepletionPct`, `preSeasonFrom`, `preSeasonKc`, `preSeasonZr`).

**b) Thornthwaite-Mather na planilha.** Use o CSV da série diária exportado **com
"Mostrar entressafra" ligado** (passo 2.2a): as linhas `Fase = PRE` trazem a ET₀
e a chuva de cada dia da entressafra. Numa planilha, com a data na coluna A, a
chuva P em B, a ET₀ em C (com Kc 1,0 a ETP é a própria ET₀; para outro Kc,
multiplique) e `CAD` numa célula fixa (ex.: `$H$1` = 1000 × (θFC − θWP) × Zr_max;
com os padrões 160 × 0,95 = **152 mm**), monte, a partir da linha 2 (1º de
fevereiro, armazenamento inicial `ARM` = CAD):

| Coluna | Fórmula (linha n, Excel em português) | Significado |
|---|---|---|
| D — P − ETP | `=Bn-Cn` | saldo do dia |
| E — negativo acumulado | `=SE(Dn<0;En-1+Dn;SE(Fn-1<$H$1;$H$1*LN(Fn-1/$H$1)+Dn;0))` | memória da secagem (TM clássico) |
| F — ARM | `=SE(Dn<0;$H$1*EXP(En/$H$1);MÍNIMO(Fn-1+Dn;$H$1))` | água armazenada no perfil |
| G — depleção TM | `=$H$1-Fn` | compare com o Dr do MSA |

Na primeira linha, `E1` = 0 e `F1` = CAD (solo cheio em 1º de fevereiro). Na
véspera da emergência, anote a **depleção TM do perfil** (G) e compare com o `Dr`
da última linha `PRE` do CSV do MSA (depleção do perfil antes da conversão).
Converta as duas para a zona radicular inicial multiplicando por Zr_ini/Zr_pre
(0,30/0,95 com os padrões) e compare com `emergenceDepletionMm`. Registre em
`notas.md` os quatro números e a diferença. Diferenças são esperadas: o MSA
esgota à taxa potencial até RAW e depois pelo Ks (Eq. 84 do FAO-56), enquanto TM
esgota exponencialmente desde o início; e a hipótese de umidade uniforme na
conversão de Zr vale para os dois.

**c) Sensibilidade ao Kc da entressafra.** Na pasta `backend`:

```bash
cd backend && pnpm msa:validate-preseason -- --cell -16.7,-49.3 --emergence 2025-11-01 --out ../validacao/saida/preseason-goiania.csv
```

Troque `--cell` pela célula do talhão (ela aparece no detalhe do talhão) e
`--emergence` pela emergência da safra. Padrões: `--soil 0.28,0.12`, `--altitude 741`,
`--kc 0.4,0.7,1.0`, `--zr-mode zrMax`; repita com `--zr-mode zrIni` para a
alternativa de perfil. A saída é uma tabela, por Kc, com a depleção ao fim da
entressafra (mm e % do perfil), a depleção convertida para Zr_ini (mm e %), e a
chuva e a ET₀ acumuladas da entressafra; `--out` grava
`kc;zr_m;dr_pre_mm;dr_ini_mm;dr_ini_pct;chuva_mm;et0_mm`. A linha `kc = 1.0`
deve reproduzir `emergenceDepletionMm` da run (mesma série, mesmos parâmetros).
Em vez de `--cell`, aceita um CSV `date,tmax,tmin,tdew,u2,rn,precipitation`
(o de `safra-clima.csv` serve).

**Critério:** não há. Registre em `notas.md`, por safra: `preSeasonFrom`, Kc e Zr
da entressafra, chuva e ET₀ acumuladas, depleção do MSA (perfil e convertida),
depleção TM (perfil e convertida) e a tabela de sensibilidade (Kc × modo de Zr).

**Para a dissertação:** gráfico da depleção do perfil ao longo da entressafra
(MSA × TM) até a emergência, e a tabela de sensibilidade — a discussão alimenta as
questões nº 11 e 12 de `questoes-abertas.md`.

---

## Fase 4 — Correção de viés da chuva (Quantile Mapping) × INMET

**Pergunta:** a chuva do ERA5-Land corrigida pelo Quantile Mapping fica mais
próxima da chuva medida na estação do que a chuva bruta?

**Como se responde:** calibra-se a correção com um período (por exemplo,
2010–2019) e testa-se em outro período, independente (2020–2024). Usar o mesmo
período para calibrar e testar daria um resultado artificialmente bom.

### 4.1 Obter os dados da estação (BDMEP/INMET)

1. Entre em <https://bdmep.inmet.gov.br> (exige cadastro).
2. Escolha **Dados diários**, a estação (por exemplo, 83423 Goiânia, convencional),
   o período completo (calibração + teste) e marque ao menos **Precipitação total diária**.
3. Baixe o CSV e salve em `validacao/entrada/83423.csv` **sem editar**.

O arquivo do BDMEP tem um cabeçalho de metadados, separador `;` e vírgula decimal.
O importador reconhece esse formato:

```
Nome: GOIANIA
Codigo Estacao: 83423
Latitude: -16.66
Longitude: -49.25
Altitude: 741.48
...
Data Medicao;PRECIPITACAO TOTAL, DIARIO(mm);TEMPERATURA MAXIMA, DIARIA(°C);...
2010-01-01;12,4;30,2;...
```

> **Ilustrativo** quanto aos valores. As colunas obrigatórias são `Data Medicao`
> e `PRECIPITACAO TOTAL`.

Para dados de outra fonte (ANA, estação própria), use o formato genérico
(vírgula, ponto decimal):

```csv
station_code,date,precip_mm,tmax,tmin
EST01,2010-01-01,12.4,30.2,19.1
EST01,2010-01-02,0,31.0,18.7
```

### 4.2 Importar

Pela interface: `/admin` → **Estações e correção de viés** → **Importar
observações diárias**, escolhendo o formato. Ou pelo Terminal:

```bash
docker compose run --rm -v "$PWD/validacao:/validacao" etl \
  stations import /validacao/entrada/83423.csv --format bdmep

docker compose run --rm etl stations list      # confere estação e período importado
```

A importação pode ser repetida sem duplicar dados.

### 4.3 Garantir a série ERA5 no mesmo período

O ERA5 da célula precisa cobrir calibração e teste. Para 2010–2024, são 15 anos:

```bash
docker compose run --rm etl ingest --from 2010-01-01 --to 2024-12-31
```

> **Tempo:** a fila do Copernicus leva de minutos a dezenas de minutos por
> requisição, e o período é pedido mês a mês (o CDS recusa requisições maiores
> por custo): cerca de 180 requisições, duas por vez, ou **várias horas**.
> Rode à noite, deixando o Mac ligado. O que for baixado fica em cache e não é
> pedido de novo. O comando cobre todas as células que têm talhão cadastrado.
> Acompanhe com `pnpm etl:status`.

### 4.4 Rodar a validação

```bash
docker compose run --rm -v "$PWD/validacao:/validacao" etl \
  qm validate --cell -16.7 -49.3 --station 83423 \
  --calib-years 2010-2019 --test-years 2020-2024 \
  --csv /validacao/saida/qm-83423.csv
```

### 4.5 Ler a saída

Uma linha por mês e uma do período completo:

```
mês    dias RMSE bruto  RMSE corr PBIAS bruto PBIAS corr  f_obs f_bruto f_corr
01      155      11.20       9.85       -18.4%      -3.1%  0.581   0.794  0.587
...
total  1826       6.42       5.71       -15.2%      -1.8%  0.312   0.468  0.316
```

> **Ilustrativo:** formato real, números inventados. Com a estação sintética dos
> testes (viés conhecido de 30 %), o PBIAS total vai de cerca de −21 % para 0,0 %.

| Coluna (CSV) | Significado |
|---|---|
| `mes` | mês do ano (`01`…`12`) ou `total` |
| `dias` | dias com ERA5 e observação no período de teste |
| `rmse_bruto`, `rmse_corrigido` | erro típico diário (mm) antes e depois da correção |
| `pbias_bruto`, `pbias_corrigido` | viés total (%); aqui **negativo = ERA5 abaixo da estação** |
| `frac_chuva_obs` | fração de dias com chuva na estação (> 0,1 mm) |
| `frac_chuva_bruto`, `frac_chuva_corrigido` | a mesma fração no ERA5 antes e depois |

**Como interpretar:** o ERA5 costuma chover "pouco, mas quase todo dia" (garoa
espúria), então `f_bruto` tende a ficar bem acima de `f_obs`. A primeira etapa
da correção resolve isso. A segunda corrige a intensidade dos dias chuvosos,
mês a mês, e atua sobre o PBIAS.

O RMSE diário costuma melhorar pouco, mesmo com uma boa correção: o Quantile
Mapping ajusta a **distribuição** da chuva, não o dia exato em que um evento
ocorreu. Isso é esperado e deve ser explicado no texto.

### 4.6 Critério

- Redução de pelo menos **30 %** no |PBIAS| total do período de teste
  (por exemplo, de 15,2 % para no máximo 10,6 %);
- `frac_chuva_corrigido` a menos de **2 pontos percentuais** de `frac_chuva_obs`.

### 4.7 Aplicar a correção ao sistema

Aprovada a validação, a calibração definitiva usa todo o período disponível:

```bash
docker compose run --rm etl qm calibrate --cell -16.7 -49.3 --station 83423
docker compose run --rm etl qm status
```

Ou, pela interface, `/admin` → **Calibrar todas**. As safras não são reprocessadas
automaticamente: use **Reprocessar** no painel ou **Processar todas** em `/admin`.
A partir daí, o painel mostra "Chuva corrigida — estação 83423 (N anos, D km)".

Os parâmetros (`QM_MAX_DISTANCE_KM`, `QM_MIN_YEARS`, `QM_WET_DAY_MM`, `QM_MAX_RATIO`)
estão no `.env` e são gravados junto de cada calibração (questão aberta nº 6).

**Para a dissertação:** tabela mensal de PBIAS bruto × corrigido; gráfico das curvas
de distribuição acumulada (estação, ERA5 bruto, ERA5 corrigido); a fração de dias
chuvosos por mês.

---

## Fase 5 — Reprodutibilidade

**Pergunta:** reprocessar uma safra com os mesmos dados produz exatamente o mesmo
resultado?

O motor é determinístico (não há sorteio nem semente desde a versão 2.0.0). Cada
processamento (run) grava a versão do motor, os parâmetros da cultivar
(`cultivarSnapshot`) e do solo, a Ym da safra e a calibração de chuva usados.

1. No painel da safra, anote na seção **Histórico** a versão do motor da última
   run, e exporte **Resumo por janela**.
2. Reprocesse a safra (botão **Reprocessar**, ou peça ao administrador) sem
   alterar a cultivar, o talhão nem a Ym. Se o painel avisar que os parâmetros da
   cultivar mudaram desde a run, as duas runs não são comparáveis.
3. Exporte de novo e compare os dois CSVs. Devem ser idênticos, número a número.

```bash
diff validacao/saida/resumo-run-A.csv validacao/saida/resumo-run-B.csv   # sem saída = idênticos
```

Isso já é verificado automaticamente no roteiro de testes `e2e-msa.sh`, que compara
a impressão digital (md5) dos resumos. Esta fase serve para documentar a
propriedade na dissertação com uma safra real.

---

## Fase 6 — Métodos de graus-dia (residual × Ometto × Ometto com TB)

**Pergunta:** quanto a troca do método de graus-dia, do residual
`(Tmax + Tmin)/2 − Tb` para o método de Ometto com temperatura-base superior
(TB), desloca as datas das janelas F1–F4 e o fim do ciclo?

**Por que importa:** as janelas definem o Ks médio de cada fase, o Ky aplicado e,
no fim, a produtividade predita. Desde o motor 2.1.0 (novembro de 2026) o sistema
usa Ometto com TB = 30 °C para a soja, valor provisório (questão aberta nº 10).
Esta fase mostra o tamanho do efeito e ajuda a discutir o valor de TB. Não há
critério de aceitação: é uma comparação descritiva (`validacao.md`, Caso 5).

Os três métodos comparados:

| Método | O que é |
|---|---|
| `residual` | fórmula do motor até a versão 2.0.0, `max((Tmax + Tmin)/2 − Tb, 0)`, reimplementada no script |
| `ometto` | método de Ometto só com a base inferior Tb (casos 1–3) |
| `ometto-tb` | método de Ometto com Tb e TB (os cinco casos), como o motor atual |

### 6.1 Rodar com a safra sintética (sem banco)

```bash
cd backend
pnpm msa:validate-gda -- --synthetic 150 --out ../validacao/saida/gda-sintetica.csv
```

A série é a mesma dos testes de serviço (150 dias a partir de 2025-11-01, gerada
com semente fixa), então o resultado é sempre o mesmo e serve de teste de fumaça.

### 6.2 Rodar com a célula de Goiânia

Precisa da stack no ar e da série ERA5 da célula em cache (Fase 4, passo 4.3). Use a
data de emergência da safra escolhida na Fase 2:

```bash
cd backend
DATABASE_URL=postgresql://fertiliza:senha@localhost:5432/fertiliza \
  pnpm msa:validate-gda -- --cell -16.7,-49.3 --from 2025-10-25 \
  --tbase 10 --tupper 30 --out ../validacao/saida/gda-goiania-tb30.csv
```

> A `DATABASE_URL` é a mesma do `backend/.env`. Sem `--to`, a série vai até o
> último dia em cache; o script avisa "não atingido" se o ciclo não fechar.

Para a sensibilidade ao valor de TB, repita com `--tupper 32` e `--tupper 35`,
mudando o nome do arquivo de saída. Também é aceito um CSV próprio com as colunas
`date, tmax, tmin` (as demais são ignoradas) no lugar de `--cell`.

### 6.3 Ler a saída

```
Série: 150 dias (2025-11-01 … 2026-03-30); Tb 10.0 °C; TB 30.0 °C; gdaTotal 1200

método     | janela | início     | fim        | dias
-----------|--------|------------|------------|-----
residual   | F1     | 2025-11-01 | 2025-11-08 |    8
residual   | F2     | 2025-11-09 | 2025-12-01 |   23
...
ometto-tb  | F4     | 2026-01-21 | 2026-02-11 |   22
ometto-tb  | ciclo  | gdaTotal em 2026-02-11; GDA ao fim 2187.4 °C·dia

Diferença de dias por janela (ometto-tb − residual): F1 +0, F2 +1, F3 +1, F4 +1
Fim do ciclo: residual 2026-02-08 · ometto 2026-02-08 · ometto-tb 2026-02-11
```

> **Ilustrativo:** formato real do script; as datas e os dias dependem da série.

| Coluna (CSV, separador `;`) | Significado |
|---|---|
| `metodo` | `residual`, `ometto` ou `ometto-tb` |
| `janela` | `F1`…`F4` |
| `inicio`, `fim` | primeira e última data da janela na série (vazio se não alcançada) |
| `dias` | número de dias da janela (0 se não alcançada) |
| `gda_fim` | GDA acumulado ao fim da janela (°C·dia) |

**Como interpretar:** `residual` e `ometto` coincidem enquanto a mínima do dia
fica acima de Tb (quase sempre, na soja do Cerrado). `ometto-tb` acumula menos nos
dias em que a máxima passa de TB, por isso nenhuma janela dele começa antes da
correspondente em `residual`, e as transições tendem a cair alguns dias mais tarde
nos meses quentes (setembro a novembro). O fim do ciclo é igual ou posterior. Com
emergência em dezembro ou janeiro, com menos dias acima de 30 °C, a diferença
diminui.

**Para a dissertação:** uma tabela série × método × janela (início, fim, dias),
com o fim do ciclo e o GDA ao fim da série; e, se feita a sensibilidade, as
diferenças de dias para TB = 30, 32 e 35 °C. Relacione o deslocamento com o Ks̄
por janela e a produtividade predita da Fase 2.

---

## Registro dos resultados

Para cada execução, anote no `validacao/notas.md`:

```markdown
## Fase 1 — 2026-10-20
- Código: 3831940 (git log -1 --oneline)
- Entrada: validacao/entrada/et0-cropwat-goiania.csv (CLIMWAT 2.0, estação Goiânia)
- Comando: pnpm msa:validate-et0 -- ../validacao/entrada/et0-cropwat-goiania.csv --out ...
- Resultado: RMSE 0,0xx · R² 0,99x · NSE 0,99x · PBIAS −0,x % → aprovado
- Observações: ...
```

Com isso, qualquer número da dissertação pode ser refeito por outra pessoa a
partir do mesmo arquivo e do mesmo comando.

---

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `coluna et0_reference ausente` | cabeçalho com outro nome ou separador `;` | conferir a primeira linha e o separador |
| Erros de ET₀ de 2 a 4 mm/dia | vento em km/dia | dividir por 86,4 |
| Erros que crescem no inverno | latitude com sinal errado | usar −16,63 (sul é negativo) |
| Painel em "Dados insuficientes" | ERA5 da célula incompleto no período | `pnpm etl ingest --from ... --to ...` |
| Bloco Produtividade sem produtividade predita | safra sem Ym, ou Ym informada depois da run | informar a Ym na safra e reprocessar |
| `qm validate`: estação inelegível | menos de 10 anos de sobreposição ou mais de 50 km | ampliar o período de ERA5 ou ajustar `QM_MIN_YEARS`/`QM_MAX_DISTANCE_KM` |
| Arquivo do BDMEP não importa | arquivo editado e salvo pelo Excel | baixar de novo e importar sem abrir |
| CSV de saída da Fase 4 não aparece | faltou o `-v "$PWD/validacao:/validacao"` | repetir com o parâmetro de volume |
| `msa:validate-gda`: `coluna tmin ausente` (ou `tmax`) | CSV sem a coluna ou com outro nome | conferir o cabeçalho: `date, tmax, tmin` |
| `msa:validate-gda`: `--tupper` deve ser maior que `--tbase` | TB menor ou igual a Tb | usar TB acima de Tb (ex.: `--tupper 30`) |
| `msa:validate-gda --cell` sem dias ou com "não atingido" | série ERA5 da célula incompleta ou curta | `pnpm etl ingest --from ... --to ...` e conferir `--from`/`--to` |

---

## Pendências conhecidas

Itens que afetam a validação e ainda precisam de decisão ou implementação:

1. **Unificar o sinal do PBIAS.** O script de ET₀ segue Moriasi (Σ(O − S)/ΣO, positivo =
   subestima) e o de Quantile Mapping usa Σ(S − O)/ΣO. Recomenda-se adotar Moriasi
   nos dois, como está em `validacao.md`.
2. **Script para a Fase 2** (`msa:validate-balance`), que leia o CSV do painel e a
   tabela do CROPWAT e calcule as métricas sem planilha (o passo 2.6 já tem o
   `msa:validate-preseason` para a sensibilidade; a comparação com
   Thornthwaite-Mather continua em planilha).
3. **Relatório em Python** com os gráficos previstos em `validacao.md` (dispersão
   da ET₀, séries do balanço, predita × observada, distribuições acumuladas do QM).
4. **Limiares de aceitação.** RMSE ≤ 0,5 mm/dia, R² ≥ 0,95, NSE ≥ 0,80 e |PBIAS| ≤ 10 %
   foram definidos no início do projeto. As faixas de Moriasi et al. (2007) foram
   propostas para vazão mensal; vale confirmar os limiares com a literatura de
   validação de ET₀ e de reanálises.
5. **Estação de referência** (questão aberta nº 7) e **dia UTC × local** (nº 2), que
   influenciam as Fases 1 e 4.
