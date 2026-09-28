import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { renderer } from './renderer'
import { sql } from './db'

type Viagem = {
  id: number
  nome: string
  origem: string | null
  destino: string | null
  data_viagem: string | null
  status: string
  created_at: string
}

type Passageiro = {
  id: number
  viagem_id: number
  nome: string
  assento: string | null
  documento: string | null
  descriptor: string
  foto_thumb: string | null
  embarcado: number
  presente_parada: number
  embarcado_em: string | null
  created_at: string
}

const app = new Hono()

app.use('/api/*', cors())
app.use('/static/*', serveStatic({ root: './public' }))

// ============================================================
// VIAGENS
// ============================================================

app.post('/api/viagens', async (c) => {
  const { nome, origem, destino, data_viagem } = await c.req.json()

  if (!nome) {
    return c.json({ error: 'Nome da viagem é obrigatório' }, 400)
  }

  const [result] = await sql`
    INSERT INTO viagens (nome, origem, destino, data_viagem, status)
    VALUES (${nome}, ${origem || null}, ${destino || null}, ${data_viagem || null}, 'aberta')
    RETURNING id, nome, origem, destino, data_viagem, status
  `

  return c.json(result)
})

app.get('/api/viagens', async (c) => {
  const results = await sql`
    SELECT v.*,
      (SELECT COUNT(*)::int FROM passageiros p WHERE p.viagem_id = v.id) AS total_passageiros,
      (SELECT COUNT(*)::int FROM passageiros p WHERE p.viagem_id = v.id AND p.embarcado = 1) AS total_embarcados
    FROM viagens v
    ORDER BY v.created_at DESC
  `

  return c.json(results)
})

app.get('/api/viagens/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [viagem] = await sql<Viagem[]>`SELECT * FROM viagens WHERE id = ${id}`

  if (!viagem) return c.json({ error: 'Viagem não encontrada' }, 404)
  return c.json(viagem)
})

app.post('/api/viagens/:id/concluir-embarque', async (c) => {
  const id = Number(c.req.param('id'))

  await sql`UPDATE viagens SET status = 'embarque_concluido' WHERE id = ${id}`

  const [total] = await sql<{ total: number }[]>`
    SELECT COUNT(*)::int AS total
    FROM passageiros
    WHERE viagem_id = ${id} AND embarcado = 1
  `

  await sql`
    INSERT INTO eventos (viagem_id, tipo, descricao)
    VALUES (${id}, 'embarque', ${`Embarque concluído com ${total?.total ?? 0} passageiro(s) a bordo.`})
  `

  return c.json({ total_embarcados: total?.total ?? 0 })
})

app.post('/api/viagens/:id/iniciar-parada', async (c) => {
  const id = Number(c.req.param('id'))

  await sql`
    UPDATE passageiros
    SET presente_parada = 0
    WHERE viagem_id = ${id} AND embarcado = 1
  `

  await sql`
    INSERT INTO eventos (viagem_id, tipo, descricao)
    VALUES (${id}, 'parada_iniciada', 'Conferência de parada iniciada.')
  `

  return c.json({ ok: true })
})

app.get('/api/viagens/:id/conferencia-parada', async (c) => {
  const id = Number(c.req.param('id'))

  const results = await sql<Passageiro[]>`
    SELECT id, nome, assento, presente_parada
    FROM passageiros
    WHERE viagem_id = ${id} AND embarcado = 1
    ORDER BY nome
  `

  const faltando = results.filter((p) => p.presente_parada === 0)
  const presentes = results.filter((p) => p.presente_parada === 1)

  return c.json({ total: results.length, presentes, faltando })
})

app.post('/api/viagens/:id/finalizar-parada', async (c) => {
  const id = Number(c.req.param('id'))
  const { faltando } = await c.req.json()

  const desc = faltando && faltando.length > 0
    ? `Falta(m): ${faltando.join(', ')}`
    : 'Todos os passageiros presentes.'
  const tipo = faltando && faltando.length > 0 ? 'parada_falta' : 'parada_ok'

  await sql`
    INSERT INTO eventos (viagem_id, tipo, descricao)
    VALUES (${id}, ${tipo}, ${desc})
  `

  return c.json({ ok: true })
})

