# user-manual Specification

## Purpose

Manual do usuário em pt-BR em `docs/manual/`, para usuários não técnicos (Administrador, Agrônomo, Produtor): índice e oito capítulos com passos ilustrados, regras de redação e aviso de responsabilidade técnica, perguntas frequentes e glossário, captura automatizada das telas com Playwright a partir de dados de demonstração (com limpeza antes e depois), verificação de consistência entre texto, imagens e valores capturados, e PDF consolidado gerado a partir dos markdowns.

## Requirements

### Requirement: Manual do usuário por capítulos
O repositório SHALL ter `docs/manual/` com um manual em pt-BR para usuários não técnicos, composto por um índice (`README.md`) e um arquivo por capítulo, nesta ordem: `01-primeiros-passos.md`, `02-propriedades.md`, `03-talhoes.md`, `04-cultivares.md`, `05-safras.md`, `06-painel-agrometeorologico.md`, `07-administracao.md`, `08-perguntas-e-glossario.md`. O índice SHALL listar os capítulos com link, dizer a quem cada um se destina (Administrador, Agrônomo, Produtor) e explicar como regenerar imagens e PDF. O `README.md` da raiz e `docs/arquitetura.md` SHALL apontar para o manual.

#### Scenario: Índice leva a todos os capítulos
- **WHEN** o leitor abre `docs/manual/README.md`
- **THEN** encontra links válidos para os oito capítulos e para o PDF consolidado

#### Scenario: Conteúdo mínimo por capítulo
- **WHEN** os capítulos são lidos
- **THEN** o 1 cobre perfis e permissões, cadastro, verificação de e-mail, login, recuperação de senha, perfil e troca de senha; o 2, cadastrar, vincular produtor, editar e consultar propriedades; o 3, desenho e edição do polígono, camadas satélite e mapa, área, altitude, capacidade de campo e ponto de murcha, valores padrão e erros comuns de desenho; o 4, a cultivar de referência (soja), a criação da própria já preenchida pela referência, os grupos de parâmetros (inclusive a temperatura-base superior), a marcação do que diverge da referência, a ação "Atualizar a partir da referência" e o efeito da edição sobre safras existentes; o 5, cadastro da safra, data de emergência, produtividade potencial (Ym), por que o processamento começa em fevereiro (entressafra), acompanhamento do processamento, concluir, cancelar e notas; o 7, usuários, filas, ingestão/backfill, estações e calibração da chuva

### Requirement: Capítulo do painel agrometeorológico
O capítulo 6 SHALL ser o mais detalhado e explicar: o cabeçalho e o selo de correção da chuva, nos casos com e sem correção; a linha do tempo das janelas F1 a F4; os cartões por janela (Ks médio, redução potencial de produtividade e o significado das cores); o bloco Produtividade (tabela de redução por janela, índice do ciclo, produtividade potencial e predita, os casos de safra em andamento, sem Ym e com Ym alterada) e o cartão "Água no solo na emergência" (depleção na emergência, chuva dos 30 dias anteriores, período e parâmetros da entressafra); os três gráficos, o detalhe de um dia e o alternador "Mostrar entressafra"; a exportação em CSV; o histórico de execuções e o reprocessamento; o que fazer quando aparece "Sem processamento do MSA" (dados de clima faltando, altitude ausente, falha); e a visão do produtor. O exemplo numérico do capítulo SHALL usar os valores da captura de tela correspondente.

#### Scenario: Exemplo numérico coerente com a imagem
- **WHEN** o capítulo 6 cita o índice do ciclo, a produtividade predita, o Ks ou a redução de uma janela e a água no solo na emergência
- **THEN** os valores, marcados no markdown com `<!-- valor:… -->`, são iguais aos registrados em `docs/manual/img/captura.json` pela última captura e visíveis na imagem referenciada no mesmo passo

### Requirement: Regras de redação e aviso de responsabilidade técnica
Cada passo do manual SHALL informar o que fazer, onde clicar, o que esperar e trazer a imagem correspondente. O texto MUST usar linguagem simples, sem jargão de software, nomear botões e campos exatamente como aparecem na tela e explicar cada termo agronômico na primeira ocorrência. O manual SHALL exibir, no índice, na abertura do capítulo 6 e junto à produtividade predita, o aviso de que o sistema apoia e não substitui a decisão do responsável técnico.

#### Scenario: Aviso presente
- **WHEN** o leitor abre o índice ou o capítulo 6
- **THEN** encontra o aviso de que a decisão é do responsável técnico e o sistema é ferramenta de apoio

#### Scenario: Passo completo
- **WHEN** um passo descreve uma ação na tela
- **THEN** ele indica a ação, o elemento a clicar, o resultado esperado e referencia uma imagem existente em `docs/manual/img/`

### Requirement: Perguntas frequentes e glossário
O capítulo 8 SHALL reunir perguntas frequentes e um glossário com, no mínimo, ET₀, ETc, Ks, Kc, Ky, GDA, temperatura-base superior, TAW, RAW, depleção, janelas F1 a F4, índice do ciclo, produtividade potencial (Ym) e predita, entressafra (spin-up), água no solo na emergência, correção da chuva e ERA5-Land, cada termo definido em linguagem simples, e remeter a `docs/msa/algoritmos.md` para a formulação matemática. Os demais capítulos SHALL apontar para o glossário na primeira ocorrência de cada sigla. O glossário MUST NOT descrever recursos removidos do produto (Monte Carlo, percentis, cenários de adubação, registro de decisão, milho).

