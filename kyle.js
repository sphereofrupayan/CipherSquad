(function () {
  const API_BASE = window.location.origin;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const store = window.KyleState.createKyleState();
  const ui = window.KyleUi.createKyleUi(store);
  const audio = window.KyleAudio.createAudioEngine(handleMicAmplitude);

  let recognition = null;
  let recognitionTranscript = '';
  let recognitionTimer = null;
  let currentRecorder = null;
  let activeRun = 0;
  let utterance = null;
  let speakingRaf = null;
  let speakingStartedAt = 0;
  let smoothedSpeechEnergy = 0;
  let bargePeaks = 0;

  ui.bind({
    onOrb: () => {
      if (store.current === store.states.SPEAKING) {
        interrupt(true);
        return;
      }
      if (store.current === store.states.LISTENING || store.current === store.states.TRANSCRIBING) {
        stopListening();
        return;
      }
      startListening();
    },
    onMute: () => {
      store.muted = !store.muted;
      ui.setMuted(store.muted);
      if (store.muted) interrupt(false);
    },
    onTextFocus: () => stopAudioForText(),
    onText: prompt => {
      stopAudioForText();
      handlePrompt(prompt);
    }
  });

  async function startListening() {
    if (store.muted) return;
    if (store.current === store.states.LISTENING || store.current === store.states.TRANSCRIBING) return;
    interrupt(false);

    activeRun += 1;
    const run = activeRun;
    recognitionTranscript = '';

    try {
      const sttRes = await fetch(`${API_BASE}/api/stt/status`).catch(() => null);
      if (sttRes && sttRes.ok) {
        const status = await sttRes.json();
        if (status.loaded || status.available) {
          return startWhisperListening(run);
        }
      }
    } catch (_) {}

    return startBrowserListening(run);
  }

  async function startWhisperListening(run) {
    try {
      await audio.openMic();
      if (run !== activeRun) return;

      store.set(store.states.LISTENING);
      ui.setLiveText('Listening (Whisper)...');
      console.log('[Kyle Voice] local Whisper recording started');

      currentRecorder = audio.startRecording(
        () => {},
        async blob => {
          currentRecorder = null;
          audio.cleanupMic();
          if (run !== activeRun) return;
          if (!blob || blob.size < 1000) {
            store.set(store.states.IDLE);
            ui.setLiveText('');
            return;
          }
          store.set(store.states.TRANSCRIBING);
          ui.setLiveText('Transcribing with Whisper...');
          try {
            const formData = new FormData();
            formData.append('audio', blob, 'recording.webm');
            const res = await fetch(`${API_BASE}/api/stt/transcribe`, {
              method: 'POST',
              body: formData
            });
            if (!res.ok) throw new Error(`Whisper STT returned ${res.status}`);
            const data = await res.json();
            const transcript = String(data.text || '').trim();
            if (transcript) {
              handlePrompt(transcript, run);
            } else {
              store.set(store.states.IDLE);
              ui.setLiveText('');
            }
          } catch (e) {
            console.warn('[Kyle Voice] Whisper transcription error:', e);
            fail('Whisper transcription failed. Try speaking again.');
          }
        }
      );
      recognitionTimer = setTimeout(() => stopListening(), 15000);
    } catch (error) {
      console.warn('[Kyle Voice] local recording failed, falling back to browser:', error);
      startBrowserListening(run);
    }
  }

  async function startBrowserListening(run) {
    if (!SpeechRecognition) {
      fail('Voice input is unavailable. You can still type to Kyle.');
      return;
    }

    try {
      await audio.openMic();
      if (run !== activeRun) return;

      recognition = new SpeechRecognition();
      recognition.lang = 'en-IN';
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        store.set(store.states.LISTENING);
        ui.setLiveText('Listening…');
        console.log('[Kyle Voice] browser fallback recognition started');
      };

      recognition.onresult = event => {
        let interim = '';
        let finalText = '';
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const text = event.results[index][0]?.transcript || '';
          if (event.results[index].isFinal) finalText += text;
          else interim += text;
        }
        if (finalText.trim()) recognitionTranscript = `${recognitionTranscript} ${finalText}`.trim();
        ui.setLiveText((recognitionTranscript || interim).trim());
      };

      recognition.onerror = event => {
        console.warn('[Kyle Voice] browser recognition error:', event.error);
        if (event.error === 'aborted' || event.error === 'no-speech') return;
        fail(`Voice input could not continue (${event.error}).`);
      };

      recognition.onend = () => finishBrowserRecognition(run);
      recognition.start();
      recognitionTimer = setTimeout(() => stopListening(), 15000);
    } catch (error) {
      console.error('[Kyle Voice] mic failed:', error.message || error);
      audio.cleanupMic();
      fail('Microphone access failed. You can still type to Kyle.');
    }
  }

  function stopListening() {
    clearTimeout(recognitionTimer);
    recognitionTimer = null;

    if (currentRecorder && currentRecorder.state !== 'inactive') {
      try { currentRecorder.stop(); } catch (_) {}
      return;
    }

    if (recognition) {
      try { recognition.stop(); } catch (_) { finishBrowserRecognition(activeRun); }
      return;
    }

    audio.cleanupMic();
    store.set(store.states.IDLE);
  }

  function finishBrowserRecognition(run) {
    clearTimeout(recognitionTimer);
    recognitionTimer = null;
    recognition = null;
    audio.cleanupMic();
    ui.setAmplitude(0, 0);
    if (run !== activeRun) return;

    const transcript = recognitionTranscript.trim();
    recognitionTranscript = '';
    if (!transcript) {
      store.set(store.states.IDLE);
      ui.setLiveText('');
      return;
    }

    handlePrompt(transcript, run);
  }

  function handleMicAmplitude(value) {
    if (store.muted) return;
    if (store.current === store.states.LISTENING) {
      ui.setAmplitude(value, 0.016);
      return;
    }

    if (store.current !== store.states.SPEAKING || performance.now() - speakingStartedAt < 650) return;
    bargePeaks = value > 0.42 ? bargePeaks + 1 : Math.max(0, bargePeaks - 1);
    if (bargePeaks >= 5) {
      console.log('[Kyle Voice] barge-in detected');
      bargePeaks = 0;
      interrupt(true);
    }
  }

  async function handlePrompt(prompt, run = ++activeRun) {
    const cleanPrompt = String(prompt || '').trim();
    if (!cleanPrompt) return;

    store.addMessage('user', cleanPrompt);
    ui.setLiveText(cleanPrompt);

    if (window.KylePlanner?.isUndo(cleanPrompt)) {
      const undone = await window.KyleExecutor?.undoLast?.();
      const reply = undone?.message || 'There is nothing I can safely undo yet.';
      store.addMessage('kyle', reply);
      ui.setLiveText(reply, 4200);
      speak(reply, run);
      return;
    }

    if (window.KyleExecutor?.pending?.() && window.KylePlanner?.isApproval(cleanPrompt)) {
      const approved = await window.KyleExecutor.approvePending();
      store.addMessage('kyle', approved.message);
      ui.setLiveText(approved.message, 4200);
      speak(approved.message, run);
      return;
    }

    if (window.KyleExecutor?.pending?.() && window.KylePlanner?.isCancellation(cleanPrompt)) {
      const cancelled = window.KyleExecutor.cancelPending();
      store.addMessage('kyle', cancelled.message);
      ui.setLiveText(cancelled.message, 4200);
      speak(cancelled.message, run);
      return;
    }

    const resolution = window.KyleReferents?.resolvePrompt(cleanPrompt) || {
      hasReference: false,
      references: [],
      unresolved: false
    };

    if (resolution.unresolved) {
      const clarification = resolution.clarification || 'Which item do you mean? Select it and ask me again.';
      store.addMessage('kyle', clarification);
      ui.setLiveText(clarification, 5200);
      speak(clarification, run);
      return;
    }

    try {
      store.set(store.states.THINKING);
      const response = await fetch(`${API_BASE}/api/kyle/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: cleanPrompt,
          userId: getUserId(),
          context: store.context,
          uiContext: window.MailmateContext?.snapshot?.() || {},
          resolvedReferences: resolution.references,
          selectedCalendarEventId: window.AgentCalendar?.getSelectedEventId?.() || null
        })
      });
      if (!response.ok) throw new Error(`Kyle returned ${response.status}`);

      const data = await response.json();
      let reply = String(data.reply || data.text || '').trim() || 'Done.';
      let voice = String(data.voice || compactVoice(reply)).trim();

      if (run !== activeRun) return;

      const plan = window.KylePlanner?.fromResponse(cleanPrompt, data, resolution) || {
        id: `run_${Date.now().toString(36)}`,
        goal: cleanPrompt,
        steps: data.actions || []
      };
      const transaction = await window.KyleExecutor?.execute?.(plan);
      if (transaction && !['complete', 'waiting-approval'].includes(transaction.status)) {
        console.warn('[Kyle Agent] action transaction ended', transaction.status, transaction);
      }
      if (transaction?.status === 'waiting-approval') {
        reply = 'The preview is ready. Say confirm to save it, or cancel to leave your calendar unchanged.';
        voice = reply;
      } else {
        const observed = transaction?.narration || narrateObservedActions(data.actions || []);
        if (observed) {
          reply = observed;
          voice = observed;
        }
      }
      applyCommand(data.command);
      if (data.brief?.items?.length) {
        ui.renderBrief(data.brief.title || 'Kyle', data.brief.items);
      }

      store.addMessage('kyle', reply);
      ui.setLiveText(voice || reply, 5200);
      speak(voice || reply, run);
    } catch (error) {
      console.error('[Kyle Voice] chat failed:', error.message || error);
      fail(error.message || 'Kyle chat failed.');
    }
  }

  function applyCommand(command) {
    if (!command) return;
    if (command.type === 'open_page' && command.page) {
      window.KyleActions.openPage(command.page);
      return;
    }
    if (command.type === 'calendar_refresh') {
      window.dispatchEvent(new CustomEvent('harness:calendar-refresh'));
    }
  }

  function compactVoice(text) {
    const clean = String(text || '')
      .replace(/[*_#>`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!clean) return '';
    const sentences = clean.split(/(?<=[.!?])\s+/);
    let spoken = sentences[0] || clean;
    if (spoken.length < 75 && sentences[1]) spoken += ' ' + sentences[1];
    if (spoken.length > 190) spoken = spoken.slice(0, 190).replace(/\s+\S*$/, '') + '.';
    return spoken;
  }

  function speak(text, run) {
    stopSpeech(false);
    if (store.muted || !('speechSynthesis' in window) || !text) {
      store.set(window.KyleExecutor?.pending?.() ? store.states.WAITING_APPROVAL : store.states.IDLE);
      return;
    }

    store.set(store.states.SPEAKING);
    utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.02;
    utterance.pitch = 0.97;
    utterance.volume = 1;
    chooseVoice(utterance);

    utterance.onstart = () => {
      if (run !== activeRun) return;
      speakingStartedAt = performance.now();
      smoothedSpeechEnergy = 0;
      bargePeaks = 0;
      startSpeechAnimation(text, run);
      // Only open the mic for barge-in after speech begins.
      if (!store.muted) audio.openMic().catch(error => console.warn('[Kyle Voice] barge-in mic unavailable:', error.message || error));
    };

    utterance.onend = () => finishSpeech(run);
    utterance.onerror = event => {
      if (event.error === 'interrupted' || event.error === 'canceled') return;
      finishSpeech(run);
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function chooseVoice(target) {
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(voice => /^en-IN/i.test(voice.lang) && /natural|google|microsoft/i.test(voice.name))
      || voices.find(voice => /^en-(IN|GB|US)/i.test(voice.lang));
    if (preferred) target.voice = preferred;
  }

  function startSpeechAnimation(text, run) {
    cancelAnimationFrame(speakingRaf);
    const estimatedDuration = Math.max(1200, text.length * 44);

    const tick = now => {
      if (run !== activeRun || store.current !== store.states.SPEAKING) return;
      const elapsed = now - speakingStartedAt;
      const t = elapsed / 1000;
      const progress = Math.min(0.99, elapsed / estimatedDuration);
      const character = text[Math.floor(progress * text.length)] || '';
      const punctuationDip = /[.,!?;:]/.test(character) ? 0.18 : 1;
      const syllables = Math.abs(Math.sin(t * 7.1 + Math.sin(t * 1.7))) * 0.38;
      const consonants = Math.abs(Math.sin(t * 13.7 + 1.2)) * 0.23;
      const phrase = 0.18 + Math.abs(Math.sin(t * 2.25 + 0.4)) * 0.22;
      const microPause = Math.sin(t * 3.9) > 0.93 ? 0.22 : 1;
      const target = Math.min(1, (phrase + syllables + consonants) * punctuationDip * microPause);
      smoothedSpeechEnergy = smoothedSpeechEnergy * 0.72 + target * 0.28;
      ui.setAmplitude(smoothedSpeechEnergy, 0.018);
      speakingRaf = requestAnimationFrame(tick);
    };

    speakingRaf = requestAnimationFrame(tick);
  }

  function finishSpeech(run) {
    if (run !== activeRun) return;
    stopSpeech(false);
    store.set(window.KyleExecutor?.pending?.() ? store.states.WAITING_APPROVAL : store.states.IDLE);
    console.log('[Kyle Voice] short response finished');
  }

  function stopSpeech(cancelVoice = true) {
    if (speakingRaf) cancelAnimationFrame(speakingRaf);
    speakingRaf = null;
    if (cancelVoice && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    utterance = null;
    audio.cleanupMic();
    ui.setAmplitude(0, 0);
    smoothedSpeechEnergy = 0;
  }

  function interrupt(thenListen) {
    activeRun += 1;
    clearTimeout(recognitionTimer);
    recognitionTimer = null;

    if (currentRecorder && currentRecorder.state !== 'inactive') {
      try {
        currentRecorder.onstop = null;
        currentRecorder.stop();
      } catch (_) {}
      currentRecorder = null;
    }

    if (recognition) {
      recognition.onend = null;
      try { recognition.abort(); } catch (_) {}
      recognition = null;
    }

    stopSpeech(true);
    audio.cleanupMic();
    store.set(store.states.INTERRUPTED);
    if (thenListen && !store.muted) setTimeout(() => startListening(), 90);
    else store.set(store.states.IDLE);
  }

  function narrateObservedActions(actions) {
    const filterAction = [...actions].reverse().find(action => action?.tool === 'inbox.set_filter');
    if (filterAction) {
      const filter = String(filterAction.args?.filter || 'all');
      const active = document.querySelector('.filter-tab.active')?.dataset.filter;
      if (active !== filter) return '';
      const count = document.querySelectorAll('#emailList .email-item').length;
      const nouns = {
        important: ['important message', 'important messages'],
        unread: ['unread message', 'unread messages'],
        action: ['message requiring action', 'messages requiring action'],
        all: ['message', 'messages']
      };
      const [singular, plural] = nouns[filter] || nouns.all;
      if (count === 0) return `You don't have any ${plural} right now.`;
      return count === 1 ? `I found 1 ${singular}.` : `I found ${count} ${plural}.`;
    }
    return '';
  }

  function stopAudioForText() {
    const active = recognition || currentRecorder || [store.states.LISTENING, store.states.TRANSCRIBING, store.states.SPEAKING].includes(store.current);
    if (active) interrupt(false);
  }

  function fail(message) {
    store.set(store.states.ERROR);
    ui.setAmplitude(0, 0);
    ui.setLiveText(message, 4200);
    window.dispatchEvent(new CustomEvent('harness:error', { detail: { message } }));
    setTimeout(() => store.set(store.states.IDLE), 650);
  }

  function setContext(context) {
    store.context = context;
    window.dispatchEvent(new CustomEvent('harness:context', { detail: context }));
  }

  function runLocalAction(prompt) {
    const text = prompt.toLowerCase();
    const emails = store.context?.emails || [];

    if (/open\s+(my\s+)?calendar/.test(text)) {
      window.KyleActions.navigation.openCalendar();
    }

    if (/top\s*(ten|10)|important|priority/.test(text) && emails.length) {
      const ranked = emails
        .filter(email => /urgent|asap|blocked|approval|deadline|waiting|review|important/i.test(`${email.subject || ''} ${email.snippet || ''}`))
        .concat(emails)
        .filter((email, index, all) => all.findIndex(candidate => (candidate.id || candidate.gmail_id || candidate.subject) === (email.id || email.gmail_id || email.subject)) === index)
        .slice(0, 10);
      window.KyleActions.showEmailResults(ranked);
      ui.renderResults('Top emails', ranked);
    }

    const openMatch = text.match(/open\s+(?:email\s+)?(?:number\s+)?(\d+)/);
    if (openMatch) window.KyleActions.openEmail(openMatch[1]);
  }

  function getUserId() {
    return localStorage.getItem('userId') || store.context?.user_id || '';
  }

  window.Kyle = { store, setContext, startListening, interrupt, handlePrompt };
})();
