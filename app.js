"use strict";


// ──────────── API KEY CLAUDE (localStorage, nunca hardcodeada) ────────────
function getClaudeKey() { return localStorage.getItem("ecoia_claude_key") || ""; }
// Proxy local para evitar CORS — el servidor reenvía a api.anthropic.com
const CLAUDE_URL   = "/api/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";

// ──────────── ESTADO GLOBAL ────────────
const STATE = {
  tfModel:        null,
  tfReady:        false,
  selectedFile:   null,
  imageBase64:    null,
  imageMediaType: "image/jpeg",
  tfPredictions:  [],
  lastResult:     null,
  isAnalyzing:    false,
};

// ──────────── DOM HELPERS ────────────
const $  = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// ──────────── PANTALLAS ────────────
const SCREENS = {
  splash:   $("screenSplash"),
  upload:   $("screenUpload"),
  loading:  $("screenLoading"),
  results:  $("screenResults"),
};

let currentScreen = "splash";

function showScreen(name, opts = {}) {
  const prev = SCREENS[currentScreen];
  const next = SCREENS[name];
  if (!next || currentScreen === name) return;

  prev.classList.add("exit");
  setTimeout(() => {
    prev.classList.remove("active", "exit");
    prev.style.display = "";
  }, 500);

  next.style.display = "flex";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      next.classList.add("active");
      if (opts.scrollTop) next.scrollTop = 0;
    });
  });

  currentScreen = name;
}

// ──────────── CURSOR PERSONALIZADO ────────────
(function initCursor() {
  const cursor   = $("cursor");
  const follower = $("cursorFollower");
  if (!cursor || !follower) return;
  if (window.matchMedia("(pointer: coarse)").matches) {
    cursor.style.display = follower.style.display = "none";
    return;
  }

  let fX = 0, fY = 0, mX = 0, mY = 0;

  document.addEventListener("mousemove", (e) => {
    mX = e.clientX; mY = e.clientY;
    cursor.style.left = mX + "px";
    cursor.style.top  = mY + "px";
  });

  function animFollower() {
    fX += (mX - fX) * 0.15;
    fY += (mY - fY) * 0.15;
    follower.style.left = fX + "px";
    follower.style.top  = fY + "px";
    requestAnimationFrame(animFollower);
  }
  animFollower();

  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest("button, a, [data-hover], .drop-zone, .nav-pill");
    document.body.classList.toggle("cursor-hover", !!el);
  });
})();

// ──────────── PARTÍCULAS ────────────
(function initParticles() {
  const container = $("particles");
  if (!container) return;
  for (let i = 0; i < 18; i++) {
    const p = document.createElement("div");
    p.className = "particle";
    const size = Math.random() * 3 + 1;
    p.style.cssText = `
      width:${size}px; height:${size}px;
      left:${Math.random() * 100}%;
      animation-duration:${12 + Math.random() * 20}s;
      animation-delay:${-Math.random() * 20}s;
    `;
    container.appendChild(p);
  }
})();