app.post('/api/viagens/:id/encerrar', async (c) => {
  const id = Number(c.req.param('id'))

  const [viagem] = await sql<Viagem[]>`SELECT * FROM viagens WHERE id = ${id}`
  if (!viagem) return c.json({ error: 'Viagem não encontrada' }, 404)

  const [total] = await sql<{ total: number }[]>`
    SELECT COUNT(*)::int AS total FROM passageiros WHERE viagem_id = ${id}
  `

  await sql`DELETE FROM passageiros WHERE viagem_id = ${id}`
  await sql`UPDATE viagens SET status = 'encerrada' WHERE id = ${id}`
  await sql`
    INSERT INTO eventos (viagem_id, tipo, descricao)
    VALUES (${id}, 'viagem_encerrada', ${`Viagem encerrada. Dados de ${total?.total ?? 0} passageiro(s) removidos.`})
  `

  return c.json({ ok: true, passageiros_removidos: total?.total ?? 0 })
})

// ============================================================
// PASSAGEIROS
// ============================================================

app.post('/api/viagens/:id/passageiros', async (c) => {
  const viagemId = Number(c.req.param('id'))
  const { nome, assento, documento, descriptor, foto_thumb } = await c.req.json()

  if (!nome || !descriptor) {
    return c.json({ error: 'Nome e descriptor facial são obrigatórios' }, 400)
  }

  const [result] = await sql<{ id: number }[]>`
    INSERT INTO passageiros
      (viagem_id, nome, assento, documento, descriptor, foto_thumb, embarcado)
    VALUES
      (${viagemId}, ${nome}, ${assento || null}, ${documento || null}, ${JSON.stringify(descriptor)}, ${foto_thumb || null}, 0)
    RETURNING id
  `

  await sql`
    INSERT INTO eventos (viagem_id, tipo, descricao)
    VALUES (
      ${viagemId},
      'passagem_cadastrada',
      ${`Passagem cadastrada para ${nome}${assento ? ' (assento ' + assento + ')' : ''}.`}
    )
  `

  return c.json({ id: result.id, nome, assento })
})

app.get('/api/viagens/:id/passageiros', async (c) => {
  const viagemId = Number(c.req.param('id'))

  const results = await sql<Passageiro[]>`
    SELECT id, nome, assento, documento, descriptor, foto_thumb,
           embarcado, presente_parada, embarcado_em
    FROM passageiros
    WHERE viagem_id = ${viagemId}
    ORDER BY nome
  `

  return c.json(results)
})

app.post('/api/passageiros/:id/validar-embarque', async (c) => {
  const id = Number(c.req.param('id'))
  const [passageiro] = await sql<Passageiro[]>`SELECT * FROM passageiros WHERE id = ${id}`

  if (!passageiro) return c.json({ error: 'Passageiro não encontrado' }, 404)

  await sql`
    UPDATE passageiros
    SET embarcado = 1,
        presente_parada = 1,
        embarcado_em = CURRENT_TIMESTAMP
    WHERE id = ${id}
  `

  await sql`
    INSERT INTO eventos (viagem_id, tipo, descricao)
    VALUES (${passageiro.viagem_id}, 'embarque_validado', ${`${passageiro.nome} validado e embarcado.`})
  `

  return c.json({ id: passageiro.id, nome: passageiro.nome, assento: passageiro.assento })
})

app.post('/api/viagens/:id/embarque-negado', async (c) => {
  const id = Number(c.req.param('id'))

  await sql`
    INSERT INTO eventos (viagem_id, tipo, descricao)
    VALUES (
      ${id},
      'embarque_negado',
      'Passageiro não identificado tentou embarcar — sem passagem cadastrada para esta viagem.'
    )
  `

  return c.json({ ok: true })
})

app.post('/api/passageiros/:id/marcar-presente', async (c) => {
  const id = Number(c.req.param('id'))

  await sql`
    UPDATE passageiros SET presente_parada = 1 WHERE id = ${id}
  `

  const [passageiro] = await sql<Pick<Passageiro, 'id' | 'nome' | 'assento'>[]>`
    SELECT id, nome, assento FROM passageiros WHERE id = ${id}
  `

  return c.json(passageiro)
})

app.delete('/api/passageiros/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await sql`DELETE FROM passageiros WHERE id = ${id}`
  return c.json({ ok: true })
})

// ============================================================
// EVENTOS / LOG
// ============================================================

app.get('/api/viagens/:id/eventos', async (c) => {
  const id = Number(c.req.param('id'))

  const results = await sql`
    SELECT * FROM eventos
    WHERE viagem_id = ${id}
    ORDER BY created_at DESC
  `

  return c.json(results)
})

// ============================================================
// FRONTEND (SPA)
// ============================================================

app.use(renderer)

app.get('*', (c) => c.render(<div id="app"></div>))

export default app
