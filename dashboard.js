/**
 * CipherSquad — Dashboard Client Logic
 * Fetches live data from the backend (which queries Supabase + Gmail + AI)
 * and populates the dashboard dynamically.
 */

document.addEventListener('DOMContentLoaded', () => {
  const API_BASE = 'http://localhost:5000';

  // ── Read userId from localStorage (set during OAuth callback) ──
  const userId = localStorage.getItem('userId');
  const userName = localStorage.getItem('userName') || 'User';

  if (!userId) {
    // Not authenticated — redirect to login page
    window.location.href = './index.html';
    return;
  }

  // ── Populate user info ──
  const profileName = document.getElementById('profileName');
  const profilePic = document.getElementById('profilePic');
  const greetingTitle = document.getElementById('greetingTitle');

  if (profileName) profileName.textContent = userName;
  if (profilePic) {
    profilePic.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=ff7597&color=fff`;
    profilePic.alt = userName;
  }

  // Set time-based greeting
  const hour = new Date().getHours();
  let greeting = 'Good morning';
  if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
  else if (hour >= 17) greeting = 'Good evening';
  if (greetingTitle) greetingTitle.textContent = `${greeting}, ${userName}`;

  // ── Fetch dashboard data from backend ──
  fetchDashboard();

  async function fetchDashboard() {
    try {
      const response = await fetch(`${API_BASE}/api/dashboard/overview?userId=${userId}`);

      if (response.status === 401) {
        // Token expired or user not authenticated
        localStorage.removeItem('userId');
        localStorage.removeItem('userName');
        window.location.href = './index.html';
        return;
      }

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();
      populateDashboard(data);
    } catch (error) {
      console.error('Failed to load dashboard:', error);
      showError('Could not load dashboard data. Please try again.');
    }
  }

  function populateDashboard(data) {
    // ── Stats ──
    const statEmails = document.getElementById('statEmails');
    const statImportant = document.getElementById('statImportant');
    const statActions = document.getElementById('statActions');

    if (statEmails) animateCounter(statEmails, data.metrics?.emails || 0);
    if (statImportant) animateCounter(statImportant, data.metrics?.important || 0);
    if (statActions) animateCounter(statActions, data.metrics?.actions || 0);

    // ── Needs Attention ──
    const attentionList = document.getElementById('attentionList');
    if (attentionList) {
      const items = data.needs_attention || [];
      if (items.length === 0) {
        attentionList.innerHTML = `
          <li>
            <div class="attention-content">
              <span class="sender" style="opacity: 0.6;">✅ Nothing needs your attention right now!</span>
            </div>
          </li>
        `;
      } else {
        const avatarClasses = ['', 'avatar-alt-1', 'avatar-alt-2'];
        attentionList.innerHTML = items.map((item, i) => {
          const initial = (item.sender || '?')[0].toUpperCase();
          const avatarClass = avatarClasses[i % avatarClasses.length];
          return `
            <li>
              <div class="attention-content">
                <div class="avatar-sm ${avatarClass}">${initial}</div>
                <span class="sender">${escapeHtml(item.sender || 'Unknown')}</span>
                <i class="fas fa-arrow-right icon-arrow"></i>
                <span class="subject">${escapeHtml(item.reason || '')}</span>
              </div>
              <button class="btn-icon" title="View details"><i class="fas fa-chevron-right"></i></button>
            </li>
          `;
        }).join('');
      }
    }

    // ── AI Insight ──
    const aiInsightText = document.getElementById('aiInsightText');
    if (aiInsightText) {
      aiInsightText.innerHTML = escapeHtml(data.ai_insight || 'No insights available.');
    }

    // ── Update greeting subtitle with summary ──
    const greetingSubtitle = document.getElementById('greetingSubtitle');
    if (greetingSubtitle && data.metrics) {
      const total = data.metrics.emails || 0;
      const important = data.metrics.important || 0;
      greetingSubtitle.textContent = `${total} emails processed · ${important} flagged as important.`;
    }
  }

  // ── Utility: Animated counter ──
  function animateCounter(element, target) {
    const duration = 800;
    const start = performance.now();
    const startVal = 0;

    function step(now) {
      const progress = Math.min((now - start) / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startVal + (target - startVal) * eased);
      element.textContent = current.toLocaleString();
      if (progress < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  // ── Utility: Escape HTML to prevent XSS ──
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Utility: Show error state ──
  function showError(message) {
    const aiInsightText = document.getElementById('aiInsightText');
    if (aiInsightText) {
      aiInsightText.textContent = message;
      aiInsightText.style.color = '#ff6b6b';
    }
  }
});
