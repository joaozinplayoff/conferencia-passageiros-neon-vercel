// ============================================================
// Sistema de Conferência de Passageiros por Reconhecimento Facial
// Protótipo para motoristas de ônibus rodoviário
// Todo o reconhecimento facial roda no navegador (face-api.js)
// ============================================================

const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
const MATCH_THRESHOLD = 0.55; // quanto menor, mais estrito no reconhecimento
const AUTO_SCAN_INTERVAL_MS = 900;

let modelsLoaded = false;
let currentStream = null;
let videoEl = null;
let overlayEl = null;
let scanTimer = null;
let currentTrip = null;
let recentlyMatched = new Map(); // id -> timestamp para evitar repetir voz/flash

const app = document.getElementById('app');

// ---------------- Utilitários ----------------

function falar(texto) {
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(texto);
    utter.lang = 'pt-BR';
    utter.rate = 0.98;
    utter.pitch = 1;
    window.speechSynthesis.speak(utter);
  } catch (e) {
    console.warn('TTS não suportado', e);
  }
}

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }));
    throw new Error(err.error || 'Erro na requisição');
  }
  return res.json();
}

function el(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

async function loadModels() {
  if (modelsLoaded) return;
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);
  modelsLoaded = true;
}

async function startCamera(videoElement) {
  if (currentStream) return;
  currentStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  videoElement.srcObject = currentStream;
  await videoElement.play();
}

function stopCamera() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }
}

function captureThumb(videoElement, size = 96) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const vw = videoElement.videoWidth, vh = videoElement.videoHeight;
  const s = Math.min(vw, vh);
  ctx.drawImage(videoElement, (vw - s) / 2, (vh - s) / 2, s, s, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.7);
}

async function detectSingleFace(videoElement) {
  return faceapi
    .detectSingleFace(videoElement, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
}

async function detectAllFaces(videoElement) {
  return faceapi
    .detectAllFaces(videoElement, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptors();
}

function drawDetections(overlayEl, videoElement, detections) {
  const dims = faceapi.matchDimensions(overlayEl, videoElement, true);
  const resized = faceapi.resizeResults(detections, dims);
  const ctx = overlayEl.getContext('2d');
  ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
  faceapi.draw.drawDetections(overlayEl, resized);
}

function fmtData(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleString('pt-BR'); } catch { return d; }
}

// ---------------- Router ----------------

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);

