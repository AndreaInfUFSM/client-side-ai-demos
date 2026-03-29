import { sharedConfig } from '../../shared/config.js';
import { buildSubmission, sendSubmission } from '../../shared/sender.js';
import { collectEnvironment } from '../../shared/collect-environment.js';
import { createEfficientDetLite0Runner } from '../../benchmarks/efficientdet-lite0-runner.js';
import { demoConfig } from './config.js';

const imageInput = document.getElementById('imageInput');
const useDefaultBtn = document.getElementById('useDefaultBtn');
const loadBtn = document.getElementById('loadBtn');
const analyzeBtn = document.getElementById('analyzeBtn');
const preview = document.getElementById('preview');
const placeholder = document.getElementById('placeholder');
const configInput = document.getElementById('configInput');
const outputEl = document.getElementById('output');
const statusText = document.getElementById('statusText');
const statusDot = document.getElementById('statusDot');
const overlay = document.getElementById('overlay');

let currentImageDataUrl = null;
let workerReady = false;
let modelReady = false;

let currentRun = {
  analyzeStartedAt: null,
  modelInfo: null
};

const runner = createEfficientDetLite0Runner({
  workerUrl: new URL(demoConfig.workerUrl, import.meta.url),
  onStatus: (text, kind) => setStatus(text, kind),
  onWorkerReady: () => {
    workerReady = true;
    setStatus('Worker ready.', 'ok');
    refreshButtons();
  },
  onModelReady: (msg) => {
    modelReady = true;
    currentRun.modelInfo = {
      backend: msg.backend || null,
      dtype: msg.dtype || null,
      load_ms: msg.load_ms ?? null
    };
    setStatus(
      `Model ready (${msg.backend || 'unknown'}${msg.dtype ? ', ' + msg.dtype : ''}).`,
      'ok'
    );
    refreshButtons();
  },
  onWorkerError: (err) => {
    setStatus(`Worker crashed: ${err.message || err}`, 'err');
    refreshButtons();
  }
});

function setStatus(text, kind = '') {
  statusText.textContent = text;
  statusDot.className = 'dot';
  if (kind) statusDot.classList.add(kind);
}

function showImage(src) {
  preview.src = src;
  preview.style.display = 'block';
  placeholder.style.display = 'none';
  clearOverlay();
}

function clearImage() {
  preview.removeAttribute('src');
  preview.style.display = 'none';
  placeholder.style.display = 'block';
  currentImageDataUrl = null;
  clearOverlay();
  refreshButtons();
}

function refreshButtons() {
  analyzeBtn.disabled = !(workerReady && modelReady && currentImageDataUrl);
}

function safeParseConfig() {
  return JSON.parse(configInput.value);
}


function clearOverlay() {
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  overlay.style.display = 'none';
}

function drawDetectionsOnPreview(detections) {
  if (!preview.naturalWidth || !preview.naturalHeight) return;

  const containerWidth = preview.clientWidth;
  const containerHeight = preview.clientHeight;

  overlay.width = containerWidth;
  overlay.height = containerHeight;
  overlay.style.display = 'block';

  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  const imageAspect = preview.naturalWidth / preview.naturalHeight;
  const containerAspect = containerWidth / containerHeight;

  let renderedWidth, renderedHeight, offsetX, offsetY;

  if (imageAspect > containerAspect) {
    renderedWidth = containerWidth;
    renderedHeight = containerWidth / imageAspect;
    offsetX = 0;
    offsetY = (containerHeight - renderedHeight) / 2;
  } else {
    renderedHeight = containerHeight;
    renderedWidth = containerHeight * imageAspect;
    offsetY = 0;
    offsetX = (containerWidth - renderedWidth) / 2;
  }

  const scaleX = renderedWidth / preview.naturalWidth;
  const scaleY = renderedHeight / preview.naturalHeight;

  ctx.lineWidth = 2;
  ctx.font = '14px system-ui, sans-serif';
  ctx.textBaseline = 'top';

  for (const det of detections) {
    const box = det.boundingBox || {};
    const categories = det.categories || [];
    const best = categories[0] || {};

    const x = offsetX + (box.originX || 0) * scaleX;
    const y = offsetY + (box.originY || 0) * scaleY;
    const w = (box.width || 0) * scaleX;
    const h = (box.height || 0) * scaleY;

    const label = best.categoryName || best.displayName || 'object';
    const score = typeof best.score === 'number' ? ` ${Math.round(best.score * 100)}%` : '';
    const text = `${label}${score}`;

    ctx.strokeStyle = '#00e676';
    ctx.fillStyle = '#00e676';
    ctx.strokeRect(x, y, w, h);

    const textPadding = 4;
    const textWidth = ctx.measureText(text).width + textPadding * 2;
    const textHeight = 20;
    const textY = Math.max(0, y - textHeight);

    ctx.fillRect(x, textY, textWidth, textHeight);
    ctx.fillStyle = '#111';
    ctx.fillText(text, x + textPadding, textY + 3);
  }
}

