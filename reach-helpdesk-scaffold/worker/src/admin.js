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
<style>
  :root{--leo:#69af95;--leo-deep:#4c8b73;--leo-soft:#eaf4f0;--ink:#2b2b2b;--muted:#71847c;
        --paper:#f7f7f7;--card:#ffffff;--line:#e3e8e5;--danger:#b3554a;--amber:#b07a33;--amber-soft:#f6edde}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--paper);color:var(--ink);font-size:14px}
  .topbar{display:flex;align-items:center;gap:14px;background:var(--ink);color:#fff;padding:10px 18px}
  .topbar .logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--leo),var(--leo-deep));display:grid;place-items:center;font-weight:800;color:#fff}
  .topbar h1{font-size:15px;font-weight:600;margin:0;flex:1}
  .presence{display:flex;align-items:center;gap:8px;font-size:13px;color:#cfd8d3;cursor:pointer;user-select:none}
  .presence .track{width:38px;height:22px;border-radius:99px;background:#4a5550;position:relative;transition:background .15s}
  .presence .knob{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s}
  .presence.on .track{background:var(--leo)}
  .presence.on .knob{left:19px}
  .layout{display:grid;grid-template-columns:340px 1fr;height:calc(100vh - 48px)}
  .list{border-right:1px solid var(--line);background:var(--card);display:flex;flex-direction:column;min-width:0}
  .tabs{display:flex;gap:4px;padding:10px 12px;border-bottom:1px solid var(--line)}
  .tabs button{border:none;background:none;padding:6px 10px;border-radius:99px;cursor:pointer;font-size:12.5px;color:var(--muted);font-weight:600}
  .tabs button.active{background:var(--leo-soft);color:var(--leo-deep)}
  .rows{overflow-y:auto;flex:1}
  .row{display:flex;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line);cursor:pointer;align-items:flex-start}
  .row:hover{background:#fafcfb}
  .row.sel{background:var(--leo-soft)}
  .avatar{width:34px;height:34px;border-radius:50%;background:var(--leo-deep);color:#fff;display:grid;place-items:center;font-weight:700;font-size:13px;flex-shrink:0}
  .row .body{min-width:0;flex:1}
  .row .top{display:flex;align-items:baseline;gap:8px}
  .row .who{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .row time{margin-left:auto;font-size:11px;color:var(--muted);white-space:nowrap}
  .row .snippet{color:var(--muted);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
  .row .church{font-size:11.5px;color:var(--leo-deep);font-weight:600}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--leo);flex-shrink:0;margin-top:6px;visibility:hidden}
  .row.unread .dot{visibility:visible}
  .row.unread .snippet{color:var(--ink);font-weight:600}
  .pill{font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:99px}
  .pill.open{background:var(--leo-soft);color:var(--leo-deep)}
  .pill.escalated{background:var(--amber-soft);color:var(--amber)}
  .pill.resolved{background:#eef0ef;color:var(--muted)}
  .pill.leo{background:#eef7f3;color:var(--leo-deep)}
  .pill.team{background:#2b2b2b;color:#fff}
  .thread{display:flex;flex-direction:column;min-width:0}
  .thread-head{display:flex;align-items:center;gap:12px;padding:12px 18px;background:var(--card);border-bottom:1px solid var(--line)}
  .thread-head .info{flex:1;min-width:0}
  .thread-head .name{font-weight:700}
  .thread-head .sub{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .actions{display:flex;gap:8px}
  .btn{border:1px solid var(--line);background:var(--card);border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:600;cursor:pointer;color:var(--ink)}
  .btn:hover{border-color:var(--leo)}
  .btn.primary{background:var(--leo-deep);border-color:var(--leo-deep);color:#fff}
  .msgs{flex:1;overflow-y:auto;padding:20px 24px;display:flex;flex-direction:column;gap:4px}
  .m{max-width:66%;padding:9px 13px;border-radius:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}
  .m.user{align-self:flex-start;background:var(--card);border:1px solid var(--line);border-bottom-left-radius:4px}
  .m.assistant{align-self:flex-end;background:var(--leo-soft);border-bottom-right-radius:4px}
  .m.agent{align-self:flex-end;background:var(--leo-deep);color:#fff;border-bottom-right-radius:4px}
  .mlabel{font-size:10.5px;color:var(--muted);margin:8px 0 2px;font-weight:600}
  .mlabel.right{align-self:flex-end}
  .escnote{align-self:center;background:var(--amber-soft);color:var(--amber);font-size:12px;padding:6px 12px;border-radius:99px;margin:8px 0}
  .composer{display:flex;gap:10px;padding:14px 18px;background:var(--card);border-top:1px solid var(--line)}
  .composer textarea{flex:1;resize:none;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:inherit;min-height:44px;max-height:120px;outline:none}
  .composer textarea:focus{border-color:var(--leo)}
  .composer button{background:var(--leo-deep);color:#fff;border:none;border-radius:10px;padding:0 18px;font-weight:700;cursor:pointer}
  .empty{display:grid;place-items:center;color:var(--muted);height:100%;font-size:13px}
  @media (max-width:860px){.layout{grid-template-columns:1fr}.thread{display:none}.layout.viewing .list{display:none}.layout.viewing .thread{display:flex}}
</style></head><body>
<div class="topbar">
  <div class="logo">L</div><h1>Reach Helpdesk</h1>
  <div class="presence" id="presence"><span id="ptext">You're offline</span><span class="track"><span class="knob"></span></span></div>
</div>
<div class="layout" id="layout">
  <div class="list">
    <div class="tabs" id="tabs">
      <button data-f="open" class="active">Open</button><button data-f="escalated">Escalated</button>
      <button data-f="resolved">Resolved</button><button data-f="all">All</button>
    </div>
    <div class="rows" id="rows"></div>
  </div>
  <div class="thread" id="thread"><div class="empty">Select a conversation</div></div>
</div>
<script>
const KEY=${JSON.stringify(key)};
let FILTER='open', SEL=null, ONLINE=false, CONVS=[];
const $=s=>document.querySelector(s);
const escH=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=(p,opts)=>fetch('/admin/api/'+p+(p.includes('?')?'&':'?')+'key='+encodeURIComponent(KEY),opts).then(r=>r.json());
const post=(p,body)=>api(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const initials=c=>((c.user_name||c.user_email||'?').trim()[0]||'?').toUpperCase();
const when=t=>t?t.replace(/^\\d{4}-/,'').slice(0,11):'';

function renderList(){
  const rows=CONVS.filter(c=>FILTER==='all'?true:c.status===FILTER);
  $('#rows').innerHTML=rows.map(c=>{
    const unread=(c.last_id||0)>(c.agent_last_read_id||0);
    return '<div class="row'+(c.id===SEL?' sel':'')+(unread?' unread':'')+'" data-id="'+escH(c.id)+'">'
      +'<span class="dot"></span><div class="avatar">'+escH(initials(c))+'</div>'
      +'<div class="body"><div class="top"><span class="who">'+escH(c.user_name||c.user_email||'Visitor')+'</span>'
      +'<span class="pill '+escH(c.status)+'">'+escH(c.status)+'</span>'
      +(c.handled_by==='team'?'<span class="pill team">you</span>':'<span class="pill leo">leo</span>')
      +'<time>'+escH(when(c.last_at))+'</time></div>'
      +'<div class="church">'+escH(c.church||c.site||'')+'</div>'
      +'<div class="snippet">'+escH(c.last_snippet||'')+'</div></div></div>';
  }).join('')||'<div class="empty" style="height:120px">Nothing here</div>';
  document.querySelectorAll('.row').forEach(r=>r.onclick=()=>{SEL=r.dataset.id;$('#layout').classList.add('viewing');loadThread();renderList();});
}
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
  $('#thread').innerHTML='<div class="thread-head"><div class="avatar">'+escH(initials(c))+'</div>'
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