function route() {
  stopCamera();
  const hash = location.hash || '#/';
  const partsMatch = hash.match(/^#\/viagem\/(\d+)\/(passagem|porta|parada)$/);
  if (hash === '#/' || hash === '') {
    renderHome();
  } else if (partsMatch) {
    renderViagem(partsMatch[1], partsMatch[2]);
  } else {
    renderHome();
  }
}

// ---------------- Tela: Home / Lista de viagens ----------------

async function renderHome() {
  app.innerHTML = `
    <div class="min-h-screen p-4 md:p-8 max-w-3xl mx-auto">
      <header class="mb-8 text-center">
        <h1 class="text-3xl md:text-4xl font-bold text-white flex items-center justify-center gap-3">
          <i class="fas fa-bus text-amber-400"></i>
          Conferência de Passageiros
        </h1>
        <p class="text-slate-400 mt-2">Sistema de reconhecimento facial para motoristas — Protótipo</p>
      </header>

      <div class="bg-slate-800 rounded-2xl p-5 mb-6 border border-slate-700">
        <h2 class="text-lg font-semibold mb-3 text-amber-300"><i class="fas fa-plus-circle mr-2"></i>Nova viagem</h2>
        <form id="form-viagem" class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input required name="nome" placeholder="Nome / linha (ex: São Paulo → Curitiba)" class="col-span-2 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400" />
          <input name="origem" placeholder="Origem" class="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400" />
          <input name="destino" placeholder="Destino" class="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400" />
          <input name="data_viagem" type="date" class="col-span-2 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-amber-400" />
          <button type="submit" class="col-span-2 bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold py-2.5 rounded-lg transition">
            <i class="fas fa-route mr-2"></i>Criar viagem
          </button>
        </form>
      </div>

      <h2 class="text-lg font-semibold mb-3 text-slate-300"><i class="fas fa-list mr-2"></i>Viagens</h2>
      <div id="lista-viagens" class="space-y-3">
        <p class="text-slate-500 text-sm">Carregando...</p>
      </div>
    </div>
  `;

  document.getElementById('form-viagem').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    try {
      const viagem = await api('/viagens', { method: 'POST', body: JSON.stringify(payload) });
      location.hash = `#/viagem/${viagem.id}/passagem`;
    } catch (err) {
      alert('Erro ao criar viagem: ' + err.message);
    }
  });

  const viagens = await api('/viagens');
  const listaEl = document.getElementById('lista-viagens');
  if (viagens.length === 0) {
    listaEl.innerHTML = `<p class="text-slate-500 text-sm">Nenhuma viagem cadastrada ainda.</p>`;
    return;
  }
  listaEl.innerHTML = viagens.map(v => `
    <div class="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
      <div>
        <div class="font-semibold text-white">${escapeHtml(v.nome)}</div>
        <div class="text-sm text-slate-400">
          ${v.origem ? escapeHtml(v.origem) + ' → ' : ''}${v.destino ? escapeHtml(v.destino) : ''}
          ${v.data_viagem ? ' · ' + escapeHtml(v.data_viagem) : ''}
        </div>
        <div class="text-xs mt-1">
          <span class="inline-block px-2 py-0.5 rounded-full ${statusBadge(v.status)}">${statusLabel(v.status)}</span>
          <span class="text-slate-400 ml-2"><i class="fas fa-ticket mr-1"></i>${v.total_passageiros} passagem(ns)</span>
          <span class="text-slate-400 ml-2"><i class="fas fa-user-check mr-1"></i>${v.total_embarcados} a bordo</span>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        ${v.status !== 'encerrada' ? `
          <a href="#/viagem/${v.id}/passagem" class="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-sm text-center">
            <i class="fas fa-ticket mr-1"></i>Passagens
          </a>
          <a href="#/viagem/${v.id}/porta" class="bg-amber-600 hover:bg-amber-700 text-white px-3 py-2 rounded-lg text-sm text-center">
            <i class="fas fa-door-open mr-1"></i>Embarque na porta
          </a>
          <a href="#/viagem/${v.id}/parada" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-sm text-center">
            <i class="fas fa-map-marker-alt mr-1"></i>Conferir parada
          </a>
          <button data-id="${v.id}" data-nome="${escapeHtml(v.nome)}" class="btn-encerrar-viagem bg-red-600/80 hover:bg-red-600 text-white px-3 py-2 rounded-lg text-sm">
            <i class="fas fa-flag-checkered mr-1"></i>Encerrar viagem
          </button>
        ` : `
          <span class="text-slate-500 text-sm italic px-2 py-2">
            <i class="fas fa-check-double mr-1"></i>Viagem encerrada — dados dos passageiros removidos
          </span>
        `}
      </div>
    </div>
  `).join('');

  listaEl.querySelectorAll('.btn-encerrar-viagem').forEach(btn => {
    btn.addEventListener('click', async () => {
      const nome = btn.dataset.nome;
      const confirmado = confirm(
        `Encerrar a viagem "${nome}"?\n\nIsso irá EXCLUIR os dados (rostos cadastrados) de todos os passageiros desta viagem. Essa ação não pode ser desfeita.`
      );
      if (!confirmado) return;
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Encerrando...';
      try {
        const result = await api(`/viagens/${btn.dataset.id}/encerrar`, { method: 'POST' });
        falar(`Viagem encerrada. Dados de ${result.passageiros_removidos} passageiros removidos.`);
        await renderHome();
      } catch (err) {
        alert('Erro ao encerrar viagem: ' + err.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-flag-checkered mr-1"></i>Encerrar viagem';
      }
    });
  });
}

function statusBadge(status) {
  if (status === 'aberta') return 'bg-blue-500/20 text-blue-300';
  if (status === 'embarque_concluido') return 'bg-emerald-500/20 text-emerald-300';
  if (status === 'encerrada') return 'bg-slate-500/20 text-slate-400';
  return 'bg-slate-500/20 text-slate-300';
}
function statusLabel(status) {
  if (status === 'aberta') return 'Aberta';
  if (status === 'embarque_concluido') return 'Embarque concluído';
  if (status === 'encerrada') return 'Encerrada';
  return status;
}
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------- Tela: Viagem (Passagem / Porta / Parada) ----------------

