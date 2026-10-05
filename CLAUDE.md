# FertilizaCerrado — Contexto de Projeto para Claude

## Sobre o Projeto

**FertilizaCerrado** é uma plataforma SaaS agronômica para as grandes culturas do Cerrado brasileiro. Combina dados de análise de solo, reanálise climática (ERA5-Land) e parâmetros fisiológicos de culturas para gerar recomendações de calagem e adubação sensíveis ao contexto hídrico real de cada talhão.

**Fase 1 em desenvolvimento:** Módulo de Software Agrometeorológico (MSA) — objeto da dissertação de mestrado de Heb Rejane Moreira Pires.

**Leia antes de implementar qualquer feature:**
- `docs/arquitetura.md` — visão geral do sistema, fases, stack
- `docs/modulos/` — especificações dos módulos (auth, propriedades, msa)
- `docs/msa/algoritmos.md` — fórmulas matemáticas com rastreabilidade de código
- `docs/msa/era5-etl.md` — pipeline ERA5-Land
- `docs/msa/validacao.md` — protocolo de validação científica

---

## Domínio Agrometeorológico — Parâmetros Fixos

### Fonte de dados climáticos
- **ERA5-Land** (Copernicus/ECMWF), resolução ~9 km, lag ~5 dias
- Correção de viés por **Quantile Mapping** calibrado com estações INMET/ANA
- Processamento retrospectivo em **batch semanal** — sem dados em tempo real

### ET₀ — Fórmula FAO-56 Penman-Monteith
- Referência: Allen et al. (1998) FAO Irrigation Paper No. 56, Eq. 6
- Ajuste de vento: $u_2 = u_{10} \times 0{,}748$
- $G = 0$ para passo diário

### Cultura Soja (plantio direto, Cerrado)
| Parâmetro | Valor |
|---|---|
| T_base | 10°C |
| Kc_ini (plantio direto) | 0,20 |
| Kc_mid | 1,15 |
| Kc_end | 0,50 |
| p (fração depleção) | 0,50 |
| Zr (ini → max) | 0,30 → 0,95 m |
| GDA total | ~1.200 °C·dia |

### Coeficientes Ky por janela (Doorenbos & Kassam, 1979 FAO No. 33)
| Janela | GDA (°C·dia) | Ky |
|---|---|---|
| F1 — Germinação | 0–120 | 0,20 |
| F2 — Crescimento vegetativo | 120–450 | 0,80 |
| F3 — Floração/Enchimento | 450–900 | 1,00 |
| F4 — Maturação | 900–1.200 | 0,40 |

### Monte Carlo
- 1.000 iterações por safra/janela
- Perturbação precipitação: $\pm 30\%$ ($\sigma = 0{,}30$, distribuição normal)
- Perturbação temperatura: $\pm 0{,}6°C$ ($\sigma = 0{,}6$, distribuição normal)
- Output: P10 / P50 / P90 do Ks médio por janela

### Cenários de Decisão (escolha do técnico)
- **(a) Redução de dose:** `Dose_adj = Dose_base × Ks_P50`
- **(b) Parcelamento:** dividido pela proporção de ETc projetada
- **(c) Fator de eficiência:** `Eficiência_adj = Eficiência_base × Ks_P50`

### Roles do sistema
- `ADMIN` — acesso total
- `AGRONOMO` — acessa propriedades/talhões dos seus clientes
- `PRODUTOR` — acessa somente-leitura suas próprias propriedades

---

## Contexto de Infraestrutura

Estou iniciando um projeto Node.js + TypeScript e quero aproveitar uma infraestrutura já validada. Preciso que você a replique neste novo projeto respeitando todas as decisões abaixo.

---

### Gerenciador de pacotes

Usar **pnpm** exclusivamente. Nunca sugerir npm ou yarn.  
Incluir no `package.json`:
```json
"packageManager": "pnpm@9.15.4",
"engines": { "node": ">=20.0.0", "pnpm": ">=9.0.0" }
```
Criar `.npmrc` na raiz do backend com:
```
engine-strict=true
public-hoist-pattern[]=*prisma*
public-hoist-pattern[]=*ts-node*
```

---

### Dockerfile (backend)

Multi-stage build com dois estágios:

**Stage 1 – builder:**
- Base: `node:20-alpine`
- Instalar: `python3 make g++ openssl` (para native addons)
- Ativar pnpm via `corepack enable && corepack prepare pnpm@latest --activate`
- Copiar `package.json` e `pnpm-lock.yaml` antes do código (cache de camadas)
- `pnpm install --frozen-lockfile`
- Gerar Prisma Client: `pnpm prisma generate`
- Compilar TypeScript: `pnpm build`

**Stage 2 – production:**
- Base: `node:20-alpine`
- Instalar: `openssl tini` + ativar corepack/pnpm
- `ENTRYPOINT ["/sbin/tini", "--"]` (reaper de processos zombie)
- Copiar de builder: `package.json`, `pnpm-lock.yaml`, `node_modules/`, `dist/`, `prisma/`
- Usuário não-root: criar `appgroup` e `appuser`, rodar como `appuser`
- `EXPOSE 3000`
- `HEALTHCHECK` via `wget -qO- http://localhost:3000/health`
- `CMD ["node", "dist/server.js"]`

---

### docker-compose.yml (desenvolvimento local)

