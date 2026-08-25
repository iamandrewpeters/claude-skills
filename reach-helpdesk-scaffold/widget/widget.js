/**
 * Leo — Faithmade support widget. Vanilla JS, no dependencies.
 * Expects window.ReachHelpdesk = { endpoint, context: {site, church, user_name, user_email, ts, sig} }
 * printed server-side by faithmade-admin for logged-in users.
 */
(function () {
  'use strict';

  var cfg = window.ReachHelpdesk;
  if (!cfg || !cfg.endpoint || !cfg.context) return;

  var STORAGE_KEY = 'rhd-conversation-id';
  var conversationId = null;
  try {
    conversationId = localStorage.getItem(STORAGE_KEY);
  } catch (e) {}
  if (!conversationId) {
    conversationId =
      (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
      String(Date.now()) + Math.random().toString(16).slice(2);
    try {
      localStorage.setItem(STORAGE_KEY, conversationId);
    } catch (e) {}
  }

  var lastId = 0;
  var teamOnline = false;
  var handledBy = 'leo';
  var lastSender = null;
  var pollTimer = null;

  var SUGGESTIONS = ['How do I add a sermon?', 'Change our site colors', 'Edit a page'];

  var LEO_AVATAR =
    '<span class="rhd-avatar rhd-avatar-leo" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 6 L12 3 L19 6"/><circle cx="12" cy="13" r="6.5"/><circle cx="9.8" cy="12.4" r="0.6" fill="currentColor"/><circle cx="14.2" cy="12.4" r="0.6" fill="currentColor"/><path d="M9.5 15.4 Q12 17.2 14.5 15.4"/></svg></span>';
  var TEAM_AVATAR = '<span class="rhd-avatar rhd-avatar-team" aria-hidden="true">R</span>';

  // --- DOM -----------------------------------------------------------------
  var root = document.createElement('div');
  root.id = 'rhd-root';
  root.innerHTML =
    '<button type="button" class="rhd-launcher" aria-label="Chat with Leo">' +
    '  <svg class="rhd-ic-chat" viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M12 3C7 3 3 6.6 3 11c0 2.1.9 4 2.4 5.4-.2 1.1-.8 2.4-1.9 3.3-.2.2-.1.6.2.6 1.9.1 3.6-.6 4.7-1.4 1.1.4 2.3.6 3.6.6 5 0 9-3.6 9-8S17 3 12 3z"/></svg>' +
    '  <svg class="rhd-ic-close" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
    '</button>' +
    '<div class="rhd-panel" hidden>' +
    '  <div class="rhd-header">' +
    LEO_AVATAR.replace('rhd-avatar ', 'rhd-avatar rhd-avatar-header ') +
    '    <div class="rhd-header-text">' +
    '      <div class="rhd-title">Leo</div>' +
    '      <div class="rhd-subtitle"><span class="rhd-presence"></span><span class="rhd-subtitle-text">Faithmade AI</span></div>' +
    '    </div>' +
    '  </div>' +
    '  <div class="rhd-messages" role="log" aria-live="polite"></div>' +
    '  <div class="rhd-chips"></div>' +
    '  <div class="rhd-escalate" hidden>' +
    '    <p class="rhd-esc-title">Bring in the team</p>' +
    '    <textarea class="rhd-esc-msg" rows="2" maxlength="1000" placeholder="Anything else we should know? (optional)"></textarea>' +
    '    <input class="rhd-esc-phone" type="tel" maxlength="30" placeholder="Mobile number for a text back (optional)">' +
    '    <button type="button" class="rhd-escalate-btn">Send to the team</button>' +
    '  </div>' +
    '  <form class="rhd-form">' +
    '    <input class="rhd-input" type="text" placeholder="Ask Leo anything…" autocomplete="off" maxlength="4000">' +
    '    <button class="rhd-send" type="submit" aria-label="Send">' +
    '      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3.4 20.4l17.4-7.5c.8-.4.8-1.5 0-1.8L3.4 3.6c-.7-.3-1.4.3-1.3 1l.9 5.6c0 .4.4.7.8.8l8.5 1-8.5 1c-.4 0-.7.4-.8.8l-.9 5.6c-.1.7.6 1.3 1.3 1z"/></svg>' +
    '    </button>' +
    '  </form>' +
    '  <div class="rhd-footer"><button type="button" class="rhd-human-link">Talk to a human</button></div>' +
    '</div>';
  document.body.appendChild(root);

  var panel = root.querySelector('.rhd-panel');
  var launcher = root.querySelector('.rhd-launcher');
  var messagesEl = root.querySelector('.rhd-messages');
  var chipsEl = root.querySelector('.rhd-chips');
  var escalateCard = root.querySelector('.rhd-escalate');
  var input = root.querySelector('.rhd-input');
  var form = root.querySelector('.rhd-form');
  var subtitleText = root.querySelector('.rhd-subtitle-text');
  var presenceDot = root.querySelector('.rhd-presence');

  // --- rendering -----------------------------------------------------------
  function senderLabel(role) {
    if (role === 'user') return 'You';
    if (role === 'agent') return "The Reach team";
    return 'Leo';
  }

  function addMessage(role, text) {
    if (lastSender !== role) {
      var label = document.createElement('div');
      label.className = 'rhd-sender' + (role === 'user' ? ' rhd-sender-user' : '');
      label.textContent = senderLabel(role);
      messagesEl.appendChild(label);
      lastSender = role;
    }
    var row = document.createElement('div');
    row.className = 'rhd-row rhd-row-' + (role === 'user' ? 'user' : 'other');
    var el = document.createElement('div');
    el.className = 'rhd-msg rhd-msg-' + role;
    el.textContent = text;
    if (role !== 'user') {
      row.innerHTML = role === 'agent' ? TEAM_AVATAR : LEO_AVATAR;
    }
    row.appendChild(el);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function addTyping() {
    lastSender = 'assistant-typing';
    var row = document.createElement('div');
    row.className = 'rhd-row rhd-row-other rhd-typing-row';
    row.innerHTML = LEO_AVATAR + '<div class="rhd-msg rhd-msg-assistant rhd-typing"><span></span><span></span><span></span></div>';
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return row;
  }

  function setPresence(online) {
    teamOnline = online;
    presenceDot.className = 'rhd-presence' + (online ? ' rhd-presence-on' : '');
    subtitleText.textContent = online ? 'Faithmade AI · team is online' : 'Faithmade AI';
  }

  function greet() {
    if (messagesEl.children.length) return;
    lastSender = null;
    addMessage(
      'assistant',
      'Hi ' + (cfg.context.user_name ? cfg.context.user_name.split(' ')[0] : 'there') + "! I'm Leo, the Faithmade AI. Ask me anything about your site — I'll bring in the team whenever you need a person."
    );
    chipsEl.innerHTML = '';
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
    chipsEl.hidden = false;
  }

  // --- API -----------------------------------------------------------------
  function post(path, body) {
    body.context = cfg.context;
    body.conversation_id = conversationId;
    return fetch(cfg.endpoint + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function poll() {
    var q =
      '?conversation_id=' + encodeURIComponent(conversationId) +
      '&after_id=' + lastId +
      '&site=' + encodeURIComponent(cfg.context.site) +
      '&user_email=' + encodeURIComponent(cfg.context.user_email) +
      '&ts=' + encodeURIComponent(cfg.context.ts) +
      '&sig=' + encodeURIComponent(cfg.context.sig);
    fetch(cfg.endpoint + '/messages' + q)
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data) return;
        setPresence(!!data.team_online);
        handledBy = data.handled_by || handledBy;
        (data.messages || []).forEach(function (m) {
          if (m.id > lastId) {
            addMessage(m.role, m.content);
            lastId = m.id;
          }
        });
      })
      .catch(function () {});
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

  function send(text) {
    chipsEl.hidden = true;
    addMessage('user', text);
    var typingRow = handledBy === 'leo' ? addTyping() : null;
    escalateCard.hidden = true;

    post('/chat', { message: text })
      .then(function (data) {
        if (typingRow) typingRow.remove();
        setPresence(!!data.team_online);
        handledBy = data.handled_by || handledBy;
        if (data.last_id) lastId = Math.max(lastId, data.last_id);
        if (data.reply) {
          lastSender = null;
          addMessage('assistant', data.reply);
          if (data.escalate_suggested) showEscalateForm('Leo suggested escalation');
        } else if (handledBy === 'team' && !teamOnline) {
          lastSender = null;
          addMessage('assistant', "The team has your message — they'll reply here, by email, or by text shortly.");
        }
      })
      .catch(function () {
        if (typingRow) typingRow.remove();
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
    var note = escalateCard.querySelector('.rhd-esc-msg').value.trim();
    var phone = escalateCard.querySelector('.rhd-esc-phone').value.trim();
    escalateCard.hidden = true;
    if (note) addMessage('user', note);
    lastSender = null;
    var pending = addMessage('assistant', 'Bringing in the team…');
    post('/escalate', {
      reason: escalateCard.dataset.reason || 'User requested a human',
      user_message: note,
      phone: phone,
    })
      .then(function (data) {
        setPresence(!!(data && data.team_online));
        pending.textContent = teamOnline
          ? 'Done — the team is online and has your full conversation. Hang tight!'
          : "Done — the team has your full conversation and has been notified. You'll hear back by " +
            (phone ? 'text or email' : 'email') + ' shortly.';
      })
      .catch(function () {
        pending.textContent = 'I could not reach the team automatically — please email support@faithmade.app.';
      });
  }

  // --- events --------------------------------------------------------------
  launcher.addEventListener('click', function () {
    var opening = panel.hidden;
    panel.hidden = !opening ? true : false;
    root.classList.toggle('rhd-open', opening);
    if (opening) {
      greet();
      startPolling();
      input.focus();
    } else {
      stopPolling();
    }
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    send(text);
  });
  root.querySelector('.rhd-escalate-btn').addEventListener('click', escalate);
  root.querySelector('.rhd-human-link').addEventListener('click', function () {
    showEscalateForm('User requested a human');
  });
})();
