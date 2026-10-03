/**
 * Leo — Faithmade support widget: chat with Leo (and the team) plus the
 * Ideas board. Vanilla JS, no dependencies.
 *
 * Expects window.FaithmadeHelpdesk = { endpoint, context: {site, church, user_name, user_email, ts, sig}, ajax?, refresh? }
 * printed server-side by faithmade-admin for logged-in users.
 *
 * Deep links (from Leo's emails): ?fmhd=chat opens the chat, ?fmhd=ideas the
 * board, ?fmhd=idea-<id> one idea.
 */
(function () {
  'use strict';

  var cfg = window.FaithmadeHelpdesk;
  if (!cfg || !cfg.endpoint || !cfg.context) return;
  cfg.endpoint = String(cfg.endpoint).replace(/\/+$/, '');
  var ctxLoadedAt = Date.now();

  // --- storage ---------------------------------------------------------------
  // One conversation per person per browser. Keyed to the signed-in email so a
  // shared computer never shows one staff member another's thread.
  var STORAGE_KEY = 'rhd-conversation';
  var myEmail = String(cfg.context.user_email || '').toLowerCase();

  function readStore() {
    try {
      var s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (s && s.email === myEmail && /^[a-z0-9-]{8,40}$/.test(s.id)) return s;
      var legacy = localStorage.getItem('rhd-conversation-id');
      if (!s && legacy && /^[a-z0-9-]{8,40}$/.test(legacy)) return { id: legacy, email: myEmail, seen: 0, active: Date.now() };
    } catch (e) {}
    return null;
  }
  function writeStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {}
  }
  function newStore() {
    var id = (window.crypto && crypto.randomUUID && crypto.randomUUID()) || Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    return { id: id, email: myEmail, seen: 0, active: 0 };
  }
  var store = readStore() || newStore();
  writeStore();

  // --- state -------------------------------------------------------------------
  var lastId = 0; // highest server message id rendered
  var seen = {}; // server message ids already on screen
  var pending = []; // texts we rendered optimistically, awaiting their server copy
  var loaded = false; // has the thread been fetched since page load?
  var teamOnline = false;
  var handledBy = 'leo';
  var convStatus = 'open';
  var lastSender = null;
  var pollTimer = null;
  var typingRow = null;
  var tab = 'chat';
  var unread = 0;

  var SUGGESTIONS = ['How do I add a sermon?', 'Change our site colors', 'Edit a page'];
  var STATUS = { under_review: 'Under review', planned: 'Planned', in_progress: 'In progress', shipped: 'Shipped', declined: 'Declined' };

  var LEO_AVATAR =
    '<span class="rhd-avatar rhd-avatar-leo" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 6 L12 3 L19 6"/><circle cx="12" cy="13" r="6.5"/><circle cx="9.8" cy="12.4" r="0.6" fill="currentColor"/><circle cx="14.2" cy="12.4" r="0.6" fill="currentColor"/><path d="M9.5 15.4 Q12 17.2 14.5 15.4"/></svg></span>';
  var TEAM_AVATAR = '<span class="rhd-avatar rhd-avatar-team" aria-hidden="true">F</span>';
  var BULB =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"/></svg>';
  var CHAT_IC =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 3C7 3 3 6.6 3 11c0 2.1.9 4 2.4 5.4-.2 1.1-.8 2.4-1.9 3.3-.2.2-.1.6.2.6 1.9.1 3.6-.6 4.7-1.4 1.1.4 2.3.6 3.6.6 5 0 9-3.6 9-8S17 3 12 3z"/></svg>';
  var UP = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M12 3.5l8.5 9.5H15v7.5H9V13H3.5z"/></svg>';

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  // --- DOM -----------------------------------------------------------------
  var root = document.createElement('div');
  root.id = 'rhd-root';
  root.innerHTML =
    '<div class="rhd-peek" hidden><button type="button" class="rhd-peek-close" aria-label="Dismiss">×</button><div class="rhd-peek-who"></div><div class="rhd-peek-text"></div></div>' +
    '<button type="button" class="rhd-launcher" aria-label="Chat with Leo" aria-controls="rhd-panel" aria-expanded="false">' +
    '  <svg class="rhd-ic-chat" viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M12 3C7 3 3 6.6 3 11c0 2.1.9 4 2.4 5.4-.2 1.1-.8 2.4-1.9 3.3-.2.2-.1.6.2.6 1.9.1 3.6-.6 4.7-1.4 1.1.4 2.3.6 3.6.6 5 0 9-3.6 9-8S17 3 12 3z"/></svg>' +
    '  <svg class="rhd-ic-close" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
    '  <span class="rhd-badge" hidden></span>' +
    '</button>' +
    '<div class="rhd-panel" id="rhd-panel" role="dialog" aria-label="Leo, Faithmade support chat" hidden>' +
    '  <div class="rhd-header">' +
    '    <div class="rhd-header-row">' +
    LEO_AVATAR.replace('rhd-avatar ', 'rhd-avatar rhd-avatar-header ') +
    '      <div class="rhd-header-text">' +
    '        <div class="rhd-title">Leo</div>' +
    '        <div class="rhd-subtitle"><span class="rhd-presence"></span><span class="rhd-subtitle-text">Faithmade AI</span></div>' +
    '      </div>' +
    '    </div>' +
    '    <div class="rhd-tabs" role="tablist">' +
    '      <button type="button" role="tab" class="rhd-tab rhd-tab-on" data-tab="chat" aria-selected="true">' + CHAT_IC + 'Chat</button>' +
    '      <button type="button" role="tab" class="rhd-tab" data-tab="ideas" aria-selected="false">' + BULB + 'Ideas</button>' +
    '    </div>' +
    '  </div>' +
    // Chat
    '  <div class="rhd-view rhd-view-chat">' +
    '    <div class="rhd-messages" role="log" aria-live="polite"></div>' +
    '    <div class="rhd-chips"></div>' +
    '    <div class="rhd-escalate" hidden>' +
    '      <p class="rhd-esc-title">Bring in the team</p>' +
    '      <textarea class="rhd-esc-msg" rows="2" maxlength="1000" aria-label="Note for the team (optional)" placeholder="Anything else we should know? (optional)"></textarea>' +
    '      <input class="rhd-esc-phone" type="tel" maxlength="30" aria-label="Mobile number for a text back (optional)" placeholder="Mobile number for a text back (optional)">' +
    '      <button type="button" class="rhd-escalate-btn">Send to the team</button>' +
    '    </div>' +
    '    <form class="rhd-form">' +
    '      <input class="rhd-input" type="text" aria-label="Ask Leo anything" placeholder="Ask Leo anything…" autocomplete="off" maxlength="4000">' +
    '      <button class="rhd-send" type="submit" aria-label="Send">' +
    '        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3.4 20.4l17.4-7.5c.8-.4.8-1.5 0-1.8L3.4 3.6c-.7-.3-1.4.3-1.3 1l.9 5.6c0 .4.4.7.8.8l8.5 1-8.5 1c-.4 0-.7.4-.8.8l-.9 5.6c-.1.7.6 1.3 1.3 1z"/></svg>' +
    '      </button>' +
    '    </form>' +
    '    <div class="rhd-footer"><button type="button" class="rhd-human-link">Talk to a human</button></div>' +
    '  </div>' +
    // Ideas
    '  <div class="rhd-view rhd-view-ideas" hidden>' +
    '    <div class="rhd-screen rhd-ideas-home">' +
    '      <div class="rhd-ideas-bar">' +
    '        <div class="rhd-seg" role="group" aria-label="Sort ideas">' +
    '          <button type="button" data-sort="top" class="rhd-seg-on">Top</button><button type="button" data-sort="new">New</button><button type="button" data-sort="roadmap">Roadmap</button>' +
    '        </div>' +
    '        <button type="button" class="rhd-new-idea">+ New idea</button>' +
    '      </div>' +
    '      <div class="rhd-ideas-items" aria-live="polite"></div>' +
    '    </div>' +
    '    <div class="rhd-screen rhd-idea-detail" hidden></div>' +
    '    <form class="rhd-screen rhd-idea-new" hidden>' +
    '      <div class="rhd-screen-head"><button type="button" class="rhd-back">← All ideas</button></div>' +
    '      <div class="rhd-compose">' +
    '        <h3 class="rhd-compose-title">Share an idea</h3>' +
    '        <p class="rhd-compose-sub">What should Faithmade build next? Other churches can vote, and we’ll email you when it moves.</p>' +
    '        <input class="rhd-field rhd-idea-title" maxlength="120" aria-label="Idea title" placeholder="Short title — e.g. Spanish sermon notes" required>' +
    '        <div class="rhd-similar" hidden></div>' +
    '        <textarea class="rhd-field rhd-idea-body" rows="4" maxlength="4000" aria-label="Details" placeholder="What would it help your church do? (optional)"></textarea>' +
    '        <button type="submit" class="rhd-primary">Post idea</button>' +
    '      </div>' +
    '    </form>' +
    '  </div>' +
    '</div>';
  document.body.appendChild(root);

  var $ = function (s) { return root.querySelector(s); };
  var panel = $('.rhd-panel');
  var launcher = $('.rhd-launcher');
  var badge = $('.rhd-badge');
  var peek = $('.rhd-peek');
  var messagesEl = $('.rhd-messages');
  var chipsEl = $('.rhd-chips');
  var escalateCard = $('.rhd-escalate');
  var input = $('.rhd-input');
  var form = $('.rhd-form');
  var titleEl = $('.rhd-title');
  var subtitleText = $('.rhd-subtitle-text');
  var presenceDot = $('.rhd-presence');
  var headerAvatar = $('.rhd-avatar-header');
  var LEO_HEADER_ICON = headerAvatar.innerHTML;

  // --- API -----------------------------------------------------------------
  // Signed contexts expire (10 min server-side); refresh before they go stale
  // via cfg.refresh() (demo) or the wp-admin ajax endpoint (cfg.ajax).
  function freshContext(force) {
    var age = (Date.now() - ctxLoadedAt) / 1000;
    if (!force && age < 480) return Promise.resolve(cfg.context);
    var next;
    if (typeof cfg.refresh === 'function') {
      next = Promise.resolve(cfg.refresh());
    } else if (cfg.ajax && cfg.ajax.url) {
      next = fetch(cfg.ajax.url + '?action=fm_helpdesk_context&_ajax_nonce=' + encodeURIComponent(cfg.ajax.nonce), {
        credentials: 'same-origin',
      })
        .then(function (r) { return r.json(); })
        .then(function (d) { return d && d.success && d.data ? d.data : null; });
    } else {
      next = Promise.resolve(null);
    }
    return next
      .then(function (ctx) {
        if (ctx && ctx.sig) {
          cfg.context = ctx;
          ctxLoadedAt = Date.now();
        }
        return cfg.context;
      })
      .catch(function () { return cfg.context; });
  }

  function post(path, body, isRetry) {
    return freshContext(false).then(function (ctx) {
      body.context = ctx;
      body.conversation_id = store.id;
      return fetch(cfg.endpoint + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (res) {
        if (res.status === 401 && !isRetry) {
          return freshContext(true).then(function () { return post(path, body, true); });
        }
        if (res.status === 403 && !isRetry) {
          // Someone else's conversation in this browser: start our own.
          return res.json().catch(function () { return {}; }).then(function (d) {
            if (d.error !== 'conversation_mismatch') throw new Error('HTTP 403');
            resetConversation();
            return post(path, body, true);
          });
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      });
    });
  }

  // Pending texts are kept so the retried request's copy is still recognized;
  // the next successful poll greets if the new thread is empty.
  function resetConversation() {
    store = newStore();
    writeStore();
    lastId = 0;
    seen = {};
    loaded = false;
    messagesEl.innerHTML = '';
    lastSender = null;
  }

  // --- chat rendering -------------------------------------------------------
  function senderLabel(role, via) {
    if (role === 'user') return via === 'email' ? 'You · by email' : 'You';
    if (role === 'agent') return 'The Faithmade team';
    return 'Leo';
  }

  function addMessage(role, text, via) {
    var key = role + (role === 'user' && via === 'email' ? '-email' : '');
    if (lastSender !== key) {
      var label = document.createElement('div');
      label.className = 'rhd-sender' + (role === 'user' ? ' rhd-sender-user' : '');
      label.textContent = senderLabel(role, via);
      messagesEl.appendChild(label);
      lastSender = key;
    }
    var row = document.createElement('div');
    row.className = 'rhd-row rhd-row-' + (role === 'user' ? 'user' : 'other');
    var el = document.createElement('div');
    el.className = 'rhd-msg rhd-msg-' + role;
    el.textContent = text;
    if (role !== 'user') row.innerHTML = role === 'agent' ? TEAM_AVATAR : LEO_AVATAR;
    row.appendChild(el);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function addTyping() {
    removeTyping();
    lastSender = 'assistant-typing';
    typingRow = document.createElement('div');
    typingRow.className = 'rhd-row rhd-row-other rhd-typing-row';
    typingRow.innerHTML = LEO_AVATAR + '<div class="rhd-msg rhd-msg-assistant rhd-typing"><span></span><span></span><span></span></div>';
    messagesEl.appendChild(typingRow);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function removeTyping() {
    if (typingRow) typingRow.remove();
    typingRow = null;
  }

  // A message from the server: render it unless it's already on screen.
  function ingest(m) {
    if (seen[m.id]) return false;
    seen[m.id] = true;
    if (m.id > lastId) lastId = m.id;
    if (m.role === 'user') {
      var i = pending.indexOf(m.content);
      if (i >= 0) {
        pending.splice(i, 1);
        return false;
      }
    } else {
      removeTyping();
    }
    addMessage(m.role, m.content, m.via);
    return m.role !== 'user';
  }

  function markSeen() {
    if (lastId > (store.seen || 0)) {
      store.seen = lastId;
      writeStore();
    }
    setUnread(0);
  }

  function setPresence(online) {
    teamOnline = online;
    root.classList.toggle('rhd-team-online', online);
    presenceDot.className = 'rhd-presence' + (online ? ' rhd-presence-on' : '');
    if (tab === 'chat') subtitleText.textContent = online ? 'Faithmade AI · team is online' : 'Faithmade AI · replies instantly';
  }

  function greet(withChips) {
    lastSender = null;
    addMessage(
      'assistant',
      'Hi ' + (cfg.context.user_name ? cfg.context.user_name.split(' ')[0] : 'there') +
        "! I'm Leo, the Faithmade AI. Ask me anything about your site — I'll bring in the team whenever you need a person."
    );
    chipsEl.innerHTML = '';
    chipsEl.hidden = !withChips;
    if (!withChips) return;
    SUGGESTIONS.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rhd-chip';
      b.textContent = s;
      b.addEventListener('click', function () {
        chipsEl.hidden = true;
        send(s);
      });
      chipsEl.appendChild(b);
    });
  }

  function ideaCard(draft) {
    var card = document.createElement('div');
    card.className = 'rhd-idea-card';
    card.innerHTML =
      '<div class="rhd-idea-card-ic">' + BULB + '</div><div><b>Post this on the Ideas board?</b>' +
      '<span>Other churches can vote on it, and you’ll hear from us when it moves.</span>' +
      '<button type="button">Post as an idea</button></div>';
    card.querySelector('button').addEventListener('click', function () {
      switchTab('ideas');
      openCompose(draft);
    });
    messagesEl.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    lastSender = null;
  }

  // --- chat polling ----------------------------------------------------------
  function poll() {
    post('/messages', { after_id: lastId })
      .then(function (data) {
        if (!data) return;
        setPresence(!!data.team_online);
        handledBy = data.handled_by || handledBy;
        convStatus = data.status || convStatus;
        var first = !loaded;
        if (first) {
          loaded = true;
          greet(!(data.messages || []).length);
        }
        (data.messages || []).forEach(ingest);
        if (first) messagesEl.scrollTop = messagesEl.scrollHeight;
        markSeen();
      })
      .catch(function () {
        if (!loaded) {
          loaded = true;
          greet(true);
        }
      });
  }
  function startPolling() {
    if (pollTimer) return;
    poll();
    pollTimer = setInterval(poll, 4000);
  }
  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // While the chat is closed: a light check for team replies, so the launcher
  // can show a badge. Passive — it doesn't count as the church watching, so
  // replies still go out by email too. Only for recently active conversations.
  var PASSIVE_MS = 60000;
  var ACTIVE_DAYS = 14;
  function passiveCheck() {
    if (!panel.hidden || document.visibilityState !== 'visible') return;
    if (!store.active || Date.now() - store.active > ACTIVE_DAYS * 86400000) return;
    post('/messages', { after_id: store.seen || 0, passive: true })
      .then(function (data) {
        var fresh = (data.messages || []).filter(function (m) { return m.role !== 'user'; });
        if (!fresh.length || !panel.hidden) return;
        setUnread(fresh.length);
        var last = fresh[fresh.length - 1];
        showPeek(last.role === 'agent' ? 'The Faithmade team' : 'Leo', last.content);
      })
      .catch(function () {});
  }
  setInterval(passiveCheck, PASSIVE_MS);
  setTimeout(passiveCheck, 2500);

  function setUnread(n) {
    unread = n;
    badge.hidden = !n;
    badge.textContent = n > 9 ? '9+' : String(n);
    launcher.setAttribute('aria-label', n ? 'Chat with Leo — ' + n + ' new' : 'Chat with Leo');
  }
  function showPeek(who, text) {
    if (peek.dataset.dismissed === text) return;
    peek.querySelector('.rhd-peek-who').textContent = who + ' replied';
    peek.querySelector('.rhd-peek-text').textContent = text.length > 140 ? text.slice(0, 139).trimEnd() + '…' : text;
    peek.dataset.text = text;
    peek.hidden = false;
  }

  // --- chat actions ------------------------------------------------------------
  function touchActive() {
    store.active = Date.now();
    writeStore();
  }

  function send(text) {
    chipsEl.hidden = true;
    pending.push(text);
    addMessage('user', text);
    if (handledBy === 'leo') addTyping();
    escalateCard.hidden = true;
    touchActive();

    post('/chat', { message: text })
      .then(function (data) {
        removeTyping();
        setPresence(!!data.team_online);
        handledBy = data.handled_by || handledBy;
        convStatus = data.status || convStatus;
        if (data.user_id && !seen[data.user_id]) {
          seen[data.user_id] = true;
          var i = pending.indexOf(text);
          if (i >= 0) pending.splice(i, 1);
        }
        if (data.reply && !seen[data.last_id]) {
          seen[data.last_id] = true;
          lastSender = null;
          addMessage('assistant', data.reply);
        }
        if (data.last_id > lastId) lastId = data.last_id;
        markSeen();
        if (data.reply && data.escalate_suggested && convStatus !== 'escalated') showEscalateForm('Leo suggested escalation');
        else if (data.reply && data.idea_suggested) ideaCard(text);
        else if (!data.reply && handledBy === 'team' && !teamOnline) {
          lastSender = null;
          addMessage('assistant', "The team has your message — they'll reply here, by email, or by text shortly.");
        }
      })
      .catch(function () {
        removeTyping();
        lastSender = null;
        addMessage('assistant', 'Something went wrong on my end — tap "Talk to a human" below and the team will jump in.');
      });
  }

  function showEscalateForm(reason) {
    escalateCard.hidden = false;
    escalateCard.dataset.reason = reason;
    escalateCard.querySelector('.rhd-esc-msg').focus();
  }

  function escalate() {
    var noteEl = escalateCard.querySelector('.rhd-esc-msg');
    var phoneEl = escalateCard.querySelector('.rhd-esc-phone');
    var note = noteEl.value.trim();
    var phone = phoneEl.value.trim();
    escalateCard.hidden = true;
    noteEl.value = '';
    if (note) {
      pending.push(note);
      addMessage('user', note);
    }
    lastSender = null;
    touchActive();
    var waiting = addMessage('assistant', 'Bringing in the team…');
    post('/escalate', {
      reason: escalateCard.dataset.reason || 'User requested a human',
      user_message: note,
      phone: phone,
    })
      .then(function (data) {
        setPresence(!!(data && data.team_online));
        convStatus = 'escalated';
        if (data.user_id) {
          seen[data.user_id] = true;
          var i = pending.indexOf(note);
          if (i >= 0) pending.splice(i, 1);
        }
        waiting.textContent = teamOnline
          ? 'Done — the team is online and has your full conversation. Hang tight!'
          : "Done — the team has your full conversation and has been notified. You'll hear back here and by " +
            (phone ? 'text or email' : 'email') + ' shortly.';
        messagesEl.scrollTop = messagesEl.scrollHeight;
      })
      .catch(function () {
        waiting.textContent = 'I could not reach the team automatically — please email support@faithmade.app.';
        messagesEl.scrollTop = messagesEl.scrollHeight;
      });
  }

  // =====================================================================
  // Ideas board
  // =====================================================================
  var ideasEl = $('.rhd-ideas-items');
  var homeEl = $('.rhd-ideas-home');
  var detailEl = $('.rhd-idea-detail');
  var newEl = $('.rhd-idea-new');
  var titleInput = $('.rhd-idea-title');
  var bodyInput = $('.rhd-idea-body');
  var similarEl = $('.rhd-similar');
  var sort = 'top';
  var ideas = [];

  function screen(which) {
    homeEl.hidden = which !== 'home';
    detailEl.hidden = which !== 'detail';
    newEl.hidden = which !== 'new';
  }

  function statusChip(s) {
    return '<span class="rhd-status rhd-st-' + esc(s) + '">' + esc(STATUS[s] || s) + '</span>';
  }

  function voteBtn(idea, big) {
    return '<button type="button" class="rhd-vote' + (idea.voted ? ' rhd-voted' : '') + (big ? ' rhd-vote-big' : '') +
      '" data-vote="' + idea.id + '" aria-pressed="' + (idea.voted ? 'true' : 'false') + '" aria-label="' +
      (idea.voted ? 'Remove your vote' : 'Vote for this idea') + ' (' + idea.vote_count + ')">' + UP + '<b>' + idea.vote_count + '</b></button>';
  }

  function ideaRow(i) {
    return '<div class="rhd-idea">' + voteBtn(i) +
      '<button type="button" class="rhd-idea-main" data-open="' + i.id + '"><span class="rhd-idea-title">' + esc(i.title) + '</span>' +
      '<span class="rhd-idea-meta">' + statusChip(i.status) + (i.comment_count ? '<span>💬 ' + i.comment_count + '</span>' : '') +
      (i.mine ? '<span>Yours</span>' : '') + '</span></button></div>';
  }

  function renderIdeas() {
    var list = ideas.filter(function (i) { return i.status !== 'declined'; });
    var html;
    if (sort === 'roadmap') {
      html = ['in_progress', 'planned', 'shipped']
        .map(function (s) {
          var items = list.filter(function (i) { return i.status === s; });
          return '<div class="rhd-road-head">' + statusChip(s) + '<span>' + items.length + '</span></div>' +
            (items.map(ideaRow).join('') || '<p class="rhd-muted">Nothing here yet.</p>');
        })
        .join('');
    } else {
      html = list.map(ideaRow).join('');
    }
    ideasEl.classList.toggle('rhd-roadmap', sort === 'roadmap');
    ideasEl.innerHTML =
      html ||
      '<div class="rhd-ideas-empty">' + BULB + '<b>No ideas yet</b><span>Be the first — what should Faithmade build next?</span></div>';
  }

  function loadIdeas() {
    if (!ideas.length) ideasEl.innerHTML = '<p class="rhd-muted rhd-loading">Loading ideas…</p>';
    return post('/ideas', { sort: sort === 'new' ? 'new' : 'top' })
      .then(function (d) {
        ideas = d.ideas || [];
        renderIdeas();
      })
      .catch(function () {
        ideasEl.innerHTML = '<p class="rhd-muted">Couldn’t load ideas — try again in a moment.</p>';
      });
  }

  function updateIdea(id, patch) {
    ideas.forEach(function (i) {
      if (i.id === id) for (var k in patch) i[k] = patch[k];
    });
  }

  function vote(id, btn) {
    var on = btn.getAttribute('aria-pressed') !== 'true';
    var count = Number(btn.querySelector('b').textContent) + (on ? 1 : -1);
    // Optimistic: flip every button for this idea now, settle when the server answers.
    root.querySelectorAll('[data-vote="' + id + '"]').forEach(function (b) {
      b.classList.toggle('rhd-voted', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.querySelector('b').textContent = count;
    });
    updateIdea(id, { voted: on, vote_count: count });
    post('/ideas/vote', { id: id, on: on })
      .then(function (r) {
        updateIdea(id, { voted: r.voted, vote_count: r.vote_count });
        root.querySelectorAll('[data-vote="' + id + '"] b').forEach(function (b) { b.textContent = r.vote_count; });
      })
      .catch(function () {});
  }

  function openIdea(id, notice) {
    screen('detail');
    detailEl.innerHTML = '<div class="rhd-screen-head"><button type="button" class="rhd-back">← All ideas</button></div><p class="rhd-muted rhd-loading">Loading…</p>';
    post('/ideas/get', { id: id })
      .then(function (d) {
        var i = d.idea;
        detailEl.innerHTML =
          '<div class="rhd-screen-head"><button type="button" class="rhd-back">← All ideas</button></div>' +
          '<div class="rhd-detail">' +
          (notice ? '<div class="rhd-notice">' + esc(notice) + '</div>' : '') +
          '<div class="rhd-detail-top">' + voteBtn(i, true) + '<div>' + statusChip(i.status) + '<h3>' + esc(i.title) + '</h3></div></div>' +
          (i.body ? '<p class="rhd-detail-body">' + esc(i.body) + '</p>' : '') +
          '<div class="rhd-comments-head">' + (d.comments.length ? d.comments.length + (d.comments.length === 1 ? ' comment' : ' comments') : 'No comments yet') + '</div>' +
          d.comments
            .map(function (c) {
              return '<div class="rhd-comment' + (c.is_team ? ' rhd-comment-team' : '') + '"><b>' +
                (c.is_team ? TEAM_AVATAR.replace('rhd-avatar ', 'rhd-avatar rhd-avatar-mini ') : '') + esc(c.mine ? 'You' : c.author) + '</b>' + esc(c.body) + '</div>';
            })
            .join('') +
          '</div>' +
          '<form class="rhd-comment-form"><input class="rhd-field" maxlength="2000" aria-label="Add a comment" placeholder="Add a comment…" required>' +
          '<button type="submit" class="rhd-primary rhd-small">Post</button></form>';
        detailEl.querySelector('.rhd-comment-form').addEventListener('submit', function (e) {
          e.preventDefault();
          var f = e.currentTarget.querySelector('input');
          var text = f.value.trim();
          if (!text) return;
          f.disabled = true;
          post('/ideas/comment', { id: i.id, body: text }).then(function () {
            updateIdea(i.id, { comment_count: (i.comment_count || 0) + 1 });
            openIdea(i.id);
          });
        });
      })
      .catch(function () {
        detailEl.innerHTML =
          '<div class="rhd-screen-head"><button type="button" class="rhd-back">← All ideas</button></div><p class="rhd-muted">That idea isn’t available anymore.</p>';
      });
  }

  // "I wish we could have a prayer wall where…" → "A prayer wall where…"
  function draftTitle(text) {
    var t = text.replace(/^(hi|hey|hello)(\s+(leo|there))?\s*[,!.]*\s*/i, '');
    t = (t.match(/^[^.!?\n]*/) || [''])[0].trim() || t;
    t = t
      .replace(/^(i|we)\s+(really\s+)?(wish|would love|'d love|want)\s+(it\s+)?(if\s+)?((we|you|faithmade|there)\s+)?((could|would|had|was|were)\s+)?((have|add|get|be)\s+)?/i, '')
      .replace(/^(can|could|would)\s+(you|faithmade|we)\s+(please\s+)?(add|have|get|make|build)\s+/i, '')
      .replace(/^it\s+would\s+be\s+(great|nice|awesome|amazing|helpful)\s+(if|to)\s+(we\s+could\s+)?((have|add|get)\s+)?/i, '')
      .replace(/^(please\s+)?(add|make|build)\s+/i, '')
      .trim();
    t = t.charAt(0).toUpperCase() + t.slice(1);
    if (t.length > 90) t = t.slice(0, 90).replace(/\s+\S*$/, '') + '…';
    return t.length >= 4 ? t : text.slice(0, 90);
  }

  var similarTimer = null;
  function openCompose(draft) {
    screen('new');
    var text = String(draft || '').trim();
    titleInput.value = text ? draftTitle(text) : '';
    bodyInput.value = text && text !== titleInput.value ? text : '';
    similarEl.hidden = true;
    if (titleInput.value) checkSimilar();
    titleInput.focus();
    try { titleInput.setSelectionRange(0, 0); } catch (e) {}
    titleInput.scrollLeft = 0;
  }

  function checkSimilar() {
    var text = (titleInput.value + ' ' + bodyInput.value).trim();
    if (text.length < 6) {
      similarEl.hidden = true;
      return;
    }
    post('/ideas/similar', { text: text })
      .then(function (d) {
        var list = d.ideas || [];
        similarEl.hidden = !list.length;
        similarEl.innerHTML =
          '<div class="rhd-similar-head">Already on the board? Add your vote instead:</div>' +
          list.map(function (i) {
            return '<div class="rhd-idea rhd-idea-small">' + voteBtn(i) + '<button type="button" class="rhd-idea-main" data-open="' + i.id + '"><span class="rhd-idea-title">' +
              esc(i.title) + '</span><span class="rhd-idea-meta">' + statusChip(i.status) + '</span></button></div>';
          }).join('');
      })
      .catch(function () {});
  }
  function queueSimilar() {
    clearTimeout(similarTimer);
    similarTimer = setTimeout(checkSimilar, 400);
  }
  titleInput.addEventListener('input', queueSimilar);
  bodyInput.addEventListener('input', queueSimilar);

  newEl.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = newEl.querySelector('.rhd-primary');
    btn.disabled = true;
    btn.textContent = 'Posting…';
    post('/ideas/new', { title: titleInput.value, body: bodyInput.value })
      .then(function (d) {
        titleInput.value = '';
        bodyInput.value = '';
        ideas = [];
        openIdea(d.idea.id, 'Posted! Your vote is in — we’ll email you when this idea moves.');
      })
      .catch(function () {
        btn.insertAdjacentHTML('afterend', '<p class="rhd-muted rhd-err">Couldn’t post that — give it a short title and try again.</p>');
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = 'Post idea';
      });
  });

  // One delegated handler for votes, opening ideas, and back buttons.
  $('.rhd-view-ideas').addEventListener('click', function (e) {
    var v = e.target.closest('[data-vote]');
    if (v) return vote(Number(v.dataset.vote), v);
    var o = e.target.closest('[data-open]');
    if (o) return openIdea(Number(o.dataset.open));
    if (e.target.closest('.rhd-back')) {
      screen('home');
      loadIdeas();
      return;
    }
    if (e.target.closest('.rhd-new-idea')) return openCompose('');
    var s = e.target.closest('[data-sort]');
    if (s) {
      sort = s.dataset.sort;
      root.querySelectorAll('[data-sort]').forEach(function (b) { b.classList.toggle('rhd-seg-on', b === s); });
      loadIdeas();
    }
  });

  // --- tabs + open/close ---------------------------------------------------------
  function switchTab(next) {
    tab = next;
    root.querySelectorAll('.rhd-tab').forEach(function (b) {
      var on = b.dataset.tab === next;
      b.classList.toggle('rhd-tab-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('.rhd-view-chat').hidden = next !== 'chat';
    $('.rhd-view-ideas').hidden = next !== 'ideas';
    root.classList.toggle('rhd-on-ideas', next === 'ideas');
    if (next === 'ideas') {
      titleEl.textContent = 'Ideas';
      subtitleText.textContent = 'Vote on what Faithmade builds next';
      headerAvatar.innerHTML = BULB.replace(/width="15" height="15"/, 'width="20" height="20"');
      if (homeEl.hidden && detailEl.hidden && newEl.hidden) screen('home');
      if (!homeEl.hidden) loadIdeas();
    } else {
      titleEl.textContent = 'Leo';
      headerAvatar.innerHTML = LEO_HEADER_ICON;
      setPresence(teamOnline);
      input.focus();
    }
  }
  root.querySelectorAll('.rhd-tab').forEach(function (b) {
    b.addEventListener('click', function () { switchTab(b.dataset.tab); });
  });

  function openPanel(startTab) {
    panel.hidden = false;
    root.classList.add('rhd-open');
    launcher.setAttribute('aria-expanded', 'true');
    peek.hidden = true;
    startPolling();
    switchTab(startTab || tab);
  }
  function closePanel() {
    panel.hidden = true;
    root.classList.remove('rhd-open');
    launcher.setAttribute('aria-expanded', 'false');
    stopPolling();
  }

  launcher.addEventListener('click', function () {
    if (panel.hidden) openPanel(unread ? 'chat' : tab);
    else closePanel();
  });
  peek.addEventListener('click', function (e) {
    if (e.target.closest('.rhd-peek-close')) {
      peek.dataset.dismissed = peek.dataset.text || '';
      peek.hidden = true;
      return;
    }
    openPanel('chat');
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    send(text);
  });
  $('.rhd-escalate-btn').addEventListener('click', escalate);
  $('.rhd-human-link').addEventListener('click', function () {
    showEscalateForm('User requested a human');
  });

  // --- deep links from Leo's emails --------------------------------------------------
  (function () {
    var params;
    try {
      params = new URLSearchParams(location.search);
    } catch (e) {
      return;
    }
    var open = params.get('fmhd');
    if (!open) return;
    params.delete('fmhd');
    var qs = params.toString();
    try {
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    } catch (e) {}
    var idea = /^idea-(\d+)$/.exec(open);
    if (idea) {
      openPanel('ideas');
      openIdea(Number(idea[1]));
    } else {
      openPanel(open === 'ideas' ? 'ideas' : 'chat');
    }
  })();
})();
