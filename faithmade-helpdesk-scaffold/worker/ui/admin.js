// Faithmade Helpdesk inbox app. Plain JS, no build step beyond inlining
// (tools/build-ui.js). Talks to /admin/api/* with the session cookie.
(function () {
  'use strict';

  // ---------- helpers ----------
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var firstName = function (n) { return String(n || '').trim().split(/\s+/)[0] || ''; };
  var host = function (u) { return String(u || '').replace(/^https?:\/\//, '').replace(/\/.*$/, ''); };
  var short = function (email) { return String(email || '').split('@')[0]; };
  var parseTs = function (t) { return new Date(String(t).replace(' ', 'T') + 'Z'); };
  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); };

  function ago(t) {
    if (!t) return '';
    var d = parseTs(t);
    var s = (Date.now() - d) / 1000;
    if (isNaN(s)) return '';
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 7 * 86400) return Math.floor(s / 86400) + 'd';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  function stamp(t) {
    var d = parseTs(t);
    return isNaN(d) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function handle(r) {
    if (r.status === 401) {
      location.reload();
      throw new Error('Signed out');
    }
    return r.json().catch(function () { return {}; }).then(function (d) {
      if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
      return d;
    });
  }
  function api(p) {
    return fetch('/admin/api/' + p, { credentials: 'same-origin' }).then(handle);
  }
  function post(p, body) {
    return fetch('/admin/api/' + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(handle);
  }

  var toastTimer;
  function toast(html, isErr) {
    var t = $('#toast');
    t.innerHTML = html;
    t.classList.toggle('err', !!isErr);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, isErr ? 8000 : 6000);
  }

  var stored = function (k, fallback) { try { return localStorage.getItem(k) || fallback; } catch (e) { return fallback; } };
  var store = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };

  // ---------- state ----------
  var S = {
    view: 'inbox',
    config: null,
    convs: [], online: false, filter: 'open', query: '', sel: null, thread: null, threadSig: '', sending: false,
    mode: stored('rhd-mode', 'reply'),
    ideas: [], ideaQuery: '', ideaSel: null, idea: null,
    memories: [], memQuery: '', memFlash: null,
    emails: [], efilter: 'all', emailSel: null, emailConv: null,
  };

  // ---------- routing (#c=…, #ideas, #idea=…, #memory, #memory=…, #emails, #email=…) ----------
  function route() {
    var h = location.hash.replace(/^#/, '');
    var eq = h.indexOf('=');
    var key = eq < 0 ? h : h.slice(0, eq);
    var val = eq < 0 ? '' : decodeURIComponent(h.slice(eq + 1));
    var view = { ideas: 'ideas', idea: 'ideas', memory: 'memory', emails: 'emails', email: 'emails' }[key] || 'inbox';
    if (key === 'memory' && val) S.memFlash = Number(val);
    show(view);
    if (key === 'c' && val) openConversation(val);
    else if (view === 'inbox') $('#view-inbox').classList.remove('viewing');
    if (key === 'idea' && val) openIdea(Number(val));
    if (key === 'email' && val) openEmail(Number(val));
    if (view === 'emails' && key !== 'email') $('#view-emails').classList.remove('viewing');
  }
  window.addEventListener('hashchange', route);

  function show(view) {
    S.view = view;
    $$('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + view; });
    $$('#nav a').forEach(function (a) { a.classList.toggle('active', a.dataset.view === view); });
    if (view !== 'ideas') closeDrawer(true);
    if (view === 'ideas') loadIdeas();
    if (view === 'memory') loadMemories();
    if (view === 'emails') loadEmails();
    if (view === 'inbox') refreshList();
  }
  $('#nav').addEventListener('click', function (e) {
    var a = e.target.closest('a');
    if (a && a.dataset.view === 'emails') S.emailConv = null;
  });

  // ---------- presence + theme ----------
  function renderPresence() {
    var p = $('#presence');
    p.classList.toggle('on', S.online);
    p.setAttribute('aria-checked', String(S.online));
    $('#ptext').textContent = S.online ? 'You’re online' : 'You’re offline';
  }
  function togglePresence() {
    post('presence', { online: !S.online }).then(function (d) { S.online = !!d.team_online; renderPresence(); });
  }
  $('#presence').addEventListener('click', togglePresence);
  $('#presence').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePresence(); }
  });
  setInterval(function () { if (S.online) post('presence', { online: true }).catch(function () {}); }, 60000);

  var MOON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M21 14.4A9 9 0 1 1 9.6 3a7.2 7.2 0 1 0 11.4 11.4z"/></svg>';
  var SUN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4.4"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19"/></svg>';
  function effTheme() {
    return stored('rhd-theme', null) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function renderThemeBtn() { $('#theme').innerHTML = effTheme() === 'dark' ? SUN : MOON; }
  $('#theme').addEventListener('click', function () {
    var next = effTheme() === 'dark' ? 'light' : 'dark';
    store('rhd-theme', next);
    document.documentElement.dataset.theme = next;
    renderThemeBtn();
  });

  // =====================================================================
  // Inbox
  // =====================================================================
  var initials = function (c) { return ((c.user_name || c.user_email || '?').trim()[0] || '?').toUpperCase(); };
  function avClass(c) {
    var h = 0, s = String(c.user_email || c.id || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return 'av' + (h % 4);
  }
  function matches(c) {
    return !S.query || [c.user_name, c.user_email, c.church, c.site, c.last_snippet].join(' ').toLowerCase().indexOf(S.query) >= 0;
  }

  function renderList() {
    ['open', 'escalated', 'resolved'].forEach(function (f) {
      var el = $('[data-n="' + f + '"]');
      var n = S.convs.filter(function (c) { return c.status === f; }).length;
      if (el) el.textContent = n || '';
    });
    $('#nb-inbox').textContent = S.convs.filter(function (c) { return c.status === 'escalated'; }).length || '';
    var rows = S.convs.filter(function (c) { return (S.filter === 'all' || c.status === S.filter) && matches(c); });
    $('#rows').innerHTML = rows.map(function (c) {
      var unread = (c.last_id || 0) > (c.agent_last_read_id || 0);
      var who = c.last_role === 'agent' ? 'You: ' : c.last_role === 'assistant' ? 'Leo: ' : '';
      return '<div class="row' + (c.id === S.sel ? ' sel' : '') + (unread ? ' unread' : '') + '" data-id="' + esc(c.id) + '">' +
        '<span class="dot"></span><div class="avatar ' + avClass(c) + '">' + esc(initials(c)) + '</div>' +
        '<div class="body"><div class="top"><span class="who">' + esc(c.user_name || c.user_email || 'Visitor') + '</span>' +
        '<span class="pill ' + esc(c.status) + '">' + esc(c.status) + '</span>' +
        (c.handled_by === 'team' ? '<span class="pill team">you</span>' : '<span class="pill leo">leo</span>') +
        '<time>' + esc(ago(c.last_at || c.created_at)) + '</time></div>' +
        '<div class="church">' + esc(c.church || host(c.site)) + '</div>' +
        '<div class="snippet">' + esc(who + (c.last_snippet || '')) + '</div></div></div>';
    }).join('') || '<div class="empty" style="height:160px"><div class="mark">L</div>Nothing here</div>';
  }
  $('#rows').addEventListener('click', function (e) {
    var r = e.target.closest('.row');
    if (r) location.hash = 'c=' + encodeURIComponent(r.dataset.id);
  });
  $('#search').addEventListener('input', function (e) { S.query = e.target.value.trim().toLowerCase(); renderList(); });
  $('#tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    S.filter = b.dataset.f;
    $$('#tabs button').forEach(function (x) { x.classList.toggle('active', x === b); });
    renderList();
  });

  function refreshList() {
    return api('conversations').then(function (d) {
      S.convs = d.conversations || [];
      S.online = !!d.team_online;
      renderPresence();
      renderList();
    }).catch(function () {});
  }

  function openConversation(id) {
    if (S.sel !== id) { S.sel = id; S.threadSig = ''; }
    $('#view-inbox').classList.add('viewing');
    renderList();
    return loadThread(true);
  }

  function loadThread(force) {
    if (!S.sel) return Promise.resolve();
    var id = S.sel;
    return api('conversation?id=' + encodeURIComponent(id)).then(function (d) {
      if (id !== S.sel) return;
      var last = d.messages.length ? d.messages[d.messages.length - 1].id : 0;
      var sig = [id, last, d.conversation.status, d.conversation.handled_by, d.client_active, d.escalations.length, d.emails.length].join('|');
      if (!force && sig === S.threadSig) return;
      S.threadSig = sig;
      S.thread = d;
      renderThread(d);
    }).catch(function (e) {
      $('#thread').innerHTML = '<div class="empty"><div class="mark">L</div>' + esc(e.message) + '</div>';
      delete $('#thread').dataset.conv;
    });
  }

  var MODES = {
    reply: {
      tab: function (n) { return 'Reply to ' + n; },
      hint: function (n, live) {
        return n + ' gets your exact words, signed by the Faithmade team' + (live ? ' — live in their chat.' : ' — by email, since they’re away.');
      },
      button: function (n) { return 'Send to ' + n; },
      ph: 'Write your reply… (Enter sends, Shift+Enter for a new line)',
    },
    coach: {
      tab: function () { return 'Coach Leo'; },
      hint: function (n) { return 'Tell Leo what to say. Leo replies to ' + n + ' in its own words — and remembers the answer for the next church that asks.'; },
      button: function () { return 'Teach Leo'; },
      ph: 'e.g. “Sermons → Settings → copy the podcast feed URL, then paste it into Apple Podcasts Connect.”',
    },
    note: {
      tab: function () { return 'Note'; },
      hint: function () { return 'Only the team sees notes. Leo doesn’t read them either.'; },
      button: function () { return 'Add note'; },
      ph: 'Internal note…',
    },
  };

  function viaTag(m) {
    if (m.via === 'email') return '<span class="via">✉ email</span>';
    if (m.via === 'link') return '<span class="via">reply link</span>';
    return '';
  }

  function msgHtml(m, c) {
    var time = esc(stamp(m.created_at));
    if (m.role === 'coach') {
      return '<div class="side coach"><div class="slabel">🎓 Coached Leo' + (m.author ? ' · ' + esc(short(m.author)) : '') + ' · ' + time + ' ' + viaTag(m) + '</div>' + esc(m.content) + '</div>';
    }
    if (m.role === 'note') {
      var leo = m.author === 'leo';
      return '<div class="side ' + (leo ? 'leonote' : 'note') + '"><div class="slabel">' +
        (leo ? 'Leo → team' : '📝 Note' + (m.author ? ' · ' + esc(short(m.author)) : '')) + ' · ' + time + '</div>' + esc(m.content) + '</div>';
    }
    var label;
    if (m.role === 'user') label = esc(c.user_name || 'Church');
    else if (m.role === 'agent') label = m.author ? esc(short(m.author)) : 'You';
    else {
      var coached = !!(m.author || m.via === 'inbox' || m.via === 'link');
      label = 'Leo' + (coached ? ' · coached' + (m.author ? ' by ' + esc(short(m.author)) : '') : '');
    }
    return '<div class="mlabel' + (m.role === 'user' ? '' : ' right') + '">' + label + ' · ' + time + ' ' + viaTag(m) + '</div>' +
      '<div class="m ' + esc(m.role) + '">' + esc(m.content) + '</div>';
  }

  // Stored as "<reason> — client note: <note>"; the note is already in the thread.
  var REASONS = { 'Leo suggested escalation': 'Leo couldn’t answer', 'User requested a human': 'Asked for a person' };
  function reasonLabel(r) {
    var why = String(r || '').split(' — client note: ')[0];
    return REASONS[why] || why || 'Leo couldn’t answer';
  }

  function msgsHtml(d) {
    var items = d.messages.map(function (m, i) { return { t: m.created_at, i: i, m: m }; })
      .concat(d.escalations.map(function (e, i) { return { t: e.created_at, i: 100000 + i, e: e }; }))
      .sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : a.i - b.i; });
    return items.map(function (it) {
      return it.e ? '<div class="escnote">⚡ Escalated · ' + esc(reasonLabel(it.e.reason)) + '</div>' : msgHtml(it.m, d.conversation);
    }).join('') || '<div class="empty">No messages yet</div>';
  }

  function headHtml(d) {
    var c = d.conversation;
    var presence = d.client_active ? '<span class="live">In their dashboard now</span>' : '<span class="away">Away — replies go by email</span>';
    return '<button class="btn back" id="back" type="button" aria-label="Back to the list">←</button>' +
      '<div class="avatar ' + avClass(c) + '">' + esc(initials(c)) + '</div>' +
      '<div class="info"><div class="name">' + esc(c.user_name || c.user_email || 'Visitor') + (c.church ? ' · ' + esc(c.church) : '') + '</div>' +
      '<div class="sub">' + presence + '<span>·</span><span>' + esc(c.user_email || '') + '</span><span>·</span><span>' + esc(host(c.site)) + '</span></div></div>' +
      '<div class="actions">' +
      (d.emails.length ? '<a class="btn" href="#emails" id="conv-emails">Emails · ' + d.emails.length + '</a>' : '') +
      (c.handled_by === 'team' ? '<button class="btn" id="handoff" type="button">Hand back to Leo</button>' : '') +
      (c.status === 'resolved'
        ? '<button class="btn" id="reopen" type="button">Reopen</button>'
        : '<button class="btn primary" id="resolve" type="button">Resolve</button>') +
      '</div>';
  }

  function composerHtml() {
    return '<div class="composer" id="composer"><div class="modes" id="modes" role="tablist">' +
      ['reply', 'coach', 'note'].map(function (k) {
        return '<button type="button" role="tab" data-mode="' + k + '"><span class="sw ' + k + '"></span><span class="mt"></span></button>';
      }).join('') +
      '</div><div class="cbody"><p class="hint" id="hint"></p><div class="crow">' +
      '<textarea id="reply" rows="2" aria-label="Message"></textarea>' +
      '<button class="send" id="send" type="button"></button></div></div></div>';
  }

  function updateComposer() {
    if (!S.thread || !$('#composer')) return;
    var c = S.thread.conversation;
    var n = firstName(c.user_name) || 'them';
    $('#composer').className = 'composer mode-' + S.mode;
    $$('#modes button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === S.mode);
      b.setAttribute('aria-selected', String(b.dataset.mode === S.mode));
      $('.mt', b).textContent = MODES[b.dataset.mode].tab(n);
    });
    $('#hint').textContent = MODES[S.mode].hint(n, S.thread.client_active);
    if (!S.sending) $('#send').textContent = MODES[S.mode].button(n);
    $('#reply').placeholder = MODES[S.mode].ph;
  }

  function bindComposer() {
    $('#modes').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      S.mode = b.dataset.mode;
      store('rhd-mode', S.mode);
      updateComposer();
      $('#reply').focus();
    });
    var ta = $('#reply');
    ta.addEventListener('input', function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendComposer(); }
    });
    $('#send').addEventListener('click', sendComposer);
  }

  function sendComposer() {
    var ta = $('#reply');
    var text = ta.value.trim();
    if (!text || !S.sel || S.sending) return;
    var mode = S.mode;
    var n = firstName(S.thread.conversation.user_name) || 'them';
    var send = $('#send');
    S.sending = true;
    send.disabled = true;
    ta.disabled = true;
    send.innerHTML = '<span class="spin"></span>' + (mode === 'coach' ? 'Leo is writing…' : 'Sending…');
    post(mode, { id: S.sel, content: text }).then(function (r) {
      ta.value = '';
      ta.style.height = '';
      var byEmail = r.delivery && r.delivery.channel === 'email';
      if (mode === 'coach') {
        toast('<b>✓ ' + (r.reply ? 'Leo replied to ' + esc(n) + (byEmail ? ' by email' : '') : 'Leo didn’t send anything yet') + '</b>' +
          (r.memory ? '🧠 Learned: “' + esc(r.memory.question) + '” · <a href="#memory=' + r.memory.id + '" style="color:#9fe6c3">Edit</a>' : 'Nothing saved to memory.') +
          (r.note ? '<br>Leo: ' + esc(r.note) : ''));
      } else if (mode === 'reply') {
        toast('<b>✓ Sent to ' + esc(n) + '</b>' + (byEmail ? 'By email — their reply comes back into this thread.' : 'Live in their chat.'));
      }
    }).catch(function (e) {
      toast('<b>Nothing was sent</b>' + esc(e.message), true);
    }).then(function () {
      S.sending = false;
      send.disabled = false;
      ta.disabled = false;
      updateComposer();
      ta.focus();
      loadThread(true);
      refreshList();
    });
  }

  function renderThread(d) {
    var c = d.conversation;
    var th = $('#thread');
    var fresh = th.dataset.conv !== c.id;
    if (fresh) {
      th.dataset.conv = c.id;
      th.innerHTML = '<div class="thread-head" id="thead"></div><div class="msgs" id="msgs" role="log"></div>' + composerHtml();
      bindComposer();
    }
    $('#thead').innerHTML = headHtml(d);
    bindHead(d);
    var box = $('#msgs');
    var nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    box.innerHTML = msgsHtml(d);
    if (fresh || nearBottom) box.scrollTop = box.scrollHeight;
    updateComposer();
  }

  function bindHead(d) {
    var id = d.conversation.id;
    var on = function (sel, fn) { var el = $(sel); if (el) el.addEventListener('click', fn); };
    var after = function () { loadThread(true); refreshList(); };
    on('#back', function () {
      $('#view-inbox').classList.remove('viewing');
      S.sel = null;
      history.replaceState(null, '', '#inbox');
      renderList();
    });
    on('#resolve', function () { post('status', { id: id, status: 'resolved' }).then(after); });
    on('#reopen', function () { post('status', { id: id, status: 'open' }).then(after); });
    on('#handoff', function () { post('handoff', { id: id }).then(after); });
    on('#conv-emails', function () { S.emailConv = { id: id, name: d.conversation.user_name || d.conversation.user_email }; });
  }

  setInterval(function () { if (S.view === 'inbox') refreshList(); }, 4000);
  setInterval(function () { if (S.view === 'inbox' && S.sel && !S.sending) loadThread(false); }, 3500);

  // =====================================================================
  // Ideas
  // =====================================================================
  var STATUS = { under_review: 'Under review', planned: 'Planned', in_progress: 'In progress', shipped: 'Shipped', declined: 'Declined' };
  var ORDER = ['under_review', 'planned', 'in_progress', 'shipped', 'declined'];
  var UP = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.5l8.5 9.5H15v7.5H9V13H3.5z"/></svg>';

  function loadIdeas() {
    return api('ideas').then(function (d) {
      S.ideas = d.ideas || [];
      renderKanban();
      updateIdeasBadge();
    }).catch(function (e) { toast(esc(e.message), true); });
  }
  function updateIdeasBadge() {
    $('#nb-ideas').textContent = S.ideas.filter(function (i) { return i.status === 'under_review'; }).length || '';
  }
  function ideaMatches(i) {
    return !S.ideaQuery || [i.title, i.body, i.church, i.author_name].join(' ').toLowerCase().indexOf(S.ideaQuery) >= 0;
  }
  function ideaCard(i) {
    return '<button type="button" class="icard' + (i.id === S.ideaSel ? ' sel' : '') + '" data-id="' + i.id + '">' +
      '<span class="votes" aria-label="' + plural(i.vote_count, 'vote') + '">' + UP + i.vote_count + '</span>' +
      '<span class="ibody"><span class="ititle">' + esc(i.title) + '</span>' +
      '<span class="imeta">' + esc(i.church || 'A church') + ' · 💬 ' + i.comment_count + ' · ' + esc(ago(i.created_at)) + '</span></span></button>';
  }
  function renderKanban() {
    var total = S.ideas.length;
    var votes = S.ideas.reduce(function (n, i) { return n + i.vote_count; }, 0);
    $('#ideas-sub').textContent = total
      ? plural(total, 'idea') + ' · ' + plural(votes, 'vote') + ' from Faithmade churches. Voters hear from you when an idea moves.'
      : 'No ideas yet. Churches post them from the lightbulb tab in Leo’s chat.';
    $('#kanban').innerHTML = ORDER.map(function (s) {
      var items = S.ideas.filter(function (i) { return i.status === s && ideaMatches(i); });
      return '<div class="col"><div class="colhead"><span class="sdot ' + s + '"></span>' + STATUS[s] + '<span class="n">' + items.length + '</span></div>' +
        '<div class="cards">' + (items.map(ideaCard).join('') || '<div class="colempty">Nothing here yet</div>') + '</div></div>';
    }).join('');
  }
  $('#kanban').addEventListener('click', function (e) {
    var c = e.target.closest('.icard');
    if (c) location.hash = 'idea=' + c.dataset.id;
  });
  $('#ideas-q').addEventListener('input', function (e) { S.ideaQuery = e.target.value.trim().toLowerCase(); renderKanban(); });

  function openIdea(id) {
    S.ideaSel = id;
    var ready = S.ideas.length ? Promise.resolve() : loadIdeas();
    return ready.then(function () { return api('idea?id=' + id); }).then(function (d) {
      if (S.ideaSel !== id) return;
      S.idea = d;
      renderKanban();
      renderDrawer();
    }).catch(function (e) { toast(esc(e.message), true); });
  }
  function closeDrawer(silent) {
    $('#drawer').hidden = true;
    $('#scrim').hidden = true;
    S.ideaSel = null;
    if (!silent) {
      history.replaceState(null, '', '#ideas');
      renderKanban();
    }
  }
  $('#scrim').addEventListener('click', function () { closeDrawer(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer(); });

  function renderDrawer() {
    var i = S.idea.idea, comments = S.idea.comments, voters = S.idea.voters;
    var others = S.ideas.filter(function (x) { return x.id !== i.id; });
    var dr = $('#drawer');
    dr.innerHTML = '<div class="dhead"><span class="sdot ' + esc(i.status) + '"></span><span>Idea #' + i.id + ' · ' + esc(STATUS[i.status] || i.status) + '</span>' +
      '<button class="x" type="button" aria-label="Close">×</button></div>' +
      '<div class="dbody">' +
      '<input class="field title" id="i-title" maxlength="120" aria-label="Title" value="' + esc(i.title) + '">' +
      '<textarea class="field" id="i-body" rows="4" maxlength="4000" aria-label="Details" placeholder="No details">' + esc(i.body) + '</textarea>' +
      '<div class="formrow"><button class="btn primary" id="i-save" type="button" hidden>Save changes</button>' +
      '<span class="dmeta">Posted by ' + esc(i.author_name || 'a church') + (i.church ? ' · ' + esc(i.church) : '') + ' · ' + esc(host(i.site)) + ' · ' + esc(stamp(i.created_at)) + '</span></div>' +
      '<h4>Status</h4><div class="statuses" id="i-statuses">' + ORDER.map(function (s) {
        return '<button type="button" data-s="' + s + '" class="' + (s === i.status ? 'current' : '') + '"><span class="sdot ' + s + '"></span>' + STATUS[s] + '</button>';
      }).join('') + '</div>' +
      '<div class="statusform" id="i-sf" hidden>' +
      '<textarea class="field" id="i-note" rows="3" placeholder="Note to voters (optional) — posted on the idea and included in the email"></textarea>' +
      '<label class="check"><input type="checkbox" id="i-notify"> Email ' + (voters.length ? 'the ' + plural(voters.length, 'voter') : 'voters (none yet)') + '</label>' +
      '<div class="formrow"><button class="btn primary" id="i-apply" type="button"></button><button class="btn" id="i-cancel" type="button">Cancel</button></div></div>' +
      '<h4>Votes · ' + voters.length + '</h4><div class="voters">' + (voters.map(function (v) {
        return '<span class="voter" title="' + esc(v.voter_email) + '">' + esc(v.voter_name || v.voter_email) + (v.church ? ' · ' + esc(v.church) : '') + '</span>';
      }).join('') || '<span class="dmeta">No votes yet</span>') + '</div>' +
      '<h4>Comments · ' + comments.length + '</h4>' +
      comments.map(function (c) {
        return '<div class="comment' + (c.is_team ? ' team' : '') + '"><b>' + (c.is_team ? 'Faithmade team' : esc(c.author_name || 'A church')) +
          (c.church && !c.is_team ? ' <span>· ' + esc(c.church) + '</span>' : '') + ' <span>· ' + esc(ago(c.created_at)) + '</span></b>' + esc(c.body) + '</div>';
      }).join('') +
      '<textarea class="field" id="i-comment" rows="2" placeholder="Comment as the Faithmade team — every church sees it"></textarea>' +
      '<div class="formrow"><button class="btn" id="i-post" type="button">Post comment</button></div>' +
      '<details class="danger"><summary>Merge or delete</summary>' +
      '<div class="formrow"><select class="field" id="i-into" aria-label="Merge into"><option value="">Merge this into…</option>' + others.map(function (x) {
        return '<option value="' + x.id + '">#' + x.id + ' ' + esc(x.title) + ' (' + x.vote_count + ')</option>';
      }).join('') + '</select><button class="btn" id="i-merge" type="button">Merge</button></div>' +
      '<div class="formrow"><button class="btn danger" id="i-delete" type="button">Delete idea</button><span class="dmeta">Removes its votes and comments too.</span></div></details>' +
      '</div>';
    dr.hidden = false;
    $('#scrim').hidden = false;
    bindDrawer(i, voters);
  }

  function bindDrawer(i, voters) {
    var dr = $('#drawer');
    $('.x', dr).addEventListener('click', function () { closeDrawer(); });
    var dirty = function () { $('#i-save').hidden = $('#i-title').value === i.title && $('#i-body').value === i.body; };
    $('#i-title').addEventListener('input', dirty);
    $('#i-body').addEventListener('input', dirty);
    $('#i-save').addEventListener('click', function () {
      post('idea/update', { id: i.id, title: $('#i-title').value, body: $('#i-body').value })
        .then(function () { toast('<b>✓ Saved</b>'); refreshIdea(i.id); })
        .catch(function (e) { toast(esc(e.message), true); });
    });
    var pick = null;
    $('#i-statuses').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      pick = b.dataset.s === i.status ? null : b.dataset.s;
      $$('#i-statuses button').forEach(function (x) { x.classList.toggle('pick', x.dataset.s === pick); });
      $('#i-sf').hidden = !pick;
      if (pick) {
        $('#i-apply').textContent = 'Move to ' + STATUS[pick];
        $('#i-notify').checked = pick !== 'declined' && voters.length > 0;
        $('#i-notify').disabled = !voters.length;
        $('#i-note').focus();
      }
    });
    $('#i-cancel').addEventListener('click', function () {
      pick = null;
      $('#i-sf').hidden = true;
      $$('#i-statuses button').forEach(function (x) { x.classList.remove('pick'); });
    });
    $('#i-apply').addEventListener('click', function (e) {
      var btn = e.currentTarget;
      btn.disabled = true;
      post('idea/status', { id: i.id, status: pick, note: $('#i-note').value, notify: $('#i-notify').checked }).then(function (r) {
        var logged = S.config && S.config.email !== 'resend';
        toast('<b>✓ Moved to ' + STATUS[pick] + '</b>' + (r.notified
          ? plural(r.notified.voters, 'voter') + (logged ? ' — email isn’t connected, so it was logged, not sent' : ' emailed')
          : 'No emails sent.'));
        refreshIdea(i.id);
      }).catch(function (er) { toast(esc(er.message), true); btn.disabled = false; });
    });
    $('#i-post').addEventListener('click', function () {
      var body = $('#i-comment').value.trim();
      if (!body) return;
      post('idea/comment', { id: i.id, body: body }).then(function () { refreshIdea(i.id); });
    });
    $('#i-merge').addEventListener('click', function () {
      var into = Number($('#i-into').value);
      if (!into || !confirm('Merge this idea into #' + into + '? Its votes and comments move over.')) return;
      post('idea/merge', { id: i.id, into: into }).then(function () {
        toast('<b>✓ Merged</b>Votes and comments moved to #' + into + '.');
        S.ideas = [];
        location.hash = 'idea=' + into;
      }).catch(function (e) { toast(esc(e.message), true); });
    });
    $('#i-delete').addEventListener('click', function () {
      if (!confirm('Delete this idea and all its votes and comments?')) return;
      post('idea/delete', { id: i.id }).then(function () { closeDrawer(); loadIdeas(); toast('<b>Idea deleted</b>'); });
    });
  }
  function refreshIdea(id) { return loadIdeas().then(function () { return openIdea(id); }); }

  // =====================================================================
  // Leo's memory
  // =====================================================================
  var VIA = { email: 'by email', inbox: 'in the inbox', link: 'from a reply link', manual: 'by hand' };

  function loadMemories() {
    return api('memories').then(function (d) {
      S.memories = d.memories || [];
      renderMemories();
    }).catch(function (e) { toast(esc(e.message), true); });
  }
  function memHtml(m) {
    return '<div class="mem' + (m.enabled ? '' : ' off') + (m.id === S.memFlash ? ' flash' : '') + '" id="mem-' + m.id + '" data-id="' + m.id + '">' +
      '<div class="memq">' + esc(m.question) + '</div><div class="mema">' + esc(m.answer) + '</div>' +
      '<div class="memmeta"><span>🧠 Learned ' + esc(VIA[m.created_via] || '') + ' · ' + esc(ago(m.created_at)) + '</span>' +
      '<span>Used ' + plural(m.match_count, 'time') + (m.last_matched_at ? ' · last ' + esc(ago(m.last_matched_at)) : '') + '</span>' +
      (m.source_conversation_id ? '<a href="#c=' + esc(encodeURIComponent(m.source_conversation_id)) + '">See the conversation</a>' : '') +
      '<span class="spacer"></span>' +
      '<label class="switch"><input type="checkbox" data-act="toggle"' + (m.enabled ? ' checked' : '') + '> ' + (m.enabled ? 'On' : 'Off') + '</label>' +
      '<button class="btn" type="button" data-act="edit">Edit</button><button class="btn danger" type="button" data-act="delete">Delete</button></div></div>';
  }
  function renderMemories() {
    var q = S.memQuery;
    var list = S.memories.filter(function (m) { return !q || (m.question + ' ' + m.answer).toLowerCase().indexOf(q) >= 0; });
    $('#memlist').innerHTML = list.map(memHtml).join('') ||
      '<div class="empty" style="height:220px"><div class="mark">🧠</div>' +
      (q ? 'No memories match.' : 'Leo hasn’t learned anything yet. Reply to one of Leo’s emails, coach Leo in the inbox, or teach it by hand.') + '</div>';
    if (S.memFlash) {
      var el = $('#mem-' + S.memFlash);
      if (el) el.scrollIntoView({ block: 'center' });
      setTimeout(function () { S.memFlash = null; var f = $('.mem.flash'); if (f) f.classList.remove('flash'); }, 2600);
    }
  }
  $('#mem-q').addEventListener('input', function (e) { S.memQuery = e.target.value.trim().toLowerCase(); renderMemories(); });
  $('#mem-add').addEventListener('click', function () { $('#mem-form').hidden = false; $('#mem-form [name=question]').focus(); });
  $('#mem-cancel').addEventListener('click', function () { $('#mem-form').hidden = true; $('#mem-form').reset(); });
  $('#mem-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.currentTarget;
    post('memory/create', { question: f.question.value, answer: f.answer.value }).then(function (r) {
      f.reset();
      f.hidden = true;
      S.memFlash = r.memory.id;
      toast('<b>✓ Leo learned it</b>Leo will use this answer from now on.');
      loadMemories();
    }).catch(function (er) { toast(esc(er.message), true); });
  });
  $('#memlist').addEventListener('change', function (e) {
    if (e.target.dataset.act !== 'toggle') return;
    var id = Number(e.target.closest('.mem').dataset.id);
    post('memory/update', { id: id, enabled: e.target.checked }).then(loadMemories);
  });
  $('#memlist').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var card = b.closest('.mem');
    var id = Number(card.dataset.id);
    var m = S.memories.filter(function (x) { return x.id === id; })[0];
    if (b.dataset.act === 'delete') {
      if (confirm('Remove this from Leo’s memory?')) post('memory/delete', { id: id }).then(loadMemories);
    } else if (b.dataset.act === 'edit') {
      card.innerHTML = '<div class="memedit"><input class="field" name="q" maxlength="300" aria-label="Question" value="' + esc(m.question) + '">' +
        '<textarea class="field" name="a" rows="5" maxlength="4000" aria-label="Answer">' + esc(m.answer) + '</textarea>' +
        '<div class="formrow"><button class="btn primary" type="button" data-act="save">Save</button><button class="btn" type="button" data-act="cancel">Cancel</button></div></div>';
    } else if (b.dataset.act === 'save') {
      post('memory/update', { id: id, question: $('[name=q]', card).value, answer: $('[name=a]', card).value })
        .then(function () { toast('<b>✓ Saved</b>'); loadMemories(); });
    } else if (b.dataset.act === 'cancel') {
      renderMemories();
    }
  });

  // =====================================================================
  // Emails
  // =====================================================================
  var KIND = {
    escalation: 'Leo needs you', followup: 'Church wrote back', coach_confirm: 'Leo’s confirmation', coach_failed: 'Coaching failed',
    leo_reply: 'Leo → church', team_reply: 'Team → church', idea_new: 'New idea', idea_status: 'Idea update',
    coach: 'You coached Leo', client_reply: 'Church replied', unknown: 'Unknown',
  };
  var problem = function (m) { return m.status === 'failed' || m.status === 'rejected'; };

  function loadEmails() {
    var q = S.emailConv ? '?conversation=' + encodeURIComponent(S.emailConv.id) : '';
    return Promise.all([S.config ? Promise.resolve(S.config) : api('config'), api('emails' + q)]).then(function (r) {
      S.config = r[0];
      S.emails = r[1].emails || [];
      renderEmailCfg();
      renderEmails();
    }).catch(function (e) { toast(esc(e.message), true); });
  }
  function renderEmailCfg() {
    var c = S.config;
    var html = c.email === 'resend'
      ? '<div class="cfgbox ok"><b>Sending with Resend</b>Leo’s emails go to ' + esc(c.team_emails.join(', ') || 'nobody yet — set TEAM_EMAILS') + '</div>'
      : '<div class="cfgbox warn"><b>Email isn’t connected yet</b>Everything is logged here but nothing is sent. Set EMAIL_PROVIDER=resend and RESEND_API_KEY — see docs/EMAIL-SETUP.md.</div>';
    if (S.emailConv) {
      html += '<div class="cfgbox ok" style="margin-top:8px"><b>' + esc(S.emailConv.name) + '</b>Just this conversation · <a href="#emails" id="eclear">Show all</a></div>';
    }
    $('#email-cfg').innerHTML = html;
    var cl = $('#eclear');
    if (cl) cl.addEventListener('click', function () { S.emailConv = null; });
  }
  function emailRow(m) {
    var who = m.direction === 'out' ? 'To ' + m.to_addr : 'From ' + m.from_addr;
    return '<div class="erow' + (m.id === S.emailSel ? ' sel' : '') + '" data-id="' + m.id + '">' +
      '<span class="dir ' + esc(m.direction) + '">' + (m.direction === 'out' ? '↗' : '↙') + '</span>' +
      '<div class="ebody"><div class="etop"><span class="ekind">' + esc(KIND[m.kind] || m.kind) + '</span>' +
      '<span class="estatus ' + esc(m.status) + '">' + esc(m.status) + '</span><time>' + esc(ago(m.created_at)) + '</time></div>' +
      '<div class="esubj">' + esc(m.subject || '(no subject)') + '</div><div class="eaddr">' + esc(who) + (m.error ? ' · ' + esc(m.error) : '') + '</div></div></div>';
  }
  function renderEmails() {
    var f = S.efilter;
    var list = S.emails.filter(function (m) { return f === 'all' || (f === 'problem' ? problem(m) : m.direction === f); });
    $('#eprob').textContent = S.emails.filter(problem).length || '';
    $('#email-rows').innerHTML = list.map(emailRow).join('') || '<div class="empty" style="height:160px"><div class="mark">✉</div>No emails here</div>';
  }
  $('#etabs').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    S.efilter = b.dataset.f;
    $$('#etabs button').forEach(function (x) { x.classList.toggle('active', x === b); });
    renderEmails();
  });
  $('#email-rows').addEventListener('click', function (e) {
    var r = e.target.closest('.erow');
    if (r) location.hash = 'email=' + r.dataset.id;
  });

  function openEmail(id) {
    S.emailSel = id;
    renderEmails();
    $('#view-emails').classList.add('viewing');
    return api('email?id=' + id).then(function (d) {
      var m = d.email;
      var pv = $('#email-preview');
      pv.innerHTML = '<dl class="phead"><div class="psubj"><button class="btn back" type="button" id="eback" aria-label="Back to emails">←</button> ' + esc(m.subject || '(no subject)') + '</div>' +
        '<dt>' + (m.direction === 'out' ? 'Sent' : 'Received') + '</dt><dd>' + esc(stamp(m.created_at)) + ' · ' + esc(KIND[m.kind] || m.kind) + '</dd>' +
        '<dt>From</dt><dd>' + esc(m.from_addr) + '</dd><dt>To</dt><dd>' + esc(m.to_addr) + '</dd>' +
        (m.reply_to ? '<dt>Reply-To</dt><dd>' + esc(m.reply_to) + '</dd>' : '') +
        '<dt>Status</dt><dd><span class="estatus ' + esc(m.status) + '">' + esc(m.status) + '</span>' + (m.error ? ' ' + esc(m.error) : '') + '</dd>' +
        (m.conversation_id ? '<dt>Thread</dt><dd><a href="#c=' + esc(encodeURIComponent(m.conversation_id)) + '">Open the conversation →</a></dd>' : '') +
        '</dl>';
      if (m.html) {
        var f = document.createElement('iframe');
        f.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
        f.setAttribute('title', 'Email preview');
        f.srcdoc = '<base target="_blank">' + m.html;
        pv.appendChild(f);
      } else {
        var pre = document.createElement('pre');
        pre.textContent = m.text || '(no body)';
        pv.appendChild(pre);
      }
      $('#eback').addEventListener('click', function () {
        $('#view-emails').classList.remove('viewing');
        history.replaceState(null, '', '#emails');
      });
    }).catch(function (e) { toast(esc(e.message), true); });
  }

  // ---------- boot ----------
  renderThemeBtn();
  api('config').then(function (c) { S.config = c; }).catch(function () {});
  api('ideas').then(function (d) { S.ideas = d.ideas || []; updateIdeasBadge(); }).catch(function () {});
  route();
})();
