## 1. Infraestrutura de captura

- [x] 1.1 `frontend/playwright.manual.config.ts` (`testDir ./e2e/manual`, 1440×900, `deviceScaleFactor 2`, pt-BR, America/Sao_Paulo, 1 worker, sem trace/screenshot automáticos); `testIgnore: ['manual/**']` no `playwright.config.ts`; scripts `manual:capture` e `manual:pdf` no `frontend/package.json` e atalhos no `package.json` da raiz; conferir que `pnpm e2e --list` não lista a captura
- [x] 1.2 `backend/scripts/manual/cleanup-demo.sql`: remoção transacional, em ordem de dependência, de tudo que pertence aos usuários `@manual.fertilizacerrado.local`; rodar duas vezes seguidas sem erro e conferir que contagens de `era5_daily_data`, estações e calibrações não mudam
- [x] 1.3 Helpers em `frontend/e2e/manual/`: `shot()` (rede assentada, fontes, destaque por `outline`, animações desligadas, cursor oculto), espera de tiles do mapa com falha clara, semeadura pela API (usuários verificados, "Fazenda Boa Vista", talhão na célula de Goiânia, cultivar própria, safra soja 2025/26 processada, decisão), verificação do pré-requisito de cache, limpeza em `beforeAll`/`afterAll`

## 2. Captura das telas

- [x] 2.1 Capítulos 1 a 5: cadastro, verificação, login, recuperação de senha, perfil e troca de senha; lista/formulário/detalhe de propriedade e vínculo de produtor; talhão (camadas, desenho, edição, área, altitude, umidade do solo, erro de desenho); cultivares (referência, própria, bloqueada); safras (formulário, processamento, concluir/cancelar) — _nota 2026-11-09: a tela "cultivar bloqueada" foi removida do escopo em `refocus-on-yield-prediction` (edição sempre habilitada); as imagens 04-05/04-06 passaram a mostrar divergência da referência e "Atualizar a partir da referência"; cap. 05 ganhou 05-10 produtividade potencial_
- [x] 2.2 Capítulo 6: linha do tempo, cartões com destaque, três gráficos, selo de correção da chuva, "dados insuficientes" (segunda safra recente), cenários A/B/C com dose-base fixa, registro da decisão, histórico, exportar CSV; gravar `docs/manual/img/captura.json` (Ks P50, resultados dos cenários, estado do selo) — _nota 2026-11-09: cenários, registro da decisão e Ks P50 foram removidos do escopo em `refocus-on-yield-prediction`; a captura passou a gravar o bloco Produtividade (06-11), Água no solo na emergência (06-12) e a entressafra nos gráficos (06-13) por `add-preseason-water-balance`; `captura.json` guarda índice do ciclo, predita e depleção na emergência_
- [x] 2.3 Capítulo 7 (como ADMIN): usuários (lista, editar, desativar), filas, ingestão/backfill, estações e calibração, sem disparar jobs; visão somente-leitura do Produtor onde o manual a descreve
- [x] 2.4 Rodar `pnpm manual:capture` de ponta a ponta; revisar visualmente todas as imagens; confirmar banco sem resíduos e cache do ETL intacto; adicionar `data-testid` apenas onde não houver localizador estável

## 3. Redação do manual

- [x] 3.1 `docs/manual/README.md` (índice, público por capítulo, aviso de responsabilidade técnica, "Como atualizar este manual") e capítulos 1 a 5, cada passo com ação, onde clicar, resultado esperado e imagem
- [x] 3.2 Capítulo 6 com o exemplo numérico tirado de `captura.json` (valores marcados com `<!-- valor:… -->`), os dois casos do selo de correção e o aviso junto ao registro da decisão — _nota 2026-11-09: o registro da decisão foi removido do escopo em `refocus-on-yield-prediction`; o aviso ficou junto à produtividade predita_
- [x] 3.3 Capítulos 7 e 8 (FAQ e glossário com ET₀, ETc, Ks, Kc, GDA, TAW/RAW, ERA5-Land, Monte Carlo, percentis; remissão a `docs/msa/algoritmos.md`) — _nota 2026-11-09: Monte Carlo e percentis removidos do escopo em `refocus-on-yield-prediction`; o glossário ganhou Ky, índice do ciclo, Ym, produtividade predita, temperatura-base superior (`adopt-ometto-degree-days`), entressafra e água no solo na emergência (`add-preseason-water-balance`)_; links para o glossário na primeira ocorrência de cada sigla nos demais capítulos
- [x] 3.4 Teste de consistência na captura: toda imagem referenciada existe, não há PNG órfão, valores marcados no capítulo 6 batem com `captura.json`, todos os links internos entre capítulos resolvem

## 4. PDF

- [x] 4.1 `frontend/scripts/manual-pdf.mjs` com `marked` (devDependency) e Chromium do Playwright: capa, sumário com âncoras, capítulos em nova página, CSS de impressão A4, cabeçalho/rodapé com numeração, reescrita de links entre capítulos, erro em imagem ausente
- [x] 4.2 Rodar `pnpm manual:pdf`; conferir páginas, sumário, imagens e quebras; versionar `docs/manual/manual-completo.pdf`

## 5. Verificação e documentação

- [x] 5.1 `pnpm e2e` completo verde e sem a captura; `pnpm typecheck && pnpm lint` no frontend; workflow do CI inalterado
- [x] 5.2 Links para o manual no `README.md` da raiz e em `docs/arquitetura.md`; `docs/modulos/frontend.md` e README dos e2e descrevem `manual:capture`/`manual:pdf` e seus pré-requisitos