async function renderViagem(id, modo) {
  currentTrip = await api(`/viagens/${id}`);

  app.innerHTML = `
    <div class="min-h-screen p-4 md:p-6 max-w-3xl mx-auto">
      <a href="#/" class="text-slate-400 hover:text-white text-sm mb-4 inline-block"><i class="fas fa-arrow-left mr-1"></i>Voltar</a>
      <header class="mb-4">
        <h1 class="text-2xl font-bold text-white">${escapeHtml(currentTrip.nome)}</h1>
        <div class="flex gap-2 mt-2 flex-wrap">
          <a href="#/viagem/${id}/passagem" class="px-3 py-1.5 rounded-lg text-sm ${modo === 'passagem' ? 'bg-slate-100 text-slate-900 font-semibold' : 'bg-slate-800 text-slate-300'}">
            <i class="fas fa-ticket mr-1"></i>1. Cadastrar passagem
          </a>
          <a href="#/viagem/${id}/porta" class="px-3 py-1.5 rounded-lg text-sm ${modo === 'porta' ? 'bg-amber-500 text-slate-900 font-semibold' : 'bg-slate-800 text-slate-300'}">
            <i class="fas fa-door-open mr-1"></i>2. Embarque na porta
          </a>
          <a href="#/viagem/${id}/parada" class="px-3 py-1.5 rounded-lg text-sm ${modo === 'parada' ? 'bg-emerald-500 text-slate-900 font-semibold' : 'bg-slate-800 text-slate-300'}">
            <i class="fas fa-map-marker-alt mr-1"></i>3. Conferir parada
          </a>
        </div>
      </header>

      <div id="modo-container"></div>
    </div>
  `;

  if (modo === 'passagem') {
    await renderModoPassagem(id);
  } else if (modo === 'porta') {
    await renderModoPorta(id);
  } else {
    await renderModoParada(id);
  }
}

// ---------------- Modo: Cadastro de Passagem (quem comprou o bilhete) ----------------