async function blobToDataUrl(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function loadDefaultImage() {
  const url = new URL(demoConfig.defaultImageUrl, import.meta.url);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load default image.');
  const blob = await res.blob();
  const dataUrl = await blobToDataUrl(blob);
  currentImageDataUrl = dataUrl;
  showImage(dataUrl);
  refreshButtons();
}

imageInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    clearImage();
    return;
  }

  try {
    const dataUrl = await blobToDataUrl(file);
    currentImageDataUrl = dataUrl;
    showImage(dataUrl);
    refreshButtons();
  } catch {
    setStatus('Could not read the image file.', 'err');
  }
});

useDefaultBtn.addEventListener('click', async () => {
  try {
    setStatus('Loading default image...', 'busy');
    await loadDefaultImage();
    setStatus('Default image loaded.', 'ok');
  } catch (err) {
    setStatus(err.message || 'Could not load default image.', 'err');
  }
});

loadBtn.addEventListener('click', async () => {
  try {
    const config = safeParseConfig();
    modelReady = false;
    outputEl.textContent = '{}';
    refreshButtons();
    setStatus('Loading model...', 'busy');
    await runner.loadModel(config);
  } catch (err) {
    setStatus(err.message || 'Invalid JSON config.', 'err');
    refreshButtons();
  }
});

window.addEventListener('resize', () => {
  try {
    const parsed = JSON.parse(outputEl.textContent);
    const detections = parsed.parsed_json?.detections || [];
    drawDetectionsOnPreview(detections);
  } catch {}
});

analyzeBtn.addEventListener('click', async () => {
  try {
    const config = safeParseConfig();
    if (!currentImageDataUrl) throw new Error('No image selected.');

    currentRun.analyzeStartedAt = performance.now();
    outputEl.textContent = '{}';
    setStatus('Analyzing image...', 'busy');
    analyzeBtn.disabled = true;

    const benchmarkResult = await runner.analyzeImage(config, currentImageDataUrl);

    const analyzeFinishedAt = performance.now();
    const totalAnalyzeMs = currentRun.analyzeStartedAt != null
      ? +(analyzeFinishedAt - currentRun.analyzeStartedAt).toFixed(2)
      : null;

    const resultPayload = {
      ...benchmarkResult,
      total_analyze_ms: totalAnalyzeMs
    };

    outputEl.textContent = JSON.stringify(resultPayload, null, 2);

    const detections = resultPayload.parsed_json?.detections || [];
    drawDetectionsOnPreview(detections);

    try {
      setStatus('Collecting environment...', 'busy');
      const environment = await collectEnvironment();

      setStatus('Sending result...', 'busy');

      const submission = buildSubmission({
        project: demoConfig.project,
        kind: demoConfig.kind,
        client: demoConfig.client,
        clientVersion: demoConfig.clientVersion,
        probeVersion: demoConfig.probeVersion,
        payload: {
          identity: environment.identity,
          hardware: environment.hardware,
          capabilities: environment.capabilities,
          media: environment.media,
          benchmark: {
            model_id: config.model_id,
            processor_id: config.processor_id || config.model_id,
            backend: resultPayload.backend,
            dtype: resultPayload.dtype,
            load_ms: currentRun.modelInfo?.load_ms ?? null,
            inference_ms: resultPayload.inference_ms ?? null,
            total_analyze_ms: resultPayload.total_analyze_ms
          },
          result: {
            raw_text: resultPayload.raw_text,
            parsed_json: resultPayload.parsed_json
          },
          config
        }
      });

      await sendSubmission(sharedConfig.apiEndpoint, submission);
      setStatus('Done and sent.', 'ok');
    } catch (err) {
      console.error(err);
      setStatus(`Done, but send failed: ${err.message || err}`, 'err');
    }

    refreshButtons();
  } catch (err) {
    setStatus(err.message || 'Could not analyze image.', 'err');
    refreshButtons();
  }
});

runner.init();
