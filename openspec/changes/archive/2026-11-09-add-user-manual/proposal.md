## Why

As Fases 0 e 1 estão completas e verificadas, mas toda a documentação existente (`docs/arquitetura.md`, `docs/modulos/`, `docs/msa/`) é técnica: fala com quem desenvolve, não com quem usa. O agrônomo, o produtor e o administrador não têm um roteiro para operar o sistema, e a banca da dissertação precisa de um documento que mostre o MSA funcionando do ponto de vista de quem toma a decisão de adubação. Um manual escrito à mão com capturas feitas à mão envelhece na primeira mudança de tela; por isso as imagens precisam ser regeneráveis por comando.

## What Changes

- **Manual em `docs/manual/`**, em pt-BR, linguagem simples, um arquivo por capítulo e índice em `README.md`:
  1. Primeiros passos (o que é, perfis, cadastro, verificação de e-mail, login, recuperação de senha, perfil e troca de senha)
  2. Propriedades (cadastrar, vincular produtor, editar, consultar)
  3. Talhões (desenhar no mapa, satélite × mapa, editar polígono, área, altitude, umidade do solo, erros comuns)
  4. Cultivares (de referência, criar a própria, grupos de parâmetros, bloqueio quando há safra)
  5. Safras (cadastrar, data de emergência, acompanhar o processamento, concluir/cancelar)
  6. Painel agrometeorológico — capítulo principal (linha do tempo F1–F4, cartões, três gráficos, selo de correção da chuva, "dados insuficientes", cenários A/B/C com exemplo numérico real, registrar decisão, histórico, exportar CSV)
  7. Administração (usuários, filas, ingestão/backfill, estações e calibração da chuva)
  8. Perguntas frequentes e glossário (ET₀, ETc, Ks, Kc, GDA, TAW/RAW, ERA5-Land, Monte Carlo, percentis), com remissão a `docs/msa/algoritmos.md`
- Cada passo traz: o que fazer, onde clicar, o que esperar e a imagem. Termos agronômicos explicados na primeira ocorrência. Aviso explícito de que o sistema apoia e não substitui a decisão do responsável técnico.
- **Capturas automáticas**: `frontend/e2e/manual/capture.spec.ts` (Playwright, viewport 1440×900) monta dados de demonstração (propriedade "Fazenda Boa Vista", talhão na célula de Goiânia em cache, safra de soja 2025/26 com processamento concluído, uma decisão registrada), percorre as telas e grava PNGs com nomes estáveis em `docs/manual/img/`, destacando com uma borda o elemento descrito no passo. Remove os dados de demonstração ao final.
- **Configuração Playwright própria** para a captura; a suíte `pnpm e2e` passa a ignorar `e2e/manual/`. A captura não roda no CI.
- **PDF único**: `docs/manual/manual-completo.pdf` gerado a partir dos markdowns (capa, sumário, capítulos, imagens embutidas), para a banca e para usuários.
- **Atalhos na raiz**: `pnpm manual:capture` e `pnpm manual:pdf`.
- Links para o manual no `README.md` da raiz e em `docs/arquitetura.md`.

## Capabilities

### New Capabilities
- `user-manual`: manual do usuário em `docs/manual/` (estrutura de capítulos, regras de redação, aviso de responsabilidade técnica), captura automatizada e reproduzível das telas com dados de demonstração e limpeza, e geração do PDF consolidado.

### Modified Capabilities
<!-- Nenhuma: o comportamento do sistema não muda. A exclusão de e2e/manual da suíte e2e é detalhe de configuração coberto pela nova capability. -->

## Impact

- **Novo**: `docs/manual/` (9 markdowns, `img/*.png`, `manual-completo.pdf`), `frontend/e2e/manual/capture.spec.ts`, `frontend/playwright.manual.config.ts`, `frontend/scripts/manual-pdf.mjs`, `backend/scripts/manual/cleanup-demo.sql`.
- **Alterado**: `frontend/playwright.config.ts` (`testIgnore` de `manual/**`), `frontend/package.json` (scripts `manual:capture`/`manual:pdf`, devDependency `marked`), `package.json` da raiz (atalhos), `README.md`, `docs/arquitetura.md`, `docs/modulos/frontend.md`.
- **Sem alteração**: API, banco, ETL, telas do frontend (salvo `data-testid` pontuais se algum elemento não for localizável de forma estável), workflow do CI.
- **Pré-requisitos de execução**: stack de dev no ar, admin semeado e cache do ETL cobrindo a célula de Goiânia de 2025-10 em diante (os mesmos do `msa.spec.ts`).
- **Repositório**: PNGs e o PDF passam a ser versionados (ordem de alguns MB).
