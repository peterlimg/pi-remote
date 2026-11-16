export function voiceComposer({ request, context, changed, notice }) {
  const button = document.getElementById('voice-record'), cancelButton = document.getElementById('voice-cancel');
  const panel = document.getElementById('voice-status'), status = document.getElementById('voice-label');
  const input = document.getElementById('prompt');
  const composer = document.getElementById('composer'), waveform = document.getElementById('voice-waveform');
  let active;
  const supported = () => !!(window.isSecureContext && window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia);
  const transcript = call => [...call.turns.values(), call.partial].filter(Boolean).join(' ').trim();
  const current = call => active === call && context().sessionId === call.sessionId && context().model === call.model;
  function render() {
    const reviewing = ['finishing', 'review'].includes(active?.phase);
    if (reviewing) input.setAttribute('aria-describedby', 'voice-label'); else input.removeAttribute('aria-describedby');
    cancelButton.title = reviewing ? 'Discard transcription preview' : 'Discard recording';
    panel.hidden = !active;
    if (active) composer.dataset.voice = active.phase; else delete composer.dataset.voice;
    const showingWaveform = active?.phase === 'recording' && !!active.analyser;
    waveform.hidden = !showingWaveform;
    status.classList.toggle('sr-only', showingWaveform);
    cancelButton.hidden = !active;
    button.setAttribute('aria-label', active ? 'Stop dictation' : 'Dictate with ChatGPT');
    button.title = active ? 'Stop recording and preview text' : 'Dictate with this computer’s Codex ChatGPT sign-in. Audio is sent to OpenAI.';
    button.setAttribute('aria-pressed', String(!!active));
    button.dataset.recording = String(active?.phase === 'recording');
    button.disabled = !!active && active.phase !== 'recording';
    const label = active?.phase === 'recording' ? 'Listening · directly connected to OpenAI' :
      active?.phase === 'review' ? 'Not confirmed. Check the last words.' :
      active?.phase === 'finishing' ? 'Still finishing. Last words may be missing.' : 'Connecting to ChatGPT…';
    if (status.textContent !== label) status.textContent = label;
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
    if (call.released) return;
    call.released = true;
    stopMeter(call);
    clearTimeout(call.timer); clearTimeout(call.connectTimer); clearTimeout(call.drainTimer);
    call.stream?.getTracks().forEach(track => track.stop());
    call.rejectConnection?.(new Error('Dictation cancelled.'));
    if (call.started) void request('voiceCancel', { sessionId: call.sessionId, voiceId: call.id }).catch(() => {});
    const peer = call.peer, channel = call.channel;
    if (!peer) return;
    peer.onconnectionstatechange = null;
    if (channel) { channel.onopen = null; channel.onmessage = null; channel.onclose = null; channel.onerror = null; }
    if (channel?.readyState !== 'open') { peer.close(); return; }
    let timer;
    const close = () => { clearTimeout(timer); channel.onmessage = null; channel.onclose = null; peer.close(); };
    channel.onmessage = event => { try { if (JSON.parse(event.data).type === 'session.closed') close(); } catch {} };
    channel.onclose = close;
    timer = setTimeout(close, 1000);
    try { channel.send(JSON.stringify({ type: 'session.close' })); } catch { close(); }
  }
  function cancel() {
    const call = active;
    if (!call) return;
    const restoreFocus = [button, cancelButton].includes(document.activeElement);
    if (context().sessionId === call.sessionId && call.preview !== undefined && input.value === call.preview) {
      input.value = call.draft;
      input.setSelectionRange(call.cursor, call.cursor);
    }
    active = undefined; release(call);
    render();
    if (restoreFocus && !button.hidden) button.focus({ preventScroll: true });
  }
  function preview(call) {
    if (!current(call)) return false;
    // Only our preview may be replaced; an external draft edit always wins.
    if (input.value !== (call.preview ?? call.draft)) { cancel(); return false; }
    const follow = call.preview === undefined || input.scrollHeight - input.scrollTop - input.clientHeight < 24;
    const selection = [input.selectionStart, input.selectionEnd, input.selectionDirection];
    const atTail = call.preview === undefined || selection[0] === call.previewCursor && selection[1] === call.previewCursor;
    const words = transcript(call).slice(0, 16000).trim();
    const before = call.draft.slice(0, call.cursor), after = call.draft.slice(call.cursor);
    const addition = words ? (before && !/\s$/.test(before) ? ' ' : '') + words + (after && !/^\s/.test(after) ? ' ' : '') : '';
    input.value = call.preview = before + addition + after;
    call.previewCursor = before.length + addition.length;
    if (atTail) input.setSelectionRange(call.previewCursor, call.previewCursor);
    else input.setSelectionRange(...selection);
    render();
    if (follow) input.scrollTop = input.scrollHeight;
    return true;
  }
  function freeze() {
    const call = active;
    if (!call || !current(call) || call.preview === undefined) return;
    active = undefined; release(call); render();
    if (input.value !== call.draft) input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function review(call, message) {
    if (!current(call) || call.released) return;
    if (!transcript(call).trim()) cancel();
    else {
      call.phase = 'review';
      if (!preview(call)) return;
      release(call);
    }
    if (message) notice(message, call.sessionId);
  }
  function settled(call) {
    if (current(call) && call.phase === 'finishing' && call.drained && call.turns.size && !call.partial) {
      freeze();
    }
  }
  function providerEvent(call, raw) {
    if (!current(call) || call.released) return;
    try {
      if (typeof raw !== 'string' || raw.length > 128 * 1024) throw new Error();
      const event = JSON.parse(raw);
      if (event.type === 'error' || event.type === 'session.closed') throw new Error();
      if (event.type === 'input_transcript.added' && typeof event.item?.text === 'string') call.partial += event.item.text;
      else if (event.type === 'turn.done' && event.turn?.role === 'user' && typeof event.turn.transcript === 'string') {
        if (event.turn.id && call.turns.has(event.turn.id)) return;
        if (event.turn.transcript.trim()) call.turns.set(event.turn.id || String(call.turns.size), event.turn.transcript.trim());
        call.partial = '';
      } else return; // Ignore assistant audio/text and tool requests; never forward them to the host.
      if (transcript(call).length > 16000) { review(call, 'Dictation is too long. Check the draft before sending.'); return; }
      if (call.phase === 'finishing' && preview(call)) settled(call);
    } catch { review(call, 'Dictation was interrupted. Check the draft before sending.'); }
  }
  function finish() {
    const call = active;
    if (!call || call.phase !== 'recording') return;
    call.phase = 'finishing'; clearTimeout(call.timer); stopMeter(call);
    call.stream.getTracks().forEach(track => track.stop());
    if (!preview(call)) return;
    input.focus({ preventScroll: true });
    // shortcut: no verified flush; replace this Stop-based drain when a finalization contract is available.
    call.drainTimer = setTimeout(() => { call.drained = true; settled(call); }, 1800);
    call.timer = setTimeout(() => review(call), 8000);
  }
  async function start() {
    if (active) return;
    const state = context();
    if (!state.enabled || !supported()) return;
    const call = active = { id: crypto.randomUUID(), ...state, draft: input.value, cursor: input.selectionStart, phase: 'connecting', turns: new Map(), partial: '' };
    input.blur(); notice(''); render(); cancelButton.focus({ preventScroll: true });
    // Start Web Audio inside the tap gesture so Safari can render the microphone level.
    try { call.audio = new AudioContext(); void call.audio.resume().catch(() => {}); } catch {}
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!current(call)) { stream.getTracks().forEach(track => track.stop()); return; }
      call.stream = stream;
      stream.getTracks().forEach(track => { track.enabled = false; });
      const peer = call.peer = new RTCPeerConnection();
      stream.getTracks().forEach(track => peer.addTrack(track, stream));
      const channel = call.channel = peer.createDataChannel('oai-events');
      channel.onmessage = event => providerEvent(call, event.data);
      channel.onclose = channel.onerror = () => review(call, 'Voice connection lost. Check the draft before sending.');
      peer.onconnectionstatechange = () => {
        if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) review(call, 'Voice connection lost. Check the draft before sending.');
      };
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
      if (!current(call)) return;
      call.started = true;
      const { sdp } = await request('voiceStart', { sessionId: call.sessionId, voiceId: call.id, format: 'webrtc-direct', sdp: offer.sdp });
      if (!current(call)) return;
      await peer.setRemoteDescription({ type: 'answer', sdp });
      if (!current(call)) return;
      await new Promise((resolve, reject) => {
        call.rejectConnection = reject;
        const ready = () => { clearTimeout(call.connectTimer); resolve(); };
        call.connectTimer = setTimeout(() => reject(new Error('Voice connection timed out. Try again.')), 10000);
        channel.onopen = ready; if (channel.readyState === 'open') ready();
      });
      if (!current(call)) return;
      call.rejectConnection = undefined;
      call.phase = 'recording'; stream.getTracks().forEach(track => { track.enabled = true; });
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
  input.addEventListener('beforeinput', freeze);
  input.addEventListener('compositionstart', freeze);
  input.addEventListener('input', () => active?.preview !== undefined ? freeze() : cancel());
  document.addEventListener('keydown', event => { if (active && event.key === 'Escape') { event.preventDefault(); cancel(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  window.addEventListener('pagehide', cancel);
  return {
    get busy() { return ['connecting', 'recording'].includes(active?.phase); },
    cancel,
    freeze,
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
