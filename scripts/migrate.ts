import 'dotenv/config'
import { neon } from '@neondatabase/serverless'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL não configurada.')

const sql = neon(databaseUrl)
const migration = await readFile(join(process.cwd(), 'migrations/0001_initial_schema.sql'), 'utf8')

// O schema desta migration usa apenas DDL simples; executamos os comandos separadamente.
for (const statement of migration
  .split(';')
  .map((part) => part.trim())
  .filter(Boolean)) {
  await sql.query(statement)
}

console.log('Banco Neon inicializado com sucesso.')