#### Scenario: Termo definido
- **WHEN** o leitor procura "Ks" no glossário
- **THEN** encontra uma definição sem fórmula e a indicação de onde está a matemática

### Requirement: Captura automatizada das telas
`frontend/e2e/manual/capture.spec.ts` SHALL gerar todas as imagens do manual com Playwright em viewport 1440×900 (tela inteira, página inteira ou recorte de um elemento), gravando PNGs em `docs/manual/img/` com nomes estáveis no formato `<capítulo>-<sequência>-<slug>.png`, e SHALL destacar com uma borda o elemento descrito no passo quando aplicável, sem deslocar o layout. A captura SHALL montar dados de demonstração: propriedade "Fazenda Boa Vista", talhão na célula ERA5 de Goiânia presente no cache, cultivar própria, safra de soja 2025/26 com produtividade potencial informada e processamento concluído com sucesso, e uma segunda safra recente que fica sem dados. A captura MUST NOT contactar o CDS nem acionar as rotinas de ingestão, backfill ou calibração da tela de administração; a ingestão que a criação de uma safra dispara automaticamente SHALL ser atendida pelo cache do ETL, que MUST cobrir a célula desde `preSeasonStart(emergência)`.

#### Scenario: Geração das imagens
- **WHEN** `pnpm manual:capture` é executado na raiz com a stack de desenvolvimento no ar e o cache cobrindo o período
- **THEN** `docs/manual/img/` contém todos os PNGs referenciados pelos capítulos, sem arquivos órfãos, e `captura.json` com os valores do exemplo numérico

#### Scenario: Pré-requisito ausente
- **WHEN** a captura é executada sem o cache do ETL cobrir a célula e o período da safra de demonstração
- **THEN** ela encerra com erro explicando o pré-requisito, sem gravar imagens parciais do painel

#### Scenario: Mapa sem tiles
- **WHEN** os tiles do mapa não carregam dentro do tempo limite
- **THEN** a captura falha com mensagem clara em vez de gravar a imagem

### Requirement: Limpeza dos dados de demonstração
Os dados de demonstração SHALL pertencer a usuários de um domínio de e-mail reservado e SHALL ser removidos ao final da captura e também no início de cada execução. A limpeza MUST afetar apenas registros desses usuários e MUST NOT remover dados ERA5, estações, calibrações, volumes ou o cache do ETL.

#### Scenario: Sem resíduos
- **WHEN** a captura termina, com sucesso ou falha
- **THEN** não restam no banco usuários, propriedades, talhões, cultivares, safras ou processamentos de demonstração

#### Scenario: Reexecução após interrupção
- **WHEN** uma execução anterior foi interrompida deixando dados de demonstração
- **THEN** a nova execução os remove antes de começar e conclui normalmente

### Requirement: Verificação de consistência do manual
`pnpm manual:check` (`frontend/scripts/manual-check.mjs`, também executado ao fim de `manual:capture`) SHALL verificar que toda imagem referenciada pelos capítulos existe em `docs/manual/img/`, que não há PNG órfão, que todos os links internos entre capítulos resolvem e que cada valor marcado com `<!-- valor:… -->` no capítulo 6 é igual ao registrado em `captura.json`, encerrando com código 1 e a lista das divergências quando houver.

#### Scenario: Valor divergente
- **WHEN** o capítulo 6 cita uma produtividade predita diferente da gravada em `captura.json`
- **THEN** o comando encerra com código 1 indicando o marcador, o valor do texto e o valor da captura

### Requirement: Captura fora da suíte e2e e do CI
A captura SHALL ter configuração Playwright própria, e `pnpm e2e` MUST NOT executar os arquivos de `frontend/e2e/manual/`. O workflow de CI MUST NOT executar a captura nem a geração do PDF. O `package.json` da raiz SHALL expor `manual:capture` e `manual:pdf`.

#### Scenario: Suíte e2e inalterada
- **WHEN** `pnpm e2e` é executado no frontend
- **THEN** rodam apenas as specs fora de `e2e/manual/`

### Requirement: PDF consolidado
`pnpm manual:pdf` SHALL gerar `docs/manual/manual-completo.pdf` a partir dos markdowns, em A4, com capa, sumário, os oito capítulos na ordem do índice, cada um iniciando em nova página, imagens embutidas, numeração de páginas e o aviso de responsabilidade técnica. A geração MUST NOT exigir ferramentas instaladas fora do pnpm além dos navegadores do Playwright.

#### Scenario: PDF gerado
- **WHEN** `pnpm manual:pdf` é executado após a captura
- **THEN** o arquivo é criado com todos os capítulos e nenhuma imagem ausente

#### Scenario: Imagem ausente
- **WHEN** um capítulo referencia uma imagem que não existe em `docs/manual/img/`
- **THEN** o script encerra com erro indicando o arquivo e o capítulo, sem gerar o PDF
