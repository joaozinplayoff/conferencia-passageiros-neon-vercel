# 🚌 Conferência de Passageiros por Reconhecimento Facial

Protótipo de sistema para **motoristas de ônibus rodoviário** conferirem a lista de
passageiros usando **reconhecimento facial pela câmera**, com **feedback por voz**
(text-to-speech), sem precisar tirar os olhos da estrada/porta para ler uma tela.

## ✅ Funcionalidades implementadas

### 1. Cadastro de viagem
- Motorista cria uma viagem (nome/linha, origem, destino, data).

### 2. Cadastrar passagem (registro do comprador do bilhete)
- Câmera do celular/tablet ativada no navegador.
- Para cada **passagem vendida**, o motorista (ou atendente) aponta a câmera pro
  rosto do comprador, digita o nome (e opcionalmente assento e documento/CPF-RG)
  e clica em **"Cadastrar passagem"**.
- O navegador extrai um **descritor facial** (128 números, via `face-api.js`)
  e salva no banco — **nenhuma imagem é enviada ao servidor**, só os números do
  descritor e uma miniatura pequena para exibição na lista.
- Neste momento o passageiro ainda **NÃO está a bordo** — ele só tem a passagem
  registrada (`embarcado = 0`). A confirmação física de entrada acontece na
  etapa seguinte, **"Embarque na porta"**.

### 3. Embarque na porta (validação facial com bloqueio de não identificados)
- Ao clicar em **"Iniciar validação na porta"**, a câmera fica ativa e
  escaneando continuamente (a cada ~0.9s) cada pessoa que entra no ônibus.
- **Se o rosto corresponder a uma passagem cadastrada para esta viagem**: o
  sistema libera o embarque, marca o passageiro como **a bordo** (`embarcado = 1`)
  e fala por voz *"[Nome do passageiro] a bordo"*.
- **Se o rosto NÃO corresponder a nenhuma passagem cadastrada para esta viagem**
  (pessoa sem passagem, ou passagem de outra viagem/ônibus): o sistema fala
  *"Passageiro não identificado"*, exibe um alerta visual vermelho e
  **não libera o embarque** — o evento é registrado no log para auditoria.
