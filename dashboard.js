/**
 * CipherSquad Dashboard Client Logic
 */
document.addEventListener('DOMContentLoaded', () => {
  const API_BASE = 'http://localhost:5000';

  // Check for OAuth return params in URL first
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('connected') === 'true' && urlParams.get('userId')) {
    localStorage.setItem('userId', urlParams.get('userId'));
    if (urlParams.get('name')) localStorage.setItem('userName', urlParams.get('name'));
    window.history.replaceState({}, '', './dashboard.html');
  }

  const userId = localStorage.getItem('userId');
  const userName = localStorage.getItem('userName') || 'User';

  if (!userId) {
    window.location.href = './index.html';
    return;
  }

  const profileName = document.getElementById('profileName');
  const profilePic = document.getElementById('profilePic');
  const greetingTitle = document.getElementById('greetingTitle');

  if (profileName) profileName.textContent = userName;
  if (profilePic) {
    profilePic.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(userName) + '&background=ff7597&color=fff';
    profilePic.alt = userName;
  }

  const hour = new Date().getHours();
  let greeting = 'Good morning';
  if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
  else if (hour >= 17) greeting = 'Good evening';
  if (greetingTitle) greetingTitle.textContent = greeting + ', ' + userName;

  fetchDashboard();

  async function fetchDashboard() {
    try {
      const response = await fetch(API_BASE + '/api/dashboard/overview?userId=' + userId);
      if (response.status === 401) {
        localStorage.removeItem('userId');
        localStorage.removeItem('userName');
        window.location.href = './index.html';
        return;
      }
      if (!response.ok) throw new Error('Server error: ' + response.status);
      const data = await response.json();
      populateDashboard(data);
    } catch (error) {
      console.error('Failed to load dashboard:', error);
      showError('Could not load dashboard data. Please try again.');
    }
  }

  function populateDashboard(data) {
    const statEmails = document.getElementById('statEmails');
    const statImportant = document.getElementById('statImportant');
    const statActions = document.getElementById('statActions');
    if (statEmails) animateCounter(statEmails, data.metrics?.emails || 0);
    if (statImportant) animateCounter(statImportant, data.metrics?.important || 0);
    if (statActions) animateCounter(statActions, data.metrics?.actions || 0);

    const attentionList = document.getElementById('attentionList');
    if (attentionList) {
      const items = data.needs_attention || [];
      if (items.length === 0) {
        attentionList.innerHTML = '<li><div class="attention-content"><span class="sender" style="opacity:0.6">No items need attention.</span></div></li>';
      } else {
        const cls = ['', 'avatar-alt-1', 'avatar-alt-2'];
        attentionList.innerHTML = items.map(function(item, i) {
          var init = (item.sender || '?')[0].toUpperCase();
          return '<li><div class="attention-content"><div class="avatar-sm ' + cls[i % 3] + '">' + init + '</div><span class="sender">' + escapeHtml(item.sender || 'Unknown') + '</span><i class="fas fa-arrow-right icon-arrow"></i><span class="subject">' + escapeHtml(item.reason || '') + '</span></div><button class="btn-icon" title="View"><i class="fas fa-chevron-right"></i></button></li>';
        }).join('');
      }
    }

    const aiInsightText = document.getElementById('aiInsightText');
    if (aiInsightText) aiInsightText.innerHTML = escapeHtml(data.ai_insight || 'No insights available.');

    const greetingSubtitle = document.getElementById('greetingSubtitle');
    if (greetingSubtitle && data.metrics) {
      greetingSubtitle.textContent = (data.metrics.emails || 0) + ' emails processed - ' + (data.metrics.important || 0) + ' flagged as important.';
    }
  }

  function animateCounter(el, target) {
    var dur = 800, start = performance.now();
    function step(now) {
      var p = Math.min((now - start) / dur, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))).toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function showError(msg) {
    var el = document.getElementById('aiInsightText');
    if (el) { el.textContent = msg; el.style.color = '#ff6b6b'; }
  }
});