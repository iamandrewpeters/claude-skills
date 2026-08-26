// Reach Helpdesk inbox: live agent view over D1.
//   GET  /admin?key=…                     app shell (list + thread + composer)
//   GET  /admin/api/conversations         inbox list
//   GET  /admin/api/conversation?id=…     thread (marks read)
//   POST /admin/api/reply                 {id, content} → agent message, team takes over
//   POST /admin/api/status                {id, status}  → open | resolved
//   POST /admin/api/handoff               {id}          → hand the thread back to Leo
//   POST /admin/api/presence              {online}      → 5-min presence lease (page heartbeats)
// Gated by ADMIN_KEY (?key=… / JSON body). Auth upgrade path: Cloudflare Access.

import * as db from './db.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function jsonRes(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function api(env, request, url) {
  const path = url.pathname.replace('/admin/api/', '');

  if (request.method === 'GET' && path === 'conversations') {
    return jsonRes(200, { conversations: await db.listConversations(env), team_online: await db.isTeamOnline(env) });
  }
  if (request.method === 'GET' && path === 'conversation') {
    const id = url.searchParams.get('id') || '';
    const conv = await db.getConversation(env, id);
    if (!conv) return jsonRes(404, { error: 'not found' });
    const messages = await db.messagesAfter(env, id, 0);
    const escalations = await db.listEscalations(env, id);
    await db.markAgentRead(env, id);
    return jsonRes(200, { conversation: conv, messages, escalations });
  }

  if (request.method !== 'POST') return jsonRes(405, { error: 'method not allowed' });
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonRes(400, { error: 'invalid JSON' });
  }

  if (path === 'reply') {
    const content = String(body.content || '').trim().slice(0, 4000);
    if (!body.id || !content) return jsonRes(400, { error: 'id and content required' });
    const msg = await db.storeMessage(env, body.id, 'agent', content);
    await db.setHandledBy(env, body.id, 'team');
    await db.setStatus(env, body.id, 'open');
    await db.markAgentRead(env, body.id);
    return jsonRes(200, { message: msg });
  }
  if (path === 'status') {
    if (!body.id || !['open', 'resolved'].includes(body.status)) return jsonRes(400, { error: 'bad status' });
    await db.setStatus(env, body.id, body.status);
    return jsonRes(200, { ok: true });
  }
  if (path === 'handoff') {
    if (!body.id) return jsonRes(400, { error: 'id required' });
    await db.setHandledBy(env, body.id, 'leo');
    return jsonRes(200, { ok: true });
  }
  if (path === 'presence') {
    await db.setPresence(env, !!body.online);
    return jsonRes(200, { team_online: await db.isTeamOnline(env) });
  }
  return jsonRes(404, { error: 'not found' });
}

