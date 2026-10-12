// Shared helpers for the dashboard pages: formatting (Mexico City time), provider colors, task drawer.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TZ = 'America/Mexico_City';
const tzFmt = new Intl.DateTimeFormat('es-MX', {timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false});
const tzSec = new Intl.DateTimeFormat('es-MX', {timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false});
// "12 oct 14:00 CDMX"; accepts ISO strings or Date
function fmtT(v) {
  const d = v instanceof Date ? v : new Date(v);
  if (!v || isNaN(d)) return '–';
  const p = Object.fromEntries(tzFmt.formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day} ${p.month.replace('.', '').toLowerCase()} ${p.hour}:${p.minute} CDMX`;
}
const fmtClock = v => { const d = new Date(v); return isNaN(d) ? '' : tzSec.format(d); };
const fmtN = n => n >= 1e9 ? (n/1e9).toFixed(2)+' B' : n >= 1e6 ? (n/1e6).toFixed(2)+' M' : n >= 1e3 ? (n/1e3).toFixed(1)+' k' : String(Math.round(n || 0));
const usd = n => !n ? '$0' : '$' + (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(3));
const dur = s => s >= 3600 ? `${Math.floor(s/3600)}h ${String(Math.round(s%3600/60)).padStart(2,'0')}m` : s >= 60 ? `${Math.floor(s/60)}m ${String(s%60).padStart(2,'0')}s` : `${s}s`;
const PROVIDERS = ['glm', 'kimi', 'qwen', 'mimo', 'deepseek', 'claude'];
const provVar = p => PROVIDERS.includes(p) ? `var(--p-${p})` : 'var(--faint)';
const provDot = p => `<i class="dot" style="background:${provVar(p)}"></i>`;
const resultChip = r => r === 'pass' ? '<span class="chip ok">pass</span>' : r === 'fail' ? '<span class="chip bad">fail</span>'
  : r === 'stalled' ? '<span class="chip warn">stalled</span>' : '<span class="faint">–</span>';
const statusChip = s => s === 'done' ? '<span class="chip ok">done</span>' : s === 'in progress' ? '<span class="chip accent">in progress</span>'
  : (s || '').startsWith('waiting') ? `<span class="chip warn">${esc(s)}</span>` : s === 'blocked' ? '<span class="chip bad">blocked</span>' : `<span class="chip">${esc(s || '–')}</span>`;

function tipHandler() {
  const el = document.createElement('div'); el.id = 'tip'; document.body.appendChild(el);
  document.addEventListener('mousemove', e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { el.style.display = 'none'; return; }
    el.textContent = t.dataset.tip; el.style.display = 'block';
    el.style.left = Math.min(e.clientX + 14, innerWidth - el.offsetWidth - 8) + 'px'; el.style.top = (e.clientY + 14) + 'px';
  });
}

// ---- task drawer ----
function drawerInit() {
  document.body.insertAdjacentHTML('beforeend', '<div id="scrim"></div><aside id="drawer" role="dialog" aria-label="Task detail" aria-hidden="true"></aside>');
  $('scrim').onclick = closeTask;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTask(); });
  document.addEventListener('click', e => {
    const r = e.target.closest('[data-task]');
    if (r && !e.target.closest('button, a, summary')) openTask(r.dataset.task);
    if (e.target.closest('[data-close]')) closeTask();
  });
  document.addEventListener('keydown', e => {
    const r = e.target.closest && e.target.closest('[data-task]');
    if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTask(r.dataset.task); }
  });
}
function closeTask() { document.body.classList.remove('drawer-open'); $('drawer').setAttribute('aria-hidden', 'true'); }
async function openTask(num) {
  const dr = $('drawer');
  dr.innerHTML = `<div class="empty">Loading ${esc(num)}…</div>`;
  document.body.classList.add('drawer-open'); dr.setAttribute('aria-hidden', 'false');
  let d;
  try { const r = await fetch('/api/task?num=' + encodeURIComponent(num)); d = await r.json(); if (!r.ok) throw new Error(d.error); }
  catch (e) { dr.innerHTML = `<div class="empty"><b>Could not load task</b>${esc(e.message)}</div>`; return; }
  const t = d.totals, cl = d.runs.filter(r => r.provider === 'claude');
  const rows = d.runs.map(r => {
    const claude = r.provider === 'claude';
    const flags = [r.heavy ? '<span class="chip">heavy</span>' : '', r.resumed ? '<span class="chip">resume</span>' : '',
      !claude && r.round ? `<span class="chip warn">fix ${r.round}</span>` : ''].join('');
    return `<tr><td class="muted">${fmtT(r.start)}</td>
      <td><div class="who">${esc(r.role)} ${flags}</div>${claude && (r.description || r.agent) ? `<small>${esc(r.agent ? r.agent + ' · ' : '')}${esc(r.description)}</small>` : ''}</td>
      <td><div class="who">${provDot(r.provider)}${esc(r.provider)}</div><small>${esc(r.model)}</small></td>
      <td class="n">${dur(r.seconds)}</td><td class="n">${fmtN(r.input)}</td><td class="n">${fmtN(r.output)}</td>
      <td class="n">${fmtN(r.cacheRead + r.cacheWrite)}</td><td class="n">${usd(r.costUsd)}</td><td>${claude ? '' : resultChip(r.result)}</td></tr>`;
  }).join('');
  const ev = d.events.slice().reverse().map(e => `<tr><td class="muted">${fmtT(e.ts)}</td><td>${esc(e.event)}</td><td class="muted">${esc(e.detail || '')}</td></tr>`).join('');
  dr.innerHTML = `<header><div style="flex:1;min-width:0"><h1>${esc(d.num)} · ${esc(d.title || 'untitled')}</h1>
      <div class="row meta">${statusChip(d.status)}${d.stage ? `<span class="chip">stage ${esc(d.stage)}</span>` : ''}${d.fixRounds ? `<span class="chip warn">${d.fixRounds} fix round${d.fixRounds > 1 ? 's' : ''}</span>` : ''}</div></div>
      <button class="ghost" data-close aria-label="Close">Close</button></header>
    <div class="minis"><div class="mini"><div class="l">Runs</div><div class="v">${t.runs}</div></div>
      <div class="mini"><div class="l">Tokens</div><div class="v">${fmtN(t.total)}</div></div>
      <div class="mini"><div class="l">Active time</div><div class="v">${dur(t.seconds)}</div></div>
      <div class="mini"><div class="l">Est. cost</div><div class="v">${usd(t.costUsd)}</div></div></div>
    <h2>Who worked on it <span class="note">${d.runs.length - cl.length} worker runs · ${cl.length} Claude planner</span></h2>
    ${d.runs.length ? `<div class="scroll"><table><thead><tr><th>Start</th><th>Role</th><th>Provider</th><th class="n">Time</th><th class="n">In</th><th class="n">Out</th><th class="n">Cache</th><th class="n">Est. $</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div class="empty"><b>No runs yet</b>Nothing has worked on this task.</div>'}
    ${ev ? `<h2 style="margin-top:24px">Events</h2><div class="scroll" style="max-height:240px"><table><tbody>${ev}</tbody></table></div>` : ''}`;
  dr.scrollTop = 0;
}
document.addEventListener('DOMContentLoaded', () => { tipHandler(); drawerInit(); });