// ──────────── TOAST ────────────
let _toastTimer = null;
function toast(msg, type = "info", duration = 3500) {
  const el   = $("toast");
  const icon = $("toastIcon");
  const txt  = $("toastMsg");

  const icons = { success: "✓", error: "✕", info: "ℹ", warn: "⚠" };
  icon.textContent = icons[type] || "ℹ";
  txt.textContent  = msg;

  el.className = `toast show ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("show"), duration);
}

// ──────────── TENSORFLOW.JS ────────────
async function loadTFModel() {
  const ring   = document.querySelector(".status-ring");
  const navTxt = $("navStatusText");
  const barLbl = $("modelBarLabel");
  const barFill = $("modelBarFill");

  try {
    ring.className   = "status-ring loading";
    navTxt.textContent = "Cargando modelo...";
    barLbl.textContent = "Cargando TensorFlow.js MobileNet V2...";

    STATE.tfModel = await mobilenet.load({ version: 2, alpha: 1.0 });

    STATE.tfReady = true;
    ring.className   = "status-ring ready";
    navTxt.textContent = "Sistema listo";
    barLbl.textContent = "✓ MobileNet V2 — Listo";
    barFill.classList.add("loaded");
    barFill.style.width = "100%";

    const iconEl = $("modelBarIcon");
    iconEl.innerHTML = "";
    iconEl.className = "model-bar-icon done";

    // Enable button if image already loaded
    checkReadyToAnalyze();
    toast("TensorFlow.js listo ✓", "success");
  } catch (err) {
    console.error("Error cargando TF:", err);
    ring.className = "status-ring error";
    navTxt.textContent = "Error de carga";
    barLbl.textContent = "⚠ Error al cargar modelo";
    toast("Error cargando TensorFlow.js", "error");
  }
}

function checkReadyToAnalyze() {
  const btn = $("btnAnalyze");
  if (!btn) return;
  const ready = STATE.tfReady && !!STATE.imageBase64;
  btn.disabled = !ready;
}

// ──────────── DRAG & DROP / FILE INPUT ────────────
(function initFileHandling() {
  const dropZone = $("dropZone");
  const fileInput = $("fileInput");
  if (!dropZone || !fileInput) return;

  // Click on drop zone
  dropZone.addEventListener("click", (e) => {
    if (!$("dropPreview").style.display || $("dropPreview").style.display === "none") {
      fileInput.click();
    }
  });

  // Drag events
  dropZone.addEventListener("dragenter", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
  dropZone.addEventListener("dragover",  (e) => { e.preventDefault(); });
  dropZone.addEventListener("dragleave", (e) => { dropZone.classList.remove("dragover"); });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleFile(file);
    else toast("Solo se permiten imágenes (JPG, PNG, WEBP)", "error");
  });

  // File input change
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
    e.target.value = "";
  });
})();

function handleFile(file) {
  if (file.size > 10 * 1024 * 1024) {
    toast("Imagen demasiado grande (máx. 10 MB)", "error");
    return;
  }

  const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!validTypes.includes(file.type)) {
    toast("Formato no soportado. Usa JPG, PNG o WEBP", "error");
    return;
  }

  STATE.selectedFile   = file;
  // Siempre guardamos como JPEG comprimido para Gemini
  STATE.imageMediaType = "image/jpeg";

  const reader = new FileReader();
  reader.onload = (e) => {
    const fullDataUrl = e.target.result;

    // Mostrar preview con la imagen original (calidad visual)
    const previewImg = $("previewImg");
    const inner      = $("dropZoneInner");
    const preview    = $("dropPreview");
    previewImg.src       = fullDataUrl;
    inner.style.display  = "none";
    preview.style.display = "block";

    // Comprimir imagen antes de guardar en STATE (para enviar a Gemini)
    compressImage(fullDataUrl, 900, 0.78, (compressedBase64) => {
      STATE.imageBase64 = compressedBase64;
      checkReadyToAnalyze();

      // Mostrar tamaño original vs comprimido en consola
      const origKB     = Math.round(e.target.result.length * 0.75 / 1024);
      const compressKB = Math.round(compressedBase64.length * 0.75 / 1024);
      console.log(`%c[EcoIA] Imagen: ${origKB} KB → ${compressKB} KB (${Math.round(compressKB/origKB*100)}%)`,
        "color:#a3e635;font-weight:bold");
      toast(`Imagen lista — ${compressKB} KB ✓`, "success");
    });
  };
  reader.readAsDataURL(file);
}

/**
 * Comprime una imagen a JPEG usando Canvas.
 * @param {string} dataUrl   - Data URL original
 * @param {number} maxSize   - Dimensión máxima (px) del lado más largo
 * @param {number} quality   - Calidad JPEG 0–1
 * @param {function} cb      - Callback(base64SinPrefix)
 */
function compressImage(dataUrl, maxSize, quality, cb) {
  const img = new Image();
  img.onload = () => {
    let { width, height } = img;

    // Escalar si excede maxSize
    if (width > maxSize || height > maxSize) {
      if (width >= height) {
        height = Math.round(height * maxSize / width);
        width  = maxSize;
      } else {
        width  = Math.round(width * maxSize / height);
        height = maxSize;
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width  = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);

    const compressed = canvas.toDataURL("image/jpeg", quality);
    cb(compressed.split(",")[1]);
  };
  img.onerror = () => {
    // Fallback: usar imagen original sin comprimir
    console.warn("[EcoIA] No se pudo comprimir, usando original");
    cb(dataUrl.split(",")[1]);
  };
  img.src = dataUrl;
}

function removeImage() {
  STATE.selectedFile   = null;
  STATE.imageBase64    = null;
  STATE.tfPredictions  = [];

  const inner   = $("dropZoneInner");
  const preview = $("dropPreview");

  $("previewImg").src     = "";
  inner.style.display     = "flex";
  preview.style.display   = "none";

  $("tfPanel").style.display = "none";
  $("tfBars").innerHTML      = "";

  checkReadyToAnalyze();
}

// Bind remove button
document.addEventListener("DOMContentLoaded", () => {
  const btnRemove = $("btnRemoveImg");
  if (btnRemove) {
    btnRemove.addEventListener("click", (e) => {
      e.stopPropagation();
      removeImage();
    });
  }
});

// ──────────── TENSORFLOW CLASSIFY ────────────
async function runTensorFlow() {
  if (!STATE.tfModel || !STATE.imageBase64) return [];

  const img    = $("previewImg");
  const canvas = $("hiddenCanvas");
  const ctx    = canvas.getContext("2d");

  canvas.width  = 224;
  canvas.height = 224;
  ctx.drawImage(img, 0, 0, 224, 224);

  const preds = await STATE.tfModel.classify(canvas, 5);
  STATE.tfPredictions = preds;

  // Render TF bars in upload screen
  renderTFBars(preds, "tfBars");
  $("tfPanel").style.display = "block";

  return preds;
}

function renderTFBars(preds, containerId) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = preds.map(p => `
    <div class="tf-bar-item">
      <div class="tf-bar-label">
        <span>${p.className.split(",")[0].trim()}</span>
        <span class="pct">${(p.probability * 100).toFixed(1)}%</span>
      </div>
      <div class="tf-bar-track">
        <div class="tf-bar-fill" style="width:${p.probability * 100}%"></div>
      </div>
    </div>
  `).join("");
}

// ──────────── GEMINI API ────────────
async function callClaude(imageBase64, mediaType, tfContext, retries = 4) {
  const tfInfo = tfContext.length > 0
    ? "TensorFlow MobileNet detecto: " + tfContext.map(p => p.className + " (" + (p.probability*100).toFixed(1) + "%)").join(", ") + "."
    : "";

  // Prompt separado del template literal para evitar conflictos de caracteres
  const promptLines = [
    "Eres un experto en fitopatologia y entomologia agricola.",
    "Analiza la imagen de la planta. Detecta plagas, mordidas, manchas, telaranas, hongos o insectos visibles.",
    tfInfo,
    "",
    "IMPORTANTE: Responde SOLO con JSON valido. Sin texto antes ni despues. Sin markdown. Sin comentarios.",
    "",
    'Usa exactamente esta estructura (reemplaza los valores de ejemplo):',
    '{',
    '  "hayPlaga": true,',
    '  "confianza": 90,',
    '  "nombrePlaga": "Pulgon negro",',
    '  "nombreCientifico": "Aphis fabae",',
    '  "orden": "Hemiptera",',
    '  "descripcionDano": "Colonias en tallos y hojas jovenes causando deformacion",',
    '  "severidad": 3,',
    '  "caracteristicas": {',
    '    "tamano": "1-3 mm",',
    '    "color": "Negro brillante",',
    '    "tipo": "Hemiptero",',
    '    "alimentacion": "Savia de tallos y hojas",',
    '    "reproduccion": "Partenogenesis, muy rapida",',
    '    "habitat": "Envés de hojas y tallos tiernos",',
    '    "cicloVida": "7-10 dias por generacion",',
    '    "plantasAfectadas": "Habas, remolacha, girasol",',
    '    "estacion": "Primavera-verano",',
    '    "vectorEnfermedades": "Virus del mosaico"',
    '  },',
    '  "diagnosticoCompleto": "Descripcion experta en 4 oraciones sobre la plaga, su impacto y riesgo.",',
    '  "tratamientos": [',
    '    { "icono": "BIO", "nombre": "Control Biologico", "descripcion": "Usar crisopas o mariquitas como depredadores." },',
    '    { "icono": "QUI", "nombre": "Control Quimico", "descripcion": "Aplicar imidacloprid 0.5ml/L o pirimicarb." },',
    '    { "icono": "CUL", "nombre": "Control Cultural", "descripcion": "Eliminar hormigas que protegen la colonia." },',
    '    { "icono": "INM", "nombre": "Accion Inmediata", "descripcion": "Retirar colonias con chorro de agua a presion." },',
    '    { "icono": "MON", "nombre": "Monitoreo", "descripcion": "Revisar envés de hojas cada 3 dias." }',
    '  ],',
    '  "diagramaTipo": "aphid",',
    '  "alertaNivel": "alto",',
    '  "notaExperto": "Consejo profesional adicional."',
    '}',
    "",
    "Para diagramaTipo usa uno de: aphid, whitefly, spider_mite, caterpillar, thrip, beetle, fungus_gnat, leafminer, mealybug, scale, generic",
    "Para alertaNivel usa: bajo, medio, alto o critico",
    "Si no hay plaga visible pon hayPlaga false y confianza menor a 30."
  ];

  const prompt = promptLines.join("\n");

  for (let intento = 1; intento <= retries; intento++) {
    const key = getClaudeKey();
    if (!key) throw new Error("No hay API Key de Claude. Configúrala en el modal.");
    console.log(`%c[EcoIA] Claude intento ${intento}/${retries} | Key: sk-...${key.slice(-6)} | Img: ${Math.round(imageBase64.length * 0.75 / 1024)} KB`, "color:#a3e635");

    const resp = await fetch(CLAUDE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        _apiKey:    key,          // el proxy lo extrae y lo manda en el header
        model:      CLAUDE_MODEL,
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
            { type: "text", text: prompt }
          ]
        }]
      })
    });

    // Rate limit 429
    if (resp.status === 429) {
      if (intento >= retries) throw new Error("Límite de Claude alcanzado. Espera un momento.");
      const retryAfter = parseInt(resp.headers.get("retry-after") || "20");
      const waitSecs   = retryAfter + Math.round(Math.random() * 3);
      showRateLimitCountdown(waitSecs, intento, retries);
      await countdownDelay(waitSecs * 1000);
      hideRateLimitCountdown();
      continue;
    }

    if (!resp.ok) {
      let errBody = {};
      try { errBody = await resp.json(); } catch (_) {}
      const msg    = errBody?.error?.message || "";
      const status = resp.status;
      if (status === 401) throw new Error("API Key de Claude inválida (401). Cópiala completa desde console.anthropic.com.");
      if (status === 403) throw new Error("Sin permisos (403). Verifica que tu cuenta tiene saldo.");
      if (status === 400) throw new Error(`Error en la petición (400): ${msg || "Intenta con otra imagen."}`);
      throw new Error(msg || `Error HTTP ${status}`);
    }

    const data = await resp.json();
    const raw  = data?.content?.[0]?.text;
    if (!raw) throw new Error("Respuesta vacia de Claude. Intenta de nuevo.");

    console.log("%c[EcoIA] Respuesta raw de Claude:", "color:#86efac", raw.slice(0, 200));
    return parseClaudeJSON(raw);
  }
}

// ──────────── PARSER ROBUSTO JSON ────────────
function parseClaudeJSON(raw) {
  // Paso 1: limpiar backticks de markdown
  var text = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

  // Paso 2: intento directo
  try { return JSON.parse(text); } catch(e) {}

  // Paso 3: extraer bloque { } contando llaves
  var first = text.indexOf("{");
  if (first !== -1) {
    var depth = 0, last = -1;
    for (var i = first; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) { last = i; break; }
      }
    }
    if (last !== -1) {
      var block = text.slice(first, last + 1);

      // Paso 4: intento con bloque extraido
      try { return JSON.parse(block); } catch(e) {}

      // Paso 5: limpiar trailing commas con split/join (sin regex compleja)
      var fixed = block;
      fixed = fixed.split(",}").join("}");
      fixed = fixed.split(",]").join("]");
      fixed = fixed.split(",\n}").join("}");
      fixed = fixed.split(",\n]").join("]");

      try { return JSON.parse(fixed); } catch(e) {}
    }
  }

  // Paso 6: fallback — extraer campos uno por uno sin regex compleja
  console.warn("[EcoIA] JSON muy roto, modo fallback manual");

  function getStr(key) {
    var tag   = '"' + key + '":';
    var idx   = raw.indexOf(tag);
    if (idx === -1) { tag = '"' + key + '": '; idx = raw.indexOf(tag); }
    if (idx === -1) return null;
    var after = raw.slice(idx + tag.length).trim();
    if (after[0] !== '"') return null;
    var val = "";
    for (var i = 1; i < after.length; i++) {
      if (after[i] === '"' && after[i-1] !== "\\") break;
      val += after[i];
    }
    return val || null;
  }

  function getBool(key) {
    var tag = '"' + key + '":';
    var idx = raw.indexOf(tag);
    if (idx === -1) { tag = '"' + key + '": '; idx = raw.indexOf(tag); }
    if (idx === -1) return true;
    var after = raw.slice(idx + tag.length).trim();
    return after.indexOf("true") === 0;
  }

  function getNum(key) {
    var tag = '"' + key + '":';
    var idx = raw.indexOf(tag);
    if (idx === -1) { tag = '"' + key + '": '; idx = raw.indexOf(tag); }
    if (idx === -1) return 50;
    var after = raw.slice(idx + tag.length).trim();
    var num   = parseInt(after);
    return isNaN(num) ? 50 : num;
  }

  return {
    hayPlaga:           getBool("hayPlaga"),
    confianza:          getNum("confianza"),
    nombrePlaga:        getStr("nombrePlaga")        || "Plaga detectada",
    nombreCientifico:   getStr("nombreCientifico")   || "",
    orden:              getStr("orden")              || "",
    descripcionDano:    getStr("descripcionDano")    || "Dano visible en la planta",
    severidad:          getNum("severidad"),
    caracteristicas: {
      tamano:             getStr("tamano")           || "",
      color:              getStr("color")            || "",
      tipo:               getStr("tipo")             || "",
      alimentacion:       getStr("alimentacion")     || "",
      reproduccion:       getStr("reproduccion")     || "",
      habitat:            getStr("habitat")          || "",
      cicloVida:          getStr("cicloVida")        || "",
      plantasAfectadas:   getStr("plantasAfectadas") || "",
      estacion:           getStr("estacion")         || "",
      vectorEnfermedades: getStr("vectorEnfermedades") || "",
    },
    diagnosticoCompleto: getStr("diagnosticoCompleto") || "Analisis completado.",
    tratamientos: [
      { icono: "BIO", nombre: "Control Biologico", descripcion: "Usar depredadores naturales." },
      { icono: "QUI", nombre: "Control Quimico",   descripcion: "Consultar productos disponibles." },
      { icono: "CUL", nombre: "Control Cultural",  descripcion: "Aplicar practicas preventivas." },
      { icono: "INM", nombre: "Accion Inmediata",  descripcion: "Aislar la planta afectada." },
      { icono: "MON", nombre: "Monitoreo",         descripcion: "Revisar cada 3 dias." },
    ],
    diagramaTipo: getStr("diagramaTipo") || "generic",
    alertaNivel:  getStr("alertaNivel")  || "medio",
    notaExperto:  getStr("notaExperto")  || "",
  };
}

// ──────────── LOADING STEPS ────────────
const STEPS = [
  { text: "Preprocesando imagen...",           pct: 12 },
  { text: "Clasificando con TensorFlow.js...", pct: 35 },
  { text: "Enviando a Claude Vision AI...",     pct: 55 },
  { text: "Diagnosticando con Claude AI...",    pct: 75 },
  { text: "Generando plan de tratamiento...",   pct: 90 },
  { text: "Compilando resultados...",           pct: 100 },
];

let _stepIdx = 0;
let _stepTimer = null;

function startLoadingSteps() {
  _stepIdx = 0;
  updateLoadingStep(0);
}

function updateLoadingStep(idx) {
  const el   = $("loadingStep");
  const fill = $("loadingFill");

  // Si es string, mostrarlo directo (mensajes de reintento)
  if (typeof idx === 'string') {
    if (el) el.textContent = idx;
    return;
  }

  // Si es número, usar el array STEPS normal
  const step = STEPS[Math.min(idx, STEPS.length - 1)];
  if (!step) return;

  if (el)   el.textContent  = step.text;
  if (fill) fill.style.width = step.pct + "%";
}
function advanceStep() {
  if (_stepIdx < STEPS.length - 1) {
    _stepIdx++;
    updateLoadingStep(_stepIdx);
  }
}

// ──────────── MAIN ANALYSIS ────────────
async function startAnalysis() {
  if (STATE.isAnalyzing)  return;
  if (!STATE.imageBase64) { toast("Primero sube una imagen", "error"); return; }
  if (!STATE.tfReady)     { toast("Espera a que cargue el modelo TensorFlow", "warn"); return; }

  if (!getClaudeKey()) {
    openApikeyModal();
    toast("⚠ Primero configura tu API Key de Claude", "error", 5000);
    return;
  }

  STATE.isAnalyzing = true;

  // Update button UI
  const btn     = $("btnAnalyze");
  const btnText = btn.querySelector(".btn-analyze-text");
  const btnLoad = btn.querySelector(".btn-analyze-loader");
  btnText.style.display = "none";
  btnLoad.style.display = "flex";
  btn.disabled          = true;

  // Switch to loading screen
  showScreen("loading");
  startLoadingSteps();

  try {
    // Step 1: TensorFlow
    _stepTimer = setInterval(advanceStep, 1200);

    const tfResults = await runTensorFlow();
    advanceStep();

    // Step 2: Gemini
    // imageMediaType es siempre "image/jpeg" tras la compresión con canvas
    const result = await callClaude(STATE.imageBase64, "image/jpeg", tfResults);
    STATE.lastResult = result;

    clearInterval(_stepTimer);
    updateLoadingStep(STEPS.length - 1);

    await new Promise(r => setTimeout(r, 600));

    // Render results
    renderResults(result);
    showScreen("results", { scrollTop: true });

  } catch (err) {
    clearInterval(_stepTimer);
    console.error("Error análisis:", err);
    toast("Error: " + (err.message || "Intenta de nuevo"), "error", 6000);
    showScreen("upload");
  } finally {
    STATE.isAnalyzing     = false;
    btnText.style.display = "flex";
    btnLoad.style.display = "none";
    btn.disabled          = false;
    checkReadyToAnalyze();
  }
}

// ──────────── RENDER RESULTS ────────────
function renderResults(data) {
  const container = $("resultsLayout");
  if (!container) return;

  if (!data.hayPlaga) {
    container.innerHTML = renderNoPest(data);
    return;
  }

  const sev   = Math.max(1, Math.min(5, parseInt(data.severidad) || 3));
  const chars = data.caracteristicas || {};
  const txts  = data.tratamientos    || [];

  container.innerHTML = `
    <!-- ═ HEADER ═ -->
    <div class="results-header">
      <div class="results-header-left">
        <div class="results-badge">
          <div class="results-badge-dot"></div>
          Plaga identificada — ${data.alertaNivel ? data.alertaNivel.toUpperCase() : "DETECTADA"}
        </div>
        <h1 class="results-pest-name">${escHtml(data.nombrePlaga || "Plaga detectada")}</h1>
        <p class="results-sci-name">${escHtml(data.nombreCientifico || "")}${data.orden ? " — " + escHtml(data.orden) : ""}</p>
      </div>
      <div class="severity-block">
        <span class="severity-label">Nivel de severidad</span>
        <div class="severity-pips">
          ${Array.from({length:5}, (_,i) => `<div class="pip${i < sev ? ` active-${sev}` : ""}"></div>`).join("")}
        </div>
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--text-3);">${getSeverityText(sev)}</span>
      </div>
    </div>

    <!-- ═ MAIN GRID ═ -->
    <div class="results-main-grid">

      <!-- Diagrama insecto -->
      <div class="diagram-card">
        <div class="card-header">Diagrama del insecto</div>
        <div class="insect-display">
          ${getInsectSVG(data.diagramaTipo || "generic")}
          <div class="insect-meta">
            <div class="insect-common-name">${escHtml(data.nombrePlaga || "")}</div>
            <div class="insect-sci">${escHtml(data.nombreCientifico || "")}</div>
          </div>
        </div>
      </div>

      <!-- Características -->
      <div class="chars-card">
        <div class="card-header">Características biológicas</div>
        <div class="chars-grid">
          ${renderCharCell("📏", "Tamaño", chars.tamano)}
          ${renderCharCell("🎨", "Color", chars.color)}
          ${renderCharCell("🐛", "Tipo", chars.tipo)}
          ${renderCharCell("🍃", "Alimentación", chars.alimentacion)}
          ${renderCharCell("🔄", "Reproducción", chars.reproduccion)}
          ${renderCharCell("🏠", "Hábitat", chars.habitat)}
          ${renderCharCell("⏱️", "Ciclo de vida", chars.cicloVida)}
          ${renderCharCell("🌱", "Plantas afectadas", chars.plantasAfectadas)}
          ${renderCharCell("🌡️", "Estación activa", chars.estacion)}
          ${renderCharCell("⚠️", "Vector", chars.vectorEnfermedades || "No documentado")}
        </div>
      </div>
    </div>

    <!-- ═ DIAGNÓSTICO ═ -->
    <div class="diagnosis-card">
      <div class="card-header">Diagnóstico detallado</div>
      <div class="diagnosis-body">
        ${data.descripcionDano ? `
          <div class="diagnosis-damage">
            <div class="diagnosis-damage-icon">🔍</div>
            <div class="diagnosis-damage-text">
              <strong>Daño observado en la imagen:</strong> ${escHtml(data.descripcionDano)}
            </div>
          </div>
        ` : ""}
        <div class="diagnosis-paragraphs">
          ${renderDiagnosisParagraphs(data.diagnosticoCompleto || "")}
        </div>
        ${data.notaExperto ? `
          <div style="margin-top:20px;padding:16px 20px;background:rgba(163,230,53,0.05);border:1px solid rgba(163,230,53,0.15);border-radius:12px;">
            <div style="font-family:var(--font-mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--lime);margin-bottom:8px;">💡 Nota del experto</div>
            <p style="font-size:13px;color:var(--text-2);line-height:1.7;">${escHtml(data.notaExperto)}</p>
          </div>
        ` : ""}
      </div>
    </div>

    <!-- ═ TF ANALYSIS ═ -->
    ${STATE.tfPredictions.length > 0 ? `
    <div class="tf-detail-section">
      <div class="card-header">Análisis TensorFlow.js — Top predicciones</div>
      <div class="tf-detail-body">
        ${STATE.tfPredictions.map(p => `
          <div class="tf-bar-item">
            <div class="tf-bar-label">
              <span>${escHtml(p.className.split(",")[0].trim())}</span>
              <span class="pct">${(p.probability * 100).toFixed(2)}%</span>
            </div>
            <div class="tf-bar-track">
              <div class="tf-bar-fill" style="width:${p.probability * 100}%"></div>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
    ` : ""}

    <!-- ═ TRATAMIENTOS ═ -->
    <div class="treatments-section">
      <div class="card-header" style="margin-bottom:4px;">Plan de control y tratamiento</div>
      <div class="treatments-grid">
        ${txts.map(t => `
          <div class="treatment-card">
            <span class="treatment-card-icon">${t.icono || "🔬"}</span>
            <h4 class="treatment-card-name">${escHtml(t.nombre || "")}</h4>
            <p class="treatment-card-desc">${escHtml(t.descripcion || "")}</p>
          </div>
        `).join("")}
      </div>
    </div>

    <!-- ═ CONFIANZA ═ -->
    ${data.confianza ? `
    <div style="display:flex;align-items:center;gap:16px;padding:16px 20px;background:var(--surface);border:1px solid var(--border);border-radius:14px;margin-bottom:24px;">
      <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-3);letter-spacing:1px;text-transform:uppercase;">Confianza del diagnóstico</span>
      <div style="flex:1;height:4px;background:rgba(163,230,53,0.1);border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:${data.confianza}%;background:linear-gradient(90deg,var(--green),var(--lime));border-radius:2px;transition:width 1s;"></div>
      </div>
      <span style="font-family:var(--font-mono);font-size:14px;color:var(--lime);font-weight:600;">${data.confianza}%</span>
    </div>
    ` : ""}
  `;
}

