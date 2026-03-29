import { sharedConfig } from './config.js';

let depsPromise = null;

export async function collectEnvironment() {
  await ensureCollectorDependencies();

  const identity = collectIdentity();
  const hardware = collectHardware();
  const capabilities = collectCapabilities();
  const media = await collectMedia();

  return {
    identity,
    hardware,
    capabilities,
    media
  };
}

async function ensureCollectorDependencies() {
  if (!depsPromise) {
    depsPromise = Promise.all([
      loadScript(sharedConfig.collectorDeps.bowserUrl, 'bowser'),
      loadScript(sharedConfig.collectorDeps.modernizrUrl, 'Modernizr')
    ]);
  }
  return depsPromise;
}

function loadScript(url, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-global="${globalName}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window[globalName]), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${globalName}.`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.global = globalName;
    script.onload = () => resolve(window[globalName]);
    script.onerror = () => reject(new Error(`Failed to load ${globalName} from ${url}`));
    document.head.appendChild(script);
  });
}

function collectIdentity() {
  const parser = window.bowser?.getParser?.(navigator.userAgent) || null;
  const browser = parser ? parser.getBrowser() : {};
  const os = parser ? parser.getOS() : {};
  const platform = parser ? parser.getPlatform() : {};
  const engine = parser ? parser.getEngine() : {};

  return {
    userAgent: navigator.userAgent,
    browserName: browser.name || '',
    browserVersion: browser.version || '',
    os: os.name || '',
    osVersion: os.versionName || os.version || '',
    formFactor: platform.type || '',
    engineName: engine.name || '',
    engineVersion: engine.version || ''
  };
}

function collectHardware() {
  return {
    deviceMemoryGB: navigator.deviceMemory ?? '',
    hardwareConcurrency: navigator.hardwareConcurrency ?? '',
    maxTouchPoints: navigator.maxTouchPoints ?? ''
  };
}

function collectCapabilities() {
  return {
    webGL: !!getWebGLInfo(),
    webGPU: 'gpu' in navigator,
    mediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    modernizrLoaded: !!window.Modernizr,
    bowserLoaded: !!window.bowser
  };
}

async function collectMedia() {
  const media = {
    camerasFound: ''
  };

  if (!(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices)) {
    return media;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    media.camerasFound = devices.filter((d) => d.kind === 'videoinput').length;
  } catch {
    media.camerasFound = '';
  }

  return media;
}

function getWebGLInfo() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return null;

    const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = debugExt ? gl.getParameter(debugExt.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const renderer = debugExt ? gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);

    return { vendor, renderer };
  } catch {
    return null;
  }
}
