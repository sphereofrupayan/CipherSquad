document.addEventListener('DOMContentLoaded', () => {
  const logoCanvas = document.getElementById('dotLogo');
  const logoContext = logoCanvas.getContext('2d');
  const logoDots = [];
  const pointer = { x: -2000, y: -2000 };

  const currentTime = document.getElementById('currentTime');
  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  });

  function updateTime() {
    if (currentTime) currentTime.textContent = timeFormatter.format(new Date());
  }

  updateTime();
  window.setInterval(updateTime, 1000);

  // Universal portable image fallback resolver: works in any directory structure
  document.querySelectorAll('img').forEach(img => {
    img.addEventListener('error', function () {
      if (this.dataset.fallbackTried) return;
      this.dataset.fallbackTried = '1';
      const currentSrc = this.getAttribute('src') || '';
      const filename = currentSrc.split('/').pop();
      if (currentSrc.includes('assets/')) {
        this.src = './' + filename;
      } else {
        this.src = './assets/images/' + filename;
      }
    });
  });

  // Video autoplay handling with error fallback
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
      // If video file cannot be found or decoded on another computer, fallback background displays cleanly
      if (videoFallbackBg) videoFallbackBg.style.display = 'block';
    });
  }

  // Ambient background particles
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
    p.style.background = '#ff7597';
    p.style.opacity = `${Math.random() * 0.45 + 0.15}`;
    particlesContainer.appendChild(p);

    const duration = Math.random() * 7000 + 4000;
    const keyframes = [
      { transform: 'translate(0, 0)', opacity: p.style.opacity },
      { transform: `translate(${(Math.random() - 0.5) * 120}px, -${Math.random() * 180 + 80}px)`, opacity: 0 }
    ];
    p.animate(keyframes, {
      duration: duration,
      iterations: Infinity,
      delay: Math.random() * 3000
    });
  }

  // Scroll tracking & smooth scattering physics
  let targetScatter = 0;
  let currentScatter = 0;

  function updateScroll() {
    const scrollDistance = window.innerHeight * 0.85;
    const progress = Math.min(1, Math.max(0, window.scrollY / scrollDistance));
    targetScatter = progress;
  }

  window.addEventListener('scroll', updateScroll, { passive: true });
  window.addEventListener('wheel', () => requestAnimationFrame(updateScroll), { passive: true });
  window.addEventListener('touchmove', () => requestAnimationFrame(updateScroll), { passive: true });

  // Canvas dot logo creation (centered dead middle on landing)
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

    // Dead center horizontally and vertically
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
        if (pixels[pixelIndex + 3] > 70) {
          targets.push({ x, y });
        }
      }
    }

    const maxScreenDist = Math.hypot(width, height);

    logoDots.length = 0;
    targets.forEach((target, index) => {
      // Omnidirectional 360-degree trajectory to scatter across full screen
      const angle = Math.random() * Math.PI * 2;
      const dist = (Math.random() * 0.85 + 0.45) * maxScreenDist * 0.75;

      const scatterX = Math.cos(angle) * dist;
      const scatterY = Math.sin(angle) * dist;

      const initAngle = Math.random() * Math.PI * 2;
      const initDist = Math.random() * 200 + 60;

      logoDots.push({
        x: target.x + Math.cos(initAngle) * initDist,
        y: target.y + Math.sin(initAngle) * initDist,
        baseX: target.x,
        baseY: target.y,
        scatterX: scatterX,
        scatterY: scatterY,
        delay: (index % 150) * 3,
        size: Math.random() * 0.5 + 1.45
      });
    });
  }

  // Tubelight Flicker & Glitch State Machine
  let glitchActive = false;
  let glitchIntensity = 0;
  let nextGlitchTime = Date.now() + 1400;
  let glitchEndTime = 0;
  let glitchMode = 0; // 0 = white surge, 1 = hot pink buzz, 2 = alternating flicker

  const pinkColors = ['#ff7597', '#ff507a', '#ff3366', '#f472b6', '#fda4af'];

  function updateTubelightGlitch(now) {
    if (!glitchActive && now >= nextGlitchTime) {
      glitchActive = true;
      glitchIntensity = Math.random() * 0.7 + 0.3;
      glitchMode = Math.floor(Math.random() * 3);
      // Fast neon voltage stutter (100ms - 280ms)
      const duration = Math.random() * 180 + 100;
      glitchEndTime = now + duration;
    } else if (glitchActive) {
      if (now >= glitchEndTime) {
        glitchActive = false;
        // Next glitch burst in 1.8s to 4.2s
        nextGlitchTime = now + Math.random() * 2600 + 1800;
        glitchIntensity = 0;
      } else {
        // High frequency voltage jitter during burst
        glitchIntensity = Math.random() > 0.35 ? Math.random() * 0.9 + 0.1 : 0.05;
      }
    }
  }

  // Animation Loop
  let startTime = null;
  const videoOverlay = document.getElementById('videoOverlay');

  function animateLogo(time) {
    if (!startTime) startTime = time;
    const elapsed = time - startTime;
    const now = Date.now();

    const width = window.innerWidth;
    const height = window.innerHeight;
    logoContext.clearRect(0, 0, width, height);

    // Update neon tubelight glitch
    updateTubelightGlitch(now);

    // Smooth scroll interpolation (silky lerp)
    currentScatter += (targetScatter - currentScatter) * 0.085;

    // Background transition: Hidden on landing, blurred video & pink atmosphere on scroll
    const videoOpacity = Math.min(1, Math.max(0, (currentScatter - 0.1) / 0.65));
    if (bgVideo) {
      bgVideo.style.opacity = videoOpacity;
    }
    if (videoFallbackBg) {
      videoFallbackBg.style.opacity = videoOpacity;
    }
    if (videoOverlay) {
      const overlayOpacity = Math.min(1, Math.max(0, (currentScatter - 0.08) / 0.7));
      videoOverlay.style.opacity = overlayOpacity;
    }

    // Dynamic Tubelight Canvas Drop-Shadow Glitch
    if (currentScatter < 0.25) {
      if (glitchActive && glitchIntensity > 0.2) {
        const glowColor = glitchMode === 1 ? 'rgba(255, 51, 102, 0.9)' : 'rgba(255, 117, 151, 0.85)';
        const blurSize = 20 + glitchIntensity * 30;
        logoCanvas.style.filter = `drop-shadow(0 0 ${blurSize}px ${glowColor}) drop-shadow(0 0 ${blurSize * 2}px rgba(244, 114, 182, 0.6))`;
      } else {
        logoCanvas.style.filter = 'drop-shadow(0 0 16px rgba(255, 117, 151, 0.55)) drop-shadow(0 0 38px rgba(244, 114, 182, 0.25))';
      }
    }

    // Fade out scroll prompt as user begins scrolling
    const scrollPrompt = document.getElementById('scrollPrompt');
    if (scrollPrompt) {
      scrollPrompt.style.opacity = Math.max(0, 0.85 - currentScatter * 3.5);
    }

    // Smoothly rise and reveal the Google Auth Login Card
    const authContainer = document.getElementById('authContainer');
    if (authContainer) {
      const authProgress = Math.max(0, Math.min(1, (currentScatter - 0.32) / 0.68));
      authContainer.style.opacity = authProgress;
      authContainer.style.transform = `translate(-50%, calc(-50% + ${(1 - authProgress) * 45}px)) scale(${0.92 + authProgress * 0.08})`;
      authContainer.style.pointerEvents = authProgress > 0.65 ? 'auto' : 'none';
    }

    // Dot particles rendering & tubelight color logic
    for (let i = 0; i < logoDots.length; i++) {
      const dot = logoDots[i];
      
      const entryProgress = Math.max(0, Math.min(1, (elapsed - dot.delay) / 600));

      const targetX = dot.baseX + dot.scatterX * currentScatter;
      const targetY = dot.baseY + dot.scatterY * currentScatter;

      const springRate = 0.085 * (0.3 + entryProgress * 0.7);
      dot.x += (targetX - dot.x) * springRate;
      dot.y += (targetY - dot.y) * springRate;

      // Subtle mouse repulsion ONLY when at the very top (zero scroll)
      if (currentScatter < 0.04) {
        const dist = Math.hypot(dot.x - pointer.x, dot.y - pointer.y);
        if (dist < 65) {
          const force = (65 - dist) / 65;
          dot.x += (dot.x - pointer.x) * force * 0.08;
          dot.y += (dot.y - pointer.y) * force * 0.08;
        }
      }

      // Fade out completely across screen as currentScatter approaches 1
      const fade = Math.max(0, 1 - currentScatter * 1.15);
      let alpha = fade * (0.35 + entryProgress * 0.65);
      if (alpha <= 0.005) continue;

      // Tubelight Color Glitching: shifts between electric white and hot neon sakura pink
      let dotColor = '#ffffff';

      if (glitchActive) {
        // Voltage dip: slight random opacity pulse
        alpha *= (0.6 + glitchIntensity * 0.4);

        if (glitchMode === 1) {
          // Hot pink neon surge
          dotColor = pinkColors[i % pinkColors.length];
        } else if (glitchMode === 2) {
          // Alternating electric strobe
          dotColor = (i % 3 === 0) ? pinkColors[i % pinkColors.length] : '#ffffff';
        } else {
          // Intense white flash with occasional hot pink spark
          dotColor = (i % 7 === 0) ? '#ff507a' : '#ffffff';
        }
      } else {
        // Normal state: crisp glowing white with occasional subtle rose tint
        dotColor = (i % 8 === 0) ? '#fbcfe8' : '#ffffff';
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

  // Pointer interactions (full-screen window coordinates)
  const handlePointer = (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  };

  window.addEventListener('pointermove', handlePointer, { passive: true });
  window.addEventListener('pointerleave', () => {
    pointer.x = -2000;
    pointer.y = -2000;
  });

  // ── Check for OAuth return params on page load ──
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('connected') === 'true' && urlParams.get('userId')) {
    localStorage.setItem('userId', urlParams.get('userId'));
    if (urlParams.get('name')) localStorage.setItem('userName', urlParams.get('name'));
    // Redirect to dashboard
    window.location.href = './dashboard.html';
    return; // Stop executing the rest of the script
  }

  // ── Google Auth Button — Real OAuth Redirect ──
  const googleAuthBtn = document.getElementById('googleAuthBtn');
  const authStatusMsg = document.getElementById('authStatusMsg');
  const API_BASE = 'http://localhost:5000';

  if (googleAuthBtn) {
    googleAuthBtn.addEventListener('click', () => {
      if (googleAuthBtn.classList.contains('is-loading')) return;

      googleAuthBtn.classList.add('is-loading');
      authStatusMsg.className = 'auth-status-msg';
      authStatusMsg.textContent = 'Redirecting to Google...';

      // Redirect to backend OAuth endpoint
      window.location.href = `${API_BASE}/auth/google`;
    });
  }


  // Load font first so canvas text metrics are crisp
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(buildLogo);
  } else {
    buildLogo();
  }

  requestAnimationFrame(animateLogo);
  window.addEventListener('resize', buildLogo);
});