- Ao clicar em **"Concluir embarque"**, o sistema **fala por voz** quantos
  passageiros foram confirmados a bordo (ex: *"Embarque concluído. Foram
  confirmados 23 passageiros a bordo."*).

### 4. Conferência em parada (reconhecimento automático e contínuo)
- Ao clicar em **"Iniciar conferência"**, a câmera fica ativa e escaneando
  continuamente (a cada ~0.9s) os rostos que aparecem no quadro.
- Cada passageiro reconhecido é marcado como "presente" automaticamente e o
  motorista ouve uma confirmação por voz (ex: *"Maria Silva confirmada"*), sem
  precisar tocar na tela.
- Ao clicar em **"Finalizar e verificar"**, o sistema:
  - Se **todos estão presentes** → fala *"Todos os X passageiros estão presentes.
    Pode seguir viagem."*
  - Se **alguém está faltando** → fala o(s) **nome(s) específico(s)** do(s)
    passageiro(s) ausente(s), ex: *"Atenção! Está faltando o passageiro João Pereira."*
- Um modal visual também resume o resultado (para conferência olhando a tela, se preciso).

### 5. Encerrar viagem (exclusão automática dos dados biométricos)
- Na área de viagens, cada viagem em andamento tem um botão **"Encerrar viagem"**.
- Ao confirmar, o sistema **exclui todos os passageiros cadastrados** (nome,
  descritor facial e foto miniatura) daquela viagem e marca a viagem como
  **"Encerrada"** na lista.
- O histórico de eventos (embarques, conferências, faltas) é mantido para
  auditoria, mas os **dados biométricos são apagados** — importante para
  privacidade (LGPD), já que não faz sentido guardar o rosto de um passageiro
  depois que a viagem terminou.
- Uma viagem encerrada não pode mais receber embarque nem conferência (os
  botões somem e aparece apenas o aviso de "dados removidos").

### 6. Histórico / Log de eventos
- Toda viagem registra eventos (passagem cadastrada, embarque validado na porta,
  embarque negado/não identificado, embarque concluído, parada iniciada, parada
  ok, parada com falta, viagem encerrada) — útil para auditoria futura.

## 🔗 Rotas de API (backend Hono + Cloudflare D1)

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/viagens` | Cria uma nova viagem |
| GET | `/api/viagens` | Lista viagens (com contagem de passageiros/embarcados) |
| GET | `/api/viagens/:id` | Detalhe de uma viagem |
| POST | `/api/viagens/:id/concluir-embarque` | Encerra o cadastro de embarque |
| POST | `/api/viagens/:id/iniciar-parada` | Zera a presença para nova conferência |
| GET | `/api/viagens/:id/conferencia-parada` | Retorna quem está presente / faltando |
| POST | `/api/viagens/:id/finalizar-parada` | Registra o resultado da conferência no log |
| POST | `/api/viagens/:id/encerrar` | Encerra a viagem e **exclui os passageiros/dados biométricos** |
| POST | `/api/viagens/:id/passageiros` | Cadastra a **passagem** (nome, assento, documento, descriptor facial, thumb) — inicia com `embarcado = 0` |
| GET | `/api/viagens/:id/passageiros` | Lista passageiros/passagens (com descriptor, para reconhecimento no client) |
| POST | `/api/passageiros/:id/validar-embarque` | Valida o embarque na porta: reconhecido → marca `embarcado = 1` e fala "[Nome] a bordo" |
| POST | `/api/viagens/:id/embarque-negado` | Registra no log uma tentativa de embarque **não identificada** (rosto sem passagem cadastrada) — embarque bloqueado |
| POST | `/api/passageiros/:id/marcar-presente` | Marca passageiro como presente na parada |
| DELETE | `/api/passageiros/:id` | Remove passageiro (correção de cadastro) |
| GET | `/api/viagens/:id/eventos` | Log de eventos da viagem |

## 🧠 Como funciona o reconhecimento facial

- Biblioteca: **[face-api.js](https://github.com/justadudewhohacks/face-api.js)**
  (TensorFlow.js), carregada via CDN — roda **inteiramente no navegador**.
- Modelos usados: `TinyFaceDetector` (detecção rápida), `FaceLandmark68Net`
  (pontos do rosto) e `FaceRecognitionNet` (gera o descritor de 128 dimensões).
- No cadastro de passagem: 1 rosto por vez é capturado e vinculado a um nome
  (comprador do bilhete).
- Na porta e na parada: `FaceMatcher` compara continuamente os rostos
  detectados no vídeo contra os descritores de todas as passagens cadastradas
  para aquela viagem, com um limiar de distância (`threshold = 0.55`) para
  considerar "é a mesma pessoa". Na porta, um rosto **fora** desse conjunto
  (distância acima do limiar em todos os descritores) é tratado como
  **"não identificado"** e tem o embarque bloqueado.
- **Voz**: usa a Web Speech API (`SpeechSynthesisUtterance`, `lang: 'pt-BR'`),
  nativa do navegador — sem custo de API externa.

## 💾 Dados / Armazenamento

- **Cloudflare D1** (SQLite distribuído), tabelas:
  - `viagens` — cada viagem cadastrada.
  - `passageiros` — nome, assento, documento (CPF/RG opcional), descriptor
    facial (JSON de 128 floats), miniatura da foto (base64), status de
    embarque (`embarcado`: 0 = passagem registrada / 1 = validado na porta),
    horário do embarque (`embarcado_em`) e presença na parada atual.
  - `eventos` — log de embarques, início/fim de conferências e faltas detectadas.

## 📱 Guia rápido de uso

1. Abra o sistema no celular/tablet do motorista (precisa de câmera e permitir acesso).
2. Na tela inicial, crie uma nova viagem.
3. Na aba **"Passagens"**: para cada bilhete vendido, aponte a câmera pro
   rosto do comprador, digite o nome (e opcionalmente assento/documento) e
   clique em "Cadastrar passagem". Isso só registra a passagem — a pessoa
   ainda não está marcada como a bordo.
4. Na aba **"Embarque na porta"**, clique em "Iniciar validação na porta" e
   aponte a câmera para cada pessoa entrando no ônibus:
   - Se a passagem for reconhecida, o app fala **"[Nome] a bordo"** e libera.
   - Se a pessoa **não tiver passagem cadastrada** para esta viagem, o app
     fala **"Passageiro não identificado"** e **bloqueia o embarque**.
   Ao final, clique em "Concluir embarque" — o app fala o total a bordo.
5. Em cada parada do percurso, abra a aba **"Conferir parada"**, clique em
   "Iniciar conferência" e aponte a câmera para os passageiros retornando ao
   ônibus (pode ser um a um, na porta). O app confirma cada um por voz.
6. Clique em "Finalizar e verificar" — se faltar alguém, o app **fala o nome**
   de quem está faltando e mostra na tela.

## ⚠️ Limitações do protótipo (importante)

- Reconhecimento facial 100% client-side com `face-api.js`: ótimo para provar
  o conceito, mas **não tem a robustez de sistemas biométricos comerciais**
  (sensível a iluminação, ângulo, óculos escuros, etc). Para produção real,
  recomenda-se avaliar hardware/SDK dedicado de biometria facial.
- Este é um protótipo de demonstração — validações de segurança/privacidade
  de dados biométricos (LGPD) precisam ser aprofundadas antes de uso real
  com passageiros (consentimento, retenção de dados, etc).
- Testado em navegador com câmera; performance de reconhecimento depende do
  dispositivo (celular/tablet) usado pelo motorista.

## 🎞️ Apresentação do projeto

Uma apresentação de slides (HTML autônomo, navegável) explicando o projeto para
stakeholders (gestores de viação/frota) está disponível em:
- **Local**: `/static/apresentacao/index.html`
- **Navegação**: setas do teclado (← →), clique nos botões de navegação, swipe no celular, ou clique nos pontinhos
- **Tela cheia**: botão de expandir no canto inferior

## 📦 Protótipo standalone (arquivo único .html)

Para testes rápidos sem precisar do backend Cloudflare D1, existe uma versão
**standalone** que roda 100% no navegador (armazena os dados no `localStorage`
em vez de D1), com a mesma lógica de passagem/embarque na porta/parada:
- **Local**: `/static/prototipo-standalone.html`
- Basta abrir esse arquivo direto no navegador (com câmera) para testar o
  fluxo completo sem servidor/banco de dados.

## 🚀 Deploy

- **Plataforma**: Cloudflare Pages + Cloudflare D1
- **Status local**: ✅ Rodando em ambiente de desenvolvimento (sandbox)
- **Stack**: Hono + TypeScript + TailwindCSS (CDN) + face-api.js (CDN)
- **Deploy em produção**: pendente (execute o fluxo de deploy Cloudflare
  quando estiver pronto para publicar)
