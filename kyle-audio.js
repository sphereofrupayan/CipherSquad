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
    const data = new Float32Array(1024);

    function ensureContext() {
      audioContext = audioContext || new AudioContext();
      return audioContext;
    }

    function startAnalyser() {
      if (!analyser) return;
      const tick = () => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        const noiseFloor = 0.018;
        const normalized = Math.max(0, Math.min(1, (rms - noiseFloor) * 9));
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

    async function openMic() {
      console.log('[Kyle Voice] mic opened');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = ensureContext();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      startAnalyser();
      return stream;
    }

    function startRecording(onChunk, onStop) {
      chunks = [];
      recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined });
      recorder.ondataavailable = event => {
        if (event.data.size > 0) {
          chunks.push(event.data);
          onChunk?.(event.data);
        }
      };
      recorder.onstop = () => onStop?.(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
      recorder.start(1000);
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
      stopAnalyser();
      recorder = null;
      if (source) source.disconnect();
      source = null;
      analyser = null;
      stream?.getTracks().forEach(track => track.stop());
      stream = null;
      console.log('[Kyle Voice] mic closed');
    }

    function cleanupAudio() {
      stopAnalyser();
      if (source) source.disconnect();
      source = null;
      analyser = null;
    }

    return { openMic, startRecording, connectAudioElement, cleanupMic, cleanupAudio };
  }

  window.KyleAudio = { createAudioEngine };
})();