async function renderModoPassagem(viagemId) {
  const container = document.getElementById('modo-container');
  container.innerHTML = `
    <div class="bg-slate-800 border border-slate-700 rounded-2xl p-4 mb-4">
      <p class="text-sm text-slate-300 mb-3">
        <i class="fas fa-info-circle text-slate-400 mr-1"></i>
        Cadastre aqui a <strong>passagem de quem comprou o bilhete</strong> (não é a entrada física no
        ônibus ainda). Posicione o rosto do comprador na câmera e clique em <strong>"Cadastrar passagem"</strong>.
        A validação real de embarque acontece na aba <strong>"Embarque na porta"</strong>.
      </p>
      <div id="video-wrap">
        <video id="video" autoplay muted playsinline></video>
        <canvas id="overlay"></canvas>
      </div>
      <div id="status-cam" class="text-center text-sm text-slate-400 mt-2">Iniciando câmera...</div>

      <form id="form-passageiro" class="grid grid-cols-1 md:grid-cols-3 gap-2 mt-4">
        <input required id="input-nome" placeholder="Nome do passageiro" class="col-span-2 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400" />
        <input id="input-assento" placeholder="Assento (opcional)" class="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400" />
        <input id="input-documento" placeholder="CPF/RG (opcional)" class="col-span-3 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400" />
        <button type="submit" id="btn-cadastrar" class="col-span-3 bg-slate-100 hover:bg-white text-slate-900 font-semibold py-2.5 rounded-lg transition">
          <i class="fas fa-ticket mr-2"></i>Cadastrar passagem
        </button>
      </form>
    </div>

    <div class="bg-slate-800 border border-slate-700 rounded-2xl p-4 mb-4">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold text-white"><i class="fas fa-users mr-2 text-slate-400"></i>Passagens cadastradas (<span id="contador-embarcados">0</span>)</h2>
        <a href="#/viagem/${viagemId}/porta" class="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm">
          <i class="fas fa-door-open mr-1"></i>Ir para embarque na porta
        </a>
      </div>
      <div id="lista-embarcados" class="space-y-2 max-h-80 overflow-y-auto"></div>
    </div>
  `;

  videoEl = document.getElementById('video');
  overlayEl = document.getElementById('overlay');
  const statusCam = document.getElementById('status-cam');

  try {
    statusCam.textContent = 'Carregando modelos de reconhecimento facial...';
    await loadModels();
    statusCam.textContent = 'Solicitando acesso à câmera...';
    await startCamera(videoEl);
    statusCam.innerHTML = '<i class="fas fa-video text-emerald-400 mr-1"></i>Câmera ativa';
  } catch (err) {
    statusCam.innerHTML = `<span class="text-red-400"><i class="fas fa-exclamation-triangle mr-1"></i>Erro: ${err.message}</span>`;
  }

  let livePreviewTimer = setInterval(async () => {
    if (!videoEl || videoEl.readyState < 2 || !modelsLoaded) return;
    try {
      const det = await detectSingleFace(videoEl);
      drawDetections(overlayEl, videoEl, det ? [det] : []);
    } catch {}
  }, 400);

  async function atualizarLista() {
    const passageiros = await api(`/viagens/${viagemId}/passageiros`);
    document.getElementById('contador-embarcados').textContent = passageiros.length;
    const listaEl = document.getElementById('lista-embarcados');
    if (passageiros.length === 0) {
      listaEl.innerHTML = `<p class="text-slate-500 text-sm">Nenhuma passagem cadastrada ainda.</p>`;
      return;
    }
    listaEl.innerHTML = passageiros.map(p => `
      <div class="flex items-center justify-between bg-slate-900 border border-slate-700 rounded-lg px-3 py-2">
        <div class="flex items-center gap-2">
          ${p.foto_thumb ? `<img src="${p.foto_thumb}" class="w-8 h-8 rounded-full object-cover" />` : '<div class="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center"><i class="fas fa-user text-slate-400 text-xs"></i></div>'}
          <span class="text-sm text-white">${escapeHtml(p.nome)}</span>
          ${p.assento ? `<span class="text-xs text-slate-500">(${escapeHtml(p.assento)})</span>` : ''}
        </div>
        <button data-id="${p.id}" class="btn-remover text-red-400 hover:text-red-300 text-xs">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `).join('');
    listaEl.querySelectorAll('.btn-remover').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remover esta passagem?')) return;
        await api(`/passageiros/${btn.dataset.id}`, { method: 'DELETE' });
        atualizarLista();
      });
    });
  }
  await atualizarLista();

  document.getElementById('form-passageiro').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('input-nome').value.trim();
    const assento = document.getElementById('input-assento').value.trim();
    const documento = document.getElementById('input-documento').value.trim();
    const btn = document.getElementById('btn-cadastrar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processando...';
    try {
      const det = await detectSingleFace(videoEl);
      if (!det) {
        throw new Error('Nenhum rosto detectado. Posicione o passageiro de frente para a câmera.');
      }
      const descriptor = Array.from(det.descriptor);
      const foto_thumb = captureThumb(videoEl);
      await api(`/viagens/${viagemId}/passageiros`, {
        method: 'POST',
        body: JSON.stringify({ nome, assento, documento, descriptor, foto_thumb }),
      });

      const wrap = document.getElementById('video-wrap');
      wrap.classList.add('scan-flash');
      setTimeout(() => wrap.classList.remove('scan-flash'), 400);

      falar(`Passagem cadastrada para ${nome}`);
      document.getElementById('input-nome').value = '';
      document.getElementById('input-assento').value = '';
      document.getElementById('input-documento').value = '';
      await atualizarLista();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-ticket mr-2"></i>Cadastrar passagem';
    }
  });
}

// ---------------- Modo: Embarque na Porta (validação facial com bloqueio) ----------------

