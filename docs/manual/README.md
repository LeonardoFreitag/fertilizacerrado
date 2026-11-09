# Manual do usuário — FertilizaCerrado

Este manual ensina a usar o FertilizaCerrado passo a passo. Ele foi escrito para quem trabalha no campo, e não para quem trabalha com computadores. Cada passo diz o que fazer, onde clicar e o que deve aparecer, com a imagem da tela.

> **Aviso.** O FertilizaCerrado é uma ferramenta de apoio: não substitui a decisão do responsável técnico. A produtividade predita e os demais números do painel são estimativas feitas a partir de dados de clima, dos parâmetros da cultivar e da produtividade potencial informada. Eles ajudam a entender o efeito da falta de água; não são uma recomendação. Qualquer decisão sobre a lavoura é sempre de quem assina por ela.

Versão em um único arquivo, para imprimir ou enviar: [manual-completo.pdf](manual-completo.pdf).

## Capítulos

| Nº | Capítulo | Para quem | O que você aprende |
|---|---|---|---|
| 1 | [Primeiros passos](01-primeiros-passos.md) | Todos | O que é o sistema, os perfis, criar a conta, entrar e cuidar da senha |
| 2 | [Propriedades](02-propriedades.md) | Agrônomo, Administrador. Produtor consulta. | Cadastrar a fazenda, ligar ao produtor, editar e consultar |
| 3 | [Talhões](03-talhoes.md) | Agrônomo, Administrador. Produtor consulta. | Desenhar o talhão no mapa, informar altitude e umidade do solo, evitar erros de desenho |
| 4 | [Cultivares](04-cultivares.md) | Agrônomo, Administrador. Produtor consulta. | Usar a cultivar de referência, cadastrar a sua a partir dela, entender os parâmetros, atualizar quando a referência mudar |
| 5 | [Safras](05-safras.md) | Agrônomo, Administrador. Produtor consulta. | Cadastrar a safra, informar a produtividade potencial, acompanhar o processamento, concluir ou cancelar |
| 6 | [Painel agrometeorológico](06-painel-agrometeorologico.md) | Todos | Ler o painel, entender a produtividade predita e exportar os dados |
| 7 | [Administração](07-administracao.md) | Administrador | Gerenciar usuários e as rotinas de dados de clima |
| 8 | [Perguntas frequentes e glossário](08-perguntas-e-glossario.md) | Todos | Dúvidas comuns e o significado dos termos |

## Por onde começar

- **Sou agrônomo e vou usar pela primeira vez.** Siga os capítulos 1 a 6, na ordem. O caminho completo é: criar a conta, cadastrar a propriedade, desenhar o talhão, cadastrar a safra e ler o painel.
- **Sou produtor.** Leia o capítulo 1 para criar a conta e o capítulo 6 para entender o painel das suas safras.
- **Sou administrador.** Leia o capítulo 7. Os demais mostram o que os usuários veem.
- **Encontrei uma sigla que não conheço.** Veja o [glossário](08-perguntas-e-glossario.md#glossário).

## Sobre os exemplos

As telas do manual usam dados de demonstração. A Fazenda Boa Vista, a agrônoma Ana Ribeiro, o produtor João Batista e a agrônoma Carla Mendes não existem. A safra de soja 2025/26 mostrada no painel foi calculada com dados de clima reais de um ponto próximo a Goiânia, com produtividade potencial de 65 sc/ha, e os números servem apenas para ilustrar a leitura das telas.

## Como atualizar este manual

Esta seção é para quem mantém o sistema.

As imagens são geradas por um roteiro automático, que monta os dados de demonstração, percorre as telas e apaga tudo ao final. Quando uma tela mudar:

1. Suba o ambiente de desenvolvimento com `pnpm start`, na raiz do projeto.
2. Rode `pnpm manual:capture`. As imagens de `docs/manual/img/` são substituídas, e o arquivo `img/captura.json` guarda os números citados no capítulo 6.
3. Revise o texto dos capítulos afetados. O comando acusa imagem ausente, imagem sem uso, link quebrado e número do capítulo 6 diferente do capturado.
4. Rode `pnpm manual:pdf` para gerar de novo o `manual-completo.pdf`.

A captura precisa de internet, para carregar os mapas, e do histórico de clima do ponto de demonstração já baixado no ambiente — desde o 1º de fevereiro anterior à emergência da safra de exemplo, porque o balanço começa na entressafra. Ela não roda na integração contínua. Os detalhes técnicos estão em [`docs/modulos/frontend.md`](../modulos/frontend.md).
