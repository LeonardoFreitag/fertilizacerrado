# Roteiros de ponta a ponta

Scripts `bash` + `curl` que exercitam a API real contra a stack do Docker Compose, conferindo respostas HTTP e o estado do banco/Redis. Complementam os testes unitários (`pnpm test`), que não tocam em infraestrutura.

| Script | Cobre |
|---|---|
| `e2e-auth.sh` | Cadastro, verificação de e-mail, login, refresh com rotação, logout, recuperação de senha, limite de tentativas no Redis, CORS/helmet |
| `e2e-properties.sh` | CRUD de propriedades e talhões, escopo por role, validação GeoJSON/PostGIS, célula ERA5-Land, soft delete |
| `e2e-cultivars-harvests.sh` | Cultivares (referência via seed, faixas de validação, visibilidade, congelamento em uso), safras (safra ativa única, criações simultâneas, escopo, transições de status), exclusão de talhão com safras |
| `e2e-msa.sh` | Processamento MSA por safra: 150 dias sintéticos inseridos via SQL, `process` (201/200 `NEEDS_DATA`/422), truncamento pelo GDA, reprodutibilidade com a mesma semente, consultas, cenários e registro de decisões |
| `e2e-era5.sh` | **Opcional, exige `CDS_API_KEY` no `.env`** (pula com aviso sem ela): `ingest` real de 3 dias no CDS medindo a fila (~10 min observados), cache + upsert idempotente, `status`, série lida pelo Node alimentando `runDailyBalance`. O `backfill` completo (uma requisição por mês desde a emergência) só roda com `ERA5_E2E_BACKFILL=1` |

## Pré-requisitos

- Stack no ar: `docker compose up -d` na raiz do repositório (API em `localhost:3000`, Nginx em `localhost:80`).
- `.env` na raiz com `ADMIN_EMAIL` e `ADMIN_PASSWORD` definidos e o seed executado: `cd backend && pnpm prisma db seed`. Os roteiros de propriedades e de cultivares/safras fazem login com esse administrador, e o de cultivares/safras depende das duas cultivares de referência criadas pelo seed.
- Sem `SMTP_HOST` no `.env`: os roteiros leem os links de verificação e de recuperação de senha no log da API (`docker compose logs api`).
- No host: `bash`, `curl`, `node`, `shasum` e `docker compose`.

## Como rodar

```bash
bash backend/scripts/e2e/e2e-auth.sh
bash backend/scripts/e2e/e2e-properties.sh
bash backend/scripts/e2e/e2e-cultivars-harvests.sh
```

Rode-os em sequência, não em paralelo: compartilham o banco.

Cada linha sai como `PASS` ou `FAIL` com o esperado e o obtido; o final mostra `FALHAS: N`. Para ver só o que falhou:

```bash
bash backend/scripts/e2e/e2e-properties.sh | grep -v '^PASS'
```

## Efeitos colaterais

- **Dados**: no início, cada roteiro apaga `harvests`, `properties`, `fields`, `era5_cells`, as cultivares que não são de referência e todos os usuários que não sejam `ADMIN`, e limpa o Redis. Não rode contra um banco com dados que importam.
- **Redis**: o `e2e-auth.sh` para e religa o serviço `redis` para testar o comportamento com o Redis indisponível.
- Os usuários de teste criados ficam no banco ao final (o próximo roteiro os remove).