async function renderModoPorta(viagemId) {
  const container = document.getElementById('modo-container');
  container.innerHTML = `
    <div class="bg-slate-800 border border-slate-700 rounded-2xl p-4 mb-4">
      <p class="text-sm text-slate-300 mb-3">
        <i class="fas fa-shield-halved text-amber-400 mr-1"></i>
        Aponte a câmera para cada pessoa entrando no ônibus. Se a passagem for reconhecida, o sistema
        libera e fala <strong>"[Nome] a bordo"</strong>. Se a pessoa <strong>não tiver passagem cadastrada</strong>
        para esta viagem, o sistema fala <strong>"Passageiro não identificado"</strong> e <strong>não libera o embarque</strong>.
      </p>
      <div id="video-wrap">
        <video id="video" autoplay muted playsinline></video>
        <canvas id="overlay"></canvas>
      </div>
      <div id="status-cam" class="text-center text-sm text-slate-400 mt-2">Câmera parada</div>

      <div class="flex gap-2 mt-4">
        <button id="btn-iniciar-porta" class="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2.5 rounded-lg transition">
          <i class="fas fa-play mr-2"></i>Iniciar validação na porta
        </button>
        <button id="btn-concluir-porta" disabled class="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg transition">
          <i class="fas fa-check-circle mr-2"></i>Concluir embarque
        </button>
      </div>
    </div>

    <div id="alerta-negado" class="hidden bg-red-600/20 border border-red-500 rounded-2xl p-4 mb-4 text-center">
      <i class="fas fa-user-slash text-3xl text-red-400 mb-2"></i>
      <p class="font-bold text-red-300">Passageiro não identificado</p>
      <p class="text-sm text-red-300/80">Esta pessoa não possui passagem cadastrada para esta viagem. Embarque não liberado.</p>
    </div>

    <div class="bg-slate-800 border border-slate-700 rounded-2xl p-4">
      <h2 class="font-semibold text-white mb-3">
        <i class="fas fa-door-open mr-2 text-amber-400"></i>
        A bordo (<span id="contador-porta-embarcados">0</span>/<span id="contador-porta-total">0</span>)
      </h2>
      <div id="lista-porta" class="space-y-2 max-h-96 overflow-y-auto"></div>
    </div>
  `;

  videoEl = document.getElementById('video');
  overlayEl = document.getElementById('overlay');
  const statusCam = document.getElementById('status-cam');
  const btnIniciar = document.getElementById('btn-iniciar-porta');
  const btnConcluir = document.getElementById('btn-concluir-porta');
  const alertaNegado = document.getElementById('alerta-negado');

  let passageiros = await api(`/viagens/${viagemId}/passageiros`);
  let faceMatcher = null;
  let unknownStreak = new Map(); // controla tentativas de rostos desconhecidos para não repetir alerta toda hora

  function buildMatcher(lista) {
    const labeled = lista.filter(p => p.descriptor).map(p =>
      new faceapi.LabeledFaceDescriptors(String(p.id), [new Float32Array(JSON.parse(p.descriptor))])
    );
    return labeled.length > 0 ? new faceapi.FaceMatcher(labeled, MATCH_THRESHOLD) : null;
  }

  function renderListaPorta() {
    document.getElementById('contador-porta-total').textContent = passageiros.length;
    document.getElementById('contador-porta-embarcados').textContent = passageiros.filter(p => p.embarcado).length;
    const listaEl = document.getElementById('lista-porta');
    if (passageiros.length === 0) {
      listaEl.innerHTML = `<p class="text-slate-500 text-sm">Nenhuma passagem cadastrada para esta viagem ainda.</p>`;
      return;
    }
    listaEl.innerHTML = passageiros.map(p => `
      <div class="passenger-card flex items-center justify-between bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 ${p.embarcado ? 'presente' : ''}">
        <div class="flex items-center gap-2">
          ${p.foto_thumb ? `<img src="${p.foto_thumb}" class="w-8 h-8 rounded-full object-cover" />` : '<div class="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center"><i class="fas fa-user text-slate-400 text-xs"></i></div>'}
          <span class="text-sm text-white">${escapeHtml(p.nome)}</span>
          ${p.assento ? `<span class="text-xs text-slate-500">(${escapeHtml(p.assento)})</span>` : ''}
        </div>
        <span class="text-xs font-semibold ${p.embarcado ? 'text-emerald-400' : 'text-slate-500'}">
          ${p.embarcado ? '<i class="fas fa-check-circle mr-1"></i>A bordo' : 'Aguardando'}
        </span>
      </div>
    `).join('');
  }
  renderListaPorta();

  function mostrarAlertaNegado() {
    alertaNegado.classList.remove('hidden');
    setTimeout(() => alertaNegado.classList.add('hidden'), 3500);
  }

  btnIniciar.addEventListener('click', async () => {
    btnIniciar.disabled = true;
    btnIniciar.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Preparando...';
    try {
      statusCam.textContent = 'Carregando modelos...';
      await loadModels();
      statusCam.textContent = 'Ativando câmera...';
      await startCamera(videoEl);
      statusCam.innerHTML = '<i class="fas fa-satellite-dish pulse-rec text-amber-400 mr-1"></i>Validando embarque...';

      passageiros = await api(`/viagens/${viagemId}/passageiros`);
      faceMatcher = buildMatcher(passageiros);
      renderListaPorta();
      falar('Validação de embarque iniciada.');

      btnConcluir.disabled = false;
      recentlyMatched.clear();
      unknownStreak.clear();

      scanTimer = setInterval(async () => {
        if (!videoEl || videoEl.readyState < 2) return;
        try {
          const detections = await detectAllFaces(videoEl);
          drawDetections(overlayEl, videoEl, detections);

          for (const det of detections) {
            // Cria uma "chave" aproximada da posição do rosto no quadro, só para
            // evitar repetir o alerta de "não identificado" a cada 900ms para a mesma pessoa parada na câmera.
            const boxKey = Math.round(det.detection.box.x / 40) + '_' + Math.round(det.detection.box.y / 40);

            if (!faceMatcher) {
              // Nenhuma passagem cadastrada nesta viagem ainda: qualquer rosto é "não identificado".
              const lastUnknown = unknownStreak.get(boxKey) || 0;
              if (Date.now() - lastUnknown > 3500) {
                unknownStreak.set(boxKey, Date.now());
                falar('Passageiro não identificado.');
                mostrarAlertaNegado();
                await api(`/viagens/${viagemId}/embarque-negado`, { method: 'POST' });
                const wrap = document.getElementById('video-wrap');
                wrap.style.boxShadow = '0 0 0 6px rgba(239,68,68,0.8)';
                setTimeout(() => { wrap.style.boxShadow = ''; }, 500);
              }
              continue;
            }

            const bestMatch = faceMatcher.findBestMatch(det.descriptor);

            if (bestMatch.label === 'unknown') {
              // Rosto detectado, mas SEM passagem cadastrada para esta viagem -> bloqueia embarque.
              const lastUnknown = unknownStreak.get(boxKey) || 0;
              if (Date.now() - lastUnknown > 3500) {
                unknownStreak.set(boxKey, Date.now());
                falar('Passageiro não identificado.');
                mostrarAlertaNegado();
                await api(`/viagens/${viagemId}/embarque-negado`, { method: 'POST' });
                const wrap = document.getElementById('video-wrap');
                wrap.style.boxShadow = '0 0 0 6px rgba(239,68,68,0.8)';
                setTimeout(() => { wrap.style.boxShadow = ''; }, 500);
              }
              continue;
            }

            // Rosto reconhecido -> tem passagem cadastrada -> libera embarque.
            const passageiroId = bestMatch.label;
            const passageiro = passageiros.find(p => String(p.id) === passageiroId);
            if (!passageiro || passageiro.embarcado) continue;

            const lastTime = recentlyMatched.get(passageiroId) || 0;
            if (Date.now() - lastTime < 3000) continue;
            recentlyMatched.set(passageiroId, Date.now());

            passageiro.embarcado = 1;
            renderListaPorta();
            await api(`/passageiros/${passageiroId}/validar-embarque`, { method: 'POST' });

            const wrap = document.getElementById('video-wrap');
            wrap.classList.add('scan-flash');
            setTimeout(() => wrap.classList.remove('scan-flash'), 400);
            falar(`${passageiro.nome} a bordo`);
          }
        } catch (e) { console.warn('Erro no scan', e); }
      }, AUTO_SCAN_INTERVAL_MS);
    } catch (err) {
      statusCam.innerHTML = `<span class="text-red-400">Erro: ${err.message}</span>`;
    } finally {
      btnIniciar.disabled = false;
      btnIniciar.innerHTML = '<i class="fas fa-play mr-2"></i>Iniciar validação na porta';
    }
  });

  btnConcluir.addEventListener('click', async () => {
    if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
    stopCamera();
    statusCam.textContent = 'Câmera parada';
    btnConcluir.disabled = true;

    const result = await api(`/viagens/${viagemId}/concluir-embarque`, { method: 'POST' });
    const n = result.total_embarcados;
    falar(`Embarque concluído. Foram confirmados ${n} ${n === 1 ? 'passageiro' : 'passageiros'} a bordo.`);
    alert(`Embarque concluído!\n${n} ${n === 1 ? 'passageiro' : 'passageiros'} a bordo.`);
    location.hash = `#/viagem/${viagemId}/parada`;
  });
}

