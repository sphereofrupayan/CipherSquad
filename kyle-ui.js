(function () {
  function createKyleUi(store) {
    const mount = createFloatingMount();
    mount.innerHTML = `
      <section class="kyle-global" aria-label="Kyle voice assistant">
        <div class="kyle-widget" data-state="IDLE">
          <p class="kyle-caption-bubble" aria-live="polite"></p>
          <form class="kyle-shell">
            <input class="prompt-input" type="text" autocomplete="off" placeholder="Ask Kyle anything..." aria-label="Ask Kyle">
            <button class="send-icon" type="submit" aria-label="Send to Kyle"><i class="fas fa-arrow-up"></i></button>
            <button class="kyle-orb" type="button" aria-label="Talk to Kyle">
              <span class="orb-visual" aria-hidden="true"><canvas class="orb-canvas" width="192" height="192"></canvas></span>
            </button>
            <button class="mute-icon" type="button" aria-label="Mute Kyle" title="Mute Kyle"><i class="fas fa-volume-high"></i></button>
            <span class="kyle-state-label" aria-live="polite">Kyle is idle</span>
          </form>
          <div class="kyle-result-panel"></div>
        </div>
      </section>
    `;

    const root = mount.querySelector('.kyle-global');
    const widget = mount.querySelector('.kyle-widget');
    const orb = mount.querySelector('.kyle-orb');
    const mute = mount.querySelector('.mute-icon');
    const form = mount.querySelector('.kyle-shell');
    const input = mount.querySelector('.prompt-input');
    const caption = mount.querySelector('.kyle-caption-bubble');
    const stateLabel = mount.querySelector('.kyle-state-label');
    const resultPanel = mount.querySelector('.kyle-result-panel');
    const canvas = mount.querySelector('.orb-canvas');
    const context = canvas.getContext('2d');
    let cloudPhase = 0.65;
    let captionTimer = null;

    function createFloatingMount() {
      const existing = document.getElementById('kyleMount');
      if (existing) existing.remove();
      const fallback = document.createElement('div');
      fallback.id = 'kyleMount';
      fallback.className = 'kyle-floating-mount';
      document.body.appendChild(fallback);
      return fallback;
    }

    function drawCloud(energy, phaseAdvance) {
      const size = canvas.width;
      const center = size / 2;
      cloudPhase += phaseAdvance || 0;
      context.clearRect(0, 0, size, size);

      const base = context.createRadialGradient(center * 0.72, center * 0.66, 4, center, center, center);
      base.addColorStop(0, '#fbfbf8');
      base.addColorStop(0.52, '#cfcfca');
      base.addColorStop(1, '#747473');
      context.fillStyle = base;
      context.fillRect(0, 0, size, size);

      const fields = [
        { x: 0.34, y: 0.29, radius: 0.42, light: 248, alpha: 0.90 },
        { x: 0.70, y: 0.34, radius: 0.37, light: 224, alpha: 0.72 },
        { x: 0.39, y: 0.72, radius: 0.39, light: 174, alpha: 0.55 },
        { x: 0.72, y: 0.73, radius: 0.34, light: 78, alpha: 0.48 },
        { x: 0.50, y: 0.50, radius: 0.28, light: 236, alpha: 0.36 }
      ];

      fields.forEach((field, index) => {
        const drift = 5 + energy * 22;
        const x = size * field.x + Math.sin(cloudPhase * (0.72 + index * 0.08) + index * 1.6) * drift;
        const y = size * field.y + Math.cos(cloudPhase * (0.58 + index * 0.09) + index * 1.2) * drift;
        const radius = size * field.radius * (1 + energy * Math.sin(cloudPhase * 1.3 + index) * 0.15);
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `rgba(${field.light}, ${field.light}, ${Math.max(0, field.light - 3)}, ${field.alpha})`);
        gradient.addColorStop(0.52, `rgba(${field.light}, ${field.light}, ${field.light}, ${field.alpha * 0.34})`);
        gradient.addColorStop(1, 'rgba(120, 120, 118, 0)');
        context.globalCompositeOperation = field.light > 190 ? 'screen' : 'multiply';
        context.fillStyle = gradient;
        context.fillRect(0, 0, size, size);
      });

      context.globalCompositeOperation = 'source-over';
      const edge = context.createRadialGradient(center, center, size * 0.30, center, center, center);
      edge.addColorStop(0, 'rgba(255,255,255,0)');
      edge.addColorStop(0.84, 'rgba(34,34,33,0.05)');
      edge.addColorStop(1, 'rgba(22,22,21,0.48)');
      context.fillStyle = edge;
      context.fillRect(0, 0, size, size);
    }

    function setAmplitude(value, phaseAdvance = 0.016) {
      const energy = Math.max(0, Math.min(1, value || 0));
      root.style.setProperty('--orb-amplitude', String(energy));
      drawCloud(energy, energy > 0 ? phaseAdvance * (0.7 + energy * 1.8) : 0);
    }

    function setState(next) {
      widget.dataset.state = next;
      const textByState = {
        IDLE: 'Kyle is idle',
        LISTENING: 'Kyle is listening',
        TRANSCRIBING: 'Kyle is transcribing',
        THINKING: 'Kyle is thinking',
        SPEAKING: 'Kyle is speaking',
        INTERRUPTED: 'Kyle was interrupted',
        ERROR: 'Kyle needs attention',
        RESULT: 'Kyle has results',
        ACTING: 'Kyle is acting',
        OBSERVING: 'Kyle is checking the result',
        WAITING_APPROVAL: 'Kyle is waiting for approval',
        DONE: 'Kyle finished'
      };
      stateLabel.textContent = textByState[next] || 'Kyle';
      widget.classList.toggle('is-expanded', next !== 'IDLE');
    }

    function setLiveText(text, autoHideMs = 0) {
      clearTimeout(captionTimer);
      const value = String(text || '');
      caption.classList.remove('is-visible');
      if (!value) {
        caption.textContent = '';
        widget.classList.remove('has-caption');
        return;
      }
      caption.textContent = value;
      widget.classList.add('has-caption');
      requestAnimationFrame(() => requestAnimationFrame(() => caption.classList.add('is-visible')));
      if (autoHideMs) captionTimer = setTimeout(() => setLiveText(''), autoHideMs);
    }

    function setMuted(muted) {
      mute.innerHTML = muted ? '<i class="fas fa-volume-xmark"></i>' : '<i class="fas fa-volume-high"></i>';
      mute.setAttribute('aria-label', muted ? 'Unmute Kyle' : 'Mute Kyle');
      mute.title = muted ? 'Unmute Kyle' : 'Mute Kyle';
    }

    function appendMessage(role, text) {
      const messages = document.getElementById('messages');
      if (!messages) return;
      const article = document.createElement('article');
      article.className = `message ${role}`;
      article.innerHTML = `<strong>${role === 'user' ? 'You' : 'Kyle'}</strong><p>${escapeHtml(text)}</p>`;
      messages.appendChild(article);
      messages.scrollTop = messages.scrollHeight;
    }

    function renderResults(title, items) {
      if (!items || !items.length) {
        resultPanel.classList.remove('is-visible');
        resultPanel.innerHTML = '';
        return;
      }
      resultPanel.classList.add('is-visible');
      resultPanel.innerHTML = `<strong>${escapeHtml(title)}</strong>${items.slice(0, 5).map((item, index) => `
        <button type="button" data-result="${index + 1}">${escapeHtml(item.subject || item.reason || item.title || 'Open item')}</button>
      `).join('')}`;
    }

    function renderBrief(title, items) {
      if (!items || !items.length) {
        resultPanel.classList.remove('is-visible');
        resultPanel.innerHTML = '';
        return;
      }
      resultPanel.classList.add('is-visible');
      resultPanel.innerHTML = `<strong>${escapeHtml(title || 'Kyle')}</strong>${items.slice(0, 6).map(item => `
        <div class="kyle-brief-item ${item.conflict ? 'conflict' : ''}">
          <strong>${escapeHtml(item.title || 'Item')}</strong>
          <small>${escapeHtml(item.meta || '')}</small>
        </div>
      `).join('')}`;
    }

    resultPanel.addEventListener('click', event => {
      const button = event.target.closest('[data-result]');
      if (!button) return;
      window.KyleActions.openEmail(button.dataset.result);
      resultPanel.classList.remove('is-visible');
    });

    function bind(handlers) {
      orb.addEventListener('click', handlers.onOrb);
      mute.addEventListener('click', handlers.onMute);
      input.addEventListener('focus', () => handlers.onTextFocus?.());
      input.addEventListener('input', () => handlers.onTextFocus?.());
      form.addEventListener('submit', event => {
        event.preventDefault();
        const prompt = input.value.trim();
        if (!prompt) return;
        input.value = '';
        handlers.onText(prompt);
      });
    }

    window.addEventListener('kyle:state', event => setState(event.detail.state));
    window.addEventListener('kyle:message', event => appendMessage(event.detail.role, event.detail.text));
    window.addEventListener('harness:kyle-brief', event => {
      const detail = event.detail || {};
      renderBrief(detail.title || 'Kyle', detail.items || []);
    });
    window.addEventListener('kyle:motion-caption', event => {
      const detail = event.detail || {};
      setLiveText(detail.text || '', detail.transient ? 2400 : 0);
    });

    drawCloud(0, 0);
    setState(store.current);
    setMuted(store.muted);

    return { bind, setAmplitude, setLiveText, setMuted, renderResults, renderBrief };
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  }

  window.KyleUi = { createKyleUi };
})();
