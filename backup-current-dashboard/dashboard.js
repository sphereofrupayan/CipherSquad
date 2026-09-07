/**
 * CipherMail • Agent Harness for Intelligent Email Workflows
 * Team CIPHERSQUAD • Code2Create 7.0
 */

document.addEventListener('DOMContentLoaded', () => {
  // State Store
  const state = {
    activeThreadId: 'thread-1',
    activeFilter: 'all',
    searchQuery: '',
    pendingApprovalsCount: 4,
    auditLogs: [
      { time: '14:42', event: 'Thread analyzed: 4 participants mapped' },
      { time: '14:42', event: 'Task extracted: "Approve database schema"' },
      { time: '14:43', event: 'Dependency detected: Schema Approval → Backend Deploy → Frontend' },
      { time: '14:43', event: 'Critical Blocker flagged: 2 days to Client Demo' },
      { time: '14:44', event: '4 actions generated • Awaiting human approval' }
    ],
    threads: [
      {
        id: 'thread-1',
        subject: '[URGENT] Database Schema Approval for Backend Deployment',
        senders: 'Kartikay, Sreyanko, Priyam',
        time: '14:42',
        unread: true,
        starred: true,
        isSent: false,
        badges: [
          { type: 'blocker', text: '🔴 Blocker: DB Schema' },
          { type: 'dependency', text: '⚠️ Risk: High' },
          { type: 'action-req', text: '4 Actions Proposed' }
        ],
        participants: [
          { name: 'Kartikay Gupta', role: 'Backend Lead', email: 'kartikay@ciphersquad.tech' },
          { name: 'Sreyanko Sinha', role: 'DB Architect', email: 'sreyanko@ciphersquad.tech' },
          { name: 'Priyam Trivedi', role: 'Frontend & Pitch', email: 'priyam@ciphersquad.tech' }
        ],
        messages: [
          {
            id: 'm1',
            sender: 'Kartikay Gupta',
            email: 'kartikay@ciphersquad.tech',
            time: 'Yesterday at 16:30',
            avatarBg: 'linear-gradient(135deg, #0284c7, #38bdf8)',
            avatarText: 'K',
            body: 'Backend API is complete, but deployment cannot begin until Sreyanko approves the database schema. Can we get this finalized ASAP?',
            isBlocker: false
          },
          {
            id: 'm2',
            sender: 'Sreyanko Sinha',
            email: 'sreyanko@ciphersquad.tech',
            time: 'Yesterday at 17:15',
            avatarBg: 'linear-gradient(135deg, #e11d48, #fb7185)',
            avatarText: 'S',
            body: "Got tied up with orchestrator benchmarks. I'll review it by Monday afternoon.",
            isBlocker: false
          },
          {
            id: 'm3',
            sender: 'Priyam Trivedi',
            email: 'priyam@ciphersquad.tech',
            time: 'Today at 09:40',
            avatarBg: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
            avatarText: 'P',
            body: "Monday might be cutting it too close. Frontend integration strictly needs the deployed API. We need everything ready and tested before Wednesday's client demo.",
            isBlocker: false
          },
          {
            id: 'm4',
            sender: 'Kartikay Gupta',
            email: 'kartikay@ciphersquad.tech',
            time: 'Today at 14:42 (10m ago)',
            avatarBg: 'linear-gradient(135deg, #0284c7, #38bdf8)',
            avatarText: 'K',
            body: 'Still waiting for schema approval. Deployment pipeline is currently on hold.',
            isBlocker: true,
            highlightQuote: 'Critical path blocked: Deployment cannot proceed until schema is approved.'
          }
        ],
        harnessData: {
          project: 'Client Portal v2',
          deadline: "Wednesday • Client Demo (Only ~2 days remaining)",
          riskLevel: 'HIGH',
          blocker: {
            title: 'Database Schema Approval',
            responsible: 'Sreyanko Sinha',
            waitingOn: 'Kartikay Gupta & Priyam Trivedi'
          },
          dependencies: [
            {
              id: 'd1',
              title: 'Database Schema Approval',
              person: 'Sreyanko Sinha',
              status: 'node-blocker',
              statusText: 'BLOCKS',
              icon: 'fa-solid fa-circle-xmark'
            },
            {
              id: 'd2',
              title: 'Backend API Deployment',
              person: 'Kartikay Gupta',
              status: 'node-waiting',
              statusText: 'BLOCKS',
              icon: 'fa-solid fa-clock'
            },
            {
              id: 'd3',
              title: 'Frontend API Integration',
              person: 'Priyam Trivedi',
              status: 'node-waiting',
              statusText: 'REQUIRED FOR',
              icon: 'fa-solid fa-arrow-down'
            },
            {
              id: 'd4',
              title: 'Client Demo',
              person: 'Wednesday Milestone',
              status: 'node-final',
              statusText: 'TARGET',
              icon: 'fa-solid fa-flag-checkered'
            }
          ],
          actions: [
            {
              id: 'act-1',
              kind: 'reminder',
              kindLabel: 'Send Reminder',
              desc: 'Remind Sreyanko: Database schema approval is blocking backend deployment and frontend integration. Expedited review requested today.',
              approved: false
            },
            {
              id: 'act-2',
              kind: 'task',
              kindLabel: 'Create Task',
              desc: 'Create Task: "Approve database schema" • Assignee: Sreyanko Sinha • Priority: High • Due: Today 18:00',
              approved: false
            },
            {
              id: 'act-3',
              kind: 'notify',
              kindLabel: 'Notify Stakeholder',
              desc: 'Notify Kartikay: Schema approval is pending; escalation reminder has been prepared for Sreyanko.',
              approved: false
            },
            {
              id: 'act-4',
              kind: 'draft',
              kindLabel: 'Draft Reply',
              desc: 'Draft response to thread: "Followed up with Sreyanko to prioritize schema review today so frontend integration stays on schedule."',
              approved: false
            }
          ]
        }
      },
      {
        id: 'thread-2',
        subject: 'API Spec & Contract for Agent Orchestrator Endpoints',
        senders: 'Rupayan Chattaraj, Asmin Sinha',
        time: '13:15',
        unread: false,
        starred: false,
        isSent: false,
        badges: [
          { type: 'dependency', text: '🔗 1 Dependency' },
          { type: 'action-req', text: '1 Action Proposed' }
        ],
        participants: [
          { name: 'Rupayan Chattaraj', role: 'AI Harness Lead', email: 'rupayan@ciphersquad.tech' },
          { name: 'Asmin Sinha', role: 'Orchestration Eng', email: 'asmin@ciphersquad.tech' }
        ],
        messages: [
          {
            id: 'm2-1',
            sender: 'Rupayan Chattaraj',
            email: 'rupayan@ciphersquad.tech',
            time: 'Today at 13:15',
            avatarBg: 'linear-gradient(135deg, #10b981, #34d399)',
            avatarText: 'R',
            body: 'Drafted the JSON schema contract for the thread analysis endpoints. Waiting on Asmin to verify test inputs.',
            isBlocker: false
          }
        ],
        harnessData: {
          project: 'Agent Harness Core',
          deadline: 'Today 20:00 • Review 1',
          riskLevel: 'LOW',
          blocker: null,
          dependencies: [
            {
              id: 'd2-1',
              title: 'API Spec Draft',
              person: 'Rupayan Chattaraj',
              status: 'node-waiting',
              statusText: 'PENDING TEST',
              icon: 'fa-solid fa-clock'
            },
            {
              id: 'd2-2',
              title: 'Test Suite Validation',
              person: 'Asmin Sinha',
              status: 'node-final',
              statusText: 'TARGET',
              icon: 'fa-solid fa-flag-checkered'
            }
          ],
          actions: [
            {
              id: 'act-2-1',
              kind: 'task',
              kindLabel: 'Create Task',
              desc: 'Create Task: "Validate Agent API schemas against test fixtures" • Assignee: Asmin Sinha',
              approved: false
            }
          ]
        }
      },
      {
        id: 'thread-3',
        subject: 'Multi-agent consensus gate benchmark latency results',
        senders: 'Asmin Sinha',
        time: '11:30',
        unread: false,
        starred: false,
        isSent: false,
        badges: [
          { type: 'resolved', text: '✓ Workflows Mapped' }
        ],
        participants: [
          { name: 'Asmin Sinha', role: 'Orchestration Eng', email: 'asmin@ciphersquad.tech' }
        ],
        messages: [
          {
            id: 'm3-1',
            sender: 'Asmin Sinha',
            email: 'asmin@ciphersquad.tech',
            time: 'Today at 11:30',
            avatarBg: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
            avatarText: 'A',
            body: 'Consensus gate latency is under 420ms across 10 concurrent threads. All required workflow actions have been resolved.',
            isBlocker: false
          }
        ],
        harnessData: {
          project: 'Agent Consensus Engine',
          deadline: 'Review Milestone Complete',
          riskLevel: 'RESOLVED',
          blocker: null,
          dependencies: [],
          actions: []
        }
      }
    ],
    activeTeamMember: null,
    teamMembers: {
      'Kartikay': {
        name: 'Kartikay Gupta',
        role: 'Backend Lead',
        email: 'kartikay@ciphersquad.tech',
        status: 'Online',
        badgeClass: 'online',
        currentTask: 'Waiting on Database Schema review before deploying backend API service.',
        blocker: null,
        waitingOn: 'Sreyanko Sinha (DB Schema Review)',
        avatarBg: 'linear-gradient(135deg, #0284c7, #38bdf8)',
        avatarText: 'K'
      },
      'Sreyanko': {
        name: 'Sreyanko Sinha',
        role: 'Database Architect',
        email: 'sreyanko@ciphersquad.tech',
        status: 'Active Blocker',
        badgeClass: 'waiting',
        currentTask: 'Reviewing SQL schema migration files and indexing strategy.',
        blocker: 'Database Schema Approval (Blocking Backend Deployment & Client Demo)',
        waitingOn: 'Self (Review pending completion)',
        avatarBg: 'linear-gradient(135deg, #e11d48, #fb7185)',
        avatarText: 'S'
      },
      'Priyam': {
        name: 'Priyam Trivedi',
        role: 'Frontend & Pitch Lead',
        email: 'priyam@ciphersquad.tech',
        status: 'Online',
        badgeClass: 'online',
        currentTask: 'Building Agent Harness UI workflows and Client Demo presentation.',
        blocker: null,
        waitingOn: 'Kartikay Gupta (Backend Endpoints)',
        avatarBg: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
        avatarText: 'P'
      },
      'Rupayan': {
        name: 'Rupayan Chattaraj',
        role: 'AI Harness Lead',
        email: 'rupayan@ciphersquad.tech',
        status: 'Online',
        badgeClass: 'online',
        currentTask: 'Integrating LLM extraction prompts and cross-thread dependency resolver.',
        blocker: null,
        waitingOn: 'Asmin Sinha (Benchmark validation)',
        avatarBg: 'linear-gradient(135deg, #10b981, #34d399)',
        avatarText: 'R'
      },
      'Asmin': {
        name: 'Asmin Sinha',
        role: 'Orchestration Engineer',
        email: 'asmin@ciphersquad.tech',
        status: 'Online',
        badgeClass: 'online',
        currentTask: 'Running multi-agent consensus gate benchmarks and latency profiling.',
        blocker: null,
        waitingOn: 'None (Completed latency benchmark <420ms)',
        avatarBg: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
        avatarText: 'A'
      }
    }
  };

  // ==========================================
  // DOM ELEMENTS QUERY
  // ==========================================
  // Header Elements
  const brandBadgeEl = document.querySelector('.brand-badge');
  const hackathonTagEl = document.querySelector('.hackathon-tag');
  const searchInputEl = document.getElementById('searchInput');
  const engineStatusPillEl = document.getElementById('engineStatusPill');
  const auditToggleBtnEl = document.getElementById('auditToggleBtn');
  const auditBadgeEl = document.getElementById('auditBadge');
  const pendingApprovalsBtnEl = document.getElementById('pendingApprovalsBtn');
  const pendingBadgeCountEl = document.getElementById('pendingBadgeCount');
  const voiceBriefingBtnEl = document.getElementById('voiceBriefingBtn');
  const quickThemeBtn = document.getElementById('quickThemeBtn');
  const themeIcon = document.getElementById('themeIcon');
  const settingsToggleBtn = document.getElementById('settingsToggleBtn');
  const logoutLink = document.getElementById('logoutLink');

  // Sidebar Elements
  const composeBtn = document.getElementById('composeBtn');
  const sidebarNavItems = document.querySelectorAll('.sidebar-menu .nav-item[data-filter]');
  const sidebarActionCountEl = document.getElementById('sidebarActionCount');
  const navGraphViewEl = document.getElementById('navGraphView');
  const navAuditViewEl = document.getElementById('navAuditView');
  const sidebarSettingsBtn = document.getElementById('sidebarSettingsBtn');
  const teamMemberItems = document.querySelectorAll('.team-member[data-member]');
  const backendHookPillEl = document.querySelector('.backend-hook-pill');

  // Pane 2: Threads List Elements
  const threadsListEl = document.getElementById('threadsList');
  const threadFilterSelect = document.getElementById('threadFilterSelect');
  const paneFilterBtns = document.querySelectorAll('.threads-pane .pill-btn[data-filter]');

  // Pane 3: Conversation & Reasoning Pane
  const threadDetailPaneEl = document.getElementById('threadDetailPane');
  const toastContainerEl = document.getElementById('toastContainer');

  // Modals: Dependency Graph Modal
  const graphModalEl = document.getElementById('graphModal');
  const closeGraphModalBtnEl = document.getElementById('closeGraphModalBtn');
  const graphModalBodyEl = document.getElementById('graphModalBody');

  // Modals: Settings & Theme Modal
  const settingsModalEl = document.getElementById('settingsModal');
  const closeSettingsModalBtn = document.getElementById('closeSettingsModalBtn');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const resetThemeWhiteBtn = document.getElementById('resetThemeWhiteBtn');
  const themeCardLight = document.getElementById('themeCardLight');
  const themeCardDark = document.getElementById('themeCardDark');
  const settingHumanApproval = document.getElementById('settingHumanApproval');
  const settingBlockerAlerts = document.getElementById('settingBlockerAlerts');
  const settingPredraftReplies = document.getElementById('settingPredraftReplies');

  // Modals: Compose New Thread Modal
  const composeModalEl = document.getElementById('composeModal');
  const closeComposeModalBtn = document.getElementById('closeComposeModalBtn');
  const cancelComposeBtn = document.getElementById('cancelComposeBtn');
  const prefillBlockerThreadBtn = document.getElementById('prefillBlockerThreadBtn');
  const sendComposeBtn = document.getElementById('sendComposeBtn');
  const composeTo = document.getElementById('composeTo');
  const composeSubject = document.getElementById('composeSubject');
  const composeBody = document.getElementById('composeBody');

  // Modals: Audit Trail Modal
  const auditModalEl = document.getElementById('auditModal');
  const closeAuditModalBtn = document.getElementById('closeAuditModalBtn');
  const closeAuditModalBottomBtn = document.getElementById('closeAuditModalBottomBtn');
  const exportAuditJsonBtn = document.getElementById('exportAuditJsonBtn');
  const auditTimelineContainer = document.getElementById('auditTimelineContainer');

  // Modals: Agent Harness Architecture Modal
  const engineModalEl = document.getElementById('engineModal');
  const closeEngineModalBtn = document.getElementById('closeEngineModalBtn');
  const closeEngineModalBottomBtn = document.getElementById('closeEngineModalBottomBtn');

  // Modals: Team Collaborator Status Modal
  const teamMemberModalEl = document.getElementById('teamMemberModal');
  const closeTeamMemberModalBtn = document.getElementById('closeTeamMemberModalBtn');
  const teamModalPingBtn = document.getElementById('teamModalPingBtn');
  const teamModalFilterBtn = document.getElementById('teamModalFilterBtn');
  const teamModalMemberName = document.getElementById('teamModalMemberName');
  const teamModalMemberRole = document.getElementById('teamModalMemberRole');
  const teamModalBody = document.getElementById('teamModalBody');

  // Modals: Backend Integration Hook Modal
  const backendModalEl = document.getElementById('backendModal');
  const closeBackendModalBtn = document.getElementById('closeBackendModalBtn');
  const closeBackendModalBottomBtn = document.getElementById('closeBackendModalBottomBtn');
  const copyCodeSnippetBtn = document.getElementById('copyCodeSnippetBtn');
  const simulateAgentSyncBtn = document.getElementById('simulateAgentSyncBtn');

  // ==========================================
  // MODAL UTILITY FUNCTIONS
  // ==========================================
  function openModal(modal) {
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function closeAllModals() {
    [graphModalEl, settingsModalEl, composeModalEl, auditModalEl, engineModalEl, teamMemberModalEl, backendModalEl].forEach(m => {
      if (m && m.classList.contains('open')) closeModal(m);
    });
  }

  // Toast Notification Utility
  function showToast(message, type = 'check') {
    if (!toastContainerEl) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    const iconClass = type === 'star' ? 'fa-solid fa-star' : type === 'info' ? 'fa-solid fa-circle-info' : 'fa-solid fa-circle-check';
    toast.innerHTML = `<i class="${iconClass}"></i> <span>${message}</span>`;
    toastContainerEl.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 280ms ease';
      setTimeout(() => toast.remove(), 280);
    }, 3200);
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[char]));
  }

  function setBackendStatus(label, mode = 'checking') {
    const statusText = document.getElementById('backendStatusText');
    if (statusText) statusText.textContent = label;
    if (!backendHookPillEl) return;

    backendHookPillEl.classList.remove('backend-live', 'backend-waiting', 'backend-error');
    backendHookPillEl.classList.add(`backend-${mode}`);
    backendHookPillEl.setAttribute('title', `Harness API: ${label}`);
  }

  function updateMailboxCounts(totalEmails) {
    const inboxCount = Number.isFinite(totalEmails) ? totalEmails : state.threads.length;
    const inboxCountPill = document.querySelector('.nav-item[data-filter="all"] .count-pill');
    const blockerCountPill = document.querySelector('.nav-item[data-filter="blockers"] .count-pill');
    const actionOption = threadFilterSelect?.querySelector('option[value="actions"]');
    const actionPill = document.querySelector('.threads-pane .pill-btn.alert-pill');
    const blockerPill = document.querySelector('.threads-pane .pill-btn.blocker-pill');
    const blockerCount = state.threads.filter(thread => thread.harnessData?.blocker).length;

    if (inboxCountPill) inboxCountPill.textContent = inboxCount;
    if (blockerCountPill) blockerCountPill.textContent = blockerCount;
    if (actionOption) actionOption.textContent = `Action Required (${state.pendingApprovalsCount})`;
    if (actionPill) actionPill.textContent = `Actions Needed (${state.pendingApprovalsCount})`;
    if (blockerPill) blockerPill.textContent = `Blockers (${blockerCount})`;
  }

  function createBackendOverviewThread(overview) {
    const attentionItems = overview.needs_attention || [];
    const emails = overview.emails || [];
    const latestEmail = emails[0] || attentionItems[0] || {};
    const metrics = overview.metrics || {};
    const actionCount = metrics.actions || attentionItems.length || 0;
    const importantCount = metrics.important || attentionItems.length || 0;
    const hasAttention = attentionItems.length > 0;

    return {
      id: 'thread-live-gmail-overview',
      subject: hasAttention
        ? `Live Gmail Agent Analysis: ${importantCount} important thread${importantCount === 1 ? '' : 's'}`
        : 'Live Gmail Agent Analysis: Inbox stable',
      senders: 'Google Gmail + Agent Harness',
      time: 'Live',
      unread: hasAttention,
      starred: hasAttention,
      isSent: false,
      badges: [
        { type: hasAttention ? 'action-req' : 'resolved', text: hasAttention ? `${actionCount} Live Actions` : 'Live Inbox Clear' },
        { type: 'dependency', text: `${metrics.emails || emails.length || 0} Emails Scanned` }
      ],
      participants: [
        { name: 'Gmail API', role: 'Email Source', email: 'users/me/messages' },
        { name: 'Agent Harness', role: 'Analyzer', email: 'api/dashboard/overview' }
      ],
      messages: [
        {
          id: 'live-gmail-insight',
          sender: 'Agent Harness',
          email: 'api/dashboard/overview',
          time: 'Just now',
          avatarBg: 'linear-gradient(135deg, #0284c7, #10b981)',
          avatarText: 'A',
          body: overview.ai_insight || 'Backend connected. No urgent live insight returned yet.',
          isBlocker: hasAttention,
          highlightQuote: hasAttention ? 'Live Gmail scan found messages that need review or action.' : ''
        },
        ...attentionItems.slice(0, 5).map((item, index) => ({
          id: `live-attention-${index}`,
          sender: item.sender || 'Gmail Sender',
          email: item.subject || latestEmail.subject || 'Live Gmail',
          time: 'Recent',
          avatarBg: 'linear-gradient(135deg, #f59e0b, #ef4444)',
          avatarText: (item.sender || 'G').trim().charAt(0).toUpperCase(),
          body: item.reason || item.snippet || 'This message was marked as needing attention by the backend analyzer.',
          isBlocker: index === 0,
          highlightQuote: index === 0 ? 'Top backend-detected attention item.' : ''
        }))
      ],
      harnessData: {
        project: 'Live Gmail Inbox',
        deadline: hasAttention ? 'Review now • Live inbox signal' : 'No urgent deadline detected',
        riskLevel: hasAttention ? 'MEDIUM' : 'LOW',
        blocker: hasAttention ? {
          title: attentionItems[0]?.subject || 'Live Gmail attention item',
          responsible: attentionItems[0]?.sender || 'Inbox owner',
          waitingOn: 'Human review'
        } : null,
        dependencies: hasAttention ? [
          {
            id: 'live-d1',
            title: 'Review Gmail Signal',
            person: attentionItems[0]?.sender || 'Inbox owner',
            status: 'node-blocker',
            statusText: 'NEEDS REVIEW',
            icon: 'fa-solid fa-circle-exclamation'
          },
          {
            id: 'live-d2',
            title: 'Approve Suggested Follow-up',
            person: 'Human Signoff',
            status: 'node-waiting',
            statusText: 'REQUIRED FOR',
            icon: 'fa-solid fa-hand'
          },
          {
            id: 'live-d3',
            title: 'Execute Workflow',
            person: 'Agent Harness',
            status: 'node-final',
            statusText: 'TARGET',
            icon: 'fa-solid fa-bolt'
          }
        ] : [],
        actions: attentionItems.slice(0, 4).map((item, index) => ({
          id: `live-act-${index}`,
          kind: 'draft',
          kindLabel: 'Review Live Email',
          desc: `${item.sender || 'Sender'}: ${item.reason || item.subject || 'Needs attention from Gmail analysis'}`,
          approved: false
        }))
      }
    };
  }

  function createLiveEmailThread(email, index) {
    const sender = email.sender || 'Gmail Sender';
    const subject = email.subject || 'No Subject';
    const snippet = email.snippet || 'No preview available.';
    const attentionWords = /(urgent|asap|blocked|blocker|approval|approve|deadline|due|waiting|risk|deploy|demo|review|action|required|alert|invoice|security|exposure)/i;
    const needsReview = attentionWords.test(`${subject} ${snippet}`);

    return {
      id: `gmail-${email.id || index}`,
      subject,
      senders: sender,
      time: email.date ? new Date(email.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent',
      unread: index < 3,
      starred: false,
      isSent: false,
      badges: [
        { type: needsReview ? 'action-req' : 'resolved', text: needsReview ? 'Live Gmail Review' : 'Fetched from Gmail' }
      ],
      participants: [
        { name: sender, role: 'Sender', email: sender },
        { name: 'Agent Harness', role: 'Analyzer', email: 'api/dashboard/overview' }
      ],
      messages: [
        {
          id: `gmail-message-${email.id || index}`,
          sender,
          email: sender,
          time: email.date ? new Date(email.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Recent',
          avatarBg: needsReview
            ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
            : 'linear-gradient(135deg, #0284c7, #38bdf8)',
          avatarText: sender.trim().charAt(0).toUpperCase(),
          body: snippet,
          isBlocker: needsReview,
          highlightQuote: needsReview ? 'Agent marked this Gmail message as needing review.' : ''
        }
      ],
      harnessData: {
        project: 'Live Gmail Message',
        deadline: needsReview ? 'Review recommended' : 'No deadline detected',
        riskLevel: needsReview ? 'MEDIUM' : 'LOW',
        blocker: needsReview ? {
          title: subject,
          responsible: sender,
          waitingOn: 'Human review'
        } : null,
        dependencies: [],
        actions: needsReview ? [
          {
            id: `gmail-action-${email.id || index}`,
            kind: 'draft',
            kindLabel: 'Review Email',
            desc: `Open and review: ${subject}`,
            approved: false
          }
        ] : []
      }
    };
  }

  async function syncBackendOverview() {
    try {
      const healthResponse = await fetch('/api/health');
      const health = await healthResponse.json();

      if (!health.gmailAuthenticated) {
        setBackendStatus('Auth Needed', 'waiting');
        pushAuditLog('Backend online; Gmail OAuth not completed yet', 'analysis');
        updateMailboxCounts();
        return;
      }

      setBackendStatus('Analyzing', 'waiting');
      const overviewResponse = await fetch('/api/dashboard/overview');
      if (!overviewResponse.ok) throw new Error(`Overview API returned ${overviewResponse.status}`);

      const overview = await overviewResponse.json();
      const liveThread = createBackendOverviewThread(overview);
      const liveEmailThreads = (overview.emails || []).slice(0, 12).map(createLiveEmailThread);
      state.threads = state.threads.filter(thread => !thread.id.startsWith('gmail-') && thread.id !== liveThread.id);

      state.threads.unshift(liveThread, ...liveEmailThreads);

      state.activeThreadId = liveThread.id;
      setBackendStatus('Live Gmail', 'live');
      pushAuditLog(`Live Gmail overview synced: ${overview.metrics?.emails || 0} emails scanned, ${overview.metrics?.actions || 0} action items`, 'analysis');
      updatePendingCount();
      updateMailboxCounts(overview.metrics?.emails);
      renderThreadsList();
      renderThreadDetail();
      showToast('Live Gmail dashboard overview synced');
    } catch (error) {
      console.error('Backend overview sync failed:', error);
      setBackendStatus('Demo Mode', 'error');
      pushAuditLog('Backend overview unavailable; using curated demo workflow data', 'analysis');
      updateMailboxCounts();
    }
  }

  async function syncGoogleProfile() {
    try {
      const response = await fetch('/api/me');
      if (!response.ok) return;
      const user = await response.json();
      const userMetaEl = document.querySelector('.user-profile-menu .user-meta');
      const userAvatarEl = document.querySelector('.user-profile-menu .user-avatar');

      if (userMetaEl && user.name) {
        userMetaEl.innerHTML = `
          <span class="user-name">${escapeHtml(user.name)}</span>
          <span class="user-role">${escapeHtml(user.email || 'Google Workspace')}</span>
        `;
      }

      if (userAvatarEl && user.picture) {
        userAvatarEl.src = user.picture;
      }

      sessionStorage.setItem('ciphersquad_user_profile', JSON.stringify(user));
    } catch (error) {
      console.warn('Could not sync Google profile from backend:', error.message || error);
    }
  }

  function buildVoiceBriefingText() {
    const thread = state.threads.find(t => t.id === state.activeThreadId) || state.threads[0];
    const harness = thread?.harnessData || {};
    const pendingActions = (harness.actions || []).filter(action => !action.approved);
    const blockerText = harness.blocker
      ? `Blocker: ${harness.blocker.title}. Responsible owner: ${harness.blocker.responsible}. Waiting on: ${harness.blocker.waitingOn}.`
      : 'No active blocker is currently attached to this thread.';
    const actionText = pendingActions.length
      ? `There are ${pendingActions.length} human-approved actions waiting: ${pendingActions.map(action => action.kindLabel).join(', ')}.`
      : 'No human approval actions are pending.';

    return [
      `CipherMail agent voice briefing for ${thread?.subject || 'the selected email thread'}.`,
      `Project: ${harness.project || 'Inbox workflow'}.`,
      `Risk level: ${harness.riskLevel || 'unknown'}.`,
      `Deadline signal: ${harness.deadline || 'not detected'}.`,
      blockerText,
      actionText,
      'Recommendation: review the dependency chain, approve the safe actions, and keep every execution step visible in the audit trail.'
    ].join(' ');
  }

  async function playVoiceBriefing() {
    if (!voiceBriefingBtnEl || voiceBriefingBtnEl.classList.contains('is-loading')) return;

    voiceBriefingBtnEl.classList.add('is-loading');
    voiceBriefingBtnEl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Generating</span>';
    const briefingText = buildVoiceBriefingText();

    try {
      const response = await fetch('/api/voice/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: briefingText })
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error || `Voice API returned ${response.status}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.addEventListener('ended', () => URL.revokeObjectURL(audioUrl), { once: true });
      await audio.play();

      pushAuditLog('ElevenLabs voice briefing generated and played for selected thread', 'execution');
      showToast('ElevenLabs voice briefing playing');
    } catch (error) {
      console.warn('Premium ElevenLabs voice unavailable:', error.message || error);
      if ('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(briefingText);
        utterance.rate = 0.96;
        utterance.pitch = 1;
        window.speechSynthesis.speak(utterance);
        pushAuditLog('Browser fallback voice briefing played; ElevenLabs key needs replacement with sk_ API key', 'analysis');
        showToast('Fallback voice briefing playing. Replace ElevenLabs key with sk_ key for premium voice.', 'info');
      } else {
        showToast('Voice briefing unavailable. Check ElevenLabs key and network.', 'info');
      }
    } finally {
      voiceBriefingBtnEl.classList.remove('is-loading');
      voiceBriefingBtnEl.innerHTML = '<i class="fa-solid fa-volume-high"></i><span>Voice Briefing</span>';
    }
  }

  // Push Audit Log Entry
  function pushAuditLog(event, category = 'analysis') {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    state.auditLogs.unshift({ time, event, category });
    if (auditBadgeEl) auditBadgeEl.textContent = state.auditLogs.length;
  }

  // Synchronize Active Filter & Counts across UI
  function updatePendingCount() {
    let totalPending = 0;
    state.threads.forEach(t => {
      if (t.harnessData && t.harnessData.actions) {
        totalPending += t.harnessData.actions.filter(a => !a.approved).length;
      }
    });

    state.pendingApprovalsCount = totalPending;
    if (pendingBadgeCountEl) pendingBadgeCountEl.textContent = totalPending;
    if (sidebarActionCountEl) sidebarActionCountEl.textContent = totalPending;
    if (auditBadgeEl) auditBadgeEl.textContent = state.auditLogs.length;
    updateMailboxCounts();
  }

  function setActiveFilter(filterName) {
    state.activeFilter = filterName;

    // Synchronize sidebar nav items
    sidebarNavItems.forEach(item => {
      const f = item.dataset.filter;
      if (f === filterName || (f === 'needs-action' && filterName === 'actions') || (f === 'actions' && filterName === 'needs-action')) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Synchronize Pane 2 pill buttons
    paneFilterBtns.forEach(btn => {
      const f = btn.dataset.filter;
      if (f === filterName || (f === 'actions' && filterName === 'needs-action') || (f === 'needs-action' && filterName === 'actions')) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Synchronize threadFilterSelect dropdown
    if (threadFilterSelect) {
      if (filterName === 'needs-action' || filterName === 'actions') {
        threadFilterSelect.value = 'actions';
      } else if (filterName === 'blockers') {
        threadFilterSelect.value = 'blockers';
      } else {
        threadFilterSelect.value = 'all';
      }
    }

    renderThreadsList();
  }

  // ==========================================
  // RENDER THREADS IN PANE 2
  // ==========================================
  function renderThreadsList() {
    if (!threadsListEl) return;
    threadsListEl.innerHTML = '';

    const filtered = state.threads.filter(thread => {
      // Filter tab logic
      if (state.activeFilter === 'actions' || state.activeFilter === 'needs-action') {
        if (!thread.harnessData || !thread.harnessData.actions || thread.harnessData.actions.filter(a => !a.approved).length === 0) return false;
      } else if (state.activeFilter === 'blockers') {
        if (!thread.harnessData || !thread.harnessData.blocker) return false;
      } else if (state.activeFilter === 'starred') {
        if (!thread.starred) return false;
      } else if (state.activeFilter === 'sent') {
        if (!thread.isSent && !thread.senders.includes('Priyam')) return false;
      }

      // Search query logic
      if (state.searchQuery.trim() !== '') {
        const q = state.searchQuery.toLowerCase();
        const matchSubject = thread.subject.toLowerCase().includes(q);
        const matchSenders = thread.senders.toLowerCase().includes(q);
        const matchBody = thread.messages.some(m => m.body.toLowerCase().includes(q));
        if (!matchSubject && !matchSenders && !matchBody) return false;
      }

      return true;
    });

    if (filtered.length === 0) {
      threadsListEl.innerHTML = `
        <div style="padding: 36px 20px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
          <i class="fa-solid fa-inbox" style="font-size: 2.2rem; margin-bottom: 12px; color: var(--text-dim); display: block;"></i>
          <p style="margin-bottom: 10px; font-weight: 600;">No email threads matching "${state.activeFilter}"</p>
          <button class="pill-btn" id="resetFilterFromEmptyBtn" style="font-size: 0.72rem; margin: 0 auto;">Show All Threads</button>
        </div>
      `;
      const resetBtn = document.getElementById('resetFilterFromEmptyBtn');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          state.searchQuery = '';
          if (searchInputEl) searchInputEl.value = '';
          setActiveFilter('all');
        });
      }
      return;
    }

    filtered.forEach(thread => {
      const card = document.createElement('div');
      card.className = `thread-card ${thread.id === state.activeThreadId ? 'active' : ''}`;
      card.dataset.id = thread.id;

      const badgesHtml = thread.badges.map(b => `<span class="agent-badge ${b.type}">${b.text}</span>`).join('');
      const snippet = thread.messages[thread.messages.length - 1].body;

      card.innerHTML = `
        <div class="thread-card-top">
          <span class="thread-senders">
            ${thread.senders}
            <span class="thread-count">(${thread.messages.length})</span>
          </span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="thread-time">${thread.time}</span>
            <button class="thread-star-btn ${thread.starred ? 'active starred' : ''}" data-star-id="${thread.id}" title="${thread.starred ? 'Starred thread' : 'Click to star'}">
              <i class="${thread.starred ? 'fa-solid fa-star' : 'fa-regular fa-star'}"></i>
            </button>
          </div>
        </div>
        <div class="thread-subject">${thread.subject}</div>
        <div class="thread-snippet">${snippet}</div>
        <div class="thread-badges">${badgesHtml}</div>
      `;

      // Select thread on card click
      card.addEventListener('click', (e) => {
        if (e.target.closest('.thread-star-btn')) return;
        state.activeThreadId = thread.id;
        renderThreadsList();
        renderThreadDetail();
      });

      // Star button toggle click
      const starBtn = card.querySelector('.thread-star-btn');
      if (starBtn) {
        starBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          thread.starred = !thread.starred;
          pushAuditLog(`${thread.starred ? 'Starred' : 'Unstarred'} thread: "${thread.subject.substring(0, 30)}..."`, 'task');
          showToast(thread.starred ? `⭐ Thread starred` : `Thread unstarred`, 'star');
          renderThreadsList();
          if (state.activeThreadId === thread.id) {
            renderThreadDetail();
          }
        });
      }

      threadsListEl.appendChild(card);
    });
  }

  // ==========================================
  // RENDER THREAD DETAIL & REASONING IN PANE 3
  // ==========================================
  function renderThreadDetail() {
    if (!threadDetailPaneEl) return;
    const thread = state.threads.find(t => t.id === state.activeThreadId);

    if (!thread) {
      threadDetailPaneEl.innerHTML = `
        <div style="padding: 60px 30px; text-align: center; color: var(--text-muted); font-size: 0.95rem; margin: auto;">
          <i class="fa-solid fa-envelope-open" style="font-size: 3rem; color: var(--text-dim); margin-bottom: 16px; display: block;"></i>
          <h3>No Conversation Selected</h3>
          <p style="font-size: 0.82rem; color: var(--text-dim); margin-top: 6px;">Select an email thread from the inbox to inspect messages, dependencies, and agent action signoffs.</p>
        </div>
      `;
      return;
    }

    const participantsHtml = thread.participants.map(p => `
      <span class="participant-chip ${p.name.includes('Priyam') ? 'active-person' : ''}" data-participant="${p.name}" title="Click to view messages from ${p.name}">
        <i class="fa-solid fa-user" style="font-size: 0.65rem;"></i>
        <span>${p.name}</span>
      </span>
    `).join('');

    const messagesHtml = thread.messages.map(m => `
      <div class="message-card ${m.isBlocker ? 'highlighted-blocker-msg' : ''}" id="msg-${m.id}" data-sender="${m.sender}">
        <div class="message-header">
          <div class="sender-identity">
            <div class="sender-avatar" style="background: ${m.avatarBg};">${m.avatarText}</div>
            <div class="sender-name-group">
              <span class="sender-full-name">${m.sender}</span>
              <span class="sender-email-addr">${m.email}</span>
            </div>
          </div>
          <span class="message-timestamp">${m.time}</span>
        </div>
        <div class="message-body">
          <p>${m.body}</p>
          ${m.highlightQuote ? `<div class="highlighted-quote"><i class="fa-solid fa-circle-exclamation"></i> ${m.highlightQuote}</div>` : ''}
        </div>
      </div>
    `).join('');

    // Agent Harness Panel Data
    const harness = thread.harnessData || { project: 'Project', deadline: 'Upcoming', riskLevel: 'NONE', blocker: null, dependencies: [], actions: [] };

    let blockerCardHtml = '';
    if (harness.blocker) {
      blockerCardHtml = `
        <div class="blocker-alert-card" id="blockerAlertCard" title="Click to jump to blocker in conversation">
          <div class="blocker-badge-row">
            <span class="blocker-tag"><i class="fa-solid fa-triangle-exclamation"></i> CRITICAL BLOCKER</span>
            <span class="risk-level-tag">RISK: ${harness.riskLevel}</span>
          </div>
          <div class="blocker-title">${harness.blocker.title}</div>
          <div class="blocker-details-grid">
            <div class="detail-item-col">
              <span class="detail-lbl">Responsible</span>
              <span class="detail-val">${harness.blocker.responsible}</span>
            </div>
            <div class="detail-item-col">
              <span class="detail-lbl">Waiting On</span>
              <span class="detail-val">${harness.blocker.waitingOn}</span>
            </div>
          </div>
          <div class="deadline-countdown-chip">
            <i class="fa-solid fa-stopwatch"></i>
            <span>${harness.deadline}</span>
          </div>
        </div>
      `;
    }

    // Dependency chain flow HTML
    let dependencyChainHtml = '';
    if (harness.dependencies && harness.dependencies.length > 0) {
      const nodes = harness.dependencies.map((node, index) => {
        let connector = '';
        if (index > 0) {
          const isDownstream = node.statusText === 'REQUIRED FOR' || node.statusText === 'TARGET';
          connector = `
            <div class="chain-connector-arrow ${isDownstream ? 'downstream' : ''}">
              <i class="fa-solid fa-arrow-down"></i>
              <span>${harness.dependencies[index - 1].statusText}</span>
            </div>
          `;
        }
        return `
          ${connector}
          <div class="node-item ${node.status}" data-node-id="${node.id}" title="Click to open Fullscreen Graph">
            <i class="${node.icon} node-status-icon"></i>
            <div class="node-content-box">
              <span class="node-title">${node.title}</span>
              <span class="node-person">${node.person}</span>
            </div>
          </div>
        `;
      }).join('');

      dependencyChainHtml = `
        <div class="section-headline">
          <span>Live Dependency Chain</span>
          <button class="pill-btn" id="openGraphBtn" style="font-size: 0.65rem;">Fullscreen Graph</button>
        </div>
        <div class="dependency-tree-card">
          <div class="chain-flow">
            ${nodes}
          </div>
        </div>
      `;
    }

    // Proposed actions HTML
    let actionsHtml = '';
    const pendingActions = (harness.actions || []).filter(a => !a.approved);

    if (harness.actions && harness.actions.length > 0) {
      const actionCards = harness.actions.map(act => `
        <div class="action-card ${act.approved ? 'approved' : ''}" id="${act.id}">
          <div class="action-top-row">
            <span class="action-kind-pill ${act.kind}">${act.kindLabel}</span>
            <span class="action-executed-indicator"><i class="fa-solid fa-circle-check"></i> Executed</span>
          </div>
          <div class="action-desc">${act.desc}</div>
          <div class="action-controls">
            <button class="btn-dismiss" onclick="window.dismissAction('${act.id}')">Dismiss</button>
            <button class="btn-approve" onclick="window.approveAction('${act.id}')">
              <i class="fa-solid fa-check"></i> Approve
            </button>
          </div>
        </div>
      `).join('');

      const masterBtnText = pendingActions.length > 0
        ? `<i class="fa-solid fa-bolt"></i> Approve & Execute All (${pendingActions.length} Actions)`
        : `<i class="fa-solid fa-check-double"></i> All Actions Executed`;

      actionsHtml = `
        <div class="section-headline" id="actionsHeadline">
          <span>Proposed Actions (Human-in-the-Loop)</span>
          <span style="color: var(--status-amber); font-size: 0.7rem;">${pendingActions.length} Pending</span>
        </div>
        <div class="actions-approval-container" id="actionsApprovalContainer">
          ${actionCards}
        </div>
        <button class="master-approve-btn" id="masterApproveBtn" ${pendingActions.length === 0 ? 'disabled' : ''}>
          ${masterBtnText}
        </button>
      `;
    } else {
      actionsHtml = `
        <div class="section-headline"><span>Actions</span></div>
        <div style="padding: 16px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: 10px; font-size: 0.78rem; color: var(--text-muted); text-align: center;">
          <i class="fa-solid fa-circle-check" style="color: var(--status-green); font-size: 1rem; margin-bottom: 6px; display: block;"></i>
          No actions pending. Workflows are fully synchronized.
        </div>
      `;
    }

    threadDetailPaneEl.innerHTML = `
      <!-- Left: Conversation Area -->
      <div class="conversation-area">
        <div class="conversation-header">
          <h1 class="thread-full-subject">${thread.subject}</h1>
          <div class="conversation-meta-row">
            <div class="participants-tag-group">
              <span>Participants:</span>
              ${participantsHtml}
            </div>
            <div class="quick-filter-pills">
              <button class="pill-btn" id="detailStarBtn" title="${thread.starred ? 'Unstar thread' : 'Star thread'}">
                <i class="${thread.starred ? 'fa-solid fa-star' : 'fa-regular fa-star'}" style="${thread.starred ? 'color: #f59e0b;' : ''}"></i>
                <span>${thread.starred ? 'Starred' : 'Star'}</span>
              </button>
              <button class="pill-btn" id="detailForwardBtn" title="Forward this thread">
                <i class="fa-solid fa-share"></i> Forward
              </button>
            </div>
          </div>
        </div>

        <div class="messages-stream" id="messagesStream">
          ${messagesHtml}
        </div>

        <!-- Quick Reply Box with AI Auto-Draft insertion -->
        <div class="reply-composer-box">
          <div class="reply-header">
            <span>Reply to thread</span>
            <span class="ai-draft-badge" id="insertAiDraftBtn" style="cursor: pointer;">
              <i class="fa-solid fa-wand-magic-sparkles"></i> Insert Agent Suggested Draft
            </span>
          </div>
          <textarea class="reply-textarea" id="replyTextarea" placeholder="Write a response or approve agent actions on the right..."></textarea>
          <div class="reply-footer">
            <div style="font-size: 0.72rem; color: var(--text-dim);">
              <i class="fa-solid fa-shield-halved"></i> Human Review Required before sending
            </div>
            <button class="send-reply-btn" id="sendReplyBtn">Send Reply</button>
          </div>
        </div>
      </div>

      <!-- Right: Agent Harness Intelligence Panel -->
      <div class="harness-intelligence-pane" id="harnessIntelligencePane">
        <div class="harness-header">
          <div class="harness-title-group">
            <i class="fa-solid fa-network-wired harness-sparkle-icon"></i>
            <h3>Agent Reasoning</h3>
          </div>
          <span class="count-pill alert" style="font-size: 0.68rem;">Harness Live</span>
        </div>

        <!-- Pipeline Step Tracker -->
        <div class="agent-pipeline-flow">
          <div class="step-item active" id="pipelineStepContext" title="Click to view Context reasoning"><i class="fa-solid fa-brain"></i> Context</div>
          <span class="step-arrow">→</span>
          <div class="step-item active" id="pipelineStepDependencies" title="Click to view Dependency Graph"><i class="fa-solid fa-diagram-project"></i> Dependencies</div>
          <span class="step-arrow">→</span>
          <div class="step-item active" id="pipelineStepApproval" title="Click to jump to Action signoffs"><i class="fa-solid fa-hand"></i> Human Approval</div>
        </div>

        <!-- Detected Blocker -->
        ${blockerCardHtml}

        <!-- Live Visual Dependency Flow -->
        ${dependencyChainHtml}

        <!-- Proposed Actions for Human Review -->
        ${actionsHtml}
      </div>
    `;

    // Star toggle button in conversation header
    const detailStarBtn = document.getElementById('detailStarBtn');
    if (detailStarBtn) {
      detailStarBtn.addEventListener('click', () => {
        thread.starred = !thread.starred;
        pushAuditLog(`${thread.starred ? 'Starred' : 'Unstarred'} thread: "${thread.subject.substring(0, 30)}..."`, 'task');
        showToast(thread.starred ? `⭐ Thread starred` : `Thread unstarred`, 'star');
        renderThreadsList();
        renderThreadDetail();
      });
    }

    // Forward button in conversation header
    const detailForwardBtn = document.getElementById('detailForwardBtn');
    if (detailForwardBtn) {
      detailForwardBtn.addEventListener('click', () => {
        const textarea = document.getElementById('replyTextarea');
        if (textarea) {
          textarea.value = `---------- Forwarded message ---------\nFrom: ${thread.senders}\nSubject: ${thread.subject}\n\nFYI - review the blocker and action proposals attached above.`;
          textarea.focus();
          showToast('Forward template loaded into composer');
        }
      });
    }

    // Participant chips click to highlight sender messages
    document.querySelectorAll('.participant-chip[data-participant]').forEach(chip => {
      chip.addEventListener('click', () => {
        const participantName = chip.dataset.participant;
        const msgCards = document.querySelectorAll('.messages-stream .message-card');
        let matched = false;
        msgCards.forEach(card => {
          const sender = card.dataset.sender || '';
          if (sender.includes(participantName) || participantName.includes(sender)) {
            card.classList.add('flash-highlight');
            if (!matched) {
              card.scrollIntoView({ behavior: 'smooth', block: 'center' });
              matched = true;
            }
            setTimeout(() => card.classList.remove('flash-highlight'), 2800);
          }
        });
        showToast(`Filtered messages from ${participantName}`);
      });
    });

    // Blocker card click: jumps to blocker message with flash highlight
    const blockerAlertCard = document.getElementById('blockerAlertCard');
    if (blockerAlertCard) {
      blockerAlertCard.addEventListener('click', () => {
        const blockerMsg = document.querySelector('.messages-stream .highlighted-blocker-msg');
        if (blockerMsg) {
          blockerMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
          blockerMsg.classList.add('flash-highlight');
          setTimeout(() => blockerMsg.classList.remove('flash-highlight'), 2800);
          showToast('🎯 Focused on critical blocker message in conversation');
        }
      });
    }

    // Node items in live dependency chain: click opens Fullscreen Graph Modal
    document.querySelectorAll('.chain-flow .node-item').forEach(node => {
      node.addEventListener('click', openDependencyGraphModal);
    });

    // Pipeline step clicks
    const stepContext = document.getElementById('pipelineStepContext');
    if (stepContext) {
      stepContext.addEventListener('click', () => {
        showToast('Pipeline Stage 1: Continuous thread context & NLP entity extraction active', 'info');
      });
    }

    const stepDependencies = document.getElementById('pipelineStepDependencies');
    if (stepDependencies) {
      stepDependencies.addEventListener('click', openDependencyGraphModal);
    }

    const stepApproval = document.getElementById('pipelineStepApproval');
    if (stepApproval) {
      stepApproval.addEventListener('click', () => {
        const actionsEl = document.getElementById('actionsApprovalContainer');
        if (actionsEl) {
          actionsEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          showToast('Stage 3: Review proposed actions below before dispatch', 'info');
        }
      });
    }

    // Insert AI Draft Button
    const insertAiDraftBtn = document.getElementById('insertAiDraftBtn');
    if (insertAiDraftBtn) {
      insertAiDraftBtn.addEventListener('click', () => {
        const textarea = document.getElementById('replyTextarea');
        if (textarea) {
          if (thread.harnessData && thread.harnessData.blocker) {
            textarea.value = `Hi ${thread.harnessData.blocker.responsible.split(' ')[0]}, following up to expedite the ${thread.harnessData.blocker.title.toLowerCase()} today so our deployment pipeline and frontend integration stay on track for Wednesday's client demo.`;
          } else {
            textarea.value = `Hi team, confirming that all workflow actions have been synchronized and verified. Ready to proceed with the next milestone.`;
          }
          textarea.focus();
          showToast('✓ AI Suggested Draft inserted into reply composer');
        }
      });
    }

    // Send Reply Button: actual message append and audit logging
    const sendReplyBtn = document.getElementById('sendReplyBtn');
    if (sendReplyBtn) {
      sendReplyBtn.addEventListener('click', () => {
        const textarea = document.getElementById('replyTextarea');
        if (!textarea || !textarea.value.trim()) {
          showToast('Please type a reply message first', 'info');
          return;
        }

        const replyContent = textarea.value.trim();
        thread.messages.push({
          id: 'm-' + Date.now(),
          sender: 'Priyam Trivedi (You)',
          email: 'priyam@ciphersquad.tech',
          time: 'Just now',
          avatarBg: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
          avatarText: 'P',
          body: replyContent,
          isBlocker: false
        });

        pushAuditLog(`User sent reply on "${thread.subject.substring(0, 30)}..."`, 'execution');
        showToast('✓ Reply sent and logged in audit trail');
        textarea.value = '';
        renderThreadDetail();

        setTimeout(() => {
          const stream = document.getElementById('messagesStream');
          if (stream) stream.scrollTop = stream.scrollHeight;
        }, 100);
      });
    }

    // Fullscreen Graph Button
    const openGraphBtn = document.getElementById('openGraphBtn');
    if (openGraphBtn) {
      openGraphBtn.addEventListener('click', openDependencyGraphModal);
    }

    // Master Approve & Execute All Button
    const masterApproveBtn = document.getElementById('masterApproveBtn');
    if (masterApproveBtn) {
      masterApproveBtn.addEventListener('click', () => {
        executeAllPendingActions(thread.id);
      });
    }
  }

  // ==========================================
  // ACTION APPROVAL & EXECUTION FUNCTIONS
  // ==========================================
  window.approveAction = function(actionId) {
    const thread = state.threads.find(t => t.id === state.activeThreadId);
    if (!thread || !thread.harnessData || !thread.harnessData.actions) return;

    const action = thread.harnessData.actions.find(a => a.id === actionId);
    if (!action || action.approved) return;

    action.approved = true;
    updatePendingCount();
    pushAuditLog(`Approved action: ${action.kindLabel} — "${action.desc.substring(0, 45)}..."`, 'approval');
    showToast(`✓ Approved & Executed: ${action.kindLabel}`);

    const cardEl = document.getElementById(actionId);
    if (cardEl) cardEl.classList.add('approved');
    setTimeout(() => renderThreadDetail(), 350);
  };

  window.dismissAction = function(actionId) {
    const thread = state.threads.find(t => t.id === state.activeThreadId);
    if (!thread || !thread.harnessData || !thread.harnessData.actions) return;

    const action = thread.harnessData.actions.find(a => a.id === actionId);
    const actionLabel = action ? action.kindLabel : 'Action';
    thread.harnessData.actions = thread.harnessData.actions.filter(a => a.id !== actionId);
    updatePendingCount();
    pushAuditLog(`Dismissed action: ${actionLabel}`, 'analysis');
    showToast(`Action dismissed: ${actionLabel}`);
    renderThreadDetail();
  };

  function executeAllPendingActions(threadId) {
    const thread = state.threads.find(t => t.id === threadId);
    if (!thread || !thread.harnessData || !thread.harnessData.actions) return;

    const pending = thread.harnessData.actions.filter(a => !a.approved);
    if (pending.length === 0) return;

    pending.forEach(a => {
      a.approved = true;
      pushAuditLog(`Executed ${a.kindLabel}: "${a.desc.substring(0, 40)}..."`, 'execution');
    });

    updatePendingCount();
    showToast(`✓ Approved & executed ${pending.length} actions across services`);
    renderThreadDetail();
  }

  // ==========================================
  // MODALS LOGIC
  // ==========================================
  // 1. Dependency Graph Modal
  function openDependencyGraphModal() {
    const thread = state.threads.find(t => t.id === state.activeThreadId);
    if (!thread || !thread.harnessData) return;

    const dependencies = thread.harnessData.dependencies || [];

    graphModalBodyEl.innerHTML = `
      <div style="text-align: center; margin-bottom: 24px;">
        <span class="agent-badge blocker" style="font-size: 0.8rem; padding: 4px 12px;">CRITICAL PATH: ${thread.harnessData.deadline || '2 DAYS TO CLIENT DEMO'}</span>
        <h2 style="font-size: 1.35rem; color: var(--text-heading); margin-top: 10px;">${thread.subject}</h2>
      </div>

      <div style="display: flex; flex-direction: column; align-items: center; gap: 14px; max-width: 600px; margin: 0 auto;">
        ${dependencies.length > 0 ? dependencies.map((node, i) => `
          ${i > 0 ? `<div style="color: var(--status-amber); font-size: 0.85rem; font-weight: 700;"><i class="fa-solid fa-arrow-down"></i> ${dependencies[i-1].statusText}</div>` : ''}
          <div class="node-item ${node.status}" style="width: 100%; padding: 14px 20px; font-size: 0.95rem;">
            <i class="${node.icon}" style="font-size: 1.2rem;"></i>
            <div class="node-content-box">
              <span class="node-title" style="font-size: 0.95rem;">${node.title}</span>
              <span class="node-person" style="font-size: 0.8rem;">Responsible: ${node.person}</span>
            </div>
          </div>
        `).join('') : `
          <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.9rem;">
            <i class="fa-solid fa-circle-check" style="color: var(--status-green); font-size: 2rem; margin-bottom: 10px; display: block;"></i>
            No active cross-team dependency blockers in this conversation.
          </div>
        `}
      </div>

      <div style="margin-top: 28px; padding: 16px; background: var(--bg-card-subtle); border: 1px solid var(--border-subtle); border-radius: 12px; font-size: 0.82rem; line-height: 1.6; color: var(--text-muted);">
        <strong style="color: var(--text-heading);">Harness Intelligence Explanation:</strong>
        ${thread.harnessData.blocker
          ? `The agent harness identified that <strong>${thread.harnessData.blocker.responsible}</strong> is currently on the critical blocker path. Downstream team members (${thread.harnessData.blocker.waitingOn}) cannot begin their scheduled integration tasks until this is resolved.`
          : `All dependencies in this thread have been resolved or are operating with normal velocity. No milestone breaches detected.`}
      </div>
    `;

    openModal(graphModalEl);
  }

  // 2. Audit Trail Modal
  function renderAuditTimeline() {
    if (!auditTimelineContainer) return;
    auditTimelineContainer.innerHTML = '';

    if (state.auditLogs.length === 0) {
      auditTimelineContainer.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
          No audit entries recorded yet.
        </div>
      `;
      return;
    }

    state.auditLogs.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'timeline-item';

      let catClass = 'analysis';
      let catLabel = 'Analysis';
      const text = entry.event.toLowerCase();

      if (text.includes('blocker') || text.includes('critical')) {
        catClass = 'blocker';
        catLabel = 'Blocker';
      } else if (text.includes('task') || text.includes('star')) {
        catClass = 'task';
        catLabel = 'Task';
      } else if (text.includes('approved')) {
        catClass = 'approval';
        catLabel = 'Approval';
      } else if (text.includes('executed') || text.includes('sent') || text.includes('dispatched')) {
        catClass = 'execution';
        catLabel = 'Executed';
      }

      item.innerHTML = `
        <span class="timeline-badge ${catClass}">${catLabel}</span>
        <div class="timeline-content">${entry.event}</div>
        <span class="timeline-time">${entry.time}</span>
      `;
      auditTimelineContainer.appendChild(item);
    });
  }

  function openAuditModal() {
    renderAuditTimeline();
    openModal(auditModalEl);
  }

  function exportAuditLogJson() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.auditLogs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "ciphersquad_agent_audit.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('✓ Audit log downloaded as JSON');
  }

  // 3. Team Member Collaborator Modal
  function openTeamMemberModal(memberKey) {
    const member = state.teamMembers[memberKey];
    if (!member) return;

    state.activeTeamMember = memberKey;
    if (teamModalMemberName) teamModalMemberName.textContent = member.name;
    if (teamModalMemberRole) teamModalMemberRole.textContent = `${member.role} • ${member.email}`;

    if (teamModalBody) {
      teamModalBody.innerHTML = `
        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 20px; padding: 16px; background: var(--bg-card-subtle); border-radius: 12px; border: 1px solid var(--border-subtle);">
          <div style="width: 52px; height: 52px; border-radius: 50%; background: ${member.avatarBg}; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; font-weight: 800; color: #fff;">${member.avatarText}</div>
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <strong style="font-size: 1.1rem; color: var(--text-heading);">${member.name}</strong>
              <span class="member-dot ${member.badgeClass}"></span>
              <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">${member.status}</span>
            </div>
            <span style="font-size: 0.8rem; color: var(--text-dim);">${member.email}</span>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div style="padding: 12px 14px; background: var(--bg-input); border-radius: 8px; border: 1px solid var(--border-subtle);">
            <span style="font-size: 0.72rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; display: block; margin-bottom: 4px;">Current Task</span>
            <span style="font-size: 0.85rem; color: var(--text-main);">${member.currentTask}</span>
          </div>

          <div style="padding: 12px 14px; background: ${member.blocker ? 'rgba(225, 29, 72, 0.08)' : 'var(--bg-input)'}; border-radius: 8px; border: 1px solid ${member.blocker ? 'rgba(225, 29, 72, 0.3)' : 'var(--border-subtle)'};">
            <span style="font-size: 0.72rem; font-weight: 700; color: ${member.blocker ? 'var(--status-red)' : 'var(--text-dim)'}; text-transform: uppercase; display: block; margin-bottom: 4px;">
              ${member.blocker ? '🔴 Active Blocker' : '✓ Blocker Status'}
            </span>
            <span style="font-size: 0.85rem; color: ${member.blocker ? 'var(--status-red)' : 'var(--status-green)'}; font-weight: ${member.blocker ? '700' : '500'};">
              ${member.blocker || 'Clear • No blocking dependencies assigned'}
            </span>
          </div>

          <div style="padding: 12px 14px; background: var(--bg-input); border-radius: 8px; border: 1px solid var(--border-subtle);">
            <span style="font-size: 0.72rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; display: block; margin-bottom: 4px;">Waiting On</span>
            <span style="font-size: 0.85rem; color: var(--text-main);">${member.waitingOn}</span>
          </div>
        </div>
      `;
    }

    openModal(teamMemberModalEl);
  }

  // 4. Compose New Thread Modal
  function openComposeModal() {
    openModal(composeModalEl);
  }

  function handleSendCompose() {
    const to = composeTo ? composeTo.value.trim() : '';
    const subject = composeSubject ? composeSubject.value.trim() : '';
    const body = composeBody ? composeBody.value.trim() : '';

    if (!subject || !body) {
      showToast('Please provide a subject and email body', 'info');
      return;
    }

    const newThread = {
      id: 'thread-' + Date.now(),
      subject: subject,
      senders: 'Priyam Trivedi (You)',
      time: 'Just now',
      unread: false,
      starred: false,
      isSent: true,
      badges: [
        { type: 'blocker', text: '🔴 Blocker: Verification' },
        { type: 'dependency', text: '⚠️ Risk: High' },
        { type: 'action-req', text: '3 Actions Proposed' }
      ],
      participants: [
        { name: 'Priyam Trivedi', role: 'Frontend & Pitch', email: 'priyam@ciphersquad.tech' },
        { name: 'Sreyanko Sinha', role: 'DB Architect', email: 'sreyanko@ciphersquad.tech' },
        { name: 'Kartikay Gupta', role: 'Backend Lead', email: 'kartikay@ciphersquad.tech' }
      ],
      messages: [
        {
          id: 'm-comp-' + Date.now(),
          sender: 'Priyam Trivedi (You)',
          email: 'priyam@ciphersquad.tech',
          time: 'Just now',
          avatarBg: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
          avatarText: 'P',
          body: body,
          isBlocker: true,
          highlightQuote: 'Critical blocker detected: Migration scripts blocked awaiting rollback verification.'
        }
      ],
      harnessData: {
        project: 'Production Auth Migration',
        deadline: 'Today 17:00 • Staging Gateway Rollout',
        riskLevel: 'CRITICAL',
        blocker: {
          title: 'Migration Rollback Verification',
          responsible: 'Sreyanko Sinha',
          waitingOn: 'Kartikay Gupta & Priyam Trivedi'
        },
        dependencies: [
          {
            id: 'd-new-1',
            title: 'Rollback Runbook Verification',
            person: 'Sreyanko Sinha',
            status: 'node-blocker',
            statusText: 'BLOCKS',
            icon: 'fa-solid fa-circle-xmark'
          },
          {
            id: 'd-new-2',
            title: 'Staging Gateway Rollout',
            person: 'Kartikay Gupta',
            status: 'node-waiting',
            statusText: 'REQUIRED FOR',
            icon: 'fa-solid fa-arrow-down'
          },
          {
            id: 'd-new-3',
            title: 'Auth Verification Signoff',
            person: 'Milestone Demo',
            status: 'node-final',
            statusText: 'TARGET',
            icon: 'fa-solid fa-flag-checkered'
          }
        ],
        actions: [
          {
            id: 'act-comp-1',
            kind: 'reminder',
            kindLabel: 'Send Urgent Nudge',
            desc: 'Dispatched automated reminder to Sreyanko: Rollback runbook approval is blocking staging rollout.',
            approved: false
          },
          {
            id: 'act-comp-2',
            kind: 'task',
            kindLabel: 'Create Task',
            desc: 'Create Task: "Verify Migration Rollback Runbook" • Assignee: Sreyanko Sinha • Priority: Urgent',
            approved: false
          },
          {
            id: 'act-comp-3',
            kind: 'draft',
            kindLabel: 'Draft Reply',
            desc: 'Draft follow-up to Kartikay: "Sreyanko has been notified with high priority. Gateway deployment pipeline on standby."',
            approved: false
          }
        ]
      }
    };

    state.threads.unshift(newThread);
    state.activeThreadId = newThread.id;
    pushAuditLog(`New thread composed: "${subject}" — Agent parsed 1 blocker & 3 proposed actions`, 'analysis');
    updatePendingCount();
    closeModal(composeModalEl);
    setActiveFilter('all');
    renderThreadDetail();
    showToast('✓ Email sent! Agent Harness detected 1 blocker & proposed 3 actions for review');
  }

  // 5. Backend SDK Integration Hook
  function copyIntegrationSnippet() {
    const snippet = `// CipherMail Agent Harness Client SDK Integration\nwindow.AgentHarness.loadThreadData(analyzedThreads);\nwindow.AgentHarness.pushAuditLog("Detected Blocker: Schema review delay");\nconst state = window.AgentHarness.getState();`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(snippet).then(() => {
        showToast('✓ Integration code snippet copied to clipboard!');
      }).catch(() => {
        showToast('✓ Code snippet selected');
      });
    } else {
      showToast('✓ Code snippet copied');
    }
  }

  function simulateAgentSync() {
    pushAuditLog('Inbound webhook from Python LangChain harness: 1 thread re-indexed, 0 new blockers', 'blocker');
    showToast('✓ Inbound agent payload synced from Python harness!');
    renderAuditTimeline();
  }

  // ==========================================
  // THEME MANAGEMENT: WHITE (DEFAULT) & BLACK
  // ==========================================
  const activeTheme = localStorage.getItem('ciphersquad_theme') || 'light';
  applyTheme(activeTheme, false);

  function applyTheme(theme, notify = false) {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('ciphersquad_theme', theme);

    if (themeIcon) {
      themeIcon.className = theme === 'light' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
      if (quickThemeBtn) {
        quickThemeBtn.setAttribute('title', theme === 'light' ? 'Convert to Obsidian Black' : 'Convert to Porcelain White');
      }
    }

    if (themeCardLight && themeCardDark) {
      if (theme === 'light') {
        themeCardLight.classList.add('active');
        themeCardDark.classList.remove('active');
      } else {
        themeCardDark.classList.add('active');
        themeCardLight.classList.remove('active');
      }
    }

    if (notify) {
      showToast(`Theme converted to ${theme === 'light' ? 'Porcelain White' : 'Obsidian Black'}`);
    }
  }

  // ==========================================
  // GLOBAL ATTACHMENTS & EVENT WIRING
  // ==========================================

  // 1. Header Buttons
  if (brandBadgeEl) {
    brandBadgeEl.style.cursor = 'pointer';
    brandBadgeEl.addEventListener('click', () => {
      state.searchQuery = '';
      if (searchInputEl) searchInputEl.value = '';
      state.activeThreadId = 'thread-1';
      setActiveFilter('all');
      renderThreadDetail();
      showToast('CipherMail reset to default Inbox view');
    });
  }

  if (hackathonTagEl) {
    hackathonTagEl.style.cursor = 'pointer';
    hackathonTagEl.addEventListener('click', () => {
      showToast('Code2Create 7.0 • ACM-VIT • Team CIPHERSQUAD');
    });
  }

  if (engineStatusPillEl) {
    engineStatusPillEl.addEventListener('click', () => openModal(engineModalEl));
  }

  if (auditToggleBtnEl) {
    auditToggleBtnEl.addEventListener('click', openAuditModal);
  }

  if (pendingApprovalsBtnEl) {
    pendingApprovalsBtnEl.addEventListener('click', () => {
      setActiveFilter('needs-action');
      const threadWithActions = state.threads.find(t => t.harnessData && t.harnessData.actions && t.harnessData.actions.some(a => !a.approved));
      if (threadWithActions) {
        state.activeThreadId = threadWithActions.id;
        renderThreadsList();
        renderThreadDetail();
        const actionsContainer = document.getElementById('actionsApprovalContainer');
        if (actionsContainer) {
          actionsContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      showToast(`Showing pending human approval actions (${state.pendingApprovalsCount})`);
    });
  }

  if (voiceBriefingBtnEl) {
    voiceBriefingBtnEl.addEventListener('click', playVoiceBriefing);
  }

  if (quickThemeBtn) {
    quickThemeBtn.addEventListener('click', () => {
      const currentTheme = document.body.getAttribute('data-theme') || 'light';
      const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
      applyTheme(nextTheme, true);
    });
  }

  if (settingsToggleBtn) {
    settingsToggleBtn.addEventListener('click', () => openModal(settingsModalEl));
  }

  if (logoutLink) {
    logoutLink.addEventListener('click', () => {
      sessionStorage.removeItem('ciphersquad_access_token');
      sessionStorage.removeItem('ciphersquad_user_profile');
    });
  }

  // 2. Sidebar Navigation
  if (composeBtn) {
    composeBtn.addEventListener('click', openComposeModal);
  }

  sidebarNavItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const filter = item.dataset.filter;
      if (filter) setActiveFilter(filter);
    });
  });

  if (navGraphViewEl) {
    navGraphViewEl.addEventListener('click', (e) => {
      e.preventDefault();
      openDependencyGraphModal();
    });
  }

  if (navAuditViewEl) {
    navAuditViewEl.addEventListener('click', (e) => {
      e.preventDefault();
      openAuditModal();
    });
  }

  if (sidebarSettingsBtn) {
    sidebarSettingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openModal(settingsModalEl);
    });
  }

  teamMemberItems.forEach(item => {
    item.addEventListener('click', () => {
      const memberKey = item.dataset.member;
      if (memberKey) openTeamMemberModal(memberKey);
    });
  });

  if (backendHookPillEl) {
    backendHookPillEl.style.cursor = 'pointer';
    backendHookPillEl.addEventListener('click', () => openModal(backendModalEl));
  }

  // 3. Pane 2 Filter Buttons & Dropdown
  paneFilterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter;
      if (filter) setActiveFilter(filter);
    });
  });

  if (threadFilterSelect) {
    threadFilterSelect.addEventListener('change', (e) => {
      setActiveFilter(e.target.value);
    });
  }

  if (searchInputEl) {
    searchInputEl.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderThreadsList();
    });
  }

  // 4. Modals Close / Action Listeners
  // Graph Modal
  if (closeGraphModalBtnEl) {
    closeGraphModalBtnEl.addEventListener('click', () => closeModal(graphModalEl));
  }

  // Settings Modal
  if (closeSettingsModalBtn) closeSettingsModalBtn.addEventListener('click', () => closeModal(settingsModalEl));
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', () => {
      closeModal(settingsModalEl);
      showToast('Settings saved successfully');
    });
  }
  if (resetThemeWhiteBtn) resetThemeWhiteBtn.addEventListener('click', () => applyTheme('light', true));
  if (themeCardLight) themeCardLight.addEventListener('click', () => applyTheme('light', true));
  if (themeCardDark) themeCardDark.addEventListener('click', () => applyTheme('dark', true));

  if (settingHumanApproval) {
    settingHumanApproval.addEventListener('change', (e) => {
      showToast(e.target.checked ? '✓ Human-in-the-Loop Signoff active' : '⚠️ Safeguard warning: Signoff disabled');
    });
  }
  if (settingBlockerAlerts) {
    settingBlockerAlerts.addEventListener('change', (e) => {
      showToast(e.target.checked ? '✓ Critical Blocker Highlighting active' : 'Blocker highlighting muted');
    });
  }
  if (settingPredraftReplies) {
    settingPredraftReplies.addEventListener('change', (e) => {
      showToast(e.target.checked ? '✓ Pre-draft reply synthesis active' : 'Pre-draft reply synthesis paused');
    });
  }

  // Compose Modal
  if (closeComposeModalBtn) closeComposeModalBtn.addEventListener('click', () => closeModal(composeModalEl));
  if (cancelComposeBtn) cancelComposeBtn.addEventListener('click', () => closeModal(composeModalEl));
  if (sendComposeBtn) sendComposeBtn.addEventListener('click', handleSendCompose);
  if (prefillBlockerThreadBtn) {
    prefillBlockerThreadBtn.addEventListener('click', () => {
      if (composeTo) composeTo.value = 'Kartikay Gupta <kartikay@ciphersquad.tech>, Sreyanko Sinha <sreyanko@ciphersquad.tech>';
      if (composeSubject) composeSubject.value = '[CRITICAL] Production Auth Migration & Gateway Deployment';
      if (composeBody) composeBody.value = 'Kartikay, the auth migration scripts are waiting on database rollback verification from Sreyanko. If Sreyanko doesn\'t approve the migration runbook by 17:00, our staging rollout will fail. Sreyanko, please unblock this immediately.';
      showToast('Sample blocker scenario populated');
    });
  }

  // Audit Modal
  if (closeAuditModalBtn) closeAuditModalBtn.addEventListener('click', () => closeModal(auditModalEl));
  if (closeAuditModalBottomBtn) closeAuditModalBottomBtn.addEventListener('click', () => closeModal(auditModalEl));
  if (exportAuditJsonBtn) exportAuditJsonBtn.addEventListener('click', exportAuditLogJson);

  // Engine Modal
  if (closeEngineModalBtn) closeEngineModalBtn.addEventListener('click', () => closeModal(engineModalEl));
  if (closeEngineModalBottomBtn) closeEngineModalBottomBtn.addEventListener('click', () => closeModal(engineModalEl));

  // Team Member Modal
  if (closeTeamMemberModalBtn) closeTeamMemberModalBtn.addEventListener('click', () => closeModal(teamMemberModalEl));
  if (teamModalPingBtn) {
    teamModalPingBtn.addEventListener('click', () => {
      const member = state.teamMembers[state.activeTeamMember];
      const memberName = member ? member.name : 'Collaborator';
      pushAuditLog(`Manual nudge dispatched to ${memberName} via Slack/Email`, 'execution');
      showToast(`✓ Automated nudge sent to ${memberName} via Slack & Email`);
      closeModal(teamMemberModalEl);
    });
  }
  if (teamModalFilterBtn) {
    teamModalFilterBtn.addEventListener('click', () => {
      const member = state.teamMembers[state.activeTeamMember];
      const name = member ? member.name.split(' ')[0] : '';
      closeModal(teamMemberModalEl);
      state.searchQuery = name;
      if (searchInputEl) searchInputEl.value = name;
      renderThreadsList();
      showToast(`Filtering inbox to threads involving ${name}`);
    });
  }

  // Backend Modal
  if (closeBackendModalBtn) closeBackendModalBtn.addEventListener('click', () => closeModal(backendModalEl));
  if (closeBackendModalBottomBtn) closeBackendModalBottomBtn.addEventListener('click', () => closeModal(backendModalEl));
  if (copyCodeSnippetBtn) copyCodeSnippetBtn.addEventListener('click', copyIntegrationSnippet);
  if (simulateAgentSyncBtn) simulateAgentSyncBtn.addEventListener('click', simulateAgentSync);

  // Backdrop click closes modals
  window.addEventListener('click', (e) => {
    if (e.target.classList && e.target.classList.contains('modal-backdrop')) {
      closeModal(e.target);
    }
  });

  // Global keydown listeners
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllModals();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (searchInputEl) {
        searchInputEl.focus();
        searchInputEl.select();
      }
    }
  });

  // OAuth Session Profile load
  try {
    const savedProfile = sessionStorage.getItem('ciphersquad_user_profile');
    if (savedProfile) {
      const user = JSON.parse(savedProfile);
      const userMetaEl = document.querySelector('.user-profile-menu .user-meta');
      const userAvatarEl = document.querySelector('.user-profile-menu .user-avatar');
      if (userMetaEl && user.name) {
        userMetaEl.innerHTML = `
          <span class="user-name">${user.name}</span>
          <span class="user-role">${user.email || 'Google Workspace'}</span>
        `;
      }
      if (userAvatarEl && user.picture) {
        userAvatarEl.src = user.picture;
      }
    }
  } catch (profileErr) {
    console.warn('Could not read user profile from session:', profileErr);
  }

  // Initial Boot
  setBackendStatus('Checking', 'waiting');
  renderThreadsList();
  renderThreadDetail();
  updatePendingCount();
  syncGoogleProfile();
  syncBackendOverview();

  // Expose API on window.AgentHarness
  const agentHarnessApi = {
    getState: () => state,
    loadThreadData: (newThreads) => {
      state.threads = newThreads;
      renderThreadsList();
      renderThreadDetail();
      updatePendingCount();
    },
    pushAuditLog: (event, category = 'analysis') => {
      pushAuditLog(event, category);
      showToast(`Audit: ${event}`);
      renderAuditTimeline();
    },
    openCompose: openComposeModal,
    openGraph: openDependencyGraphModal,
    openAudit: openAuditModal
  };
  window.AgentHarness = agentHarnessApi;
  globalThis.AgentHarness = agentHarnessApi;
  document.body.dataset.agentHarnessReady = 'true';
});