Serviços:
- **db**: `postgres:15-alpine` — expor porta 5432, volume persistente, healthcheck com `pg_isready`
- **redis**: `redis:7-alpine` — senha via env, `maxmemory 256mb`, `noeviction` (exigido pelo BullMQ), porta 6379
- **api**: build com `target: builder`, hot-reload via `ts-node-dev`, volumes de `src/` e `prisma/` como readonly, comando: `pnpm prisma migrate deploy && pnpm exec ts-node-dev --respawn --transpile-only src/server.ts`, depende de db e redis com `condition: service_healthy`
- **nginx**: `nginx:1.25-alpine`, porta 80, usa `nginx.dev.conf`
- **adminer**: `adminer:4-standalone`, porta 8080 (gerenciador visual do banco)

Volumes nomeados: `postgres_data`, `redis_data`

---

### docker-compose.prod.yml (produção)

Diferenças em relação ao dev:
- **api**: image do ECR (`${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG:-latest}`), sem volumes de código, `deploy.replicas: 2`, rolling update com `order: start-first` e `parallelism: 1` (zero-downtime), resource limits (cpu 0.75, memory 512M), logging com `json-file` max 10m
- **nginx**: porta 80 e 443, usa `nginx.prod.conf`, volume de logs e SSL
- **db** e **redis**: sem portas expostas, `restart: always`, resource limits
- Duas redes: `backend_net` (internal: true — db e redis isolados) e `frontend_net`

---

### Nginx

**nginx.dev.conf** — proxy reverso simples:
- `upstream api_upstream { server api:3000; }`
- Location `/api/` → proxy para upstream com headers padrão (`X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`)
- Location `/nginx-health` → `return 200 "OK"`

**nginx.prod.conf** — load balancer completo:
- `worker_processes auto` + `worker_rlimit_nofile 65535`
- `worker_connections 4096` + `use epoll` + `multi_accept on`
- Gzip habilitado (comp_level 5, tipos: json, js, css, svg, xml)
- `client_max_body_size 20m` (upload de laudos de solo)
- **Rate limiting** com 3 zonas:
  - `api_general`: 60 req/min por IP
  - `api_auth`: 10 req/min (anti brute-force)
  - `api_upload`: 5 req/min
- **Upstream com `least_conn`**: `server api:3000 max_fails=3 fail_timeout=30s`, `keepalive 32`
- Server HTTP (porta 80): redireciona para HTTPS, exceto `/.well-known/acme-challenge/` (Let's Encrypt)
- Server HTTPS (porta 443):
  - TLS 1.2 + 1.3, ciphers modernos, HSTS 1 ano
  - Headers de segurança: `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection`, `Referrer-Policy`
  - Location `/health` → proxy sem rate limit, `access_log off`
  - Location `~ ^/api/v[0-9]+/auth/` → zona `api_auth`, `burst=5`
  - Location `~ ^/api/v[0-9]+/.../upload` → zona `api_upload`, `client_max_body_size 50m`, `proxy_read_timeout 120s`
  - Location `/api/` → zona `api_general`, `burst=20`

---

### Variáveis de ambiente (.env.example)

```
# Banco
DB_USER=
DB_PASSWORD=
DB_NAME=

# Redis
REDIS_PASSWORD=

# JWT
JWT_SECRET=          # mínimo 32 caracteres
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=  # mínimo 32 caracteres
JWT_REFRESH_EXPIRES_IN=7d

# App
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000
FRONTEND_URL=http://localhost:5173

# SMTP
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@dominio.com.br

# AWS (produção)
AWS_REGION=
ECR_REGISTRY=
ECR_REPOSITORY=
IMAGE_TAG=latest
```

---

### Estratégia de escala (3 fases)

**Fase 1 – EC2 + Docker Compose** (até ~5.000 usuários)
- Uma EC2 t3.medium com `docker compose --scale api=3`
- Nginx faz load balancing interno entre as réplicas
- Custo: ~USD 80/mês
- Deploy: `git clone` + `docker compose -f docker-compose.prod.yml up -d --scale api=3`

**Fase 2 – AWS ECS Fargate + ALB + RDS** (5.000–30.000 usuários)
- ALB (Application Load Balancer) multi-AZ substitui o Nginx para balanceamento externo
- ECS Fargate com auto scaling por CPU/memória
- RDS PostgreSQL Multi-AZ com failover automático
- ElastiCache Redis com replicação
- Infraestrutura provisionada via **Terraform** (recomendado)
- Deploy zero-downtime nativo via rolling update do ECS

**Fase 3 – AWS EKS (Kubernetes)** (30.000+ usuários)
- HorizontalPodAutoscaler baseado em métricas customizadas
- Múltiplos serviços independentes (api, workers, scheduler)
- Terraform provisiona o cluster EKS; kubectl gerencia os pods
- Prometheus + Grafana para observabilidade

---

### Estrutura de pastas esperada

```
projeto/
├── backend/
│   ├── src/
│   ├── prisma/
│   ├── scripts/init.sql
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── .npmrc
│   ├── package.json
│   └── tsconfig.json
├── frontend/
├── nginx/
│   ├── nginx.dev.conf
│   └── nginx.prod.conf
├── infra/
│   ├── terraform/
│   └── k8s/
├── docker-compose.yml
├── docker-compose.prod.yml
└── .env.example
```

---

### Observações importantes

- O `init.sql` cria as extensões `pgcrypto` e `uuid-ossp` no PostgreSQL e define `timezone = 'America/Sao_Paulo'`
- O Express deve ter `app.set('trust proxy', 1)` para `req.ip` funcionar corretamente atrás do Nginx
- O `server.ts` deve implementar graceful shutdown capturando `SIGTERM` e `SIGINT`, desconectando o banco antes de encerrar
- Validação de variáveis de ambiente via **Zod** no `src/config/env.ts`, com `process.exit(1)` se inválidas