// ---------------- Modo: Parada (conferência via reconhecimento contínuo) ----------------

async function renderModoParada(viagemId) {
  const container = document.getElementById('modo-container');
  container.innerHTML = `
    <div class="bg-slate-800 border border-slate-700 rounded-2xl p-4 mb-4">
      <div class="flex items-center justify-between mb-3">
        <p class="text-sm text-slate-300">
          <i class="fas fa-info-circle text-emerald-400 mr-1"></i>
          Ao chegar de uma parada, clique em <strong>"Iniciar conferência"</strong> e aponte a câmera
          para os passageiros voltando ao ônibus. O sistema reconhece automaticamente cada rosto.
        </p>
      </div>
      <div id="video-wrap">
        <video id="video" autoplay muted playsinline></video>
        <canvas id="overlay"></canvas>
      </div>
      <div id="status-cam" class="text-center text-sm text-slate-400 mt-2">Câmera parada</div>

      <div class="flex gap-2 mt-4">
        <button id="btn-iniciar-parada" class="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 rounded-lg transition">
          <i class="fas fa-play mr-2"></i>Iniciar conferência
        </button>
        <button id="btn-finalizar-parada" disabled class="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg transition">
          <i class="fas fa-stop mr-2"></i>Finalizar e verificar
        </button>
      </div>
    </div>

    <div class="bg-slate-800 border border-slate-700 rounded-2xl p-4">
      <h2 class="font-semibold text-white mb-3">
        <i class="fas fa-clipboard-check mr-2 text-emerald-400"></i>
        Presença (<span id="contador-presentes">0</span>/<span id="contador-total">0</span>)
      </h2>
      <div id="lista-presenca" class="space-y-2 max-h-96 overflow-y-auto"></div>
    </div>
  `;

  videoEl = document.getElementById('video');
  overlayEl = document.getElementById('overlay');
  const statusCam = document.getElementById('status-cam');
  const btnIniciar = document.getElementById('btn-iniciar-parada');
  const btnFinalizar = document.getElementById('btn-finalizar-parada');

  let passageiros = await api(`/viagens/${viagemId}/passageiros`);
  passageiros = passageiros.filter(p => p.embarcado);
  let faceMatcher = null;

  function buildMatcher(lista) {
    const labeled = lista
      .filter(p => p.descriptor)
      .map(p => new faceapi.LabeledFaceDescriptors(
        String(p.id),
        [new Float32Array(JSON.parse(p.descriptor))]
      ));
    return labeled.length > 0 ? new faceapi.FaceMatcher(labeled, MATCH_THRESHOLD) : null;
  }

  function renderListaPresenca() {
    document.getElementById('contador-total').textContent = passageiros.length;
    document.getElementById('contador-presentes').textContent = passageiros.filter(p => p.presente_parada).length;
    const listaEl = document.getElementById('lista-presenca');
    if (passageiros.length === 0) {
      listaEl.innerHTML = `<p class="text-slate-500 text-sm">Nenhum passageiro embarcado nesta viagem.</p>`;
      return;
    }
    listaEl.innerHTML = passageiros.map(p => `
      <div class="passenger-card flex items-center justify-between bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 ${p.presente_parada ? 'presente' : ''}">
        <div class="flex items-center gap-2">
          ${p.foto_thumb ? `<img src="${p.foto_thumb}" class="w-8 h-8 rounded-full object-cover" />` : '<div class="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center"><i class="fas fa-user text-slate-400 text-xs"></i></div>'}
          <span class="text-sm text-white">${escapeHtml(p.nome)}</span>
          ${p.assento ? `<span class="text-xs text-slate-500">(${escapeHtml(p.assento)})</span>` : ''}
        </div>
        <span class="text-xs font-semibold ${p.presente_parada ? 'text-emerald-400' : 'text-slate-500'}">
          ${p.presente_parada ? '<i class="fas fa-check-circle mr-1"></i>Presente' : 'Aguardando'}
        </span>
      </div>
    `).join('');
  }
  renderListaPresenca();

  btnIniciar.addEventListener('click', async () => {
    btnIniciar.disabled = true;
    btnIniciar.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Preparando...';
    try {
      statusCam.textContent = 'Carregando modelos...';
      await loadModels();
      statusCam.textContent = 'Ativando câmera...';
      await startCamera(videoEl);
      statusCam.innerHTML = '<i class="fas fa-satellite-dish pulse-rec text-emerald-400 mr-1"></i>Reconhecendo rostos...';

      await api(`/viagens/${viagemId}/iniciar-parada`, { method: 'POST' });
      passageiros = await api(`/viagens/${viagemId}/passageiros`);
      passageiros = passageiros.filter(p => p.embarcado);
      passageiros.forEach(p => p.presente_parada = 0);
      faceMatcher = buildMatcher(passageiros);
      renderListaPresenca();
      falar('Conferência iniciada. Aguardando passageiros.');

      btnFinalizar.disabled = false;
      recentlyMatched.clear();

      scanTimer = setInterval(async () => {
        if (!videoEl || videoEl.readyState < 2 || !faceMatcher) return;
        try {
          const detections = await detectAllFaces(videoEl);
          drawDetections(overlayEl, videoEl, detections);

          for (const det of detections) {
            const bestMatch = faceMatcher.findBestMatch(det.descriptor);
            if (bestMatch.label === 'unknown') continue;
            const passageiroId = bestMatch.label;
            const passageiro = passageiros.find(p => String(p.id) === passageiroId);
            if (!passageiro || passageiro.presente_parada) continue;

            const lastTime = recentlyMatched.get(passageiroId) || 0;
            if (Date.now() - lastTime < 3000) continue;
            recentlyMatched.set(passageiroId, Date.now());

            passageiro.presente_parada = 1;
            renderListaPresenca();
            await api(`/passageiros/${passageiroId}/marcar-presente`, { method: 'POST' });

            const wrap = document.getElementById('video-wrap');
            wrap.classList.add('scan-flash');
            setTimeout(() => wrap.classList.remove('scan-flash'), 400);
            falar(`${passageiro.nome} confirmado`);
          }
        } catch (e) {
          console.warn('Erro no scan', e);
        }
      }, AUTO_SCAN_INTERVAL_MS);
    } catch (err) {
      statusCam.innerHTML = `<span class="text-red-400">Erro: ${err.message}</span>`;
    } finally {
      btnIniciar.disabled = false;
      btnIniciar.innerHTML = '<i class="fas fa-play mr-2"></i>Iniciar conferência';
    }
  });

  btnFinalizar.addEventListener('click', async () => {
    if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
    stopCamera();
    statusCam.textContent = 'Câmera parada';
    btnFinalizar.disabled = true;

    const result = await api(`/viagens/${viagemId}/conferencia-parada`);
    const faltando = result.faltando;

    await api(`/viagens/${viagemId}/finalizar-parada`, {
      method: 'POST',
      body: JSON.stringify({ faltando: faltando.map(p => p.nome) }),
    });

    if (faltando.length === 0) {
      falar(`Todos os ${result.total} passageiros estão presentes. Pode seguir viagem.`);
      showResultModal(true, result.total, []);
    } else {
      const nomes = faltando.map(p => p.nome).join(', ');
      const txt = faltando.length === 1
        ? `Atenção! Está faltando o passageiro ${nomes}.`
        : `Atenção! Estão faltando ${faltando.length} passageiros: ${nomes}.`;
      falar(txt);
      showResultModal(false, result.total, faltando);
    }
  });
}

