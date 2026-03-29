export function createSmolVlmRunner({ workerUrl, onStatus = () => {}, onWorkerReady = () => {}, onModelReady = () => {}, onWorkerError = () => {} }) {
  let worker = null;
  let workerReady = false;
  let modelReady = false;
  let pendingLoad = null;
  let pendingAnalyze = null;

  function init() {
    if (worker) return;

    worker = new Worker(workerUrl, { type: 'module' });

    worker.addEventListener('message', (event) => {
      const msg = event.data || {};

      if (msg.type === 'WORKER_READY') {
        workerReady = true;
        onWorkerReady(msg);
        return;
      }

      if (msg.type === 'STATUS') {
        onStatus(msg.text, msg.kind || 'busy');
        return;
      }

      if (msg.type === 'MODEL_READY') {
        modelReady = true;
        onModelReady(msg);
        if (pendingLoad) {
          pendingLoad.resolve(msg);
          pendingLoad = null;
        }
        return;
      }

      if (msg.type === 'RESULT') {
        if (pendingAnalyze) {
          pendingAnalyze.resolve(msg.payload);
          pendingAnalyze = null;
        }
        return;
      }

      if (msg.type === 'ERROR') {
        const err = new Error(msg.text || 'Worker operation failed.');
        if (msg.during === 'load') {
          modelReady = false;
          if (pendingLoad) {
            pendingLoad.reject(err);
            pendingLoad = null;
          }
        } else if (pendingAnalyze) {
          pendingAnalyze.reject(err);
          pendingAnalyze = null;
        } else {
          onWorkerError(err);
        }
      }
    });

    worker.addEventListener('error', (err) => {
      const error = new Error(err.message || 'Worker crashed.');
      onWorkerError(error);
      if (pendingLoad) {
        pendingLoad.reject(error);
        pendingLoad = null;
      }
      if (pendingAnalyze) {
        pendingAnalyze.reject(error);
        pendingAnalyze = null;
      }
    });
  }

  function loadModel(config) {
    init();

    return new Promise((resolve, reject) => {
      pendingLoad = { resolve, reject };
      modelReady = false;
      worker.postMessage({
        type: 'INIT_MODEL',
        config
      });
    });
  }

  function analyzeImage(config, imageDataUrl) {
    init();

    return new Promise((resolve, reject) => {
      pendingAnalyze = { resolve, reject };
      worker.postMessage({
        type: 'ANALYZE_IMAGE',
        config,
        imageDataUrl
      });
    });
  }

  return {
    init,
    loadModel,
    analyzeImage,
    isWorkerReady: () => workerReady,
    isModelReady: () => modelReady
  };
}
