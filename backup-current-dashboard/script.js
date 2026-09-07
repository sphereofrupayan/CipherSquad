const googleConfig = {
  clientId: '',
  backendAuthUrl: '/auth/google',
  envLoaded: false,
  envError: ''
};

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly'
].join(' ');

document.addEventListener('DOMContentLoaded', () => {
  const logoCanvas = document.getElementById('dotLogo');
  const logoContext = logoCanvas.getContext('2d');
  const logoDots = [];
  const pointer = { x: -2000, y: -2000 };
  const appState = {
    tokenClient: null,
    accessToken: '',
    profile: null,
    messages: []
  };

  const demoMessages = [
    {
      id: 'demo-1',
      from: 'Kartikay',
      email: 'kartikay@ciphersquad.dev',
      subject: 'Client Portal v2 deployment blocked',
      time: '10:42 AM',
      snippet: "Backend API is complete, but deployment cannot begin until Sreyanko approves the database schema.",
      body: "Backend API is complete, but deployment cannot begin until Sreyanko approves the database schema.\n\nI can deploy as soon as the approval lands."
    },
    {
      id: 'demo-2',
      from: 'Sreyanko',
      email: 'sreyanko@ciphersquad.dev',
      subject: 'Re: Client Portal v2 deployment blocked',
      time: '11:08 AM',
      snippet: "I'll review it by Monday.",
      body: "I'll review the database schema by Monday. If anything looks risky, I will mark changes in the doc."
    },
    {
      id: 'demo-3',
      from: 'Priyam',
      email: 'priyam@ciphersquad.dev',
      subject: 'Frontend integration timeline',
      time: '11:31 AM',
      snippet: "Frontend integration needs the deployed API. We need everything ready before Wednesday's client demo.",
      body: "Frontend integration needs the deployed API. We need everything ready before Wednesday's client demo."
    },
    {
      id: 'demo-4',
      from: 'Kartikay',
      email: 'kartikay@ciphersquad.dev',
      subject: 'Still waiting on schema approval',
      time: '12:12 PM',
      snippet: 'Still waiting for schema approval.',
      body: 'Still waiting for schema approval. This is now blocking deployment and pushing frontend integration closer to the demo.'
    }
  ];

  document.querySelectorAll('img').forEach(img => {
    img.addEventListener('error', function () {
      if (this.dataset.fallbackTried) return;
      this.dataset.fallbackTried = '1';
      const currentSrc = this.getAttribute('src') || '';
      const filename = currentSrc.split('/').pop();
      this.src = currentSrc.includes('assets/') ? './' + filename : './assets/images/' + filename;
    });
  });

  const bgVideo = document.getElementById('bgVideo');
  const videoFallbackBg = document.getElementById('videoFallbackBg');

  if (bgVideo) {
    const playPromise = bgVideo.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        const startPlay = () => {
          bgVideo.play();
          window.removeEventListener('click', startPlay);
          window.removeEventListener('scroll', startPlay);
          window.removeEventListener('touchstart', startPlay);
        };
        window.addEventListener('click', startPlay, { once: true });
        window.addEventListener('scroll', startPlay, { once: true });
        window.addEventListener('touchstart', startPlay, { once: true });
      });
    }
    bgVideo.addEventListener('error', () => {
      if (videoFallbackBg) videoFallbackBg.style.display = 'block';
    });
  }

  const particlesContainer = document.getElementById('particles');
  const PARTICLE_COUNT = 30;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const p = document.createElement('div');
    p.classList.add('particle');
    const size = Math.random() * 3 + 1;
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    p.style.left = `${Math.random() * 100}vw`;
    p.style.top = `${Math.random() * 100}vh`;
    p.style.background = '#ffffff';
    p.style.opacity = `${Math.random() * 0.45 + 0.15}`;
    particlesContainer.appendChild(p);

    p.animate([
      { transform: 'translate(0, 0)', opacity: p.style.opacity },
      { transform: `translate(${(Math.random() - 0.5) * 120}px, -${Math.random() * 180 + 80}px)`, opacity: 0 }
    ], {
      duration: Math.random() * 7000 + 4000,
      iterations: Infinity,
      delay: Math.random() * 3000
    });
  }

  let targetScatter = 0;
  let currentScatter = 0;

  function updateScroll() {
    const scrollDistance = window.innerHeight * 0.85;
    targetScatter = Math.min(1, Math.max(0, window.scrollY / scrollDistance));
  }

  window.addEventListener('scroll', updateScroll, { passive: true });
  window.addEventListener('wheel', () => requestAnimationFrame(updateScroll), { passive: true });
  window.addEventListener('touchmove', () => requestAnimationFrame(updateScroll), { passive: true });

  function buildLogo() {
    const scale = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (!width || !height) {
      requestAnimationFrame(buildLogo);
      return;
    }

    logoCanvas.width = Math.floor(width * scale);
    logoCanvas.height = Math.floor(height * scale);
    logoCanvas.style.width = `${width}px`;
    logoCanvas.style.height = `${height}px`;
    logoContext.setTransform(scale, 0, 0, scale, 0, 0);

    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = width;
    sampleCanvas.height = height;
    const sampleCtx = sampleCanvas.getContext('2d');

    const centerX = width / 2;
    const centerY = height / 2;
    const fontSize = Math.min(width / 7.2, height * 0.22, 170);
    sampleCtx.font = `800 ${fontSize}px "Space Grotesk", sans-serif`;
    sampleCtx.textAlign = 'center';
    sampleCtx.textBaseline = 'middle';
    sampleCtx.fillStyle = '#ffffff';
    sampleCtx.fillText('CIPHERSQUAD', centerX, centerY);

    const pixels = sampleCtx.getImageData(0, 0, width, height).data;
    const targets = [];
    const step = width < 700 ? 3 : 4;
    const startY = Math.max(0, Math.floor(centerY - fontSize));
    const endY = Math.min(height, Math.ceil(centerY + fontSize));

    for (let y = startY; y < endY; y += step) {
      for (let x = 0; x < width; x += step) {
        const pixelIndex = (y * width + x) * 4;
        if (pixels[pixelIndex + 3] > 70) targets.push({ x, y });
      }
    }

    const maxScreenDist = Math.hypot(width, height);
    logoDots.length = 0;
    targets.forEach((target, index) => {
      const angle = Math.random() * Math.PI * 2;
      const dist = (Math.random() * 0.85 + 0.45) * maxScreenDist * 0.75;
      const initAngle = Math.random() * Math.PI * 2;
      const initDist = Math.random() * 200 + 60;

      logoDots.push({
        x: target.x + Math.cos(initAngle) * initDist,
        y: target.y + Math.sin(initAngle) * initDist,
        baseX: target.x,
        baseY: target.y,
        scatterX: Math.cos(angle) * dist,
        scatterY: Math.sin(angle) * dist,
        delay: (index % 150) * 3,
        size: Math.random() * 0.5 + 1.45
      });
    });
  }

  let glitchActive = false;
  let glitchIntensity = 0;
  let nextGlitchTime = Date.now() + 1400;
  let glitchEndTime = 0;
  let glitchMode = 0;
  const chromeColors = ['#ffffff', '#f8fafc', '#e2e8f0', '#cbd5e1', '#94a3b8'];

  function updateTubelightGlitch(now) {
    if (!glitchActive && now >= nextGlitchTime) {
      glitchActive = true;
      glitchIntensity = Math.random() * 0.7 + 0.3;
      glitchMode = Math.floor(Math.random() * 3);
      glitchEndTime = now + Math.random() * 180 + 100;
    } else if (glitchActive) {
      if (now >= glitchEndTime) {
        glitchActive = false;
        nextGlitchTime = now + Math.random() * 2600 + 1800;
        glitchIntensity = 0;
      } else {
        glitchIntensity = Math.random() > 0.35 ? Math.random() * 0.9 + 0.1 : 0.05;
      }
    }
  }

  let startTime = null;
  const videoOverlay = document.getElementById('videoOverlay');

  function animateLogo(time) {
    if (!startTime) startTime = time;
    const elapsed = time - startTime;
    const now = Date.now();
    const width = window.innerWidth;
    const height = window.innerHeight;
    logoContext.clearRect(0, 0, width, height);

    updateTubelightGlitch(now);
    currentScatter += (targetScatter - currentScatter) * 0.085;

    const videoOpacity = Math.min(1, Math.max(0, (currentScatter - 0.1) / 0.65));
    if (bgVideo) bgVideo.style.opacity = videoOpacity;
    if (videoFallbackBg) videoFallbackBg.style.opacity = videoOpacity;
    if (videoOverlay) videoOverlay.style.opacity = Math.min(1, Math.max(0, (currentScatter - 0.08) / 0.7));

    if (currentScatter < 0.25) {
      if (glitchActive && glitchIntensity > 0.2) {
        const glowColor = glitchMode === 1 ? 'rgba(255, 255, 255, 0.95)' : 'rgba(226, 232, 240, 0.9)';
        const blurSize = 20 + glitchIntensity * 30;
        logoCanvas.style.filter = `drop-shadow(0 0 ${blurSize}px ${glowColor}) drop-shadow(0 0 ${blurSize * 2}px rgba(255, 255, 255, 0.5))`;
      } else {
        logoCanvas.style.filter = 'drop-shadow(0 0 16px rgba(255, 255, 255, 0.6)) drop-shadow(0 0 38px rgba(255, 255, 255, 0.3))';
      }
    }

    const scrollPrompt = document.getElementById('scrollPrompt');
    if (scrollPrompt) scrollPrompt.style.opacity = Math.max(0, 0.85 - currentScatter * 3.5);

    const authContainer = document.getElementById('authContainer');
    if (authContainer && !document.body.classList.contains('app-active')) {
      const authProgress = Math.max(0, Math.min(1, (currentScatter - 0.32) / 0.68));
      authContainer.style.opacity = authProgress;
      authContainer.style.transform = `translate(-50%, calc(-50% + ${(1 - authProgress) * 45}px)) scale(${0.92 + authProgress * 0.08})`;
      authContainer.style.pointerEvents = authProgress > 0.65 ? 'auto' : 'none';
    }

    for (let i = 0; i < logoDots.length; i++) {
      const dot = logoDots[i];
      const entryProgress = Math.max(0, Math.min(1, (elapsed - dot.delay) / 600));
      const targetX = dot.baseX + dot.scatterX * currentScatter;
      const targetY = dot.baseY + dot.scatterY * currentScatter;
      const springRate = 0.085 * (0.3 + entryProgress * 0.7);
      dot.x += (targetX - dot.x) * springRate;
      dot.y += (targetY - dot.y) * springRate;

      if (currentScatter < 0.04) {
        const dist = Math.hypot(dot.x - pointer.x, dot.y - pointer.y);
        if (dist < 65) {
          const force = (65 - dist) / 65;
          dot.x += (dot.x - pointer.x) * force * 0.08;
          dot.y += (dot.y - pointer.y) * force * 0.08;
        }
      }

      const fade = Math.max(0, 1 - currentScatter * 1.15);
      let alpha = fade * (0.35 + entryProgress * 0.65);
      if (alpha <= 0.005) continue;

      let dotColor = '#ffffff';
      if (glitchActive) {
        alpha *= 0.6 + glitchIntensity * 0.4;
        if (glitchMode === 1) dotColor = chromeColors[i % chromeColors.length];
        else if (glitchMode === 2) dotColor = i % 3 === 0 ? chromeColors[i % chromeColors.length] : '#ffffff';
        else dotColor = i % 7 === 0 ? '#94a3b8' : '#ffffff';
      } else {
        dotColor = i % 8 === 0 ? '#cbd5e1' : '#ffffff';
      }

      logoContext.fillStyle = dotColor;
      logoContext.globalAlpha = Math.min(1, alpha);
      logoContext.beginPath();
      logoContext.arc(dot.x, dot.y, dot.size, 0, Math.PI * 2);
      logoContext.fill();
    }

    logoContext.globalAlpha = 1;
    requestAnimationFrame(animateLogo);
  }

  function escapeHtml(value = '') {
    return value.replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[char]));
  }

  function decodeBase64Url(value = '') {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - base64.length % 4) % 4), '=');
    return decodeURIComponent(escape(atob(padded)).split('').map(char => {
      return `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`;
    }).join(''));
  }

  function getHeader(payload, name) {
    return payload?.headers?.find(header => header.name.toLowerCase() === name.toLowerCase())?.value || '';
  }

  function extractSender(fromHeader = '') {
    const match = fromHeader.match(/^(.*?)\s*<(.+?)>$/);
    if (!match) return { name: fromHeader || 'Unknown sender', email: '' };
    return { name: match[1].replaceAll('"', '').trim(), email: match[2] };
  }

  function getPlainBody(payload) {
    if (!payload) return '';
    if (payload.mimeType === 'text/plain' && payload.body?.data) return decodeBase64Url(payload.body.data);
    const parts = payload.parts || [];
    for (const part of parts) {
      const body = getPlainBody(part);
      if (body) return body;
    }
    return '';
  }

  async function googleFetch(url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${appState.accessToken}` }
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Google API failed with ${response.status}`);
    }
    return response.json();
  }

  async function loadGoogleProfile() {
    const profile = await googleFetch('https://www.googleapis.com/oauth2/v3/userinfo');
    appState.profile = profile;
    document.getElementById('profileName').textContent = profile.name || 'Google User';
    document.getElementById('profileEmail').textContent = profile.email || 'Connected Workspace';
    if (profile.picture) document.getElementById('profilePhoto').src = profile.picture;
  }

  async function loadInbox() {
    const messageList = document.getElementById('messageList');
    messageList.innerHTML = '<div class="loading-row">Loading Gmail messages...</div>';

    const list = await googleFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=8&q=newer_than:30d');
    const ids = list.messages || [];
    if (!ids.length) {
      appState.messages = demoMessages;
      renderMessages(demoMessages, true);
      return;
    }

    const messages = await Promise.all(ids.map(async item => {
      const message = await googleFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=full`);
      const from = extractSender(getHeader(message.payload, 'From'));
      const subject = getHeader(message.payload, 'Subject') || '(No subject)';
      const date = getHeader(message.payload, 'Date');
      const sentAt = date ? new Date(date) : null;

      return {
        id: message.id,
        from: from.name,
        email: from.email,
        subject,
        time: sentAt && !Number.isNaN(sentAt.getTime())
          ? sentAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '',
        snippet: message.snippet || '',
        body: getPlainBody(message.payload) || message.snippet || ''
      };
    }));

    appState.messages = messages;
    renderMessages(messages);
  }

  function renderMessages(messages, isDemoFallback = false) {
    const messageList = document.getElementById('messageList');
    document.getElementById('inboxCount').textContent = messages.length;
    messageList.innerHTML = '';

    if (isDemoFallback) {
      const notice = document.createElement('div');
      notice.className = 'loading-row';
      notice.textContent = 'No recent Gmail messages found, showing demo workflow thread.';
      messageList.appendChild(notice);
    }

    messages.forEach((message, index) => {
      const button = document.createElement('button');
      button.className = `message-card${index === 0 ? ' is-active' : ''}`;
      button.type = 'button';
      button.innerHTML = `
        <span class="sender-avatar">${escapeHtml((message.from || '?').trim().charAt(0).toUpperCase())}</span>
        <span class="message-copy">
          <strong>${escapeHtml(message.from)}</strong>
          <b>${escapeHtml(message.subject)}</b>
          <small>${escapeHtml(message.snippet)}</small>
        </span>
        <time>${escapeHtml(message.time)}</time>
      `;
      button.addEventListener('click', () => {
        document.querySelectorAll('.message-card').forEach(card => card.classList.remove('is-active'));
        button.classList.add('is-active');
        renderThread(message);
      });
      messageList.appendChild(button);
    });

    renderThread(messages[0] || demoMessages[0]);
  }

  function renderThread(message) {
    document.getElementById('threadTitle').textContent = message.subject;
    const isProjectThread = /schema|deploy|frontend|client|approval|blocked/i.test(`${message.subject} ${message.snippet} ${message.body}`);
    document.getElementById('riskPill').textContent = isProjectThread ? 'High Risk' : 'Needs Review';
    document.getElementById('threadContent').innerHTML = `
      <div class="thread-meta">
        <span class="sender-avatar large">${escapeHtml((message.from || '?').trim().charAt(0).toUpperCase())}</span>
        <div>
          <strong>${escapeHtml(message.from)}</strong>
          <span>${escapeHtml(message.email || 'Unknown email')}</span>
        </div>
      </div>
      <p>${escapeHtml(message.body || message.snippet).replace(/\n/g, '<br>')}</p>
      <div class="analysis-note">
        <strong>Harness read:</strong>
        ${isProjectThread
          ? 'Possible blocker detected. Schema approval is upstream of deployment, integration, and the Wednesday client demo.'
          : 'Thread imported from Gmail. The analyzer shell is ready for task extraction, dependency mapping, and human-approved actions.'}
      </div>
    `;
  }

  function setAuthStatus(text, kind = '') {
    const authStatusMsg = document.getElementById('authStatusMsg');
    authStatusMsg.className = `auth-status-msg ${kind}`.trim();
    authStatusMsg.textContent = text;
  }

  function showApp() {
    document.body.classList.add('app-active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.getElementById('mailApp').classList.add('is-visible');
    document.getElementById('authContainer').style.pointerEvents = 'none';
  }

  function parseEnv(text) {
    return text.split(/\r?\n/).reduce((values, rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) return values;
      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) return values;
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      values[key] = value;
      return values;
    }, {});
  }

  async function loadGoogleConfig() {
    if (googleConfig.envLoaded) return googleConfig;

    try {
      const response = await fetch(`/api/config?ts=${Date.now()}`);
      if (!response.ok) throw new Error(`api.env returned ${response.status}`);

      const config = await response.json();
      googleConfig.clientId = config.googleClientId || '';
      googleConfig.backendAuthUrl = config.backendAuthUrl || '/auth/google';
      googleConfig.envLoaded = true;

      if (!googleConfig.clientId) {
        googleConfig.envError = 'GOOGLE_CLIENT_ID is missing in api.env.';
      }
    } catch (error) {
      try {
        const response = await fetch(`./api.env?ts=${Date.now()}`);
        if (!response.ok) throw new Error(`api.env returned ${response.status}`);
        const env = parseEnv(await response.text());
        googleConfig.clientId = env.GOOGLE_CLIENT_ID || '';
        googleConfig.backendAuthUrl = '/auth/google';
        googleConfig.envLoaded = true;
        if (!googleConfig.clientId) googleConfig.envError = 'GOOGLE_CLIENT_ID is missing in api.env.';
      } catch (fallbackError) {
        googleConfig.envError = `Could not read Google config: ${fallbackError.message}`;
        googleConfig.envLoaded = true;
      }
    }

    return googleConfig;
  }

  async function initGoogleAuth() {
    const googleAuthBtn = document.getElementById('googleAuthBtn');
    if (!googleAuthBtn) return;

    const config = await loadGoogleConfig();
    if (!config.clientId) {
      setAuthStatus(config.envError || 'Google client ID is missing.', 'is-error');
      return;
    }

    appState.tokenClient = {
      requestAccessToken: () => {
        window.location.href = config.backendAuthUrl || '/auth/google';
      }
    };
  }

  const googleAuthBtn = document.getElementById('googleAuthBtn');
  if (googleAuthBtn) {
    googleAuthBtn.addEventListener('click', async () => {
      if (googleAuthBtn.classList.contains('is-loading')) return;
      googleAuthBtn.classList.add('is-loading');

      if (!appState.tokenClient) await initGoogleAuth();
      if (!appState.tokenClient) {
        googleAuthBtn.classList.remove('is-loading');
        return;
      }

      setAuthStatus('Redirecting to Google authorization...');
      appState.tokenClient.requestAccessToken({ prompt: appState.accessToken ? '' : 'consent' });
    });
  }

  document.getElementById('refreshInboxBtn')?.addEventListener('click', async () => {
    if (!appState.accessToken) return;
    try {
      await loadInbox();
    } catch (error) {
      console.error(error);
      renderMessages(demoMessages, true);
    }
  });

  document.getElementById('signOutBtn')?.addEventListener('click', () => {
    if (appState.accessToken && window.google?.accounts?.oauth2) {
      google.accounts.oauth2.revoke(appState.accessToken);
    }
    appState.accessToken = '';
    appState.profile = null;
    document.body.classList.remove('app-active');
    document.getElementById('mailApp').classList.remove('is-visible');
    setAuthStatus('Disconnected from Google.');
  });

  document.getElementById('approveActionsBtn')?.addEventListener('click', () => {
    const approvalStatus = document.getElementById('approvalStatus');
    approvalStatus.textContent = 'Executed: reminder queued, task created, stakeholder notified, draft prepared.';
    approvalStatus.classList.add('is-complete');
  });

  const handlePointer = event => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  };

  window.addEventListener('pointermove', handlePointer, { passive: true });
  window.addEventListener('pointerleave', () => {
    pointer.x = -2000;
    pointer.y = -2000;
  });

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(buildLogo);
  else buildLogo();

  window.addEventListener('load', initGoogleAuth);
  requestAnimationFrame(animateLogo);
  window.addEventListener('resize', buildLogo);
});