function showResultModal(tudoOk, total, faltando) {
  const modal = el(`
    <div class="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div class="bg-slate-800 border ${tudoOk ? 'border-emerald-500' : 'border-red-500'} rounded-2xl p-6 max-w-sm w-full text-center">
        <i class="fas ${tudoOk ? 'fa-check-circle text-emerald-400' : 'fa-exclamation-triangle text-red-400'} text-5xl mb-4"></i>
        <h2 class="text-xl font-bold text-white mb-2">${tudoOk ? 'Tudo certo!' : 'Passageiro(s) faltando!'}</h2>
        <p class="text-slate-300 text-sm mb-4">
          ${tudoOk
            ? `Todos os ${total} passageiros estão presentes. Pode seguir viagem.`
            : `${faltando.length} de ${total} passageiro(s) não retornaram ao ônibus:`}
        </p>
        ${!tudoOk ? `<ul class="text-left bg-slate-900 rounded-lg p-3 mb-4 text-sm text-red-300 space-y-1">
          ${faltando.map(p => `<li><i class="fas fa-user-times mr-2"></i>${escapeHtml(p.nome)}${p.assento ? ' (' + escapeHtml(p.assento) + ')' : ''}</li>`).join('')}
        </ul>` : ''}
        <button id="btn-fechar-modal" class="w-full bg-slate-700 hover:bg-slate-600 text-white py-2.5 rounded-lg font-semibold">Fechar</button>
      </div>
    </div>
  `);
  document.body.appendChild(modal);
  modal.querySelector('#btn-fechar-modal').addEventListener('click', () => modal.remove());
}
