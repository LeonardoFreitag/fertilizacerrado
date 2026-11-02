## Context

O frontend cobre as Fases 0 e 1 (auth, propriedades, talhões, cultivares, safras, painel MSA, admin de filas/estações/usuários, perfil). Já existem três specs Playwright (`smoke`, `msa`, `users`) que rodam no host contra `http://localhost`, semeiam dados pela API e leem o link de verificação no log da API. O `msa.spec.ts` já sabe produzir uma safra com processamento concluído usando a única célula ERA5 em cache (−16,7; −49,3, Goiânia), sem contactar o CDS.

Restrições relevantes:
- A API não tem exclusão de safra nem de usuário (só desativação); a exclusão de propriedade é só para ADMIN.
- `playwright.config.ts` usa `testDir: './e2e'`, então qualquer arquivo em `e2e/manual/` entraria no `pnpm e2e`.
- O frontend não tem biblioteca de markdown nem de PDF; tem o Chromium do Playwright.
- Nunca limpar volumes (`etl_cache`); a limpeza dos dados de demonstração precisa ser cirúrgica.

## Goals / Non-Goals

**Goals:**
- Manual legível por não técnicos, com um passo = uma ação + um resultado esperado + uma imagem.
- Imagens regeneráveis por um comando, com nomes estáveis, de modo que mudar uma tela exija só rodar a captura de novo.
- Números do exemplo dos cenários A/B/C coerentes com a imagem correspondente.
- PDF único, apresentável, gerado sem ferramentas externas ao projeto.
- Captura sem resíduos no banco de dev e sem tocar no cache do ETL.

**Non-Goals:**
- Manual das Fases 2+ (recomendação de calagem/adubação completa, laudos de solo).
- Ajuda contextual dentro da aplicação, tradução, vídeos.
- Capturas em viewport móvel.
- Rodar a captura ou o PDF no CI.
- Alterar comportamento de telas ou da API.

## Decisions

**1. Configuração Playwright separada.** `frontend/playwright.manual.config.ts` com `testDir: './e2e/manual'`, viewport 1440×900, `deviceScaleFactor: 2` (texto nítido no PDF), `locale pt-BR`, `timezoneId America/Sao_Paulo`, `workers: 1`, timeout longo (o processamento da safra leva segundos, mas o worker pode estar frio), sem `trace`/`screenshot` automáticos. O config principal ganha `testIgnore: ['manual/**']`. Alternativa descartada: tag `@manual` com `--grep-invert` — depende de quem roda lembrar da flag.

**2. Dados de demonstração identificáveis.** Três usuários com e-mails fixos no domínio `@manual.fertilizacerrado.local` (agrônoma "Ana Ribeiro", produtor "João Batista", e um terceiro só para as telas de cadastro/verificação), CPFs válidos fixos. Propriedade "Fazenda Boa Vista" (Goiânia/GO), talhão "Talhão 1 — Sede" com o mesmo quadrado do `msa.spec.ts` (altitude 741 m, θ_CC 0,28, θ_PM 0,12), cultivar própria "Soja Demonstração" e a safra "Soja 2025/26" com emergência em 2025-10-25 sobre uma cultivar de referência. Nomes fixos (sem carimbo de tempo) porque aparecem nas imagens e no texto do manual.

**3. Limpeza por SQL, antes e depois.** `backend/scripts/manual/cleanup-demo.sql` apaga, em ordem de dependência e numa transação, tudo que pertence aos usuários do domínio de demonstração (decisões, cenários, resumos, runs, safras, talhões, propriedades, cultivares próprias, usuários). A spec o executa via `docker compose exec -T db psql` no `beforeAll` (execução anterior interrompida não bloqueia a nova) e no `afterAll`. Alternativa descartada: limpar pela API — faltam endpoints, e criá-los só para isso mudaria o produto. O script filtra exclusivamente pelo domínio de e-mail; não usa `TRUNCATE` nem toca em `era5_daily_data`, estações ou calibrações.

**4. Semear pela API, capturar pela interface.** O estado de base (usuários verificados, propriedade, talhão, safra processada, decisão) é montado pela API, como no `msa.spec.ts`, para ser rápido e determinístico. As telas de formulário são capturadas preenchidas pela interface, mas só se submete o que não duplica o estado (ex.: o formulário de nova propriedade é fotografado preenchido e cancelado). Exceção: o fluxo de cadastro → verificação → login do terceiro usuário é feito de verdade, pois as telas de sucesso só existem assim.

**5. Helper `shot(page, nome, { highlight? })`.** Espera a rede assentar e as fontes carregarem, aplica o destaque, grava `docs/manual/img/<nome>.png` e remove o destaque. O destaque é `outline: 3px solid #e11d48; outline-offset: 4px; border-radius: 6px` injetado por `locator.evaluate` — `outline` não desloca o layout, ao contrário de `border`. Animações e transições são desligadas por CSS injetado (`addStyleTag`) e o cursor de texto é ocultado, para capturas idênticas entre execuções. Captura de viewport por padrão; `fullPage` só no painel MSA, que é mais alto que a tela.