function renderNoPest(data) {
  return `
    <div class="no-pest-card">
      <div class="no-pest-icon">✅</div>
      <h2>¡Planta saludable!</h2>
      <p>No se detectaron señales de infestación por plagas en la imagen analizada. La planta parece estar en buen estado. Continúa con tus prácticas de cuidado preventivo habituales.</p>
      ${data.diagnosticoCompleto ? `<p style="margin-top:12px;font-style:italic;font-size:14px;color:var(--text-2);">${escHtml(data.diagnosticoCompleto)}</p>` : ""}
    </div>
  `;
}

function renderCharCell(icon, label, value) {
  return `
    <div class="char-cell">
      <div class="char-cell-icon">${icon}</div>
      <div class="char-cell-label">${label}</div>
      <div class="char-cell-value">${value ? escHtml(String(value)) : '<span style="opacity:0.3">—</span>'}</div>
    </div>
  `;
}

function renderDiagnosisParagraphs(text) {
  if (!text) return '<p class="diagnosis-para">Análisis completado.</p>';
  return text
    .split(/\.(?:\s+)/)
    .filter(s => s.trim().length > 0)
    .map(s => `<p class="diagnosis-para">${escHtml(s.trim())}${s.trim().endsWith(".") ? "" : "."}</p>`)
    .join("");
}