const SHELL = (key) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reach Helpdesk</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap">
<style>
  :root{--leo:#69af95;--leo-deep:#4c8b73;--leo-dark:#35604f;--leo-soft:#edf5f1;--mist:#f4f8f6;
        --text:#22302b;--muted:#6e7f78;--paper:#f0f4f2;--card:#ffffff;--line:#e1e9e5;
        --topbar:#22302b;--agent:#22302b;--hover:#fafcfb;--accent-text:#35604f;
        --amber:#b07a33;--amber-soft:#fbf3e4}
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
        --leo-soft:#1d322a;--mist:#111a16;--text:#e6ede8;--muted:#8fa39a;--paper:#0d1512;--card:#16211c;
        --line:#26352e;--topbar:#0a100d;--agent:#3b5449;--hover:#1b2620;--accent-text:#8fc7b2;--amber:#d9a45e;--amber-soft:#31281a}}
  :root[data-theme="dark"]{
        --leo-soft:#1d322a;--mist:#111a16;--text:#e6ede8;--muted:#8fa39a;--paper:#0d1512;--card:#16211c;
        --line:#26352e;--topbar:#0a100d;--agent:#3b5449;--hover:#1b2620;--accent-text:#8fc7b2;--amber:#d9a45e;--amber-soft:#31281a}
  *{box-sizing:border-box}
  body{margin:0;font-family:'Figtree',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--paper);color:var(--text);font-size:14px}
  button,input,textarea{font-family:inherit}
  .topbar{display:flex;align-items:center;gap:12px;background:var(--topbar);color:#fff;padding:11px 20px}
  .topbar .logo{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,var(--leo),var(--leo-dark));display:grid;place-items:center;font-weight:800;color:#fff;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.25)}
  .topbar h1{font-size:15.5px;font-weight:700;letter-spacing:-.01em;margin:0;flex:1}
  .topbar h1 span{color:#8fa79d;font-weight:500}
  .presence{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:600;color:#cfd8d3;cursor:pointer;user-select:none;background:rgba(255,255,255,.07);padding:6px 8px 6px 14px;border-radius:99px;transition:background .15s}
  .presence:hover{background:rgba(255,255,255,.12)}
  .theme{background:rgba(255,255,255,.07);border:none;color:#cfd8d3;width:34px;height:34px;border-radius:99px;cursor:pointer;display:grid;place-items:center;transition:background .15s}
  .theme:hover{background:rgba(255,255,255,.12)}
  .presence .track{width:40px;height:23px;border-radius:99px;background:#4a5550;position:relative;transition:background .18s}
  .presence .knob{position:absolute;top:3px;left:3px;width:17px;height:17px;border-radius:50%;background:#fff;transition:left .18s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
  .presence.on{color:#9fe6c3}
  .presence.on .track{background:var(--leo)}
  .presence.on .knob{left:20px}
  .layout{display:grid;grid-template-columns:360px 1fr;height:calc(100vh - 52px)}
  .list{border-right:1px solid var(--line);background:var(--card);display:flex;flex-direction:column;min-width:0}
  .listtools{padding:12px 14px 0;display:flex;flex-direction:column;gap:10px;border-bottom:1px solid var(--line)}
  .search{display:flex;align-items:center;gap:8px;background:var(--mist);border:1px solid var(--line);border-radius:10px;padding:8px 12px}
  .search svg{flex-shrink:0;color:var(--muted)}
  .search input{border:none;background:none;outline:none;font-size:13px;width:100%;color:var(--text)}
  .tabs{display:flex;gap:2px;padding-bottom:8px}
  .tabs button{border:none;background:none;padding:6px 11px;border-radius:99px;cursor:pointer;font-size:12.5px;color:var(--muted);font-weight:600}
  .tabs button .n{opacity:.7;font-weight:700;margin-left:3px;font-size:11px}
  .tabs button.active{background:var(--leo-soft);color:var(--accent-text)}
  .rows{overflow-y:auto;flex:1}
  .row{display:flex;gap:11px;padding:13px 14px;border-bottom:1px solid var(--line);cursor:pointer;align-items:flex-start;transition:background .1s}
  .row:hover{background:var(--hover)}
  .row.sel{background:var(--leo-soft);box-shadow:inset 3px 0 0 var(--leo-deep)}
  .avatar{width:36px;height:36px;border-radius:50%;color:#fff;display:grid;place-items:center;font-weight:700;font-size:13.5px;flex-shrink:0}
  .av0{background:linear-gradient(135deg,#69af95,#4c8b73)}.av1{background:linear-gradient(135deg,#5b9aa6,#3d6f7a)}
  .av2{background:linear-gradient(135deg,#8a9a5b,#667440)}.av3{background:linear-gradient(135deg,#22302b,#4a5550)}
  .row .body{min-width:0;flex:1}
  .row .top{display:flex;align-items:center;gap:7px}
  .row .who{font-weight:700;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .row time{margin-left:auto;font-size:10.5px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
  .row .church{font-size:11.5px;color:var(--accent-text);font-weight:600;margin-top:1px}
  .row .snippet{color:var(--muted);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--leo-deep);flex-shrink:0;margin-top:8px;visibility:hidden}
  .row.unread .dot{visibility:visible}
  .row.unread .snippet{color:var(--text);font-weight:600}
  .pill{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:2.5px 8px;border-radius:99px;flex-shrink:0}
  .pill.open{background:var(--leo-soft);color:var(--accent-text)}
  .pill.escalated{background:var(--amber-soft);color:var(--amber)}
  .pill.resolved{background:var(--hover);color:var(--muted)}
  .pill.leo{background:var(--leo-soft);color:var(--accent-text)}
  .pill.team{background:var(--agent);color:#fff}
  .thread{display:flex;flex-direction:column;min-width:0;background:var(--mist)}
  .thread-head{display:flex;align-items:center;gap:13px;padding:13px 20px;background:var(--card);border-bottom:1px solid var(--line)}
  .thread-head .info{flex:1;min-width:0}
  .thread-head .name{font-weight:700;font-size:14.5px}
  .thread-head .sub{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
  .actions{display:flex;gap:8px}
  .btn{border:1px solid var(--line);background:var(--card);border-radius:9px;padding:8px 14px;font-size:12.5px;font-weight:700;cursor:pointer;color:var(--text);transition:border-color .12s,background .12s}
  .btn:hover{border-color:var(--leo-deep);background:var(--leo-soft)}
  .btn.primary{background:linear-gradient(135deg,var(--leo-deep),var(--leo-dark));border:none;color:#fff;box-shadow:0 2px 8px rgba(53,96,79,.28)}
  .btn.primary:hover{filter:brightness(1.06)}
  .msgs{flex:1;overflow-y:auto;padding:22px 26px;display:flex;flex-direction:column;gap:4px}
  .m{max-width:64%;padding:10px 14px;border-radius:15px;line-height:1.55;font-size:13.5px;white-space:pre-wrap;word-wrap:break-word}
  .m.user{align-self:flex-start;background:var(--card);border-bottom-left-radius:5px;box-shadow:0 1px 2px rgba(34,48,43,.07),0 3px 10px rgba(34,48,43,.05)}
  .m.assistant{align-self:flex-end;background:var(--leo-soft);border-bottom-right-radius:5px;box-shadow:0 1px 3px rgba(34,48,43,.06)}
  .m.agent{align-self:flex-end;background:var(--agent);color:#fff;border-bottom-right-radius:5px;box-shadow:0 2px 8px rgba(34,48,43,.26)}
  .mlabel{font-size:10px;color:var(--muted);margin:10px 0 3px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
  .mlabel.right{align-self:flex-end}
  .escnote{align-self:center;background:var(--amber-soft);color:var(--amber);font-size:12px;font-weight:600;padding:7px 14px;border-radius:99px;margin:10px 0;box-shadow:0 1px 3px rgba(176,122,51,.15)}
  .composer{display:flex;align-items:flex-end;gap:10px;margin:0 20px 16px;padding:12px;background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:0 4px 16px rgba(34,48,43,.08)}
  .composer textarea{flex:1;resize:none;border:none;padding:6px 4px;font-size:13.5px;line-height:1.5;min-height:40px;max-height:130px;outline:none;background:none;color:var(--text)}
  .composer button{background:linear-gradient(135deg,var(--leo-deep),var(--leo-dark));color:#fff;border:none;border-radius:10px;padding:10px 18px;font-weight:700;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(53,96,79,.3)}
  .composer button:hover{filter:brightness(1.06)}
  .empty{display:grid;place-items:center;color:var(--muted);height:100%;font-size:13px;gap:6px}
  .empty .mark{width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,var(--leo),var(--leo-dark));display:grid;place-items:center;color:#fff;font-weight:800;font-size:18px;box-shadow:0 6px 18px rgba(53,96,79,.25)}
  @media (max-width:860px){.layout{grid-template-columns:1fr}.thread{display:none}.layout.viewing .list{display:none}.layout.viewing .thread{display:flex}}
</style></head><body>
<div class="topbar">
  <div class="logo">L</div><h1>Reach Helpdesk <span>· Leo &amp; team</span></h1>
  <button class="theme" id="theme" aria-label="Toggle dark mode"></button>
  <div class="presence" id="presence"><span id="ptext">You're offline</span><span class="track"><span class="knob"></span></span></div>
</div>
<div class="layout" id="layout">
  <div class="list">
    <div class="listtools">
      <div class="search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input id="search" type="text" placeholder="Search name, church, message…">
      </div>
      <div class="tabs" id="tabs">
        <button data-f="open" class="active">Open<span class="n" data-n="open"></span></button>
        <button data-f="escalated">Escalated<span class="n" data-n="escalated"></span></button>
        <button data-f="resolved">Resolved<span class="n" data-n="resolved"></span></button>
        <button data-f="all">All</button>
      </div>
    </div>
    <div class="rows" id="rows"></div>
  </div>
  <div class="thread" id="thread"><div class="empty"><div class="mark">L</div>Select a conversation</div></div>
</div>
<script>
const KEY=${JSON.stringify(key)};
let FILTER='open', SEL=null, ONLINE=false, CONVS=[], QUERY='';
const $=s=>document.querySelector(s);
const escH=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=(p,opts)=>fetch('/admin/api/'+p+(p.includes('?')?'&':'?')+'key='+encodeURIComponent(KEY),opts).then(r=>r.json());
const post=(p,body)=>api(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const initials=c=>((c.user_name||c.user_email||'?').trim()[0]||'?').toUpperCase();
const avClass=c=>{let h=0;const s=String(c.user_email||c.id||'');for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return 'av'+(h%4);};
const when=t=>t?t.replace(/^\\d{4}-/,'').slice(0,11):'';
const matches=c=>!QUERY||[c.user_name,c.user_email,c.church,c.site,c.last_snippet].join(' ').toLowerCase().includes(QUERY);

function renderList(){
  ['open','escalated','resolved'].forEach(f=>{
    const el=document.querySelector('[data-n="'+f+'"]');
    if(el){const n=CONVS.filter(c=>c.status===f).length;el.textContent=n?n:'';}
  });
  const rows=CONVS.filter(c=>(FILTER==='all'?true:c.status===FILTER)&&matches(c));
  $('#rows').innerHTML=rows.map(c=>{
    const unread=(c.last_id||0)>(c.agent_last_read_id||0);
    return '<div class="row'+(c.id===SEL?' sel':'')+(unread?' unread':'')+'" data-id="'+escH(c.id)+'">'
      +'<span class="dot"></span><div class="avatar '+avClass(c)+'">'+escH(initials(c))+'</div>'
      +'<div class="body"><div class="top"><span class="who">'+escH(c.user_name||c.user_email||'Visitor')+'</span>'
      +'<span class="pill '+escH(c.status)+'">'+escH(c.status)+'</span>'
      +(c.handled_by==='team'?'<span class="pill team">you</span>':'<span class="pill leo">leo</span>')
      +'<time>'+escH(when(c.last_at))+'</time></div>'
      +'<div class="church">'+escH(c.church||c.site||'')+'</div>'
      +'<div class="snippet">'+escH(c.last_snippet||'')+'</div></div></div>';
  }).join('')||'<div class="empty" style="height:140px"><div class="mark">L</div>Nothing here</div>';
  document.querySelectorAll('.row').forEach(r=>r.onclick=()=>{SEL=r.dataset.id;$('#layout').classList.add('viewing');loadThread();renderList();});
}
$('#search').addEventListener('input',e=>{QUERY=e.target.value.trim().toLowerCase();renderList();});
async function refreshList(){
  const d=await api('conversations');
  CONVS=d.conversations||[];ONLINE=!!d.team_online;renderPresence();renderList();
}
function renderPresence(){
  $('#presence').classList.toggle('on',ONLINE);
  $('#ptext').textContent=ONLINE?"You're online":"You're offline";
}
$('#presence').onclick=async()=>{const d=await post('presence',{online:!ONLINE});ONLINE=!!d.team_online;renderPresence();};
setInterval(()=>{if(ONLINE)post('presence',{online:true});},60000);
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>{FILTER=b.dataset.f;document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('active',x===b));renderList();});

async function loadThread(){
  if(!SEL)return;
  const d=await api('conversation?id='+encodeURIComponent(SEL));
  if(d.error)return;
  const c=d.conversation;
  const escs=(d.escalations||[]).map(e=>'<div class="escnote">⚡ escalated — '+escH(e.reason||'')+'</div>').join('');
  const msgs=(d.messages||[]).map(m=>{
    const label=m.role==='user'?escH(c.user_name||'Client'):m.role==='agent'?'You':'Leo';
    const side=m.role==='user'?'':' right';
    return '<div class="mlabel'+side+'">'+label+' · '+escH(when(m.created_at))+'</div><div class="m '+escH(m.role)+'">'+escH(m.content)+'</div>';
  }).join('');
  $('#thread').innerHTML='<div class="thread-head"><div class="avatar '+avClass(c)+'">'+escH(initials(c))+'</div>'
    +'<div class="info"><div class="name">'+escH(c.user_name||c.user_email||'Visitor')+' · '+escH(c.church||'')+'</div>'
    +'<div class="sub">'+escH(c.user_email||'')+' · '+escH(c.site||'')+' · handled by '+escH(c.handled_by)+'</div></div>'
    +'<div class="actions">'
    +(c.handled_by==='team'?'<button class="btn" id="handoff">Hand back to Leo</button>':'')
    +(c.status==='resolved'?'<button class="btn" id="reopen">Reopen</button>':'<button class="btn primary" id="resolve">Resolve</button>')
    +'</div></div>'
    +'<div class="msgs" id="msgs">'+escs+msgs+'</div>'
    +'<div class="composer"><textarea id="reply" placeholder="Reply as the team… (Enter to send)"></textarea><button id="send">Send</button></div>';
  const box=$('#msgs');box.scrollTop=box.scrollHeight;
  const send=async()=>{const t=$('#reply').value.trim();if(!t)return;$('#reply').value='';await post('reply',{id:SEL,content:t});await loadThread();await refreshList();};
  $('#send').onclick=send;
  $('#reply').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}};
  const re=$('#resolve');if(re)re.onclick=async()=>{await post('status',{id:SEL,status:'resolved'});await loadThread();await refreshList();};
  const ro=$('#reopen');if(ro)ro.onclick=async()=>{await post('status',{id:SEL,status:'open'});await loadThread();await refreshList();};
  const ho=$('#handoff');if(ho)ho.onclick=async()=>{await post('handoff',{id:SEL});await loadThread();await refreshList();};
}
const THEME_KEY='rhd-theme';
const MOON='<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M21 14.4A9 9 0 1 1 9.6 3a7.2 7.2 0 1 0 11.4 11.4z"/></svg>';
const SUN='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4.4"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19"/></svg>';
function effTheme(){const s=localStorage.getItem(THEME_KEY);if(s)return s;return matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
function renderThemeBtn(){$('#theme').innerHTML=effTheme()==='dark'?SUN:MOON;}
const storedTheme=localStorage.getItem(THEME_KEY);
if(storedTheme)document.documentElement.dataset.theme=storedTheme;
renderThemeBtn();
$('#theme').onclick=()=>{const next=effTheme()==='dark'?'light':'dark';localStorage.setItem(THEME_KEY,next);document.documentElement.dataset.theme=next;renderThemeBtn();};
refreshList();
setInterval(refreshList,4000);
setInterval(()=>{if(SEL&&!document.activeElement.matches('#reply'))loadThread();},3500);
</script></body></html>`;

export async function handleAdmin(env, request, url) {
  const key = url.searchParams.get('key') || '';
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (url.pathname.startsWith('/admin/api/')) {
    return api(env, request, url);
  }
  if (url.pathname === '/admin') {
    return new Response(SHELL(key), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  return new Response('Not found', { status: 404 });
}