**6. Nomes de imagem estáveis: `<capítulo>-<seq>-<slug>.png`** (ex.: `06-03-cartoes-ks.png`). A lista de nomes é uma constante exportada pela spec; um teste final confere que todo PNG referenciado nos markdowns existe e que não sobrou PNG órfão em `img/` (a pasta é esvaziada no início da execução).

**7. Mapa.** As telas de talhão dependem de tiles externos (OSM e satélite). A captura espera `.leaflet-tile-loaded` e ausência de `.leaflet-tile-loading` com timeout; se os tiles não carregarem, o teste falha com mensagem clara em vez de gravar um mapa cinza. O desenho do polígono para a imagem "desenhando" é feito com cliques reais do mouse em coordenadas calculadas pelo `map.latLngToContainerPoint` exposto via `page.evaluate`.

**8. Estados difíceis de reproduzir.** "Dados insuficientes" é obtido com uma segunda safra de emergência recente (poucos dias de dados), sem adulterar o banco. O selo de correção da chuva aparece conforme houver calibração ativa para a célula; a captura fotografa o estado que existir e grava em `docs/manual/img/captura.json` qual foi (com/sem correção), e o texto do capítulo 6 descreve os dois casos. Telas de administração de estações/calibração são fotografadas no estado em que estiverem, sem disparar ingestão nem calibração.

**9. Exemplo numérico dos cenários.** A captura lê da própria tela (ou da resposta da API) o Ks P50 da janela e os resultados dos cenários A/B/C para uma dose-base fixa (ex.: 100 kg/ha) e grava em `captura.json`. O capítulo 6 é escrito a partir desses valores na aplicação da change; os dados são determinísticos enquanto o cache e a semente do Monte Carlo não mudarem. Se uma recaptura futura alterar os números, o teste de consistência (decisão 6) acusa divergência entre `captura.json` e os valores citados no markdown, marcados com um comentário HTML `<!-- valor:ksP50 -->`.

**10. PDF pelo Chromium do Playwright.** `frontend/scripts/manual-pdf.mjs`: lê os capítulos na ordem do índice, converte com `marked` (nova devDependency, pequena e sem binários), monta um HTML único com capa, sumário com links internos, CSS de impressão (A4, margens 20 mm, quebra de página por capítulo, `img { max-width: 100% }`, `break-inside: avoid` em figura+legenda), resolve as imagens por caminho de arquivo e chama `page.pdf()` com cabeçalho/rodapé (título e número de página). Alternativas descartadas: `pandoc` + LaTeX (dependência de sistema pesada e fora do pnpm) e `md-to-pdf` (traz Puppeteer, um segundo Chromium). Links entre capítulos (`02-propriedades.md#…`) são reescritos para âncoras internas; links para `docs/msa/algoritmos.md` viram texto com o caminho.

**11. Atalhos na raiz rodam no host**, como o `pnpm e2e` atual: `manual:capture` → `pnpm --dir frontend manual:capture`; `manual:pdf` → `pnpm --dir frontend manual:pdf`. O contêiner `frontend` não tem os navegadores do Playwright.

**12. Redação.** Segunda pessoa ("clique em…"), frases curtas, um verbo de ação por passo, nomes de botões em negrito exatamente como na tela. Sigla só depois do nome por extenso na primeira ocorrência de cada capítulo, com link para o glossário. Cada capítulo abre com "o que você vai fazer" e "quem pode fazer" (perfis). O aviso de responsabilidade técnica aparece no índice, na abertura do capítulo 6 e junto ao registro da decisão.

**13. Versionamento.** PNGs e PDF são versionados (são o entregável para a banca). `captura.json` também, pois sustenta o teste de consistência.

## Risks / Trade-offs

- **Tiles de mapa indisponíveis ou diferentes entre execuções** → espera explícita com falha clara; imagens de mapa podem variar ligeiramente no diff do git, o que é aceitável.
- **Cache do ETL não cobre o período** → a spec verifica o pré-requisito no início (como o `msa.spec.ts`) e aborta com instrução, em vez de ir ao CDS.
- **Limpeza por SQL acopla ao schema** → o script fica ao lado dos demais em `backend/scripts/`, filtra só pelo domínio de demonstração e a própria captura falha se uma tabela nova com FK impedir o `DELETE`, sinalizando a manutenção.
- **Números do capítulo 6 ficarem defasados** → `captura.json` + marcadores no markdown + teste de consistência.
- **Peso no repositório** (PNGs 2× e PDF) → capturas de viewport, não de página inteira, exceto no painel; PNG sem canal alfa. Estimativa de 40 a 50 imagens.
- **Manual defasado após mudança de tela** → recaptura é um comando; o texto ainda exige revisão humana. Registrado no `docs/manual/README.md` em "Como atualizar este manual".
- **`deviceScaleFactor: 2` altera a renderização** em relação ao e2e normal → só no config do manual.

