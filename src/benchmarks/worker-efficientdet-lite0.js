let FilesetResolverRef = null;
let ObjectDetectorRef = null;

let detector = null;
let loadedConfigKey = null;
let backendUsed = "wasm";

function send(data) {
  self.postMessage(data);
}

function configKey(config) {
  return JSON.stringify({
    wasmRoot:
      config?.wasmRoot ||
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
    modelAssetPath:
      config?.modelAssetPath ||
      "https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite",
    scoreThreshold: config?.scoreThreshold ?? 0.5,
    maxResults: config?.maxResults ?? -1,
  });
}

async function ensureMediaPipeLoaded() {
  if (FilesetResolverRef && ObjectDetectorRef) return;

  send({
    type: "STATUS",
    text: "Importing MediaPipe module...",
    kind: "busy",
  });

  const vision = await import(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs"
  );

  FilesetResolverRef = vision.FilesetResolver;
  ObjectDetectorRef = vision.ObjectDetector;
}

async function createDetector(config) {
  await ensureMediaPipeLoaded();

  const wasmRoot =
    config?.wasmRoot ||
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

  const modelAssetPath =
    config?.modelAssetPath ||
    "https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite";

  send({
    type: "STATUS",
    text: "Loading MediaPipe runtime...",
    kind: "busy",
  });

  const vision = await FilesetResolverRef.forVisionTasks(wasmRoot);

  send({
    type: "STATUS",
    text: "Loading detector model...",
    kind: "busy",
  });

  return await ObjectDetectorRef.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath,
    },
    runningMode: "IMAGE",
    scoreThreshold: config?.scoreThreshold ?? 0.5,
    maxResults: config?.maxResults ?? -1,
  });
}

async function initModel(config) {
  const newKey = configKey(config);

  if (detector && loadedConfigKey === newKey) {
    send({
      type: "MODEL_READY",
      backend: backendUsed,
      dtype: "",
      load_ms: null,
    });
    return;
  }

  const loadStart = performance.now();

  detector = null;
  loadedConfigKey = null;

  detector = await createDetector(config);
  loadedConfigKey = newKey;

  send({
    type: "MODEL_READY",
    backend: backendUsed,
    dtype: "",
    load_ms: +(performance.now() - loadStart).toFixed(2),
  });
}

async function imageDataUrlToImageBitmap(imageDataUrl) {
  const response = await fetch(imageDataUrl);
  const blob = await response.blob();
  return await createImageBitmap(blob);
}

function normalizeDetections(result) {
  const detections = result?.detections || [];

  return detections.map((det, index) => {
    const bbox = det.boundingBox || {};
    const categories = (det.categories || []).map((cat) => ({
      index: cat.index ?? null,
      score: cat.score ?? null,
      categoryName: cat.categoryName || "",
      displayName: cat.displayName || "",
    }));

    return {
      index,
      boundingBox: {
        originX: bbox.originX ?? null,
        originY: bbox.originY ?? null,
        width: bbox.width ?? null,
        height: bbox.height ?? null,
      },
      categories,
    };
  });
}

async function runInference(config, imageDataUrl) {
  if (!detector || loadedConfigKey !== configKey(config)) {
    await initModel(config);
  }

  send({
    type: "STATUS",
    text: "Preparing image...",
    kind: "busy",
  });

  const imageBitmap = await imageDataUrlToImageBitmap(imageDataUrl);

  send({
    type: "STATUS",
    text: "Detecting objects...",
    kind: "busy",
  });

  const inferenceStart = performance.now();
  const result = detector.detect(imageBitmap);
  const inferenceMs = +(performance.now() - inferenceStart).toFixed(2);

  imageBitmap.close?.();

  const normalized = normalizeDetections(result);

  send({
    type: "RESULT",
    payload: {
      model_id:
        config?.modelAssetPath ||
        "https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite",
      backend: backendUsed,
      dtype: "",
      prompt: "",
      inference_ms: inferenceMs,
      raw_text: JSON.stringify(normalized),
      parsed_json: {
        detections: normalized,
      },
    },
  });
}

self.addEventListener("message", async (event) => {
  const data = event.data || {};

  try {
    if (data.type === "INIT_MODEL") {
      await initModel(data.config || {});
      return;
    }

    if (data.type === "ANALYZE_IMAGE") {
      await runInference(data.config || {}, data.imageDataUrl);
      return;
    }

    send({
      type: "ERROR",
      text: `Unknown message type: ${data.type}`,
    });
  } catch (err) {
    send({
      type: "ERROR",
      during: data.type === "INIT_MODEL" ? "load" : "run",
      text: err?.message || String(err),
    });
  }
});

send({
  type: "WORKER_READY",
});