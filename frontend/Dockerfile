# Stage 1 — build dos estáticos da SPA
FROM node:20-alpine AS builder

ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Stage 2 — nginx com os estáticos. A configuração (nginx/nginx.prod.conf) é montada
# pelo Compose em /etc/nginx/nginx.conf; a imagem só acrescenta /usr/share/nginx/html.
FROM nginx:1.25-alpine

RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80 443
