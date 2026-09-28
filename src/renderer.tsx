import { jsxRenderer } from 'hono/jsx-renderer'

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Conferência de Passageiros - Sistema do Motorista</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link
          href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"
          rel="stylesheet"
        />
        <link href="/static/style.css" rel="stylesheet" />
        {/* face-api.js roda 100% no navegador (client-side), sem enviar rostos para servidor */}
        <script src="https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js"></script>
      </head>
      <body class="bg-slate-900 text-slate-100">
        {children}
        <script src="/static/app.js"></script>
      </body>
    </html>
  )
})