function getSeverityText(sev) {
  return ["", "LEVE", "MODERADO", "ALTO", "MUY ALTO", "CRÍTICO"][sev] || "";
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ──────────── SVGs DE INSECTOS ────────────
function getInsectSVG(tipo) {
  const svgs = {

    aphid: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bodyG" cx="40%" cy="30%" r="65%">
          <stop offset="0%" stop-color="#86efac"/>
          <stop offset="100%" stop-color="#15803d"/>
        </radialGradient>
      </defs>
      <!-- Alas translúcidas -->
      <ellipse cx="72" cy="92" rx="28" ry="12" fill="rgba(200,240,220,0.2)" stroke="rgba(134,239,172,0.3)" stroke-width="1" transform="rotate(-18,72,92)"/>
      <ellipse cx="128" cy="92" rx="28" ry="12" fill="rgba(200,240,220,0.2)" stroke="rgba(134,239,172,0.3)" stroke-width="1" transform="rotate(18,128,92)"/>
      <!-- Patas 6 -->
      <line x1="88" y1="112" x2="58" y2="138" stroke="#14532d" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="100" y1="116" x2="100" y2="146" stroke="#14532d" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="112" y1="112" x2="142" y2="138" stroke="#14532d" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="86" y1="106" x2="54" y2="122" stroke="#14532d" stroke-width="2" stroke-linecap="round"/>
      <line x1="114" y1="106" x2="146" y2="122" stroke="#14532d" stroke-width="2" stroke-linecap="round"/>
      <line x1="84" y1="100" x2="52" y2="110" stroke="#14532d" stroke-width="1.8" stroke-linecap="round"/>
      <!-- Cuerpo -->
      <ellipse cx="100" cy="106" rx="28" ry="21" fill="url(#bodyG)" stroke="#14532d" stroke-width="1.5"/>
      <!-- Cabeza -->
      <ellipse cx="100" cy="79" rx="15" ry="13" fill="url(#bodyG)" stroke="#14532d" stroke-width="1.5"/>
      <!-- Ojos -->
      <circle cx="92" cy="75" r="4" fill="#0f172a"/>
      <circle cx="108" cy="75" r="4" fill="#0f172a"/>
      <circle cx="91" cy="74" r="1.5" fill="white"/>
      <circle cx="107" cy="74" r="1.5" fill="white"/>
      <!-- Antenas -->
      <line x1="94" y1="67" x2="80" y2="50" stroke="#14532d" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="106" y1="67" x2="120" y2="50" stroke="#14532d" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="80" cy="50" r="2.5" fill="#a3e635"/>
      <circle cx="120" cy="50" r="2.5" fill="#a3e635"/>
      <!-- Cornicles -->
      <line x1="88" y1="122" x2="78" y2="136" stroke="#15803d" stroke-width="2" stroke-linecap="round"/>
      <line x1="112" y1="122" x2="122" y2="136" stroke="#15803d" stroke-width="2" stroke-linecap="round"/>
    </svg>`,

    whitefly: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="wingW" cx="50%" cy="20%" r="70%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.95)"/>
          <stop offset="100%" stop-color="rgba(210,240,255,0.4)"/>
        </radialGradient>
      </defs>
      <ellipse cx="70" cy="88" rx="34" ry="15" fill="url(#wingW)" stroke="rgba(200,230,255,0.7)" stroke-width="1" transform="rotate(-14,70,88)"/>
      <ellipse cx="130" cy="88" rx="34" ry="15" fill="url(#wingW)" stroke="rgba(200,230,255,0.7)" stroke-width="1" transform="rotate(14,130,88)"/>
      <ellipse cx="76" cy="100" rx="22" ry="9" fill="url(#wingW)" stroke="rgba(200,230,255,0.5)" stroke-width="1" transform="rotate(-8,76,100)" opacity="0.8"/>
      <ellipse cx="124" cy="100" rx="22" ry="9" fill="url(#wingW)" stroke="rgba(200,230,255,0.5)" stroke-width="1" transform="rotate(8,124,100)" opacity="0.8"/>
      <line x1="92" y1="113" x2="70" y2="136" stroke="#9a7700" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="100" y1="116" x2="100" y2="142" stroke="#9a7700" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="108" y1="113" x2="130" y2="136" stroke="#9a7700" stroke-width="1.8" stroke-linecap="round"/>
      <ellipse cx="100" cy="108" rx="14" ry="11" fill="#fde68a" stroke="#b45309" stroke-width="1.5"/>
      <circle cx="100" cy="92" r="10" fill="#fde68a" stroke="#b45309" stroke-width="1.5"/>
      <circle cx="94" cy="89" r="3.5" fill="#dc2626"/>
      <circle cx="106" cy="89" r="3.5" fill="#dc2626"/>
      <line x1="95" y1="83" x2="84" y2="68" stroke="#b45309" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="105" y1="83" x2="116" y2="68" stroke="#b45309" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`,

    spider_mite: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="miteG" cx="45%" cy="30%" r="60%">
          <stop offset="0%" stop-color="#fca5a5"/>
          <stop offset="100%" stop-color="#991b1b"/>
        </radialGradient>
      </defs>
      <!-- 8 patas de ácaro -->
      <line x1="88" y1="104" x2="52" y2="88" stroke="#7f1d1d" stroke-width="2" stroke-linecap="round"/>
      <line x1="88" y1="108" x2="50" y2="108" stroke="#7f1d1d" stroke-width="2" stroke-linecap="round"/>
      <line x1="88" y1="113" x2="52" y2="126" stroke="#7f1d1d" stroke-width="2" stroke-linecap="round"/>
      <line x1="89" y1="118" x2="56" y2="136" stroke="#7f1d1d" stroke-width="2" stroke-linecap="round"/>
      <line x1="112" y1="104" x2="148" y2="88" stroke="#7f1d1d" stroke-width="2" stroke-linecap="round"/>
      <line x1="112" y1="108" x2="150" y2="108" stroke="#7f1d1d" stroke-width="2" stroke-linecap="round"/>
      <line x1="112" y1="113" x2="148" y2="126" stroke="#7f1d1d" stroke-width="2" stroke-linecap="round"/>
      <line x1="111" y1="118" x2="144" y2="136" stroke="#7f1d1d" stroke-width="2" stroke-linecap="round"/>
      <!-- Telaraña decorativa -->
      <circle cx="100" cy="110" r="34" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="0.8"/>
      <line x1="100" y1="76" x2="100" y2="144" stroke="rgba(255,255,255,0.06)" stroke-width="0.8"/>
      <line x1="66" y1="110" x2="134" y2="110" stroke="rgba(255,255,255,0.06)" stroke-width="0.8"/>
      <!-- Opistosoma -->
      <ellipse cx="100" cy="114" rx="22" ry="18" fill="url(#miteG)" stroke="#7f1d1d" stroke-width="1.5"/>
      <ellipse cx="94" cy="110" rx="6" ry="7" fill="rgba(0,0,0,0.2)"/>
      <ellipse cx="106" cy="110" rx="6" ry="7" fill="rgba(0,0,0,0.2)"/>
      <!-- Prosoma -->
      <ellipse cx="100" cy="91" rx="13" ry="11" fill="url(#miteG)" stroke="#7f1d1d" stroke-width="1.5"/>
      <circle cx="93" cy="87" r="3" fill="#0f172a"/>
      <circle cx="107" cy="87" r="3" fill="#0f172a"/>
      <line x1="95" y1="82" x2="88" y2="73" stroke="#7f1d1d" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="105" y1="82" x2="112" y2="73" stroke="#7f1d1d" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`,

    caterpillar: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="catG" cx="45%" cy="25%" r="60%">
          <stop offset="0%" stop-color="#86efac"/>
          <stop offset="100%" stop-color="#15803d"/>
        </radialGradient>
      </defs>
      <!-- Segmentos -->
      <ellipse cx="150" cy="108" rx="16" ry="14" fill="url(#catG)" stroke="#14532d" stroke-width="1.5"/>
      <ellipse cx="130" cy="106" rx="17" ry="15" fill="url(#catG)" stroke="#14532d" stroke-width="1.5"/>
      <ellipse cx="110" cy="105" rx="17" ry="15" fill="url(#catG)" stroke="#14532d" stroke-width="1.5"/>
      <ellipse cx="89" cy="105" rx="16" ry="14" fill="url(#catG)" stroke="#14532d" stroke-width="1.5"/>
      <!-- Rayas -->
      <line x1="98" y1="91" x2="98" y2="119" stroke="rgba(0,0,0,0.15)" stroke-width="2"/>
      <line x1="119" y1="91" x2="119" y2="120" stroke="rgba(0,0,0,0.15)" stroke-width="2"/>
      <line x1="140" y1="93" x2="140" y2="121" stroke="rgba(0,0,0,0.15)" stroke-width="2"/>
      <!-- Patas -->
      <line x1="110" y1="119" x2="98" y2="138" stroke="#14532d" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="120" y1="120" x2="120" y2="140" stroke="#14532d" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="130" y1="120" x2="140" y2="138" stroke="#14532d" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="150" y1="122" x2="158" y2="136" stroke="#14532d" stroke-width="2.2" stroke-linecap="round"/>
      <!-- Cabeza -->
      <circle cx="68" cy="105" r="19" fill="#16a34a" stroke="#14532d" stroke-width="2"/>
      <circle cx="60" cy="98" r="5.5" fill="#0f172a"/>
      <circle cx="59" cy="97" r="2" fill="white"/>
      <line x1="63" y1="87" x2="54" y2="70" stroke="#14532d" stroke-width="2" stroke-linecap="round"/>
      <line x1="72" y1="87" x2="73" y2="70" stroke="#14532d" stroke-width="2" stroke-linecap="round"/>
      <circle cx="54" cy="70" r="3.5" fill="#a3e635"/>
      <circle cx="73" cy="70" r="3.5" fill="#a3e635"/>
      <!-- Boca -->
      <path d="M58 112 Q68 116 78 112" stroke="#14532d" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    </svg>`,

    thrip: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="thripG" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#fcd34d"/>
          <stop offset="100%" stop-color="#b45309"/>
        </linearGradient>
      </defs>
      <!-- Alas con flecos -->
      <path d="M85 95 Q60 85 50 92 Q58 98 85 100" fill="rgba(186,230,253,0.4)" stroke="rgba(147,197,253,0.5)" stroke-width="1"/>
      <path d="M115 95 Q140 85 150 92 Q142 98 115 100" fill="rgba(186,230,253,0.4)" stroke="rgba(147,197,253,0.5)" stroke-width="1"/>
      <!-- Flecos -->
      <line x1="54" y1="90" x2="50" y2="88" stroke="rgba(147,197,253,0.6)" stroke-width="0.8"/>
      <line x1="57" y1="94" x2="52" y2="94" stroke="rgba(147,197,253,0.6)" stroke-width="0.8"/>
      <line x1="146" y1="90" x2="150" y2="88" stroke="rgba(147,197,253,0.6)" stroke-width="0.8"/>
      <line x1="143" y1="94" x2="148" y2="94" stroke="rgba(147,197,253,0.6)" stroke-width="0.8"/>
      <!-- Patas -->
      <line x1="93" y1="110" x2="72" y2="132" stroke="#92400e" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="100" y1="112" x2="100" y2="138" stroke="#92400e" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="107" y1="110" x2="128" y2="132" stroke="#92400e" stroke-width="1.8" stroke-linecap="round"/>
      <!-- Cuerpo alargado segmentado -->
      <ellipse cx="100" cy="111" rx="10" ry="17" fill="url(#thripG)" stroke="#92400e" stroke-width="1.5"/>
      <line x1="90" y1="105" x2="110" y2="105" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>
      <line x1="90" y1="110" x2="110" y2="110" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>
      <line x1="91" y1="116" x2="109" y2="116" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>
      <!-- Cabeza -->
      <ellipse cx="100" cy="88" rx="9" ry="8" fill="url(#thripG)" stroke="#92400e" stroke-width="1.5"/>
      <circle cx="95" cy="85" r="2.5" fill="#0f172a"/>
      <circle cx="105" cy="85" r="2.5" fill="#0f172a"/>
      <!-- Antenas segmentadas -->
      <path d="M97 81 Q90 72 86 63" stroke="#92400e" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M103 81 Q110 72 114 63" stroke="#92400e" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <circle cx="86" cy="63" r="2" fill="#fde68a"/>
      <circle cx="114" cy="63" r="2" fill="#fde68a"/>
    </svg>`,

    beetle: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="beetleG" cx="40%" cy="25%" r="65%">
          <stop offset="0%" stop-color="#c2410c"/>
          <stop offset="100%" stop-color="#431407"/>
        </radialGradient>
        <radialGradient id="pronotG" cx="45%" cy="30%" r="60%">
          <stop offset="0%" stop-color="#ea580c"/>
          <stop offset="100%" stop-color="#7c2d12"/>
        </radialGradient>
      </defs>
      <!-- Patas 6 -->
      <line x1="88" y1="108" x2="52" y2="93" stroke="#1c0a00" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="88" y1="112" x2="50" y2="114" stroke="#1c0a00" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="88" y1="118" x2="54" y2="135" stroke="#1c0a00" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="112" y1="108" x2="148" y2="93" stroke="#1c0a00" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="112" y1="112" x2="150" y2="114" stroke="#1c0a00" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="112" y1="118" x2="146" y2="135" stroke="#1c0a00" stroke-width="2.5" stroke-linecap="round"/>
      <!-- Élitros -->
      <ellipse cx="100" cy="113" rx="26" ry="22" fill="url(#beetleG)" stroke="#1c0a00" stroke-width="2"/>
      <line x1="100" y1="91" x2="100" y2="135" stroke="#1c0a00" stroke-width="1.5"/>
      <!-- Puntos de élitros -->
      <circle cx="89" cy="105" r="2.5" fill="rgba(0,0,0,0.35)"/>
      <circle cx="93" cy="116" r="2.5" fill="rgba(0,0,0,0.35)"/>
      <circle cx="111" cy="105" r="2.5" fill="rgba(0,0,0,0.35)"/>
      <circle cx="107" cy="116" r="2.5" fill="rgba(0,0,0,0.35)"/>
      <!-- Pronoto -->
      <ellipse cx="100" cy="92" rx="18" ry="10" fill="url(#pronotG)" stroke="#1c0a00" stroke-width="1.5"/>
      <!-- Cabeza -->
      <ellipse cx="100" cy="79" rx="13" ry="10" fill="url(#beetleG)" stroke="#1c0a00" stroke-width="1.5"/>
      <circle cx="91" cy="76" r="4.5" fill="#0f172a"/>
      <circle cx="109" cy="76" r="4.5" fill="#0f172a"/>
      <circle cx="90" cy="75" r="1.5" fill="white"/>
      <circle cx="108" cy="75" r="1.5" fill="white"/>
      <!-- Antenas -->
      <path d="M93 70 Q85 59 78 50" stroke="#1c0a00" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M107 70 Q115 59 122 50" stroke="#1c0a00" stroke-width="2" fill="none" stroke-linecap="round"/>
    </svg>`,

    mealybug: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="mealyG" cx="45%" cy="30%" r="60%">
          <stop offset="0%" stop-color="#ffe4e6"/>
          <stop offset="100%" stop-color="#fda4af"/>
        </radialGradient>
      </defs>
      <!-- Filamentos cerosos -->
      <line x1="73" y1="97" x2="50" y2="85" stroke="rgba(255,255,255,0.65)" stroke-width="2" stroke-linecap="round"/>
      <line x1="74" y1="104" x2="48" y2="104" stroke="rgba(255,255,255,0.65)" stroke-width="2" stroke-linecap="round"/>
      <line x1="76" y1="111" x2="51" y2="118" stroke="rgba(255,255,255,0.65)" stroke-width="2" stroke-linecap="round"/>
      <line x1="79" y1="118" x2="58" y2="132" stroke="rgba(255,255,255,0.65)" stroke-width="2" stroke-linecap="round"/>
      <line x1="127" y1="97" x2="150" y2="85" stroke="rgba(255,255,255,0.65)" stroke-width="2" stroke-linecap="round"/>
      <line x1="126" y1="104" x2="152" y2="104" stroke="rgba(255,255,255,0.65)" stroke-width="2" stroke-linecap="round"/>
      <line x1="124" y1="111" x2="149" y2="118" stroke="rgba(255,255,255,0.65)" stroke-width="2" stroke-linecap="round"/>
      <line x1="121" y1="118" x2="142" y2="132" stroke="rgba(255,255,255,0.65)" stroke-width="2" stroke-linecap="round"/>
      <!-- Cola -->
      <line x1="116" y1="124" x2="138" y2="142" stroke="rgba(255,255,255,0.8)" stroke-width="3.5" stroke-linecap="round"/>
      <!-- Cuerpo -->
      <ellipse cx="100" cy="108" rx="30" ry="21" fill="url(#mealyG)" stroke="rgba(253,164,175,0.5)" stroke-width="1.5"/>
      <!-- Capa cera -->
      <ellipse cx="100" cy="104" rx="28" ry="17" fill="rgba(255,255,255,0.35)"/>
      <line x1="85" y1="88" x2="85" y2="128" stroke="rgba(253,164,175,0.3)" stroke-width="1"/>
      <line x1="100" y1="87" x2="100" y2="129" stroke="rgba(253,164,175,0.3)" stroke-width="1"/>
      <line x1="115" y1="88" x2="115" y2="128" stroke="rgba(253,164,175,0.3)" stroke-width="1"/>
      <!-- Cabeza -->
      <circle cx="73" cy="105" r="11" fill="url(#mealyG)" stroke="rgba(253,164,175,0.5)" stroke-width="1.5"/>
    </svg>`,

    leafminer: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="leafG" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#86efac"/>
          <stop offset="100%" stop-color="#15803d"/>
        </linearGradient>
      </defs>
      <!-- Hoja -->
      <path d="M100 58 Q145 70 148 108 Q145 140 100 148 Q55 140 52 108 Q55 70 100 58Z" fill="url(#leafG)" stroke="#14532d" stroke-width="1.5"/>
      <line x1="100" y1="58" x2="100" y2="148" stroke="#14532d" stroke-width="1.5"/>
      <line x1="76" y1="84" x2="100" y2="108" stroke="#14532d" stroke-width="1"/>
      <line x1="76" y1="118" x2="100" y2="108" stroke="#14532d" stroke-width="1"/>
      <line x1="124" y1="84" x2="100" y2="108" stroke="#14532d" stroke-width="1"/>
      <line x1="124" y1="118" x2="100" y2="108" stroke="#14532d" stroke-width="1"/>
      <!-- Galería serpenteante -->
      <path d="M78 82 Q88 90 80 102 Q72 112 84 120 Q94 128 90 138" stroke="#fbbf24" stroke-width="7" fill="none" stroke-linecap="round" opacity="0.6"/>
      <path d="M78 82 Q88 90 80 102 Q72 112 84 120 Q94 128 90 138" stroke="#fef08a" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.5"/>
      <!-- Larva minadora -->
      <ellipse cx="90" cy="138" rx="7" ry="5" fill="#fde68a" stroke="#d97706" stroke-width="1.3"/>
      <circle cx="85" cy="138" r="3" fill="#b45309" stroke="#92400e" stroke-width="1"/>
      <circle cx="84" cy="137" r="1" fill="white"/>
    </svg>`,

    scale: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="scaleG" cx="40%" cy="30%" r="60%">
          <stop offset="0%" stop-color="#d97706"/>
          <stop offset="100%" stop-color="#78350f"/>
        </radialGradient>
      </defs>
      <!-- Rama -->
      <rect x="48" y="116" width="104" height="9" rx="4.5" fill="#44200a" stroke="#2a0f05" stroke-width="1"/>
      <!-- Escudos -->
      <ellipse cx="65" cy="111" rx="13" ry="10" fill="url(#scaleG)" stroke="#78350f" stroke-width="1.5"/>
      <ellipse cx="65" cy="108" rx="8" ry="5.5" fill="rgba(253,186,116,0.4)"/>
      <ellipse cx="89" cy="109" rx="14" ry="11" fill="url(#scaleG)" stroke="#78350f" stroke-width="1.5"/>
      <ellipse cx="89" cy="106" rx="9" ry="6" fill="rgba(253,186,116,0.4)"/>
      <ellipse cx="113" cy="111" rx="13" ry="10" fill="url(#scaleG)" stroke="#78350f" stroke-width="1.5"/>
      <ellipse cx="113" cy="108" rx="8" ry="5.5" fill="rgba(253,186,116,0.4)"/>
      <ellipse cx="136" cy="109" rx="12" ry="9" fill="url(#scaleG)" stroke="#78350f" stroke-width="1.5"/>
      <ellipse cx="136" cy="107" rx="7" ry="5" fill="rgba(253,186,116,0.4)"/>
      <!-- Anillos concéntricos -->
      <ellipse cx="65" cy="111" rx="7" ry="5" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="1"/>
      <ellipse cx="89" cy="109" rx="8" ry="6" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="1"/>
      <ellipse cx="113" cy="111" rx="7" ry="5" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="1"/>
      <!-- Ninfa -->
      <ellipse cx="100" cy="90" rx="9" ry="6" fill="#fcd34d" stroke="#b45309" stroke-width="1.3"/>
      <circle cx="93" cy="90" r="3.5" fill="#d97706" stroke="#92400e" stroke-width="1"/>
      <circle cx="92" cy="89" r="1" fill="white"/>
      <line x1="90" y1="88" x2="86" y2="83" stroke="#92400e" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="90" y1="90" x2="85" y2="90" stroke="#92400e" stroke-width="1.2" stroke-linecap="round"/>
    </svg>`,

    fungus_gnat: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gnatG" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#525252"/>
          <stop offset="100%" stop-color="#171717"/>
        </linearGradient>
      </defs>
      <!-- Alas -->
      <ellipse cx="76" cy="89" rx="30" ry="12" fill="rgba(186,230,253,0.3)" stroke="rgba(147,197,253,0.45)" stroke-width="1" transform="rotate(-14,76,89)"/>
      <ellipse cx="124" cy="89" rx="30" ry="12" fill="rgba(186,230,253,0.3)" stroke="rgba(147,197,253,0.45)" stroke-width="1" transform="rotate(14,124,89)"/>
      <!-- Nervaduras -->
      <line x1="88" y1="92" x2="57" y2="83" stroke="rgba(147,197,253,0.3)" stroke-width="0.8"/>
      <line x1="112" y1="92" x2="143" y2="83" stroke="rgba(147,197,253,0.3)" stroke-width="0.8"/>
      <!-- Patas largas -->
      <line x1="92" y1="113" x2="60" y2="150" stroke="#404040" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="100" y1="116" x2="100" y2="152" stroke="#404040" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="108" y1="113" x2="140" y2="150" stroke="#404040" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="89" y1="108" x2="54" y2="132" stroke="#404040" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="111" y1="108" x2="146" y2="132" stroke="#404040" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="87" y1="104" x2="57" y2="116" stroke="#404040" stroke-width="1.3" stroke-linecap="round"/>
      <!-- Abdomen -->
      <ellipse cx="100" cy="111" rx="10" ry="19" fill="url(#gnatG)" stroke="#111" stroke-width="1.5"/>
      <!-- Segmentos -->
      <line x1="90" y1="105" x2="110" y2="105" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
      <line x1="90" y1="111" x2="110" y2="111" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
      <line x1="91" y1="117" x2="109" y2="117" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
      <!-- Tórax -->
      <ellipse cx="100" cy="92" rx="10" ry="9" fill="#3f3f3f" stroke="#111" stroke-width="1.5"/>
      <!-- Cabeza -->
      <circle cx="100" cy="77" r="9.5" fill="#292929" stroke="#111" stroke-width="1.5"/>
      <!-- Ojos compuestos -->
      <circle cx="93" cy="74" r="4.5" fill="#7f1d1d" opacity="0.85"/>
      <circle cx="107" cy="74" r="4.5" fill="#7f1d1d" opacity="0.85"/>
      <!-- Antenas -->
      <path d="M96 68 Q89 56 84 44" stroke="#292929" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      <path d="M104 68 Q111 56 116 44" stroke="#292929" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    </svg>`,

    generic: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="genG" cx="45%" cy="30%" r="65%">
          <stop offset="0%" stop-color="#86efac"/>
          <stop offset="100%" stop-color="#15803d"/>
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="45" fill="rgba(163,230,53,0.05)" stroke="rgba(163,230,53,0.15)" stroke-width="1" stroke-dasharray="4 3"/>
      <circle cx="100" cy="100" r="30" fill="rgba(163,230,53,0.08)" stroke="rgba(163,230,53,0.2)" stroke-width="1"/>
      <text x="100" y="108" text-anchor="middle" font-size="36" fill="rgba(163,230,53,0.4)">🪲</text>
      <circle cx="100" cy="100" r="45" fill="none" stroke="rgba(163,230,53,0.1)" stroke-width="1"/>
    </svg>`,
  };

  return svgs[tipo] || svgs.generic;
}

// ──────────── NAVIGATION ────────────
window.addEventListener("DOMContentLoaded", () => {
  // Show splash initially
  SCREENS.splash.style.display = "flex";
  SCREENS.splash.classList.add("active");

  // Splash → Upload
  const btnGoUpload = $("btnGoUpload");
  if (btnGoUpload) btnGoUpload.addEventListener("click", () => showScreen("upload", { scrollTop: true }));

  // Back buttons
  const btnBack = $("btnBackToSplash");
  if (btnBack) btnBack.addEventListener("click", () => showScreen("splash"));

  const btnNew = $("btnNewAnalysis");
  if (btnNew) btnNew.addEventListener("click", () => {
    removeImage();
    showScreen("upload", { scrollTop: true });
  });

  // Analyze
  const btnAnalyze = $("btnAnalyze");
  if (btnAnalyze) btnAnalyze.addEventListener("click", startAnalysis);

  // Load TF
  loadTFModel();
});
// ═══════════════════════════════════════════════════════
// MODAL API KEY — lógica completa
// ═══════════════════════════════════════════════════════

function openApikeyModal() {
  const overlay = document.getElementById("apikeyOverlay");
  if (!overlay) return;
  const input = document.getElementById("apikeyInput");
  if (input) input.value = getClaudeKey();
  overlay.classList.remove("hidden");
  updateApikeyStatusDot();
}

function closeApikeyModal() {
  const overlay = document.getElementById("apikeyOverlay");
  if (overlay) overlay.classList.add("hidden");
}

function updateApikeyStatusDot() {
  const dot = document.getElementById("apikeyStatusDot");
  if (!dot) return;
  const hasKey = !!getClaudeKey();
  dot.className = "apikey-status-dot " + (hasKey ? "dot-ok" : "dot-missing");
}

window.addEventListener("DOMContentLoaded", () => {
  // ── Abrir modal con el botón de la navbar
  const btnOpen = document.getElementById("btnOpenApikey");
  if (btnOpen) btnOpen.addEventListener("click", openApikeyModal);

  // ── Guardar key
  const btnSave = document.getElementById("apikeySaveBtn");
  if (btnSave) btnSave.addEventListener("click", () => {
    const input = document.getElementById("apikeyInput");
    const hint  = document.getElementById("apikeyHint");
    const key   = input ? input.value.trim() : "";

    if (!key) {
      if (hint) { hint.textContent = "Por favor ingresa tu API Key."; hint.className = "apikey-hint"; }
      return;
    }
    if (key.length < 20) {
      if (hint) { hint.textContent = "La clave parece demasiado corta. Cópiala completa desde AI Studio."; hint.className = "apikey-hint"; }
      return;
    }

    localStorage.setItem("ecoia_claude_key", key);
    if (hint) { hint.textContent = "✓ API Key guardada correctamente."; hint.className = "apikey-hint ok"; }
    updateApikeyStatusDot();
    toast("API Key guardada ✓", "success");
    setTimeout(closeApikeyModal, 900);
  });

  // ── Cerrar con botón skip
  const btnSkip = document.getElementById("apikeySkipBtn");
  if (btnSkip) btnSkip.addEventListener("click", closeApikeyModal);

  // ── Borrar key guardada
  const btnDelete = document.getElementById("apikeyDeleteBtn");
  if (btnDelete) btnDelete.addEventListener("click", () => {
    localStorage.removeItem("ecoia_claude_key");
    const input = document.getElementById("apikeyInput");
    const hint  = document.getElementById("apikeyHint");
    if (input) input.value = "";
    if (hint)  { hint.textContent = "Key eliminada. Pega tu nueva API Key arriba."; hint.className = "apikey-hint ok"; }
    updateApikeyStatusDot();
    toast("API Key eliminada ✓", "info");
  });

  // ── Cerrar al clic fuera
  const overlay = document.getElementById("apikeyOverlay");
  if (overlay) overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeApikeyModal();
  });

  // ── Toggle visibilidad de la key
  const eyeBtn  = document.getElementById("apikeyEye");
  const eyeIcon = document.getElementById("apikeyEyeIcon");
  const keyInput = document.getElementById("apikeyInput");
  if (eyeBtn && keyInput) {
    eyeBtn.addEventListener("click", () => {
      const isPass = keyInput.type === "password";
      keyInput.type = isPass ? "text" : "password";
      if (eyeIcon) {
        eyeIcon.innerHTML = isPass
          ? `<path d="M1 10s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7z"/><line x1="2" y1="2" x2="18" y2="18" stroke-linecap="round"/>`
          : `<path d="M1 10s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7z"/><circle cx="10" cy="10" r="3"/>`;
      }
    });
  }

  // ── Abrir modal automáticamente si no hay key guardada
  if (!getClaudeKey()) {
    setTimeout(openApikeyModal, 1200);
  }

  updateApikeyStatusDot();
});

// ═══════════════════════════════════════════════════════
// HELPERS RATE LIMIT
// ═══════════════════════════════════════════════════════

let _countdownInterval = null;

function showRateLimitCountdown(totalSecs, intento, maxIntentos) {
  const box = document.getElementById("rateLimitBox");
  const cd  = document.getElementById("rateLimitCountdown");
  const msg = document.getElementById("rateLimitMsg");
  if (!box || !cd) return;

  box.style.display = "flex";
  cd.textContent    = totalSecs;

  const intentoInfo = (intento && maxIntentos)
    ? ` (intento ${intento}/${maxIntentos})`
    : "";
  if (msg) msg.textContent = `Límite de Gemini alcanzado${intentoInfo}. Reintentando en`;
  updateLoadingStep(`Esperando límite de API${intentoInfo}...`);

  let remaining = totalSecs;
  clearInterval(_countdownInterval);
  _countdownInterval = setInterval(() => {
    remaining--;
    if (cd) cd.textContent = Math.max(0, remaining);
    if (remaining <= 0) clearInterval(_countdownInterval);
  }, 1000);
}

function hideRateLimitCountdown() {
  clearInterval(_countdownInterval);
  const box = document.getElementById("rateLimitBox");
  if (box) box.style.display = "none";
}

function countdownDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}