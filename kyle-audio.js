(function () {
  function createAudioEngine(onAmplitude) {
    let audioContext = null;
    let analyser = null;
    let source = null;
    let rafId = null;
    let stream = null;
    let recorder = null;
    let chunks = [];
    let smoothed = 0;
    let closeTimer = null;
    const data = new Float32Array(1024);

    function ensureContext() {
      audioContext = audioContext || new AudioContext();
      return audioContext;
    }

    function micLive() {
      return Boolean(stream && stream.getAudioTracks().some(track => track.readyState === 'live'));
    }

    function startAnalyser() {
      if (!analyser || rafId) return;
      const tick = () => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        const normalized = Math.max(0, Math.min(1, (rms - 0.018) * 9));
        smoothed = smoothed * 0.75 + normalized * 0.25;
        onAmplitude(smoothed);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }

    function stopAnalyser() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      smoothed = 0;
      onAmplitude(0);
    }

    function cancelScheduledClose() {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = null;
    }

    async function openMic() {
      cancelScheduledClose();
      if (!micLive()) {
        const started = performance.now();
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        console.log(`[Kyle Voice] cold mic ready in ${Math.round(performance.now() - started)} ms`);
      } else {
        console.log('[Kyle Voice] warm mic reused');
      }

      const ctx = ensureContext();
      if (ctx.state === 'suspended') await ctx.resume();
      if (!analyser || !source) {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
      }
      startAnalyser();
      return stream;
    }

    function startRecording(onChunk, onStop) {
      if (!micLive()) throw new Error('Microphone is not ready');
      chunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined;
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = event => {
        if (event.data.size > 0) {
          chunks.push(event.data);
          onChunk?.(event.data);
        }
      };
      recorder.onstop = () => onStop?.(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
      recorder.start(250);
      return recorder;
    }

    async function connectAudioElement(audio) {
      const ctx = ensureContext();
      await ctx.resume();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source = ctx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(ctx.destination);
      startAnalyser();
    }

    function cleanupMic() {
      cancelScheduledClose();
      stopAnalyser();
      recorder = null;
      if (source) { try { source.disconnect(); } catch (_) {} }
      source = null;
      analyser = null;
      stream?.getTracks().forEach(track => track.stop());
      stream = null;
      console.log('[Kyle Voice] mic closed');
    }

    function scheduleMicClose(delayMs = 10000) {
      cancelScheduledClose();
      closeTimer = setTimeout(cleanupMic, Math.max(0, delayMs));
    }

    function cleanupAudio() {
      stopAnalyser();
      if (source) { try { source.disconnect(); } catch (_) {} }
      source = null;
      analyser = null;
    }

    return {
      openMic,
      startRecording,
      connectAudioElement,
      cleanupMic,
      scheduleMicClose,
      cancelScheduledClose,
      isMicLive: micLive,
      cleanupAudio
    };
  }

  window.KyleAudio = { createAudioEngine };
})();
