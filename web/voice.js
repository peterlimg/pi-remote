export function voiceComposer({ request, context, changed, notice, queue }) {
  const button = document.getElementById('voice-record'), cancelButton = document.getElementById('voice-cancel');
  const panel = document.getElementById('voice-status'), status = document.getElementById('voice-label');
  const input = document.getElementById('prompt');
  const composer = document.getElementById('composer'), waveform = document.getElementById('voice-waveform');
  let active, audio, prepared;
  const supported = () => !!(window.isSecureContext && window.RTCPeerConnection && window.AudioWorkletNode && navigator.mediaDevices?.getUserMedia);
  function prepare() {
    if (!audio || audio.state === 'closed') {
      audio = new AudioContext();
      prepared = audio.audioWorklet.addModule('/voice-buffer.js');
      void prepared.catch(() => {});
    }
    return audio;
  }
  const transcript = call => [...call.turns.values(), call.partial].filter(Boolean).join(' ').trim();
  const current = call => active === call && context().sessionId === call.sessionId && context().model === call.model;
  function render() {
    const capturing = ['preparing', 'recording', 'sending'].includes(active?.phase);
    panel.hidden = !capturing;
    composer.toggleAttribute('data-capturing', capturing);
    if (active) composer.dataset.voice = active.phase; else delete composer.dataset.voice;
    const showingWaveform = active?.phase === 'recording' && !!active.analyser;
    waveform.hidden = !showingWaveform;
    status.classList.toggle('sr-only', showingWaveform);
    cancelButton.hidden = !capturing;
    button.setAttribute('aria-label', capturing ? 'Stop dictation' : 'Dictate with ChatGPT');
    button.title = capturing ? 'Stop recording and keep a draft' : 'Dictate with this computer’s Codex ChatGPT sign-in. Audio is sent to OpenAI.';
    button.setAttribute('aria-pressed', String(capturing));
    button.dataset.recording = String(active?.phase === 'recording');
    button.disabled = active?.phase === 'preparing';
    const label = active?.phase === 'recording' ? 'Listening' :
      active?.phase === 'sending' ? 'Transcribing…' : active?.phase === 'preparing' ? 'Starting microphone…' : '';
    if (status.textContent !== label) status.textContent = label;
    changed();
  }
  function stopMeter(call) {
    cancelAnimationFrame(call.frame);
    call.source?.disconnect();
    call.analyser?.disconnect();
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
        waveform.append(bar); history.push({ bar, at: now, height: 3 });
      }
      const width = waveform.clientWidth;
      while (history.length && (now - history[0].at) * 6 / 65 > width) history.shift().bar.remove();
      if (history.length) history.at(-1).height = level < .005 ? 3 : 3 + level * 27;
      for (const { bar, at, height } of history) {
        const distance = (now - at) * 6 / 65, edge = Math.max(0, width - 3 - distance);
        const taper = Math.min(1, Math.max(0, (edge - 6) / 36));
        bar.style.height = (3 + (height - 3) * taper * taper * (3 - 2 * taper)) + 'px';
        bar.style.transform = `translate3d(${-distance}px, -50%, 0)`;
        bar.style.opacity = String(Math.min(1, (now - at) / 50, edge / 6));
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
    call.output?.stream.getTracks().forEach(track => track.stop());
    if (call.buffer) {
      call.buffer.port.postMessage('dispose'); call.buffer.port.onmessage = null; call.buffer.port.close();
      call.buffer.onprocessorerror = null; call.buffer.disconnect();
    }
    if (call.audio) void call.audio.suspend().catch(() => {});
    call.rejectConnection?.(new Error('Dictation cancelled.'));
    call.ready = undefined;
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
  function cancel(keepPending = false) {
    const call = active;
    if (!call) return;
    const restoreFocus = [button, cancelButton].includes(document.activeElement);
    if (!call.pending && context().sessionId === call.sessionId && call.preview !== undefined && input.value === call.preview) {
      input.value = call.draft;
      input.setSelectionRange(call.cursor, call.cursor);
    }
    active = undefined; release(call);
    call.pending?.keep(keepPending && transcript(call).trim() ? call.preview : call.draft, true);
    render();
    if (restoreFocus && !button.hidden) button.focus({ preventScroll: true });
  }
  function preview(call) {
    if (!current(call)) return false;
    // Only our preview may be replaced; an external draft edit always wins.
    if (!call.pending && input.value !== (call.preview ?? call.draft)) { cancel(); return false; }
    const words = transcript(call).slice(0, 16000).trim();
    const before = call.draft.slice(0, call.cursor), after = call.draft.slice(call.cursor);
    const addition = words ? (before && !/\s$/.test(before) ? ' ' : '') + words + (after && !/^\s/.test(after) ? ' ' : '') : '';
    const text = before + addition + after;
    if (call.pending) { call.preview = text; call.pending.update(text); return true; }
    const follow = call.preview === undefined || input.scrollHeight - input.scrollTop - input.clientHeight < 24;
    const selection = [input.selectionStart, input.selectionEnd, input.selectionDirection];
    const atTail = call.preview === undefined || selection[0] === call.previewCursor && selection[1] === call.previewCursor;
    input.value = call.preview = text;
    call.previewCursor = before.length + addition.length;
    if (atTail) input.setSelectionRange(call.previewCursor, call.previewCursor);
    else input.setSelectionRange(...selection);
    render();
    if (follow) input.scrollTop = input.scrollHeight;
    return true;
  }
  function freeze() {
    const call = active;
    if (!call || call.pending || !current(call) || call.preview === undefined) return;
    active = undefined; release(call); render();
    if (input.value !== call.draft) input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function review(call, message) {
    if (!current(call) || call.released) return;
    if (!transcript(call).trim()) cancel();
    else if (call.pending) {
      active = undefined; release(call); call.pending.keep(call.preview); render();
    } else {
      call.phase = 'review';
      if (!preview(call)) return;
      release(call);
    }
    if (message) notice(message, call.sessionId);
  }
  function complete(call) {
    if (!current(call)) return;
    if (call.pending && !transcript(call).trim()) { cancel(); return; }
    if (!preview(call)) return;
    if (call.pending) {
      active = undefined; release(call); call.pending.submit(); render();
    } else freeze();
  }
  function settled(call) {
    clearTimeout(call.drainTimer);
    if (!current(call) || call.released || !['finishing', 'sending'].includes(call.phase) || call.drainedAt === undefined) return;
    const final = call.finalAt >= call.drainedAt && call.turns.size && !call.partial;
    if (!final && (call.phase !== 'sending' || !call.progressAfterStop)) return;
    // shortcut: quiet text is not a completion guarantee; replace when the provider supports an audio flush.
    const readyAt = final ? call.drainedAt + 1800 : Math.max(call.drainedAt + 2500, call.transcriptAt + 1000);
    const remaining = readyAt - performance.now();
    if (remaining > 0) call.drainTimer = setTimeout(() => settled(call), remaining);
    else complete(call);
  }
  function providerEvent(call, raw) {
    if (!current(call) || call.released) return;
    try {
      if (typeof raw !== 'string' || raw.length > 128 * 1024) throw new Error();
      const event = JSON.parse(raw), before = transcript(call);
      if (event.type === 'error' || event.type === 'session.closed') throw new Error();
      if (event.type === 'session.started') { call.providerReady = true; call.ready?.(); return; }
      if (event.type === 'input_transcript.added' && typeof event.item?.text === 'string') call.partial += event.item.text;
      else if (event.type === 'turn.done' && event.turn?.role === 'user' && typeof event.turn.transcript === 'string') {
        if (event.turn.id && call.turns.has(event.turn.id)) return;
        if (event.turn.transcript.trim()) call.turns.set(event.turn.id || String(call.turns.size), event.turn.transcript.trim());
        call.partial = '';
        call.finalAt = performance.now();
      } else return; // Ignore assistant audio/text and tool requests; never forward them to the host.
      const text = transcript(call);
      if (text !== before) {
        call.transcriptAt = performance.now();
        call.progressAfterStop ||= ['finishing', 'sending'].includes(call.phase);
      }
      if (text.length > 16000) { review(call, 'Dictation is too long. Check the draft before sending.'); return; }
      if (!preview(call)) return;
      settled(call);
    } catch { review(call, 'Dictation was interrupted. Check the draft before sending.'); }
  }
  function finish(sending = false) {
    const call = active;
    if (!call || !['recording', 'finishing', 'sending'].includes(call.phase)) return;
    if (!sending && call.pending) {
      active = undefined; release(call); call.pending.keep(call.preview, true); render(); return;
    }
    if (call.phase === 'recording') {
      clearTimeout(call.timer);
      call.buffer.port.postMessage('stop');
      call.stream.getTracks().forEach(track => track.stop());
      stopMeter(call);
    }
    call.phase = sending ? 'sending' : 'finishing';
    if (!preview(call)) return;
    if (sending) call.pending = queue(call.preview);
    settled(call);
  }
  async function start() {
    if (active) return;
    const state = context();
    if (!state.enabled || !supported()) return;
    const call = active = { id: crypto.randomUUID(), ...state, draft: input.value, cursor: input.selectionStart, phase: 'preparing', turns: new Map(), partial: '' };
    notice(''); if (!preview(call)) return;
    try {
      call.audio = prepare();
      await Promise.all([prepared, call.audio.resume()]);
      if (!current(call) || call.released) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (!current(call) || call.released) { stream.getTracks().forEach(track => track.stop()); return; }
      call.stream = stream;
      call.output = call.audio.createMediaStreamDestination();
      call.buffer = new AudioWorkletNode(call.audio, 'voice-buffer', { channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1] });
      call.buffer.connect(call.output);
      call.buffer.onprocessorerror = () => review(call, 'Audio capture failed. Check the draft before trying again.');
      call.buffer.port.onmessage = ({ data }) => {
        if (!current(call) || call.released) return;
        if (data === 'overflow') { review(call, 'Voice connection took too long. Please record again.'); return; }
        if (data !== 'drained' || call.drainedAt !== undefined) return;
        call.drainedAt = performance.now();
        settled(call);
        call.timer = setTimeout(() => review(call, call.phase === 'sending' && transcript(call) ?
          'Dictation took too long. Check the draft before sending.' : undefined), 8000);
      };
      call.source = call.audio.createMediaStreamSource(stream);
      call.source.connect(call.buffer);
      call.analyser = call.audio.createAnalyser(); call.analyser.fftSize = 1024;
      call.source.connect(call.analyser);
      call.phase = 'recording'; render(); meter(call);
      call.timer = setTimeout(() => finish(), 120000);
      const peer = call.peer = new RTCPeerConnection();
      call.output.stream.getTracks().forEach(track => peer.addTrack(track, call.output.stream));
      const channel = call.channel = peer.createDataChannel('oai-events');
      channel.onmessage = event => providerEvent(call, event.data);
      channel.onclose = channel.onerror = () => review(call, 'Voice connection lost. Check the draft before sending.');
      peer.onconnectionstatechange = () => {
        if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) review(call, 'Voice connection lost. Check the draft before sending.');
      };
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
      if (!current(call) || call.released) return;
      call.started = true;
      const { sdp } = await request('voiceStart', { sessionId: call.sessionId, voiceId: call.id, format: 'webrtc-direct', sdp: offer.sdp });
      if (!current(call) || call.released) return;
      await peer.setRemoteDescription({ type: 'answer', sdp });
      if (!current(call) || call.released) return;
      await new Promise((resolve, reject) => {
        call.rejectConnection = reject;
        const ready = call.ready = () => {
          if (channel.readyState !== 'open' || !call.providerReady) return;
          clearTimeout(call.connectTimer); resolve();
        };
        call.connectTimer = setTimeout(() => reject(new Error('Voice connection timed out. Try again.')), 10000);
        channel.onopen = ready; if (channel.readyState === 'open') ready();
      });
      if (!current(call) || call.released) return;
      call.rejectConnection = call.ready = undefined;
      call.buffer.port.postMessage('play');
    } catch (error) {
      if (!current(call) || call.released) return;
      review(call, error.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in browser settings to dictate.' :
        error.name === 'NotFoundError' ? 'No microphone was found.' : error.message || 'Could not start dictation.');
    }
  }
  button.addEventListener('click', () => {
    if (['recording', 'sending'].includes(active?.phase)) finish();
    else { freeze(); void start(); }
  });
  cancelButton.addEventListener('click', () => cancel());
  input.addEventListener('beforeinput', freeze);
  input.addEventListener('compositionstart', freeze);
  input.addEventListener('input', () => active?.preview !== undefined ? freeze() : cancel());
  document.addEventListener('keydown', event => { if (active && event.key === 'Escape') { event.preventDefault(); cancel(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(true); });
  window.addEventListener('pagehide', () => { cancel(true); void audio?.close().catch(() => {}); });
  if (supported()) { try { prepare(); } catch {} }
  return {
    get active() { return !!active; },
    get busy() { return ['preparing', 'recording', 'sending'].includes(active?.phase); },
    get blocksSend() { return ['preparing', 'sending'].includes(active?.phase); },
    send() {
      if (['recording', 'finishing'].includes(active?.phase)) { finish(true); return true; }
      return ['preparing', 'sending'].includes(active?.phase);
    },
    cancel: () => cancel(true),
    freeze,
    update() {
      const state = context();
      if (active && (!state.enabled || !current(active))) { cancel(true); return; }
      button.hidden = !state.available;
      button.disabled = !state.enabled || !supported() || active?.phase === 'preparing';
      if (!supported()) button.title = 'Dictation needs a secure browser with microphone access.';
    },
    receive(packet) {
      const call = active;
      if (!call || packet.id !== call.id || !current(call) || packet.sessionId !== call.sessionId) return;
      if (packet.cancelled) { cancel(true); notice('The selected model changed. Dictation stopped.', call.sessionId); return; }
      if (packet.error) review(call, packet.error);
    }
  };
}
