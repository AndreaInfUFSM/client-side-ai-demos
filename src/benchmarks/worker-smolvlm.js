import {
  AutoProcessor,
  AutoModelForVision2Seq,
  RawImage
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.0-next.9";

let processor = null;
let model = null;
let loadedConfigKey = null;
let backendUsed = null;
let dtypeUsed = null;

function send(data) {
  self.postMessage(data);
}

function configKey(config) {
  return JSON.stringify(config);
}

async function loadProcessor(config) {
  const processorId = config.processor_id || config.model_id;
  send({
    type: "STATUS",
    text: `Loading processor: ${processorId}`,
    kind: "busy"
  });
  processor = await AutoProcessor.from_pretrained(processorId);
}

async function tryLoadWebGPU(config) {
  const modelId = config.model_id;
  const dtype = config.load?.webgpu_dtype ?? "fp16";

  send({
    type: "STATUS",
    text: `Loading model with WebGPU: ${modelId}`,
    kind: "busy"
  });

  const loadedModel = await AutoModelForVision2Seq.from_pretrained(modelId, {
    device: "webgpu",
    dtype
  });

  return {
    model: loadedModel,
    backend: "webgpu",
    dtype
  };
}

async function tryLoadWasm(config) {
  const modelId = config.model_id;
  const dtype = config.load?.wasm_dtype ?? "q4";

  send({
    type: "STATUS",
    text: `Loading model with WASM/CPU fallback: ${modelId}`,
    kind: "busy"
  });

  const loadedModel = await AutoModelForVision2Seq.from_pretrained(modelId, {
    dtype
  });

  return {
    model: loadedModel,
    backend: "wasm",
    dtype
  };
}

async function initModel(config) {
  const newKey = configKey(config);

  if (model && processor && loadedConfigKey === newKey) {
    send({
      type: "MODEL_READY",
      backend: backendUsed,
      dtype: dtypeUsed,
      load_ms: null
    });
    return;
  }

  const loadStart = performance.now();

  processor = null;
  model = null;
  loadedConfigKey = null;
  backendUsed = null;
  dtypeUsed = null;

  await loadProcessor(config);

  const preferWebGPU = config.load?.prefer_webgpu !== false;
  const wasmFallback = config.load?.wasm_fallback !== false;

  if (preferWebGPU) {
    try {
      const loaded = await tryLoadWebGPU(config);
      model = loaded.model;
      backendUsed = loaded.backend;
      dtypeUsed = loaded.dtype;
      loadedConfigKey = newKey;

      send({
        type: "MODEL_READY",
        backend: backendUsed,
        dtype: dtypeUsed,
        load_ms: +(performance.now() - loadStart).toFixed(2)
      });
      return;
    } catch (err) {
      send({
        type: "STATUS",
        text: `WebGPU failed: ${err?.message || err}.`,
        kind: "busy"
      });
    }
  }

  if (!wasmFallback) {
    throw new Error("WebGPU load failed and WASM fallback is disabled.");
  }

  const loaded = await tryLoadWasm(config);
  model = loaded.model;
  backendUsed = loaded.backend;
  dtypeUsed = loaded.dtype;
  loadedConfigKey = newKey;

  send({
    type: "MODEL_READY",
    backend: backendUsed,
    dtype: dtypeUsed,
    load_ms: +(performance.now() - loadStart).toFixed(2)
  });
}

async function runInference(config, imageDataUrl) {
  if (!processor || !model || loadedConfigKey !== configKey(config)) {
    await initModel(config);
  }

  send({
    type: "STATUS",
    text: `Preparing prompt and image on ${backendUsed}...`,
    kind: "busy"
  });

  const rawImage = await RawImage.fromURL(imageDataUrl);

  const promptText =
    config.prompt ||
    "Return only valid JSON describing the image.";

  const messages = [
    {
      role: "user",
      content: [
        { type: "image" },
        { type: "text", text: promptText }
      ]
    }
  ];

  const prompt = processor.apply_chat_template(messages, {
    add_generation_prompt: true
  });

  const inputs = await processor(prompt, [rawImage], {
    do_image_splitting: !!config.processor?.do_image_splitting
  });

  send({
    type: "STATUS",
    text: `Generating on ${backendUsed}...`,
    kind: "busy"
  });

  const inferenceStart = performance.now();

  const generatedIds = await model.generate({
    ...inputs,
    max_new_tokens: config.generation?.max_new_tokens ?? 48,
    do_sample: config.generation?.do_sample ?? false,
    repetition_penalty: config.generation?.repetition_penalty ?? 1.1
  });

  const inferenceMs = +(performance.now() - inferenceStart).toFixed(2);

  const promptLength = inputs.input_ids.dims.at(-1);
  const newTokens = generatedIds.slice(null, [promptLength, null]);

  const decoded = processor.batch_decode(newTokens, {
    skip_special_tokens: true
  });

  const text = decoded[0]?.trim() || "";

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  send({
    type: "RESULT",
    payload: {
      model_id: config.model_id,
      backend: backendUsed,
      dtype: dtypeUsed,
      prompt: promptText,
      inference_ms: inferenceMs,
      raw_text: text,
      parsed_json: parsed
    }
  });
}

self.addEventListener("message", async (event) => {
  const data = event.data || {};

  try {
    if (data.type === "INIT_MODEL") {
      await initModel(data.config);
      return;
    }

    if (data.type === "ANALYZE_IMAGE") {
      await runInference(data.config, data.imageDataUrl);
      return;
    }

    send({
      type: "ERROR",
      text: `Unknown message type: ${data.type}`
    });
  } catch (err) {
    send({
      type: "ERROR",
      during: data.type === "INIT_MODEL" ? "load" : "run",
      text: err?.message || String(err)
    });
  }
});

send({
  type: "WORKER_READY"
});
