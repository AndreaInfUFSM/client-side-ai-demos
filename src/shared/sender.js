export function buildSubmission({
  project,
  kind = 'benchmark',
  client,
  clientVersion,
  probeVersion,
  entryLabel = '',
  status = 'ok',
  payload
}) {
  return {
    project,
    kind,
    client,
    clientVersion,
    probeVersion,
    sessionId: crypto.randomUUID(),
    entryLabel,
    origin: window.location.origin,
    pageUrl: window.location.href,
    timestamp: new Date().toISOString(),
    status,
    userAgent: navigator.userAgent,
    payload
  };
}

export async function sendSubmission(endpoint, submission) {
  if (!endpoint || endpoint.includes('PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE')) {
    throw new Error('Configure apiEndpoint first.');
  }

  await submitFormToHiddenIframe(endpoint, submission);
  return { ok: true, sentBy: 'form-post' };
}

function submitFormToHiddenIframe(endpoint, payload) {
  return new Promise((resolve, reject) => {
    const iframeName = `submit_target_${Date.now()}`;
    const iframe = document.createElement('iframe');
    iframe.name = iframeName;
    iframe.style.display = 'none';

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = endpoint;
    form.target = iframeName;
    form.style.display = 'none';

    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'payload';
    input.value = JSON.stringify(payload);

    form.appendChild(input);
    document.body.appendChild(iframe);
    document.body.appendChild(form);

    let settled = false;

    const cleanup = () => {
      setTimeout(() => {
        form.remove();
        iframe.remove();
      }, 300);
    };

    iframe.addEventListener('load', () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    });

    setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Timed out while sending submission.'));
    }, 10000);

    form.submit();
  });
}