## Notas de implementação

- **Emergência em 2025-10-01, não 2025-10-25.** Com a data do rascunho, a safra de demonstração teve Ks 1,00 nas quatro janelas e os três cenários devolviam a própria dose: o capítulo principal não teria o que ensinar. Testei datas e solos sobre os mesmos dados reais. Com emergência em 01/10/2025 (plantio logo após o vazio sanitário) e latossolo padrão, a floração fica em "atenção" (Ks 0,85; P10 0,69; P90 0,98; redução estimada de 15,1%) e as demais janelas ficam bem. Nenhum dado foi alterado: é a mesma soja 2025/26, na mesma célula.
- **Talhões na borda oeste da célula.** A célula em cache (−16,7; −49,3) é quase toda área urbana de Goiânia. Os talhões ficam no único trecho de pasto aberto dela, ao sul da BR-060, para a imagem de satélite mostrar campo. O Talhão 1 é desenhado com cliques em coordenadas geográficas, convertidas em pixels a partir de um tile carregado (endereço do tile dá z/x/y; a posição na tela dá a origem), sem depender do centro nem do zoom do mapa.
- **Barra de ações do desenho.** Ao ativar o polígono, o leaflet-geoman abre uma barra ("Finalizar", "Remover último vértice", "Cancelar") sobre o mapa; um vértice sob ela não é criado. O enquadramento é ajustado antes de desenhar e `clickMap` recusa pontos fora da área útil.
- **`deviceScaleFactor` 1,5 em vez de 2**, e recorte de elemento em vez de tela inteira onde o passo trata de um só componente: 81 imagens somam 17 MB. A decisão 5 previa "fullPage só no painel"; os formulários longos (cadastro, cultivar) também usam página inteira.
- **PDF de 10,2 MB, 77 páginas.** As imagens acima de 300 KB (11, quase todas de satélite ou mapa) entram como JPEG apenas no PDF; com PNG em tudo eram 19,9 MB. O sumário tem links internos, mas não números de página (o Chromium não implementa `target-counter`).
- **Defeito corrigido na conversão para JPEG.** A primeira versão de `lighterCopies` carregava o PNG por `file://` numa página aberta com `setContent` (origem `about:blank`), o que o Chromium bloqueia: o script fotografava o ícone de imagem quebrada e as 11 figuras saíam vazias no PDF (por isso o arquivo tinha só 8,2 MB). Agora o PNG vai por data URL, o script confere `img.complete`, `naturalWidth` e as dimensões antes de fotografar, e compara as dimensões do JPEG gerado com as do PNG; qualquer divergência interrompe a geração.
- **Campos de data em dd/mm/aaaa** exigem `--lang=pt-BR` no lançamento do navegador; a opção `locale` do Playwright não muda o formato do `<input type="date">`.
- **Publicação atômica.** As imagens vão para `frontend/test-results/manual/img` e só substituem `docs/manual/img` no último teste, que em modo serial só roda se todos os capítulos passaram. Substitui o "esvaziar a pasta no início" da decisão 6, que deixaria o repositório sem imagens numa falha.
- **Consistência como script, não como spec.** `frontend/scripts/manual-check.mjs` roda ao fim de `manual:capture` e no início de `manual:pdf`, compartilhando `manual-lib.mjs` com o gerador do PDF (um spec TypeScript não importa `.mjs` sem `allowJs`).
- **Semente fixa.** A criação da safra usa semente aleatória; a captura dispara uma segunda execução com `seed=20252026`, o que deixa os percentis reproduzíveis e ainda dá duas linhas ao histórico.
- **"Dados insuficientes"** é uma safra com emergência em hoje − 8: a run termina `NEEDS_DATA` (falta o dia mais recente do intervalo). A ingestão que ela dispara é atendida pelo cache; os logs de `etl`/`worker` não registram requisição ao CDS.
- **Sessão da própria página para a API de apoio.** Um login pela API invalidaria o refresh token da sessão do navegador (um por usuário); `trackToken` captura o access token das respostas de `/auth/login` e `/auth/refresh` da página.
- **Ajuste fora do escopo previsto, em `MsaCharts.tsx`:** os dois gráficos de meia largura sobrepunham os rótulos de data e cortavam os rótulos 0,85/0,70. Passaram a usar metade dos rótulos e margem direita maior. Nenhum `data-testid` novo foi necessário.
- **Dado pessoal nas imagens.** A tela de usuários é fotografada com a busca filtrada pelo domínio de demonstração; o e-mail do administrador real não aparece em nenhuma imagem (só o nome "Administrador" no cabeçalho).
