/**
 * Reach Helpdesk widget — vanilla JS, no dependencies.
 * Expects window.ReachHelpdesk = { endpoint, context: {site, church, user_name, user_email, ts, sig} }
 * printed by faithmade-admin for logged-in users (docs/GHL-SETUP.md §3).
 */
(function () {
  'use strict';

  var cfg = window.ReachHelpdesk;
  if (!cfg || !cfg.endpoint || !cfg.context) return;

  var STORAGE_KEY = 'rhd-conversation-id';
  var conversationId = localStorage.getItem(STORAGE_KEY);
  if (!conversationId) {
    conversationId =
      (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(16).slice(2);
    localStorage.setItem(STORAGE_KEY, conversationId);
  }

  // --- DOM -----------------------------------------------------------------
  var root = document.createElement('div');
  root.id = 'rhd-root';
  root.innerHTML =
    '<button type="button" class="rhd-launcher" aria-label="Support chat">?</button>' +
    '<div class="rhd-panel" hidden>' +
    '  <div class="rhd-header"><span>Faithmade Support</span><button type="button" class="rhd-close" aria-label="Close">&times;</button></div>' +
    '  <div class="rhd-messages"></div>' +
    '  <div class="rhd-escalate" hidden>' +
    '    <p class="rhd-esc-title">Get a real person on this</p>' +
    '    <textarea class="rhd-esc-msg" rows="2" maxlength="1000" placeholder="Anything else we should know? (optional)"></textarea>' +
    '    <input class="rhd-esc-phone" type="tel" maxlength="30" placeholder="Mobile number for a text back (optional)">' +
    '    <button type="button" class="rhd-escalate-btn">Send to the team</button>' +
    '  </div>' +
    '  <form class="rhd-form">' +
    '    <input class="rhd-input" type="text" placeholder="Ask a question…" autocomplete="off" maxlength="4000">' +
    '    <button class="rhd-send" type="submit">Send</button>' +
    '  </form>' +
    '  <div class="rhd-footer"><button type="button" class="rhd-human-link">Talk to a human</button></div>' +
    '</div>';
  document.body.appendChild(root);

  var panel = root.querySelector('.rhd-panel');
  var messagesEl = root.querySelector('.rhd-messages');
  var escalateCard = root.querySelector('.rhd-escalate');
  var input = root.querySelector('.rhd-input');
  var form = root.querySelector('.rhd-form');

  function addMessage(role, text) {
    var el = document.createElement('div');
    el.className = 'rhd-msg rhd-msg-' + role;
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function greet() {
    if (!messagesEl.children.length) {
      addMessage(
        'assistant',
        'Hi ' + (cfg.context.user_name || 'there') + "! Ask me anything about your site — I'll grab a human if I can't help."
      );
    }
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

  function send(text) {
    addMessage('user', text);
    var pending = addMessage('assistant', '…');
    pending.classList.add('rhd-pending');
    escalateCard.hidden = true;

    post('/chat', { message: text })
      .then(function (data) {
        pending.classList.remove('rhd-pending');
        pending.textContent = data.reply;
        if (data.escalate_suggested) showEscalateForm('Bot suggested escalation');
      })
      .catch(function () {
        pending.classList.remove('rhd-pending');
        pending.textContent = 'Something went wrong on my end — use "Talk to a human" below and the team will jump in.';
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
    var pending = addMessage('assistant', 'Contacting the team…');
    post('/escalate', {
      reason: escalateCard.dataset.reason || 'User requested a human',
      user_message: note,
      phone: phone,
    })
      .then(function () {
        pending.textContent =
          "Done — the team has your full conversation and has been notified. You'll hear back by " +
          (phone ? 'text or email' : 'email') +
          ' shortly.';
      })
      .catch(function () {
        pending.textContent = 'Could not reach the team automatically — please email support@faithmade.app.';
      });
  }

  // --- events --------------------------------------------------------------
  root.querySelector('.rhd-launcher').addEventListener('click', function () {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      greet();
      input.focus();
    }
  });
  root.querySelector('.rhd-close').addEventListener('click', function () {
    panel.hidden = true;
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    send(text);
  });
  root.querySelector('.rhd-escalate-btn').addEventListener('click', function () {
    escalate();
  });
  root.querySelector('.rhd-human-link').addEventListener('click', function () {
    showEscalateForm('User requested a human');
  });
})();
