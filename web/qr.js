import './jsqr.js';
import { validKey } from './e2e.js';

// The decoder runs locally, including on Safari without BarcodeDetector.
export function scanLogin() {
  // Loading the scanner can finish after the user backgrounds the app or signs in another way.
  if (document.hidden || document.getElementById('login').hidden) return Promise.resolve();
  const dialog = document.getElementById('qr-scanner'), video = document.getElementById('qr-video');
  const status = document.getElementById('qr-status'), error = document.getElementById('qr-error');
  const lifetime = new AbortController(), options = { signal: lifetime.signal };
  let stream, timer;
  video.hidden = true; error.hidden = true;
  status.textContent = 'Allow camera access to scan the code.';
  return new Promise(resolve => {
    const stopCamera = () => {
      clearTimeout(timer);
      stream?.getTracks().forEach(track => track.stop());
      video.pause(); video.srcObject = null; video.hidden = true;
    };
    const finish = credentials => {
      if (lifetime.signal.aborted) return;
      lifetime.abort(); stopCamera(); dialog.close(); resolve(credentials);
    };
    document.getElementById('qr-close').addEventListener('click', () => finish(), options);
    dialog.addEventListener('close', () => finish(), options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) finish(); }, options);
    window.addEventListener('pagehide', () => finish(), options);
    dialog.showModal();
    const fail = message => {
      stopCamera(); status.textContent = ''; error.textContent = message; error.hidden = false;
    };
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          fail('Camera access is unavailable. Open Pi Remote over HTTPS, or cancel and paste the private link.'); return;
        }
        const camera = await navigator.mediaDevices.getUserMedia({ audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } } });
        if (lifetime.signal.aborted) { camera.getTracks().forEach(track => track.stop()); return; }
        stream = camera; video.srcObject = camera; video.hidden = false;
        await video.play();
        if (lifetime.signal.aborted) return;
        status.textContent = 'Point your camera at the QR shown by /pi-remote on your computer.';
        const canvas = document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true });
        const scan = () => {
          if (lifetime.signal.aborted) return;
          try {
            if (video.readyState >= 2 && video.videoWidth) {
              const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
              canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
              context.drawImage(video, 0, 0, canvas.width, canvas.height);
              const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
              const code = globalThis.jsQR(pixels.data, pixels.width, pixels.height);
              if (code) {
                let url;
                try { url = new URL(code.data); } catch { /* Not a login link. */ }
                const params = new URLSearchParams(url?.hash.slice(1));
                let message = '';
                if (!url || url.username || url.password || url.pathname !== '/' || url.search || !params.get('token') || !validKey(params.get('key'))) {
                  message = 'This is not a complete login QR. Scan the code shown by /pi-remote.';
                } else if (url.origin !== location.origin) {
                  message = 'This QR is for a different Pi Remote address. Scan the code for this app.';
                } else { finish({ token: params.get('token'), key: params.get('key') }); return; }
                if (error.textContent !== message) error.textContent = message;
                error.hidden = false;
              }
            }
            timer = setTimeout(scan, 200);
          } catch { fail('Could not read the camera. Cancel and try again, or paste the private link.'); }
        };
        scan();
      } catch (cause) {
        if (lifetime.signal.aborted) return;
        fail(cause.name === 'NotAllowedError'
          ? 'Camera access was denied. Allow it in your browser settings, or cancel and paste the private link.'
          : 'Could not open the camera. Cancel and try again, or paste the private link.');
      }
    };
    void start();
  });
}
