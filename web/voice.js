export function voiceComposer({ request, context, changed, notice }) {
  const button = document.getElementById('voice-record'), cancelButton = document.getElementById('voice-cancel');
  const panel = document.getElementById('voice-status'), status = document.getElementById('voice-label');
  const input = document.getElementById('prompt');
  const composer = document.getElementById('composer'), waveform = document.getElementById('voice-waveform');
  let active;
  const mimeType = ['audio/webm;codecs=opus', 'audio/mp4'].find(type => window.MediaRecorder?.isTypeSupported(type));
  const supported = () => !!(window.isSecureContext && mimeType && navigator.mediaDevices?.getUserMedia);
  const current = call => active === call && context().sessionId === call.sessionId && context().model === call.model;
  function render() {
    panel.hidden = !active;
    if (active) composer.dataset.voice = active.phase; else delete composer.dataset.voice;
    const showingWaveform = active?.phase === 'recording' && !!active.analyser;
    waveform.hidden = !showingWaveform;
    status.classList.toggle('sr-only', showingWaveform);
    cancelButton.hidden = !active;
    button.setAttribute('aria-label', active ? 'Stop dictation' : 'Dictate with ChatGPT');
    button.title = active ? 'Stop recording and insert text' : 'Dictate with this computer’s Codex ChatGPT sign-in. Audio is sent to OpenAI.';
    button.setAttribute('aria-pressed', String(!!active));
    button.dataset.recording = String(active?.phase === 'recording');
    button.disabled = !!active && active.phase !== 'recording';
    status.textContent = active?.phase === 'recording' ? 'Recording · sent to OpenAI on Stop' : active?.phase === 'finishing' ? 'Transcribing…' : 'Preparing microphone…';
    changed();
  }
  function stopMeter(call) {
    cancelAnimationFrame(call.frame);
    call.source?.disconnect();
    if (call.audio) { void call.audio.close().catch(() => {}); call.audio = undefined; }
    call.analyser = undefined;
  }
  function meter(call) {
    const samples = new Float32Array(call.analyser.fftSize), history = [];
    waveform.replaceChildren();
    let lastFrame = performance.now(), lastSample = 0, level = 0;
    const draw = now => {
      if (!current(call) || call.phase !== 'recording') return;
      call.analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      // A decibel scale keeps quiet speech visible; fast attack and slower release follow its envelope.
      const target = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(rms, 1e-5)) + 60) / 45));
      level += (target - level) * (1 - Math.exp(-(now - lastFrame) / (target > level ? 25 : 100)));
      lastFrame = now;
      if (now - lastSample >= 65) {
        lastSample = now;
        const bar = document.createElement('i');
        waveform.append(bar); history.push({ bar, at: now });
      }
      const width = waveform.clientWidth;
      while (history.length && (now - history[0].at) * 6 / 65 > width) history.shift().bar.remove();
      if (history.length) history.at(-1).bar.style.height = (level < .005 ? 3 : 3 + level * 27) + 'px';
      for (const { bar, at } of history) {
        bar.style.transform = `translate3d(${-(now - at) * 6 / 65}px, -50%, 0)`;
        bar.style.opacity = String(Math.min(1, (now - at) / 50));
      }
      call.frame = requestAnimationFrame(draw);
    };
    call.frame = requestAnimationFrame(draw);
  }
  function release(call) {
    stopMeter(call);
    clearTimeout(call.timer);
    if (call.recorder?.state === 'recording') call.recorder.stop();
    call.stream?.getTracks().forEach(track => track.stop());
    call.chunks = [];
  }
  function cancel() {
    const call = active;
    if (!call) return;
    const restoreFocus = [button, cancelButton].includes(document.activeElement);
    active = undefined; release(call);
    if (call.started) void request('voiceCancel', { sessionId: call.sessionId, voiceId: call.id }).catch(() => {});
    render();
    if (restoreFocus && !button.hidden) button.focus({ preventScroll: true });
  }
  function insert(call, text) {
    if (!current(call)) return;
    // An edit during capture owns the draft; never insert late text into a changed draft.
    if (input.value !== call.draft) { cancel(); return; }
    active = undefined; release(call);
    const words = text.trim();
    if (words) {
      const before = call.draft.slice(0, call.cursor), after = call.draft.slice(call.cursor);
      const addition = (before && !/\s$/.test(before) ? ' ' : '') + words + (after && !/^\s/.test(after) ? ' ' : '');
      input.value = before + addition + after;
      input.setSelectionRange(before.length + addition.length, before.length + addition.length);
    }
    render();
    if (words) input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus({ preventScroll: true });
  }
  async function finish() {
    const call = active;
    if (!call || call.phase !== 'recording') return;
    call.phase = 'finishing'; clearTimeout(call.timer); stopMeter(call);
    call.timer = setTimeout(() => { if (current(call)) { cancel(); notice('Dictation timed out. Try again.', call.sessionId); } }, 25000);
    try {
      const stopped = new Promise(resolve => call.recorder.addEventListener('stop', resolve, { once: true }));
      call.recorder.stop(); call.stream.getTracks().forEach(track => track.stop()); render();
      await stopped;
      if (!current(call)) return;
      const blob = new Blob(call.chunks, { type: call.recorder.mimeType }); call.chunks = [];
      if (!blob.size) { cancel(); return; }
      if (blob.size > 2 * 1024 * 1024) throw new Error('Recording is too large. Try a shorter recording.');
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read the recording. Try again.')); reader.readAsDataURL(blob);
      });
      if (!current(call)) return;
      const result = await request('voiceFinish', { sessionId: call.sessionId, voiceId: call.id,
        recording: { type: blob.type.split(';')[0], data } });
      insert(call, result.text);
    } catch (error) {
      if (current(call)) { cancel(); notice(error.message || 'Could not transcribe the recording. Try again.', call.sessionId); }
    }
  }
  async function start() {
    if (active) return;
    const state = context();
    if (!state.enabled || !supported()) return;
    const call = active = { id: crypto.randomUUID(), ...state, draft: input.value, cursor: input.selectionStart, phase: 'connecting', chunks: [], bytes: 0 };
    input.blur(); notice(''); render(); cancelButton.focus({ preventScroll: true });
    // Start Web Audio inside the tap gesture so Safari can render the microphone level.
    try { call.audio = new AudioContext(); void call.audio.resume().catch(() => {}); } catch {}
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!current(call)) { stream.getTracks().forEach(track => track.stop()); return; }
      call.stream = stream;
      call.started = true;
      await request('voiceStart', { sessionId: call.sessionId, voiceId: call.id, format: 'recording' });
      if (!current(call)) return;
      const recorder = call.recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 });
      recorder.ondataavailable = event => {
        if (!current(call)) return;
        call.bytes += event.data.size;
        if (call.bytes > 2 * 1024 * 1024) { cancel(); notice('Recording is too large. Try a shorter recording.', call.sessionId); return; }
        call.chunks.push(event.data);
      };
      recorder.onerror = () => { if (current(call)) { cancel(); notice('Microphone recording failed. Try again.', call.sessionId); } };
      recorder.start(250); call.phase = 'recording';
      if (call.audio) {
        try {
          call.analyser = call.audio.createAnalyser(); call.analyser.fftSize = 1024;
          call.source = call.audio.createMediaStreamSource(stream); call.source.connect(call.analyser);
          meter(call);
        } catch { stopMeter(call); }
      }
      call.timer = setTimeout(finish, 120000); render();
    } catch (error) {
      if (!current(call)) return;
      cancel();
      notice(error.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in browser settings to dictate.' :
        error.name === 'NotFoundError' ? 'No microphone was found.' : error.message || 'Could not start dictation.', call.sessionId);
    }
  }
  button.addEventListener('click', () => active ? void finish() : void start());
  cancelButton.addEventListener('click', cancel);
  input.addEventListener('input', cancel);
  document.addEventListener('keydown', event => { if (active && event.key === 'Escape') { event.preventDefault(); cancel(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  window.addEventListener('pagehide', cancel);
  return {
    get busy() { return !!active; },
    cancel,
    update() {
      const state = context();
      if (active && (!state.enabled || !current(active))) { cancel(); return; }
      button.hidden = !state.available;
      button.disabled = !state.enabled || !supported() || !!active && active.phase !== 'recording';
      if (!supported()) button.title = 'Dictation needs a secure browser with microphone access.';
    },
    receive(packet) {
      const call = active;
      if (!call || packet.id !== call.id || !current(call) || packet.sessionId !== call.sessionId) return;
      if (packet.cancelled) { cancel(); notice('The selected model changed. Dictation stopped.', call.sessionId); return; }
      if (packet.error) { cancel(); notice(packet.error, call.sessionId); }
    }
  };
}
