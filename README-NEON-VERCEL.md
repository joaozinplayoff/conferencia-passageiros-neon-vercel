# Migração para Neon + Vercel

Este projeto foi preparado para substituir o Cloudflare D1 por PostgreSQL no Neon e o Cloudflare Pages pela Vercel.

## 1. Instalar dependências

```bash
npm install
```

## 2. Configurar o Neon localmente

Crie um banco PostgreSQL no Neon e copie a connection string.

Crie `.env` na raiz:

```env
DATABASE_URL="postgresql://USUARIO:SENHA@HOST/NEONDB?sslmode=require"
```

Não publique `.env` no GitHub. O `.gitignore` já bloqueia esse arquivo.

## 3. Criar as tabelas

Depois de colocar a `DATABASE_URL` no `.env`:

```bash
npm run db:init
```

O script cria as tabelas `viagens`, `passageiros` e `eventos` e seus índices.

## 4. Testar localmente

```bash
npm run dev
```

Abra `http://localhost:3000`.

## 5. GitHub

Crie um repositório e envie o projeto. Antes do `git add`, confira se o `.env` não está sendo enviado.

## 6. Vercel

Na Vercel, importe o repositório do GitHub.

Adicione a variável de ambiente:

- `DATABASE_URL` = a mesma connection string do Neon

Não coloque a senha do banco dentro do código.

O `vercel.json` direciona as requisições para o Hono em `api/index.ts`.

## O que mudou no código

- `D1Database` foi removido.
- As queries D1 (`prepare`, `bind`, `first`, `all`, `run`) foram substituídas pelo driver `@neondatabase/serverless`.
- `?`/`last_row_id` foram substituídos por parâmetros seguros do Neon e `RETURNING id`.
- O schema SQLite/D1 foi convertido para PostgreSQL.
- O campo `documento` já está no schema inicial.
- O backend Hono agora roda em ambiente Node/Vercel.
- `DATABASE_URL` é lida somente no servidor.
