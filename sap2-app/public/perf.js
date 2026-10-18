/* SAP2 · Administrative Staff Performance & Accountability — front end.
   Every number shown here is calculated by the server (/api/admin/*). This file only displays and collects input. */
(function () {
  'use strict';
  const X = { c: {}, p: {}, tab: 'dash', pm: TODAY.slice(0, 7), st: '', stf: '', off: '', rtype: 'monthly-performance', rep: null, sp: null };
  const A = (p, o) => api('/admin' + p, o);
  const e = esc, num = v => (v === null || v === undefined || v === '' ? null : Number(v));
  const pc = v => (v === null || v === undefined ? '—' : (Math.round(v * 10) / 10) + '%');
  const V = id => { const x = document.getElementById(id); return x ? x.value : '' };
  const VC = id => { const x = document.getElementById(id); return !!(x && x.checked) };
  const mPlus = (m, d) => { const [y, mm] = m.split('-').map(Number), x = new Date(Date.UTC(y, mm - 1 + d, 1)); return x.toISOString().slice(0, 7) };
  const label = s => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());

  /* ---- tiny cache: views are synchronous; data loads once, then render() runs again ---- */
  function need(key, fn) {
    if (X.c[key] !== undefined) return X.c[key];
    if (!X.p[key]) X.p[key] = fn().then(v => { X.c[key] = v }).catch(err => { X.c[key] = { __error: err.message } }).then(() => { delete X.p[key]; render() });
    return undefined;
  }
  const inv = () => { X.c = {}; render() };
  const bad = d => d && d.__error;
  const loading = () => '<div class="p">Loading…</div>';
  const errBox = d => `<div class="fm" style="border-color:var(--rd);color:var(--rd)">${e(d.__error)}</div>`;
  let ATT = true; // staff attendance tracking (Settings > Staff attendance). Off when staff work remotely.
  async function flags() { if (window.SP || typeof KEY === 'undefined' || !KEY || X.flagsFor === KEY) return; X.flagsFor = KEY; try { const d = await A('/settings'); const on = d.settings.attendance_enabled !== false; if (on !== ATT) { ATT = on; render() } } catch (err) { X.flagsFor = null } }
  async function act(fn, ok, after) {
    try { const r = await fn(); if (ok) toast(ok); if (after !== false) { X.c = {}; if (after) after(r); render(); } return r } catch (err) { toast(err.message, 1) }
  }
  const staffList = () => need('staff', () => A(window.SP ? '/directory' : '/staff'));
  const officeList = () => need('offices', () => A('/offices'));

  /* ---- shared ui bits ---- */
  const bandCls = k => ({ EXCELLENT: 'sbE', STRONG: 'sbS', MODERATE: 'sbM', NEEDS_IMPROVEMENT: 'sbN', CRITICAL: 'sbC' }[k] || 'sbD');
  const bandBadge = (r) => `<span class="b ${bandCls(r.band)}">${e(r.band_label || label(r.band))} · ${pc(r.final_score)}</span>`;
  const barCls = s => (s === null || s === undefined ? '' : s >= 70 ? 'g' : s >= 30 ? 'a' : 'r');
  const bar = s => `<div class="pf-bar ${barCls(s)}" title="${pc(s)}"><i style="width:${Math.max(0, Math.min(100, s || 0))}%"></i></div>`;
  const payTxt = r => r.state === 'NONE' || r.payment_percentage === undefined ? '—' : `${r.payment_percentage}% · ${fmt(r.recommended_pay)}`;
  const payBadge = r => {
    const p = r.payment_percentage; const cls = p >= 100 ? 'sbS' : p > 0 ? 'sbN' : 'sbC';
    const t = p >= 100 ? 'Full pay' : p > 0 ? `${p}% pay` : 'No pay';
    return `<span class="b ${cls}">${t}</span>`;
  };
  const stateBadge = s => ({ LIVE: '<span class="b Pending">Live (draft)</span>', DRAFT: '<span class="b Pending">Draft</span>', FINALIZED: '<span class="b Present">Finalized</span>', CLOSED: '<span class="b sbD">Closed</span>' }[s] || `<span class="b sbD">${e(s || '—')}</span>`);
  const statusBadge = s => {
    const m = { TODO: 'sbD', IN_PROGRESS: 'sbM', SUBMITTED: 'sbN', VERIFIED: 'sbS', COMPLETED: 'sbS', OVERDUE: 'sbC', CANCELLED: 'sbD', APPROVED: 'sbS', REJECTED: 'sbC', DRAFT: 'sbD', EXPECTED: 'sbD', PRESENT: 'sbS', LATE: 'sbN', ABSENT: 'sbC', EXCUSED: 'sbM', OFFICIAL_ASSIGNMENT: 'sbM', PENDING: 'sbD', REVIEWED: 'sbS', FLAGGED: 'sbC', UNREVIEWED: 'sbD', OPEN: 'sbS', CLOSED: 'sbD' };
    return `<span class="b ${m[s] || 'sbD'}">${e(label(s))}</span>`;
  };
  const tbl = (head, rows, empty, cls) => `<div class="tw ${cls || ''}"><table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.join('') || `<tr><td colspan="${head.length}" class="l">${empty || 'Nothing to show.'}</td></tr>`}</table></div>`;
  const mnav = () => `<div class="row pf-noprint"><button class="btn" onclick="PF.mv(-1)">←</button><input type="month" value="${X.pm}" onchange="PF.setM(this.value)" style="width:160px"><button class="btn" onclick="PF.mv(1)">→</button><span class="pf-mu">Performance month</span></div>`;
  const fg = (id, lbl, html) => `<label for="${id}">${lbl}</label><div>${html}</div>`;
  const inp = (id, v, extra) => `<input id="${id}" value="${e(v == null ? '' : v)}" ${extra || ''}>`;
  const selx = (id, opts, cur) => `<select id="${id}">${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${e(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${e(l)}</option>` }).join('')}</select>`;
  const MW = h => { M(h); $('mc').classList.add('wide') };
  const _mcl = window.mcl; window.mcl = function () { $('mc').classList.remove('wide'); _mcl() };
  const sbtn = (txt, fn, cls) => `<button class="btn ${cls || ''}" onclick="${fn}">${txt}</button>`;
  const mfoot = (ok, okfn, extra) => `<div class="row" style="margin:16px 0 0;justify-content:flex-end">${extra || ''}<button class="btn" onclick="mcl()">Cancel</button><button class="btn pr" onclick="${okfn}">${ok}</button></div>`;
  const reqReason = (id, why) => fg(id, 'Reason' + (why ? ' *' : ''), `<textarea id="${id}" placeholder="${why || 'Why is this change needed?'}"></textarea>`);

  /* ======================================================= DASHBOARD ======================================================= */
  function pfDash() {
    const d = need('dash:' + X.pm, () => A('/dashboard?month=' + X.pm)); if (!d) return loading(); if (bad(d)) return errBox(d);
    const t = d.tasks;
    const tiles = [
      ['Administrative staff', d.staff_count], ['Average score', pc(d.average_score), 1], ['Tasks completed', t.completed], ['Tasks pending', t.pending], ['Overdue tasks', t.overdue], ['Awaiting verification', t.awaiting_verification],
      ...(ATT ? [['Attendance rate', pc(d.attendance_rate)]] : []), ['Reports submitted', d.reports.submitted], ['Reports missing', d.reports.missing], ['Below payment line', d.below_30], ['On 50% pay', d.on_half_pay], ['Full pay', d.full_pay]
    ];
    const exit = (d.exit_review || []).length ? `<div class="pf-exit"><b>EXIT / MANAGEMENT REVIEW REQUIRED</b><div class="pf-sub" style="margin:4px 0 8px">Score below the line for consecutive months. This is a flag only: nothing is changed automatically, management decides.</div>${d.exit_review.map(r => `<div><button class="pf-link" onclick="PF.prof(${r.staff_id})">${e(r.name)}</button> <span class="pf-mu">${e(r.office || '')}</span> ${r.label ? '· ' + e(r.label) : ''}</div>`).join('')}</div>` : '';
    const need0 = (d.needs_office || []).length ? `<div class="fm">${d.needs_office.length} administrative staff member(s) have no office yet, so their score cannot be fully calculated: ${d.needs_office.map(s => `<button class="pf-link" onclick="PF.assignOffice(${s.id})">${e(s.name)} (${e(s.role || '')})</button>`).join(', ')}</div>` : '';
    const alerts = (d.attention || []).length ? (d.attention.map(a => `<div class="pf-alert ${a.severity}"><div><b>${e(label(a.severity))}</b> · ${e(a.message)}</div><button class="btn" onclick="PF.ack(${a.id})">Acknowledge</button></div>`).join('')) : '<div class="l">Nothing needs attention right now.</div>';
    return `${mnav()}${need0}${exit}
<div class="pf-grid">${tiles.map(([l, v, h]) => stat(l, v, h)).join('')}</div>
<h2 class="pf-h">Attention required</h2>${alerts}
<h2 class="pf-h">Ranking</h2>${scoreTable(d.ranking.map(r => r), true)}`;
  }
  function scoreTable(rows, mini) {
    if (mini) return tbl(['#', 'Staff', 'Office', 'Score', 'Band'], rows.map(r => `<tr class="pf-sel" onclick="PF.prof(${r.staff_id})"><td>${r.rank}</td><td><b>${e(r.name)}</b></td><td>${e(r.office || '—')}</td><td>${pc(r.final_score)}</td><td>${bandBadge(r)}</td></tr>`), 'No administrative staff.');
    return tbl(['Rank', 'Staff', 'Office', 'Task', 'KPI', ...(ATT ? ['Attendance'] : []), 'Reports', 'Productivity', 'Teamwork', 'TOTAL', 'Payment', 'Status'],
      rows.map(r => `<tr class="pf-sel" onclick="PF.prof(${r.staff_id})"><td>${r.rank}</td><td><b>${e(r.name)}</b>${r.exit_review_required ? ' <span class="b sbC">EXIT REVIEW</span>' : ''}</td><td>${e(r.office || '—')}</td><td>${pc(r.task)}</td><td>${pc(r.kpi)}</td>${ATT ? `<td>${pc(r.attendance)}</td>` : ''}<td>${pc(r.reports)}</td><td>${pc(r.productivity)}</td><td>${pc(r.teamwork)}</td>
<td><b>${pc(r.final_score)}</b>${bar(r.final_score)}</td><td>${payBadge(r)}<div class="pf-note">${fmt(r.recommended_pay)} of ${fmt(r.salary)}</div></td><td>${bandBadge(r)}<div>${stateBadge(r.state)}${r.incomplete ? ' <span class="b sbN" title="Some components have no data yet">Incomplete</span>' : ''}</div></td></tr>`), 'No administrative staff.', 'pf-tbl-small');
  }
  function pfScore() {
    const d = need('score:' + X.pm + ':' + X.off, () => A('/performance?month=' + X.pm + (X.off ? '&office_id=' + X.off : ''))); if (!d) return loading(); if (bad(d)) return errBox(d);
    const o = officeList();
    return `${mnav()}<div class="row pf-noprint"><select onchange="X_off(this.value)"><option value="">All offices</option>${(o && !bad(o) ? o : []).map(x => `<option value="${x.id}" ${String(X.off) === String(x.id) ? 'selected' : ''}>${e(x.name)}</option>`).join('')}</select>
<button class="btn" onclick="PF.calcAll()">Recalculate all</button><button class="btn" onclick="window.print()">Print</button></div>
<div class="pf-sub">Month status: ${statusBadge(d.month_status)} · Scores are calculated on the server from weights set in Settings. Click a row for the full breakdown.</div>
${scoreTable(d.rows)}`;
  }
  window.X_off = v => { X.off = v; render() };

  /* ======================================================= STAFF PROFILE ======================================================= */
  const COMP_LABEL = { task: 'Task completion', kpi: 'Office KPI performance', attendance: 'Attendance & punctuality', reports: 'Weekly reports & documentation', productivity: 'Productivity / deliverables', teamwork: 'Teamwork & professionalism' };
  const detTxt = c => {
    const d = c.details || {}; const o = [];
    Object.keys(d).forEach(k => { const v = d[k]; if (v !== null && typeof v !== 'object' && o.length < 7) o.push(label(k) + ': ' + (/rate/.test(k) ? pc(v) : v)); });
    return o.join(' · ');
  };
  function trendSvg(tr) {
    const W = 560, H = 150, px = 34, py = 14, n = tr.length; const x = i => px + i * ((W - px - 14) / Math.max(1, n - 1)), y = s => H - 22 - (s / 100) * (H - 22 - py);
    let g = [0, 30, 50, 70, 100].map(v => `<line class="${v === 30 ? 'th' : 'gl'}" x1="${px}" x2="${W - 10}" y1="${y(v)}" y2="${y(v)}"/><text x="4" y="${y(v) + 3}">${v}</text>`).join('');
    const pts = tr.map((p, i) => p.score === null ? null : [x(i), y(p.score), p]).filter(Boolean);
    const path = pts.length > 1 ? `<polyline class="ln" points="${pts.map(p => p[0] + ',' + p[1]).join(' ')}"/>` : '';
    const dots = pts.map(p => `<circle class="dt" cx="${p[0]}" cy="${p[1]}" r="4"><title>${p[2].month}: ${pc(p[2].score)}${p[2].source === 'live' ? ' (live)' : ''}</title></circle><text x="${p[0] - 10}" y="${p[1] - 8}">${Math.round(p[2].score)}</text>`).join('');
    const lbl = tr.map((p, i) => `<text x="${x(i) - 14}" y="${H - 6}">${p.month.slice(2)}</text>`).join('');
    return `<svg class="pf-trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score trend">${g}${path}${dots}${lbl}</svg>`;
  }
  async function prof(id) {
    let d; try { d = await A(`/performance/${id}?month=${X.pm}`) } catch (err) { return toast(err.message, 1) }
    const cl = d.calc, s = d.staff, p = d.payroll || {}, st = d.state, locked = st === 'CLOSED';
    const exit = cl.exit_review_required ? `<div class="pf-exit"><b>EXIT / MANAGEMENT REVIEW REQUIRED</b> — ${e(cl.exit_review_label || '')}<div class="pf-note">No automatic action is taken. Record a decision below.</div></div>` : '';
    const warn = (cl.data_quality && cl.data_quality.warnings || []).length ? `<div class="fm">Data check: ${cl.data_quality.warnings.map(e).join(' ')}</div>` : '';
    const comps = tbl(['Component', 'Weight', 'Score', 'Effective weight', 'Points', 'What was counted', ''], cl.components.filter(c => !c.hidden).map(c => `<tr><td><b>${COMP_LABEL[c.component] || e(c.label)}</b></td><td>${c.weight}%</td>
<td>${c.raw_score === null ? '<span class="pf-mu">No data</span>' : pc(c.raw_score * 100)}${c.overridden ? ` <span class="b sbN" title="${e(c.override && c.override.reason || '')}">Adjusted (was ${pc(c.system_score * 100)})</span>` : ''}</td><td>${pc(c.effective_weight)}</td><td>${c.points === null ? '—' : (Math.round(c.points * 10) / 10)}</td><td class="pf-det wrap">${e(detTxt(c))}</td>
<td>${locked || st === 'FINALIZED' ? '' : c.component === 'teamwork' ? `<button class="btn" onclick="PF.teamwork(${id})">Rate</button>` : `<button class="btn" onclick="PF.adjust(${id},'${c.component}')">Adjust</button>`}</td></tr>`), '', 'pf-tbl-small');
    const hist = tbl(['Month', 'Score', 'Band', 'Recommended', 'Approved', 'Finalized by'], (d.history || []).map(h => `<tr><td>${h.month}</td><td>${pc(h.final_score)}</td><td>${e(label(h.band))}</td><td>${fmt(h.recommended_pay)}</td><td>${h.approved_pay == null ? '—' : fmt(h.approved_pay)}</td><td>${e(h.created_by || '')}</td></tr>`), 'No finalized months yet.', 'pf-tbl-small');
    const cm = (d.comments || []).map(c => `<div class="pf-alert ${c.kind === 'WARNING' ? 'WARNING' : 'INFO'}"><div><b>${e(label(c.kind))}${c.decision ? ' · ' + e(label(c.decision)) : ''}</b> ${c.month ? '(' + c.month + ')' : ''} — ${e(c.text)}<div class="pf-note">${e(c.author || '')} · ${String(c.created_at || '').slice(0, 10)}</div></div></div>`).join('') || '<div class="l">No comments yet.</div>';
    const au = tbl(['When', 'Who', 'Action', 'Change', 'Reason'], (d.audit || []).slice(0, 25).map(a => `<tr><td>${String(a.created_at || '').slice(0, 16).replace('T', ' ')}</td><td>${e(a.actor)}</td><td>${e(label(a.action))}</td><td class="wrap pf-det">${e(a.old_value ? JSON.stringify(a.old_value) : '')}${a.old_value && a.new_value ? ' → ' : ''}${e(a.new_value ? JSON.stringify(a.new_value) : '')}</td><td class="wrap pf-det">${e(a.reason || '')}</td></tr>`), 'No changes recorded.', 'pf-tbl-small');
    const canFin = !locked && st !== 'FINALIZED', canReopen = st === 'FINALIZED';
    const canApprove = st === 'FINALIZED' && p.approved_pay == null;
    MW(`<div class="row" style="justify-content:space-between;margin:0"><div><h2 style="font-size:28px">${e(s.name)}</h2><div class="l">${e(s.role || '')} · ${e(s.office || 'No office assigned')} · ${X.pm} · ${stateBadge(st)}</div></div><button class="btn" onclick="mcl()">Close</button></div>
${exit}${warn}
<div class="pf-2" style="margin:12px 0"><div class="c"><div class="l">Performance score</div><div class="pf-big">${pc(cl.final_score)}</div>${cl.month_progress_pct < 100 ? `<div class="pf-note">Month in progress: ${cl.weeks_elapsed} of ${cl.weeks_in_month} weeks counted (each week is worth ${Math.round(100 / cl.weeks_in_month)}%). Quality so far: ${pc(cl.pace_score)}.</div>` : ''}<div style="margin:6px 0">${bandBadge({ band: cl.performance_band, band_label: cl.band_label, final_score: cl.final_score })} ${payBadge({ payment_percentage: cl.payment_percentage })}</div>${bar(cl.final_score)}</div>
<div class="c"><div class="l">Payroll position</div><dl style="margin-top:6px;grid-template-columns:150px 1fr"><dt>Base salary</dt><dd>${fmt(p.base_salary)}</dd><dt>Recommended pay</dt><dd><b style="color:var(--or)">${fmt(cl.recommended_payment)}</b> (${cl.payment_percentage}%)</dd><dt>Management-approved</dt><dd>${p.approved_pay == null ? '<span class="pf-warn">Not approved yet</span>' : fmt(p.approved_pay)}</dd><dt>Actual paid</dt><dd>${p.actual_paid == null ? '—' : fmt(p.actual_paid)}</dd></dl></div></div>
<div class="row pf-noprint">${canFin ? sbtn('Recalculate', `PF.recalc(${id})`) + sbtn('Finalize score', `PF.finalize(${id})`, 'pr') : ''}${canReopen ? sbtn('Reopen review', `PF.reopenRv(${id})`) : ''}${canApprove ? sbtn('Approve payroll', `PF.approve(${id})`, 'pr') : ''}${sbtn('Warning / comment', `PF.comment(${id})`)}${cl.exit_review_required ? sbtn('Record decision', `PF.decision(${id})`) : ''}${sbtn('Print', 'window.print()')}</div>
<h2 class="pf-h">Score breakdown</h2>${comps}
<div class="pf-2"><div><h2 class="pf-h">Trend (last 6 months)</h2><div class="c">${trendSvg(d.trend)}<div class="pf-note">Dashed line = payment threshold (30).</div></div></div>
<div><h2 class="pf-h">Office responsibilities</h2><div class="c" style="max-height:220px;overflow:auto"><ul style="margin:0;padding-left:18px">${(d.responsibilities || []).map(r => `<li style="margin:3px 0">${e(r)}</li>`).join('') || '<li class="l">No office assigned.</li>'}</ul></div></div></div>
<h2 class="pf-h">Comments, warnings & decisions</h2>${cm}
<h2 class="pf-h">Monthly history (locked snapshots)</h2>${hist}
<h2 class="pf-h">Audit trail</h2>${au}`);
  }
  const reload = id => async () => { X.c = {}; await prof(id); render() };
  async function recalc(id) { await act(() => A(`/performance/${id}/calculate`, { method: 'POST', body: { month: X.pm } }), 'Recalculated', false); reload(id)() }
  async function finalize(id, ack) {
    try { await A(`/performance/${id}/finalize`, { method: 'POST', body: { month: X.pm, acknowledge_incomplete: !!ack } }); toast('Score finalized and snapshot saved'); reload(id)() }
    catch (err) {
      if (/incomplete/i.test(err.message) && !ack) { if (confirm(err.message + '\n\nFinalize with the data that exists?')) return finalize(id, true); } else toast(err.message, 1)
    }
  }
  function reopenRv(id) { M(`<h2 style="font-size:24px">Reopen review</h2><p class="l">The finalized score returns to a live draft. The earlier snapshot stays in the audit history.</p>${reqReason('rr', 'Required')}${mfoot('Reopen', `PF.doReopen(${id})`)}`) }
  async function doReopen(id) { try { await A(`/performance/${id}/reopen`, { method: 'POST', body: { month: X.pm, reason: V('rr') } }); mcl(); toast('Review reopened'); reload(id)() } catch (err) { toast(err.message, 1) } }
  function adjust(id, comp) {
    M(`<h2 style="font-size:24px">Adjust ${COMP_LABEL[comp]}</h2><p class="l">Replace the system-calculated score (0–100). Leave blank to remove an existing adjustment. Every adjustment is recorded with your reason.</p><div class="pf-fg">${fg('av', 'New score (0–100)', inp('av', '', 'type="number" min="0" max="100"'))}${reqReason('ar', 'Required')}</div>${mfoot('Save adjustment', `PF.doAdjust(${id},'${comp}')`)}`);
  }
  async function doAdjust(id, comp) { try { await A(`/performance/${id}/adjust`, { method: 'POST', body: { month: X.pm, component: comp, value: num(V('av')), reason: V('ar') } }); mcl(); toast('Adjustment saved'); reload(id)() } catch (err) { toast(err.message, 1) } }
  function teamwork(id) {
    M(`<h2 style="font-size:24px">Teamwork & professionalism</h2><p class="l">Rate 0–10 (cooperation, communication, professionalism). This is a management judgement and is optional.</p><div class="pf-fg">${fg('tr', 'Rating (0–10)', inp('tr', '', 'type="number" min="0" max="10" step="0.5"'))}${fg('tc', 'Comment', '<textarea id="tc"></textarea>')}${reqReason('trs', '(needed only when changing an existing rating)')}</div>${mfoot('Save rating', `PF.doTeamwork(${id})`)}`);
  }
  async function doTeamwork(id) { try { await A(`/performance/${id}/teamwork`, { method: 'PUT', body: { month: X.pm, rating: num(V('tr')), comment: V('tc'), reason: V('trs') } }); mcl(); toast('Rating saved'); reload(id)() } catch (err) { toast(err.message, 1) } }
  function comment(id) {
    M(`<h2 style="font-size:24px">Comment / warning</h2><div class="pf-fg">${fg('ck', 'Type', selx('ck', [['COMMENT', 'Comment'], ['WARNING', 'Warning'], ['REVIEW_NOTE', 'Review note']], 'COMMENT'))}${fg('ct', 'Text', '<textarea id="ct"></textarea>')}</div>${mfoot('Save', `PF.doComment(${id})`)}`);
  }
  async function doComment(id) { try { await A(`/performance/${id}/comments`, { method: 'POST', body: { month: X.pm, kind: V('ck'), text: V('ct') } }); mcl(); toast('Saved'); reload(id)() } catch (err) { toast(err.message, 1) } }
  function decision(id) {
    M(`<h2 style="font-size:24px">Management decision</h2><p class="l">Recorded for the file. SAP2 never removes or deactivates staff automatically.</p><div class="pf-fg">${fg('dd', 'Decision', selx('dd', [['RETAIN', 'Retain'], ['IMPROVEMENT_PLAN', 'Improvement plan'], ['EXIT', 'Proceed with exit process']], 'IMPROVEMENT_PLAN'))}${reqReason('dr', 'Required')}</div>${mfoot('Record decision', `PF.doDecision(${id})`)}`);
  }
  async function doDecision(id) { try { await A(`/performance/${id}/decision`, { method: 'POST', body: { month: X.pm, decision: V('dd'), reason: V('dr') } }); mcl(); toast('Decision recorded'); reload(id)() } catch (err) { toast(err.message, 1) } }
  async function approve(id) {
    let d; try { d = await A(`/performance/${id}?month=${X.pm}`) } catch (err) { return toast(err.message, 1) }
    const rec = d.calc.recommended_payment, base = d.payroll.base_salary;
    M(`<h2 style="font-size:24px">Approve payroll</h2><p class="l">Approving does NOT pay anyone. It releases this amount to the Payroll page, where it is paid in the normal way.</p><dl><dt>Staff</dt><dd>${e(d.staff.name)}</dd><dt>Base salary</dt><dd>${fmt(base)}</dd><dt>Score</dt><dd>${pc(d.calc.final_score)}</dd><dt>Recommended</dt><dd><b>${fmt(rec)}</b></dd></dl>
<div class="pf-fg">${fg('ap', 'Approved amount (₦)', inp('ap', rec, 'type="number" min="0" max="' + base + '"'))}${reqReason('apr', '(required only if different from the recommendation)')}</div>${mfoot('Approve', `PF.doApprove([{staff_id:${id}}],${id})`)}`);
    window.__apBase = id;
  }
  async function doApprove(items, id) {
    if (id && $('ap')) items = [{ staff_id: id, approved_pay: num(V('ap')), reason: V('apr') }];
    try { await A('/payroll/approve', { method: 'POST', body: { month: X.pm, items } }); mcl(); toast('Payroll approved'); await refreshPay(); if (id) reload(id)(); else inv() } catch (err) { toast(err.message, 1) }
  }
  async function refreshPay() { try { PR = await api('/payroll?month=' + X.pm) } catch (err) { } }

  async function calcAll() { await act(() => A('/performance/calculate-all', { method: 'POST', body: { month: X.pm } }), 'All scores recalculated') }
  async function ack(id) { await act(() => A(`/alerts/${id}/ack`, { method: 'POST', body: {} }), 'Acknowledged') }
  function assignOffice(id) {
    const st = staffList(), of = officeList(); if (!st || !of || bad(st) || bad(of)) return toast('Still loading, try again', 1);
    const s = st.find(x => x.id === id) || {};
    M(`<h2 style="font-size:24px">Assign office</h2><p class="l">${e(s.name || '')} — role on file: <b>${e(s.role || '—')}</b>${s.suggested_office ? `<br>Suggested from the role: <b>${e(s.suggested_office)}</b> (a suggestion only, confirm below).` : ''}</p><div class="pf-fg">${fg('so', 'Office', selx('so', of.map(o => [o.id, o.name]), s.suggested_office_id || ''))}</div>${mfoot('Assign', `PF.doOffice(${id})`)}`);
  }
  async function doOffice(id) { try { await A(`/staff/${id}/office`, { method: 'POST', body: { office_id: +V('so') } }); mcl(); toast('Office assigned'); inv() } catch (err) { toast(err.message, 1) } }

  /* ======================================================= OFFICES / CLOSING / SETTINGS ======================================================= */
  function pfOffices() {
    const o = officeList(); if (!o) return loading(); if (bad(o)) return errBox(o);
    return `${mnav()}<div class="pf-sub">Seven offices from the Operations Manual. Responsibilities and KPIs are editable; changes are recorded in the audit trail.</div>
<div class="gr" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">${o.map(x => `<div class="c pf-sel" onclick="PF.office(${x.id})"><h2 style="font-size:22px;color:var(--or)">${e(x.name)}</h2><div class="l wrap" style="margin:4px 0 8px">${e((x.purpose || '').slice(0, 130))}${(x.purpose || '').length > 130 ? '…' : ''}</div><div>${(x.staff || []).map(s => `<span class="b sbD" style="margin-right:4px">${e(s.name)}</span>`).join('') || '<span class="l">No staff assigned</span>'}</div><div class="pf-note" style="margin-top:6px">${x.kpi_count} KPIs</div></div>`).join('')}</div>`;
  }
  async function office(id) {
    let d, dash; try { [d, dash] = await Promise.all([A('/offices/' + id), A(`/offices/${id}/dashboard?month=${X.pm}`)]) } catch (err) { return toast(err.message, 1) }
    const k = d.kpis.map(x => `<tr><td class="wrap"><b>${e(x.name)}</b>${x.auto_source ? `<div class="pf-note">Auto: ${e(label(x.auto_source))}</div>` : ''}</td><td>${e(label(x.measurement_type))}</td><td>${x.target == null ? '—' : x.target}</td><td>${x.weight}</td><td>${e(label(x.frequency))}</td><td>${x.active ? bd('Active') : bd('Off', 'sbD')}</td><td><button class="btn" onclick="PF.editKpi(${x.id},${id})">Edit</button></td></tr>`);
    MW(`<div class="row" style="justify-content:space-between;margin:0"><div><h2 style="font-size:28px">${e(d.name)}</h2><div class="l wrap">${e(d.purpose || '')}</div></div><button class="btn" onclick="mcl()">Close</button></div>
<div class="pf-grid" style="margin-top:12px">${stat('Office score ' + X.pm, pc(dash.office_score), 1)}${stat('Tasks done', dash.tasks.completed + '/' + dash.tasks.total)}${stat('Overdue', dash.tasks.overdue)}${ATT ? stat('Attendance', pc(dash.attendance_rate)) : ''}${stat('Reports missing', dash.reports.missing)}</div>
<h2 class="pf-h">Staff</h2>${tbl(['Staff', 'Score', 'Band'], dash.staff.map(s => `<tr class="pf-sel" onclick="PF.prof(${s.staff_id})"><td>${e(s.name)}</td><td>${pc(s.final_score)}</td><td>${e(label(s.band))}</td></tr>`), 'No staff assigned to this office.', 'pf-tbl-small')}
<h2 class="pf-h">Responsibilities</h2><div class="c"><ol style="margin:0;padding-left:20px">${d.responsibilities.map(r => `<li style="margin:3px 0">${e(r.text)}</li>`).join('')}</ol><div class="row" style="margin:10px 0 0">${sbtn('Edit responsibilities', `PF.editResp(${id})`)}${sbtn('Edit office details', `PF.editOffice(${id})`)}</div></div>
<h2 class="pf-h">KPIs <button class="btn" onclick="PF.editKpi(0,${id})">+ Add KPI</button></h2>${tbl(['KPI', 'Type', 'Target', 'Weight', 'Frequency', 'Status', ''], k, 'No KPIs.', 'pf-tbl-small')}<div class="pf-note">KPI weights are relative to each other; together the KPI component is capped at its configured weight in the final score.</div>`);
  }
  const KT = ['PERCENTAGE', 'NUMBER', 'RATING_10', 'YES_NO', 'QUALITY', 'COUNT'];
  async function editKpi(kid, oid) {
    let k = { name: '', measurement_type: 'PERCENTAGE', target: 100, weight: 10, frequency: 'MONTHLY', active: true, description: '' };
    if (kid) { const list = await A('/kpis?office_id=' + oid); k = list.find(x => x.id === kid) || k }
    M(`<h2 style="font-size:24px">${kid ? 'Edit KPI' : 'New KPI'}</h2><div class="pf-fg">${fg('kn', 'Name', inp('kn', k.name))}${fg('kd', 'Description', `<textarea id="kd">${e(k.description || '')}</textarea>`)}${fg('kt', 'Measured as', selx('kt', ['PERCENTAGE', 'NUMBER', 'RATING_10', 'YES_NO', 'QUALITY'].map(x => [x, label(x)]), k.measurement_type))}${fg('kg', 'Target', inp('kg', k.target, 'type="number"'))}${fg('kw', 'Weight', inp('kw', k.weight, 'type="number"'))}${fg('kf', 'Frequency', selx('kf', ['WEEKLY', 'MONTHLY', 'QUARTERLY'].map(x => [x, label(x)]), k.frequency))}${fg('ka', 'Active', `<input id="ka" type="checkbox" ${k.active ? 'checked' : ''} style="width:auto">`)}${kid ? reqReason('kr', 'Required when changing a target or weight') : ''}</div>${mfoot('Save KPI', `PF.saveKpi(${kid},${oid})`)}`);
  }
  async function saveKpi(kid, oid) {
    const b = { name: V('kn'), description: V('kd'), measurement_type: V('kt'), target: num(V('kg')), weight: num(V('kw')), frequency: V('kf'), active: VC('ka') };
    try { if (kid) await A('/kpis/' + kid, { method: 'PATCH', body: { ...b, reason: V('kr') } }); else await A('/kpis', { method: 'POST', body: { ...b, office_id: oid } }); mcl(); toast('KPI saved'); X.c = {}; office(oid) } catch (err) { toast(err.message, 1) }
  }
  async function editResp(id) {
    const d = await A('/offices/' + id);
    M(`<h2 style="font-size:24px">Responsibilities</h2><p class="l">One per line.</p><textarea id="rl" style="width:100%;min-height:260px">${e(d.responsibilities.map(r => r.text).join('\n'))}</textarea>${reqReason('rlr', '')}${mfoot('Save', `PF.saveResp(${id})`)}`);
  }
  async function saveResp(id) { try { await A('/offices/' + id, { method: 'PATCH', body: { responsibilities: V('rl').split('\n').map(x => x.trim()).filter(Boolean), reason: V('rlr') } }); mcl(); toast('Saved'); X.c = {}; office(id) } catch (err) { toast(err.message, 1) } }
  async function editOffice(id) {
    const d = await A('/offices/' + id);
    M(`<h2 style="font-size:24px">Office details</h2><div class="pf-fg">${fg('on', 'Name', inp('on', d.name))}${fg('os', 'Short name', inp('os', d.short_name))}${fg('op', 'Purpose', `<textarea id="op">${e(d.purpose || '')}</textarea>`)}${fg('oa', 'Active', `<input id="oa" type="checkbox" ${d.active ? 'checked' : ''} style="width:auto">`)}</div>${mfoot('Save', `PF.saveOffice(${id})`)}`);
  }
  async function saveOffice(id) { try { await A('/offices/' + id, { method: 'PATCH', body: { name: V('on'), short_name: V('os'), purpose: V('op'), active: VC('oa') } }); mcl(); toast('Saved'); X.c = {}; office(id) } catch (err) { toast(err.message, 1) } }

  function pfClose() {
    const d = need('close:' + X.pm, () => A('/months/' + X.pm)); if (!d) return loading(); if (bad(d)) return errBox(d);
    const blocks = d.checks.filter(c => c.severity === 'BLOCK'), warns = d.checks.filter(c => c.severity !== 'BLOCK');
    const closed = d.status === 'CLOSED';
    return `${mnav()}<div class="fm">Closing a month <b>locks</b> its tasks, ${ATT ? 'attendance, ' : ''}reports, KPI results and scores, and saves permanent history snapshots. A closed month can only be reopened by management with a recorded reason. Closing never pays anyone.</div>
<div class="row"><b>${X.pm}</b> ${statusBadge(d.status)}${closed ? sbtn('Reopen month', 'PF.reopenMonth()') : sbtn('Recalculate all', 'PF.calcAll()') + sbtn('Finalize all', 'PF.finAll()') + sbtn('Close month', 'PF.closeMonth()', 'pr')}${sbtn('Approve all recommended pay', 'PF.approveAll()')}</div>
${blocks.length ? `<h2 class="pf-h pf-bad">Must be fixed before closing (${blocks.length})</h2>${blocks.map(c => `<div class="pf-alert CRITICAL"><div><b>${e(c.staff || '')}</b> — ${e(c.message)}</div></div>`).join('')}` : '<div class="pf-ok" style="margin:8px 0">✓ Nothing is blocking this month.</div>'}
${warns.length ? `<h2 class="pf-h">Warnings (${warns.length})</h2>${warns.map(c => `<div class="pf-alert"><div><b>${e(c.staff || '')}</b> — ${e(c.message)}</div></div>`).join('')}` : ''}`;
  }
  async function finAll() { const r = await act(() => A('/performance/finalize-all', { method: 'POST', body: { month: X.pm, acknowledge_incomplete: true } }), null); if (r) toast('Finalize run complete: ' + (Array.isArray(r.results || r) ? (r.results || r).filter(x => x.ok !== false).length : '') + ' ok') }
  function closeMonth() {
    M(`<h2 style="font-size:24px">Close ${X.pm}</h2><p class="l">This locks the month. If warnings exist you must confirm you accept incomplete data.</p><div class="pf-fg">${fg('cn', 'Notes', '<textarea id="cn"></textarea>')}${fg('cack', 'Accept incomplete data', '<input id="cack" type="checkbox" style="width:auto">')}</div>${mfoot('Close month', 'PF.doClose()')}`);
  }
  async function doClose() { try { await A(`/months/${X.pm}/close`, { method: 'POST', body: { acknowledge_incomplete: VC('cack'), notes: V('cn') } }); mcl(); toast('Month closed and locked'); inv() } catch (err) { toast(err.message, 1) } }
  function reopenMonth() { M(`<h2 style="font-size:24px">Reopen ${X.pm}</h2>${reqReason('rmr', 'Required')}${mfoot('Reopen', 'PF.doReopenMonth()')}`) }
  async function doReopenMonth() { try { await A(`/months/${X.pm}/reopen`, { method: 'POST', body: { reason: V('rmr') } }); mcl(); toast('Month reopened'); inv() } catch (err) { toast(err.message, 1) } }
  async function approveAll() {
    let sb; try { sb = await A('/performance?month=' + X.pm) } catch (err) { return toast(err.message, 1) }
    const items = sb.rows.filter(r => r.state === 'FINALIZED' || r.state === 'CLOSED').filter(r => r.payroll && r.payroll.approved_pay == null && r.payroll.actual_paid == null).map(r => ({ staff_id: r.staff_id }));
    if (!items.length) return toast('Nothing to approve: finalize scores first, or they are already approved', 1);
    if (!confirm(`Approve the recommended pay for ${items.length} staff? This releases the amounts to Payroll; it does not pay them.`)) return;
    doApprove(items, 0);
  }

  const WL = { task: 'Task completion', kpi: 'Office KPI', attendance: 'Attendance', reports: 'Weekly reports', productivity: 'Productivity', teamwork: 'Teamwork' };
  function accessSection() {
    const a = need('access', () => A('/access')); if (!a) return loading(); if (bad(a)) return errBox(a);
    const when = r => r.set ? (r.last_used_at ? 'Last used ' + String(r.last_used_at).slice(0, 16).replace('T', ' ') : 'Not used yet') : '<span class="pf-bad">No code set</span>';
    return `<h2 class="pf-h">Access codes (login page)</h2><div class="pf-sub">Codes are stored only as one-way hashes, so they cannot be shown again. Generating a new code stops the old one working immediately.</div>
${tbl(['Who', 'Used for', 'Status', ''], [`<tr><td><b>Administrator</b></td><td>Administrator tab on the login page</td><td>${when(a.admin)}</td><td><button class="btn" onclick="PF.genCode('admin')">Generate new admin code</button></td></tr>`, ...a.offices.map(o => `<tr><td><b>${e(o.office)}</b></td><td>Staff tab: office code</td><td>${when(o)}</td><td><button class="btn" onclick="PF.genCode('office',${o.office_id})">Generate new code</button></td></tr>`)], '', 'pf-tbl-small')}
<div class="row" style="margin-top:10px"><button class="btn" onclick="PF.genAllOffices()">Generate new codes for ALL offices (printable sheet)</button></div>`;
  }
  function pfSettings() {
    const d = need('settings', () => A('/settings')); if (!d) return loading(); if (bad(d)) return errBox(d);
    const s = d.settings;
    return accessSection() + notifSection() + `<div class="fm">These rules drive every score. Changes apply to scores that are not yet finalized; finalized and closed months keep the rules they were calculated with.</div>
<h2 class="pf-h">Staff attendance</h2><div class="c" style="max-width:640px"><label style="display:flex;gap:10px;align-items:center"><input id="s_att" type="checkbox" ${ATT ? 'checked' : ''} style="width:auto"> <span><b>Track staff attendance</b><span class="pf-note"> Turn off if your staff work remotely. The Staff Attendance page, attendance scores and attendance alerts are hidden, and the other score weights are shared out automatically. Nothing already recorded is deleted.</span></span></label></div>
<h2 class="pf-h">Score weights (must add up to 100)</h2><div class="pf-grid">${Object.keys(WL).filter(k => ATT || k !== 'attendance').map(k => `<div class="c"><div class="l">${WL[k]}</div><input id="w_${k}" type="number" min="0" value="${s.weights[k]}" style="width:100%;margin-top:6px"></div>`).join('')}</div>
<h2 class="pf-h">Payment bands</h2><div class="pf-sub">Score at or above "from" earns that share of salary. Include a band starting at 0.</div>
${tbl(['Band', 'Label', 'From score', 'Pays % of salary'], s.bands.map((b, i) => `<tr><td>${e(b.key)}</td><td><input id="bl_${i}" value="${e(b.label)}"></td><td><input id="bm_${i}" type="number" min="0" max="100" value="${b.min}" style="width:90px"></td><td><input id="bp_${i}" type="number" min="0" max="100" value="${b.pay_pct}" style="width:90px"></td></tr>`), '', 'pf-tbl-small')}
<h2 class="pf-h">Rules</h2><div class="pf-fg" style="max-width:640px">
${fg('s_exit', 'Exit-review score below', inp('s_exit', s.exit_review_below, 'type="number"'))}${fg('s_cons', '…for consecutive months', inp('s_cons', s.exit_review_consecutive, 'type="number"'))}${fg('s_cap', 'KPI weight cap (%)', inp('s_cap', s.kpi_weight_cap_pct, 'type="number"'))}${fg('s_gr', 'Late grace (minutes)', inp('s_gr', s.grace_minutes, 'type="number"'))}
${fg('s_lt', 'Late task penalty (%)', inp('s_lt', s.late_task_penalty_pct, 'type="number"'))}${fg('s_ld', 'Late deliverable penalty (%)', inp('s_ld', s.late_deliverable_penalty_pct, 'type="number"'))}${fg('s_lr', 'Late report credit (%)', inp('s_lr', s.late_report_credit_pct, 'type="number"'))}
${fg('s_pol', 'Missing component', selx('s_pol', [['EXCLUDE', 'Exclude and re-balance weights'], ['ZERO', 'Count as zero']], s.missing_component_policy))}${fg('s_enf', 'Management approves pay before it can be paid', `<input id="s_enf" type="checkbox" ${s.enforce_payroll_approval ? 'checked' : ''} style="width:auto">`)}
${reqReason('s_r', 'Required')}</div><div class="row"><button class="btn pr" onclick="PF.saveSettings()">Save settings</button><button class="btn" onclick="PF.resetSettings()">Reset form</button></div>`;
  }
  const codeBox = (title, rows, note) => M(`<h2 style="font-size:24px">${title}</h2><p class="l">${note}</p><div id="cbx">${rows.map(([n, c]) => `<div class="c" style="margin:6px 0"><div class="l">${e(n)}</div><div style="font:600 22px/1.3 'Bebas Neue',monospace;letter-spacing:.08em;color:var(--or)">${e(c)}</div></div>`).join('')}</div><div class="row" style="margin:14px 0 0;justify-content:flex-end"><button class="btn" onclick="PF.copyCode()">Copy</button><button class="btn" onclick="window.print()">Print</button><button class="btn pr" onclick="mcl()">Done</button></div>`);
  function copyCode() { const tx = [...document.querySelectorAll('#cbx .c')].map(x => x.innerText.replace(/\n+/g, ': ')).join('\n'); try { navigator.clipboard.writeText(tx); toast('Copied') } catch (err) { toast('Select and copy the codes by hand', 1) } }
  async function genCode(kind, id) {
    if (!confirm(kind === 'admin' ? 'Generate a NEW administrator code? The old one stops working immediately. You stay signed in on this device.' : 'Generate a new code for this office? The old code stops working immediately and staff must use the new one.')) return;
    try {
      if (kind === 'admin') { const r = await A('/admin-code', { method: 'POST', body: {} }); KEY = r.code; try { sessionStorage.setItem('sap2key', KEY) } catch (err) { } codeBox('New administrator code', [['Administrator', r.code]], r.note) }
      else { const r = await A(`/offices/${id}/office-code`, { method: 'POST', body: {} }); const o = (X.c.access || { offices: [] }).offices.find(x => x.office_id === id); codeBox('New office code', [[o ? o.office : 'Office', r.code]], r.note) }
      delete X.c.access; render();
    } catch (err) { toast(err.message, 1) }
  }
  async function genAllOffices() {
    if (!confirm('Generate NEW codes for all offices? Every current office code stops working immediately.')) return;
    try { const a = await A('/access'); const out = []; for (const o of a.offices) { const r = await A(`/offices/${o.office_id}/office-code`, { method: 'POST', body: {} }); out.push([o.office, r.code]) } codeBox('Office access codes', out, 'Hand each code to the staff of that office. They are shown only once.'); delete X.c.access; render() } catch (err) { toast(err.message, 1) }
  }
  async function saveSettings() {
    const d = X.c.settings; if (!d) return; const s = d.settings;
    const weights = {}; Object.keys(WL).forEach(k => { if (document.getElementById('w_' + k)) weights[k] = num(V('w_' + k)); else weights[k] = (s.weights || {})[k] ?? 0 });
    const bands = s.bands.map((b, i) => ({ ...b, label: V('bl_' + i), min: num(V('bm_' + i)), pay_pct: num(V('bp_' + i)) }));
    const body = { weights, bands, exit_review_below: num(V('s_exit')), exit_review_consecutive: num(V('s_cons')), kpi_weight_cap_pct: num(V('s_cap')), grace_minutes: num(V('s_gr')), late_task_penalty_pct: num(V('s_lt')), late_deliverable_penalty_pct: num(V('s_ld')), late_report_credit_pct: num(V('s_lr')), missing_component_policy: V('s_pol'), enforce_payroll_approval: VC('s_enf'), attendance_enabled: VC('s_att') };
    await act(() => A('/settings', { method: 'PUT', body: { settings: body, reason: V('s_r') } }), 'Settings saved');
    ATT = body.attendance_enabled; render();
  }

  /* ======================================================= MAIN "Administrative Performance" view ======================================================= */
  const TABS = [['dash', 'Dashboard'], ['score', 'Scoreboard'], ['offices', 'Offices & KPIs'], ['close', 'Month closing'], ['settings', 'Settings']];
  function ap() {
    const body = { dash: pfDash, score: pfScore, offices: pfOffices, close: pfClose, settings: pfSettings }[X.tab]();
    return `<h1>Administrative Performance</h1><div class="p">Accountability scores for administrative staff. Instructor appearances and instructor pay are not affected by anything on these pages.</div>
<div class="pf-tabs">${TABS.map(([k, l]) => `<button class="btn ${X.tab === k ? 'on' : ''}" onclick="PF.tab('${k}')">${l}</button>`).join('')}</div>${body}`;
  }

  /* ======================================================= TASKS & DELIVERABLES ======================================================= */
  const actives = () => { const s = staffList(); return s && !bad(s) ? s.filter(x => x.active) : [] };
  function filt() {
    const o = officeList(), st = actives();
    return `<div class="row pf-noprint"><select onchange="X_f('st',this.value)"><option value="">All statuses</option>${['TODO', 'IN_PROGRESS', 'SUBMITTED', 'VERIFIED', 'COMPLETED', 'OVERDUE', 'CANCELLED'].map(s => `<option value="${s}" ${X.st === s ? 'selected' : ''}>${label(s)}</option>`).join('')}</select>
<select onchange="X_f('stf',this.value)"><option value="">All staff</option>${st.map(s => `<option value="${s.id}" ${String(X.stf) === String(s.id) ? 'selected' : ''}>${e(s.name)}</option>`).join('')}</select>
<select onchange="X_f('off',this.value)"><option value="">All offices</option>${(o && !bad(o) ? o : []).map(x => `<option value="${x.id}" ${String(X.off) === String(x.id) ? 'selected' : ''}>${e(x.name)}</option>`).join('')}</select></div>`;
  }
  window.X_f = (k, v) => { X[k] = v; render() };
  const qs = (extra) => `month=${X.pm}${X.stf ? '&staff_id=' + X.stf : ''}${X.off ? '&office_id=' + X.off : ''}${extra || ''}`;
  function tk() {
    const d = need('tasks:' + qs(X.st ? '&status=' + X.st : ''), () => A('/tasks?' + qs(X.st ? '&status=' + X.st : ''))); if (!d) return loading(); if (bad(d)) return errBox(d);
    const dl = need('deliv:' + qs(), () => A('/deliverables?' + qs())); const prio = { HIGH: 'sbC', MEDIUM: 'sbN', LOW: 'sbD' };
    const cnt = s => d.filter(t => t.status === s).length;
    return `<h1>Tasks</h1><div class="p">Assign work, track it, and verify what staff submit. Staff submit; only management verifies.</div>${mnav()}${filt()}
<div class="row pf-noprint"><button class="btn pr" onclick="PF.newTask()">+ New task</button><button class="btn" onclick="PF.newDeliv()">+ New deliverable</button><span style="flex:1"></span><button class="btn ${X.tv === 'staff' ? '' : 'on'}" onclick="X_f('tv','task')">By task</button><button class="btn ${X.tv === 'staff' ? 'on' : ''}" onclick="X_f('tv','staff')">By staff</button></div>
<div class="pf-grid">${stat('Tasks', d.length)}${stat('Awaiting verification', cnt('SUBMITTED'))}${stat('Overdue', cnt('OVERDUE'))}${stat('Verified / completed', cnt('VERIFIED') + cnt('COMPLETED'))}</div>
${X.tv === 'staff' ? tkByStaff(d) : tbl(['Task', 'Staff', 'Office', 'Priority', 'Due', 'Status', 'Submission', ''], d.map(t => `<tr><td class="wrap" style="min-width:200px"><b>${e(t.title)}</b>${t.expected_output ? `<div class="pf-note">Expected: ${e(t.expected_output)}</div>` : ''}</td><td>${e(t.staff_name)}</td><td>${e(t.office || '—')}</td><td><span class="b ${prio[t.priority] || 'sbD'}">${e(label(t.priority))}</span></td><td>${t.due_date}</td><td>${statusBadge(t.status)}${t.performance_score != null ? `<div class="pf-note">Quality ${t.performance_score}%</div>` : ''}</td>
<td class="wrap pf-det">${e(t.actual_output || '')}${t.files && t.files.length ? `<div>${fbtns(t.files)}</div>` : ''}${t.evidence_url ? ` <a href="${e(t.evidence_url)}" target="_blank" rel="noopener" style="color:var(--or)">evidence</a>` : ''}${t.management_comment ? `<div>Mgmt: ${e(t.management_comment)}</div>` : ''}</td>
<td><button class="btn" onclick="PF.viewTask(${t.task_id},${t.staff_id})">View</button> ${t.status === 'SUBMITTED' ? `<button class="btn pr" onclick="PF.review(${t.task_id},${t.staff_id})">Review</button>` : ['TODO', 'IN_PROGRESS'].includes(t.status) || t.status === 'OVERDUE' ? `<button class="btn" onclick="PF.submitFor(${t.task_id},${t.staff_id})">Record submission</button>` : ''}${['VERIFIED', 'COMPLETED', 'CANCELLED'].includes(t.status) ? '' : ` <button class="btn" onclick="PF.cancelTask(${t.task_id})">Cancel</button>`}</td></tr>`), 'No tasks for these filters.')}
<h2 class="pf-h">Deliverables</h2>${!dl ? loading() : bad(dl) ? errBox(dl) : tbl(['Deliverable', 'Staff', 'Type', 'Expected', 'Status', 'Evidence', ''], dl.map(x => `<tr><td class="wrap"><b>${e(x.title)}</b></td><td>${e(x.staff_name)}</td><td>${e(x.deliverable_type || '—')}</td><td>${x.expected_date}${x.overdue ? ' <span class="b sbC">Overdue</span>' : ''}</td><td>${statusBadge(x.status)}${x.late ? ' <span class="b sbN">Late</span>' : ''}${x.quality_rating != null ? `<div class="pf-note">Quality ${x.quality_rating}/10</div>` : ''}</td><td>${x.evidence_url ? `<a href="${e(x.evidence_url)}" target="_blank" rel="noopener" style="color:var(--or)">open</a>` : '—'}</td>
<td>${['EXPECTED', 'REJECTED'].includes(x.status) ? `<button class="btn" onclick="PF.submitDeliv(${x.id})">Record submission</button>` : x.status === 'SUBMITTED' ? `<button class="btn pr" onclick="PF.reviewDeliv(${x.id})">Review</button>` : ''}</td></tr>`), 'No deliverables this month.')}`;
  }

  const tkRows = () => Object.keys(X.c).filter(k => k.startsWith('tasks:')).flatMap(k => Array.isArray(X.c[k]) ? X.c[k] : []);
  function tkByStaff(d) {
    const g = new Map(); d.forEach(t => { const x = g.get(t.staff_id) || { id: t.staff_id, name: t.staff_name, office: t.office, n: 0, open: 0, sub: 0, od: 0, done: 0 }; x.n++; if (['TODO', 'IN_PROGRESS'].includes(t.status)) x.open++; if (t.status === 'SUBMITTED') x.sub++; if (t.status === 'OVERDUE') x.od++; if (['VERIFIED', 'COMPLETED'].includes(t.status)) x.done++; g.set(t.staff_id, x) });
    return tbl(['Staff', 'Office', 'Tasks', 'Open', 'Awaiting review', 'Overdue', 'Done', ''], [...g.values()].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(x => `<tr><td><b>${e(x.name)}</b></td><td>${e(x.office || '—')}</td><td>${x.n}</td><td>${x.open}</td><td>${x.sub}</td><td>${x.od ? `<span class="b sbC">${x.od}</span>` : 0}</td><td>${x.done}</td><td><button class="btn pr" onclick="PF.viewStaffTasks(${x.id})">View</button></td></tr>`), 'No tasks for these filters.');
  }
  function taskBlock(t) {
    const prio = { HIGH: 'sbC', MEDIUM: 'sbN', LOW: 'sbD' };
    return `<div class="c" style="margin:8px 0"><div class="row" style="justify-content:space-between;margin:0"><b>${e(t.title)}</b><span>${statusBadge(t.status)} <span class="b ${prio[t.priority] || 'sbD'}">${e(label(t.priority))}</span></span></div>
${t.description ? `<div class="pf-note" style="margin-top:4px">${e(t.description)}</div>` : ''}<div class="pf-note" style="margin-top:6px">Assigned to <b>${e(t.staff_name)}</b>${t.office ? ' (' + e(t.office) + ')' : ''} &middot; Due ${t.due_date}${t.assigned_by || t.created_by ? ' &middot; Given by ' + e(t.assigned_by || t.created_by) : ''}</div>
${t.expected_output ? `<div class="pf-note">Expected: ${e(t.expected_output)}</div>` : ''}
${t.actual_output || (t.files && t.files.length) || t.evidence_url ? `<h2 class="pf-h" style="font-size:15px">Submission</h2><div class="wrap" style="white-space:pre-wrap">${e(t.actual_output || '')}</div>${t.files && t.files.length ? `<div>${fbtns(t.files)}</div>` : ''}${t.evidence_url ? `<a href="${e(t.evidence_url)}" target="_blank" rel="noopener" style="color:var(--or)">evidence link</a>` : ''}` : '<div class="pf-note">Nothing submitted yet.</div>'}
${t.management_comment ? `<div class="fm" style="margin-top:6px">Management: ${e(t.management_comment)}</div>` : ''}${t.performance_score != null ? `<div class="pf-note">Quality ${t.performance_score}%</div>` : ''}</div>`;
  }
  function viewTask(tid, sid) { const t = tkRows().find(x => x.task_id === tid && x.staff_id === sid); if (!t) return toast('Task not found, reload the page', 1); MW(`<div class="row" style="justify-content:space-between;margin:0"><h2 style="font-size:24px">Task</h2><button class="btn" onclick="mcl()">Close</button></div>${taskBlock(t)}`) }
  function viewStaffTasks(sid) {
    const l = tkRows().filter(x => x.staff_id === sid), seen = new Set(), rows = l.filter(x => seen.has(x.task_id) ? false : seen.add(x.task_id)).sort((a, b) => b.task_id - a.task_id);
    MW(`<div class="row" style="justify-content:space-between;margin:0"><div><h2 style="font-size:26px">${e((rows[0] || {}).staff_name || 'Staff')}</h2><div class="pf-note">${rows.length} task(s) given, newest first</div></div><button class="btn" onclick="mcl()">Close</button></div>${rows.map(taskBlock).join('') || '<div class="pf-note">No tasks.</div>'}`);
  }
  function staffChecks(id, pre) { const s = actives(); if (!s.length) return '<div class="fm">The staff list could not be loaded. Close this window and try again.</div>'; return `<div class="pf-noprint" style="margin-bottom:6px"><button type="button" class="btn" onclick="PF.tickGroup('${id}','instructor')">Tick all instructors</button> <button type="button" class="btn" onclick="PF.tickGroup('${id}','admin')">Tick all admin staff</button> <button type="button" class="btn" onclick="PF.tickGroup('${id}','')">Clear</button></div><div class="pf-chk" id="${id}">${s.map(x => `<label><input type="checkbox" value="${x.id}" data-t="${x.staff_type === 'instructor' ? 'instructor' : 'admin'}" ${pre && pre.includes(x.id) ? 'checked' : ''}> ${e(x.name)} <span class="pf-mu">${x.staff_type === 'instructor' ? 'Instructor' : e(x.office || '')}</span></label>`).join('')}</div>` }
  function tickGroup(id, t) { document.querySelectorAll('#' + id + ' input').forEach(i => { i.checked = !!t && i.dataset.t === t }) }
  const checked = id => [...document.querySelectorAll('#' + id + ' input:checked')].map(i => +i.value);
  function newTask() {
    const o = officeList(); if (!o || bad(o) || !staffList()) return toast('Still loading, try again', 1);
    M(`<h2 style="font-size:24px">New task</h2><div class="pf-fg">${fg('tt', 'Title *', inp('tt', ''))}${fg('td', 'Description', '<textarea id="td"></textarea>')}${fg('tsc', 'Assign to', selx('tsc', [['STAFF', 'Selected staff'], ['OFFICE', 'Entire office']], 'STAFF'))}${fg('tof', 'Office (if entire office)', selx('tof', [['', '—'], ...o.map(x => [x.id, x.name])], ''))}${fg('tst', 'Staff', staffChecks('tst'))}${fg('tdu', 'Due date *', inp('tdu', TODAY, 'type="date"'))}${fg('tpr', 'Priority', selx('tpr', [['MEDIUM', 'Medium'], ['HIGH', 'High'], ['LOW', 'Low']], 'MEDIUM'))}${fg('teo', 'Expected output', inp('teo', ''))}</div>${mfoot('Create task', 'PF.saveTask()')}`);
  }
  async function saveTask() {
    const b = { title: V('tt'), description: V('td'), scope: V('tsc'), office_id: V('tof') ? +V('tof') : null, staff_ids: checked('tst'), due_date: V('tdu'), priority: V('tpr'), expected_output: V('teo') };
    try { await A('/tasks', { method: 'POST', body: b }); mcl(); toast('Task created'); inv() } catch (err) { toast(err.message, 1) }
  }
  function review(tid, sid) {
    const t = (X.c[Object.keys(X.c).find(k => k.startsWith('tasks:'))] || []).find(x => x.task_id === tid && x.staff_id === sid) || {};
    M(`<h2 style="font-size:24px">Review submission</h2><dl><dt>Task</dt><dd>${e(t.title)}</dd><dt>Staff</dt><dd>${e(t.staff_name)}</dd><dt>Output</dt><dd>${e(t.actual_output || '—')}</dd><dt>Evidence</dt><dd>${t.evidence_url ? `<a href="${e(t.evidence_url)}" target="_blank" rel="noopener" style="color:var(--or)">${e(t.evidence_url)}</a>` : '—'}</dd></dl>
<div class="pf-fg">${fg('rq', 'Quality score (0–100)', inp('rq', '', 'type="number" min="0" max="100" placeholder="optional"'))}${fg('rc', 'Comment', '<textarea id="rc"></textarea>')}</div>
<div class="row" style="margin:14px 0 0;justify-content:flex-end"><button class="btn" onclick="mcl()">Cancel</button><button class="btn" onclick="PF.doReview(${tid},${sid},'reject')">Reject (needs comment)</button><button class="btn pr" onclick="PF.doReview(${tid},${sid},'verify')">Verify</button></div>`);
  }
  async function doReview(tid, sid, a) { try { await A(`/tasks/${tid}/${a}`, { method: 'POST', body: { staff_id: sid, comment: V('rc'), performance_score: num(V('rq')) } }); mcl(); toast(a === 'verify' ? 'Task verified' : 'Task sent back'); inv() } catch (err) { toast(err.message, 1) } }
  function submitFor(tid, sid) {
    M(`<h2 style="font-size:24px">Record submission</h2><p class="l">Use this when a staff member hands in work outside the staff portal. It still needs your verification afterwards.</p><div class="pf-fg">${fg('so1', 'What was delivered', '<textarea id="so1"></textarea>')}${fg('sev', 'Evidence link', inp('sev', ''))}</div>${mfoot('Record', `PF.doSubmitFor(${tid},${sid})`)}`);
  }
  async function doSubmitFor(tid, sid) { try { await A(`/tasks/${tid}/submit`, { method: 'POST', body: { staff_id: sid, actual_output: V('so1'), evidence_url: V('sev') } }); mcl(); toast('Submission recorded, awaiting verification'); inv() } catch (err) { toast(err.message, 1) } }
  function cancelTask(tid) { M(`<h2 style="font-size:24px">Cancel task</h2><p class="l">The task stops counting toward scores.</p>${reqReason('cr', '')}${mfoot('Cancel task', `PF.doCancel(${tid})`)}`) }
  async function doCancel(tid) { try { await A('/tasks/' + tid, { method: 'PATCH', body: { cancelled: true, reason: V('cr') } }); mcl(); toast('Task cancelled'); inv() } catch (err) { toast(err.message, 1) } }
  function newDeliv() {
    M(`<h2 style="font-size:24px">New deliverable</h2><div class="pf-fg">${fg('dsf', 'Staff', selx('dsf', actives().map(s => [s.id, s.name]), ''))}${fg('dti', 'Title *', inp('dti', ''))}${fg('dty', 'Type', inp('dty', '', 'placeholder="e.g. Design, Video, Report"'))}${fg('ded', 'Description', '<textarea id="ded"></textarea>')}${fg('dex', 'Expected date *', inp('dex', TODAY, 'type="date"'))}</div>${mfoot('Create', 'PF.saveDeliv()')}`);
  }
  async function saveDeliv() { try { await A('/deliverables', { method: 'POST', body: { staff_id: +V('dsf'), title: V('dti'), deliverable_type: V('dty'), description: V('ded'), expected_date: V('dex') } }); mcl(); toast('Deliverable created'); inv() } catch (err) { toast(err.message, 1) } }
  function submitDeliv(id) { M(`<h2 style="font-size:24px">Record deliverable submission</h2><div class="pf-fg">${fg('dev', 'Evidence link *', inp('dev', ''))}</div>${mfoot('Record', `PF.doSubmitDeliv(${id})`)}`) }
  async function doSubmitDeliv(id) { try { await A(`/deliverables/${id}/submit`, { method: 'POST', body: { evidence_url: V('dev') } }); mcl(); toast('Submitted for review'); inv() } catch (err) { toast(err.message, 1) } }
  function reviewDeliv(id) {
    M(`<h2 style="font-size:24px">Review deliverable</h2><div class="pf-fg">${fg('dqr', 'Quality (0–10)', inp('dqr', '', 'type="number" min="0" max="10" step="0.5"'))}${fg('dcm', 'Comment', '<textarea id="dcm"></textarea>')}</div><div class="row" style="margin:14px 0 0;justify-content:flex-end"><button class="btn" onclick="mcl()">Cancel</button><button class="btn" onclick="PF.doReviewDeliv(${id},'REJECTED')">Reject (needs comment)</button><button class="btn pr" onclick="PF.doReviewDeliv(${id},'APPROVED')">Approve</button></div>`);
  }
  async function doReviewDeliv(id, decision) { try { await A(`/deliverables/${id}/review`, { method: 'POST', body: { decision, comment: V('dcm'), quality_rating: num(V('dqr')) } }); mcl(); toast('Saved'); inv() } catch (err) { toast(err.message, 1) } }

  /* ======================================================= ATTENDANCE ======================================================= */
  function aa() {
    const d = need('att:' + qs(), () => A('/attendance?' + qs())); if (!d) return loading(); if (bad(d)) return errBox(d);
    const n = s => d.filter(x => x.status === s).length, tot = d.filter(x => !['EXCUSED', 'OFFICIAL_ASSIGNMENT'].includes(x.status)).length;
    return `<h1>Staff Attendance</h1><div class="p">Daily presence, lateness and events for administrative staff. Instructor appearances are tracked separately on the Appearance Tracker.</div>${mnav()}${filt()}
<div class="row pf-noprint"><button class="btn pr" onclick="PF.recordAtt()">+ Record attendance</button></div>
<div class="pf-grid">${stat('Records', d.length)}${stat('Present', n('PRESENT'))}${stat('Late', n('LATE'))}${stat('Absent', n('ABSENT'))}${stat('Attendance rate', tot ? pc(Math.round((n('PRESENT') + n('LATE')) / tot * 1000) / 10) : '—', 1)}</div>
${tbl(['Date', 'Staff', 'Event', 'Expected', 'Arrived', 'Status', 'Late (min)', 'Remark', 'Recorded by'], d.map(a => `<tr><td>${a.date}</td><td>${e(a.staff_name)}</td><td>${e(label(a.event_type))}${a.event_title ? ' · ' + e(a.event_title) : ''}</td><td>${e((a.expected_time || '').slice(0, 5)) || '—'}</td><td>${e((a.arrival_time || '').slice(0, 5)) || '—'}</td><td>${statusBadge(a.status)}</td><td>${a.late_minutes || 0}</td><td class="wrap pf-det">${e(a.remark || '')}</td><td>${e(a.recorded_by || '')}</td></tr>`), 'No attendance recorded for these filters.')}`;
  }
  const EV = ['WORK', 'OFFICE', 'MEETING', 'MANDATORY_MEETING', 'TRAINING', 'EVENT', 'OFFICIAL_ASSIGNMENT'], AS = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED', 'OFFICIAL_ASSIGNMENT'];
  function recordAtt() {
    const st = actives(); if (!st.length) return toast('Still loading, try again', 1);
    M(`<h2 style="font-size:24px">Record attendance</h2><div class="pf-fg">${fg('ad', 'Date', inp('ad', TODAY, 'type="date"'))}${fg('aet', 'Event', selx('aet', EV.map(x => [x, label(x)]), 'WORK'))}${fg('aev', 'Title (optional)', inp('aev', ''))}${fg('aex', 'Expected time', inp('aex', '08:00', 'type="time"'))}</div>
<div class="tw pf-tbl-small"><table><tr><th>Staff</th><th>Status</th><th>Arrival</th><th>Remark</th></tr>${st.map(s => `<tr><td>${e(s.name)}</td><td>${selx('as' + s.id, [['', '— skip —'], ...AS.map(x => [x, label(x)])], 'PRESENT')}</td><td><input id="aa${s.id}" type="time" style="width:110px"></td><td><input id="ar${s.id}" style="width:140px"></td></tr>`).join('')}</table></div>
<div class="pf-note" style="margin-top:6px">Arriving later than the expected time plus the grace period is marked Late automatically.</div>${mfoot('Save attendance', 'PF.saveAtt()')}`);
    $('mc').classList.add('wide');
  }
  async function saveAtt() {
    const recs = actives().filter(s => V('as' + s.id)).map(s => ({ staff_id: s.id, date: V('ad'), event_type: V('aet'), event_title: V('aev'), expected_time: V('aex') || null, arrival_time: V('aa' + s.id) || null, status: V('as' + s.id), remark: V('ar' + s.id) }));
    if (!recs.length) return toast('Choose a status for at least one person', 1);
    try { await A('/attendance', { method: 'POST', body: { records: recs } }); mcl(); toast(recs.length + ' attendance record(s) saved'); inv() } catch (err) { toast(err.message, 1) }
  }

  /* ======================================================= MEETINGS ======================================================= */
  function mt() {
    const d = need('meet:' + X.pm, () => A('/meetings?month=' + X.pm)); if (!d) return loading(); if (bad(d)) return errBox(d);
    return `<h1>Meetings</h1><div class="p">Schedule meetings, record who attended, and turn action points into tracked tasks.</div>${mnav()}<div class="row pf-noprint"><button class="btn pr" onclick="PF.newMeeting()">+ New meeting</button></div>
${tbl(['Date', 'Meeting', 'Type', 'Participants', 'Present', 'Late', 'Absent', 'Pending', ''], d.map(m => `<tr><td>${m.meeting_date} ${e((m.meeting_time || '').slice(0, 5))}</td><td><b>${e(m.title)}</b>${m.private ? ' <span class="b sbD">Private</span>' : ''}<div class="pf-note">${e(m.location || '')}</div></td><td>${e(label(m.meeting_type))}</td><td>${m.participants}</td><td>${m.present}</td><td>${m.late}</td><td>${m.absent}</td><td>${m.pending}</td><td><button class="btn" onclick="PF.openMeeting(${m.id})">Open</button></td></tr>`), 'No meetings this month.')}`;
  }

  /* Participants: normal meetings default to all admin staff; "Private" lets you pick instructors and/or administrative staff and tick exactly who joins. */
  function partsBlock(pre, edit) {
    setTimeout(() => { const t = document.getElementById('mty'); if (t) t.onchange = togglePriv; togglePriv() }, 0);
    const s = (Array.isArray(X.c.dir) ? X.c.dir : []).filter(x => x.active), grp = t => s.filter(x => (x.staff_type === 'instructor') === (t === 'instructor'));
    const box = (t, title) => `<div class="pg" data-g="${t}" style="display:none;margin-top:8px"><div class="row" style="justify-content:space-between;margin:0 0 4px"><b>${title}</b><label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" style="width:auto" onchange="PF.pickAll('${t}',this.checked)"> Select all ${title.toLowerCase()}</label></div><div class="pf-chk" id="mst_${t}">${grp(t).map(x => `<label><input type="checkbox" value="${x.id}" ${pre.includes(x.id) ? 'checked' : ''} onchange="PF.syncAll('${t}')"> ${e(x.name)} <span class="pf-mu">${e(x.office || (t === 'instructor' ? 'Instructor' : ''))}</span></label>`).join('') || '<span class="pf-note">None</span>'}</div></div>`;
    const preI = pre.some(id => (s.find(x => x.id === id) || {}).staff_type === 'instructor'), preA = pre.some(id => ((s.find(x => x.id === id) || {}).staff_type || 'admin') !== 'instructor');
    return `<div id="mpriv" data-edit="${edit ? 1 : 0}" style="margin-top:6px"><div id="mpub" class="pf-note">Everyone in the administrative team is invited. Choose the type <b>Private</b> to pick exactly who joins.</div><div id="mprv" style="display:none"><label>${edit ? 'Who is invited?' : 'Who is this private meeting for?'}</label><div class="row" style="margin:4px 0"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="mg_i" style="width:auto" ${preI ? 'checked' : ''} onchange="PF.togglePriv()"> Instructors</label><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="mg_a" style="width:auto" ${preA || !pre.length ? 'checked' : ''} onchange="PF.togglePriv()"> Administrative staff</label></div>${box('instructor', 'Instructors')}${box('admin', 'Administrative staff')}<div class="pf-note" style="margin-top:6px">Only the people ticked are invited, notified and able to see this meeting.</div></div></div>`;
  }
  function togglePriv() {
    const ed = (document.getElementById('mpriv') || {}).dataset && document.getElementById('mpriv').dataset.edit === '1', priv = ed || (document.getElementById('mty') && document.getElementById('mty').value === 'PRIVATE'), pub = document.getElementById('mpub'), prv = document.getElementById('mprv'); if (!pub || !prv) return;
    pub.style.display = priv ? 'none' : ''; prv.style.display = priv ? '' : 'none';
    for (const t of ['instructor', 'admin']) { const g = document.querySelector(`#mprv .pg[data-g="${t}"]`), on = document.getElementById(t === 'instructor' ? 'mg_i' : 'mg_a').checked; if (g) g.style.display = priv && on ? '' : 'none' }
  }
  function pickAll(t, on) { document.querySelectorAll('#mst_' + t + ' input').forEach(i => { i.checked = on }) }
  function syncAll(t) { const all = [...document.querySelectorAll('#mst_' + t + ' input')], g = document.querySelector(`#mprv .pg[data-g="${t}"] .row input`); if (g) g.checked = all.length > 0 && all.every(i => i.checked) }
  function meetIds() {
    const ed = document.getElementById('mpriv').dataset.edit === '1'; if (!ed && document.getElementById('mty').value !== 'PRIVATE') return [];
    const out = []; for (const [t, cb] of [['instructor', 'mg_i'], ['admin', 'mg_a']]) if (document.getElementById(cb).checked) document.querySelectorAll('#mst_' + t + ' input:checked').forEach(i => out.push(+i.value)); return out;
  }
  async function ensureStaff() { try { if (!Array.isArray(X.c.dir)) X.c.dir = await A('/directory'); if (!staffList() || bad(staffList())) X.c.staff = await A(window.SP ? '/directory' : '/staff') } catch (err) { toast(err.message, 1) } }
  async function newMeeting() {
    await ensureStaff();
    M(`<h2 style="font-size:24px">New meeting</h2><div class="pf-fg">${fg('mti', 'Title *', inp('mti', ''))}${fg('mda', 'Date *', inp('mda', TODAY, 'type="date"'))}${fg('mtm', 'Time', inp('mtm', '10:00', 'type="time"'))}${fg('mlo', 'Location', inp('mlo', ''))}${fg('mty', 'Type', selx('mty', ['GENERAL', 'MANDATORY', 'TRAINING', 'EVENT', 'PROJECT', 'PRIVATE'].map(x => [x, label(x)]), 'GENERAL'))}${fg('mag', 'Agenda', '<textarea id="mag"></textarea>')}${partsBlock([])}</div>${mfoot('Create', 'PF.saveMeeting()')}`);
  }
  async function saveMeeting() { try { await A('/meetings', { method: 'POST', body: { title: V('mti'), meeting_date: V('mda'), meeting_time: V('mtm') || null, location: V('mlo'), meeting_type: V('mty'), agenda: V('mag'), required_staff_ids: meetIds() } }); mcl(); toast('Meeting created'); inv() } catch (err) { toast(err.message, 1) } }
  async function editMeeting(id) {
    await ensureStaff(); let m; try { m = await A('/meetings/' + id) } catch (err) { return toast(err.message, 1) }
    const locked = m.attendance.some(a => a.status !== 'PENDING');
    const ids = new Set(m.attendance.map(a => a.staff_id));
    M(`<h2 style="font-size:24px">Edit meeting</h2><div class="pf-note">Everyone invited is notified straight away about changes to the date, time or place.${locked ? ' The title and date are locked because attendance was already recorded.' : ''}</div><div class="pf-fg">${fg('mti', 'Title *', inp('mti', m.title, locked ? 'disabled' : ''))}${fg('mda', 'Date *', inp('mda', String(m.meeting_date).slice(0, 10), 'type="date"' + (locked ? ' disabled' : '')))}${fg('mtm', 'Time', inp('mtm', String(m.meeting_time || '').slice(0, 5), 'type="time"'))}${fg('mlo', 'Location', inp('mlo', m.location || ''))}${fg('mty', 'Type', selx('mty', ['GENERAL', 'MANDATORY', 'TRAINING', 'EVENT', 'PROJECT', 'PRIVATE'].map(x => [x, label(x)]), m.is_private || m.owner_staff_id != null ? 'PRIVATE' : m.meeting_type))}${fg('mag', 'Agenda', `<textarea id="mag">${e(m.agenda || '')}</textarea>`)}${partsBlock([...ids], true)}</div>${mfoot('Save changes', `PF.saveMeetingEdit(${id},${locked})`)}`);
  }
  async function saveMeetingEdit(id, locked) {
    const body = { meeting_time: V('mtm') || null, location: V('mlo'), meeting_type: V('mty'), agenda: V('mag'), required_staff_ids: meetIds() };
    if (!locked) { body.title = V('mti'); body.meeting_date = V('mda') }
    try { await A('/meetings/' + id, { method: 'PATCH', body }); mcl(); toast('Meeting updated. Everyone involved has been notified.'); X.c = {}; window.SP ? render() : (render(), openMeeting(id)) } catch (err) { toast(err.message, 1) }
  }
  async function openMeeting(id) {
    let m; try { m = await A('/meetings/' + id) } catch (err) { return toast(err.message, 1) }
    const ap = m.action_points || [];
    MW(`<div class="row" style="justify-content:space-between;margin:0"><div><h2 style="font-size:26px">${e(m.title)}</h2><div class="l">${m.meeting_date} ${e((m.meeting_time || '').slice(0, 5))} · ${e(m.location || '')} · ${e(label(m.meeting_type))}</div></div><div class="row" style="margin:0"><button class="btn" onclick="PF.editMeeting(${id})">Edit time / details</button><button class="btn" onclick="mcl()">Close</button></div></div>
${m.agenda ? `<h2 class="pf-h">Agenda</h2><div class="c wrap">${e(m.agenda)}</div>` : ''}
${true ? `<h2 class="pf-h">Attendance</h2><div class="tw pf-tbl-small"><table><tr><th>Staff</th><th>Status</th><th>Arrival</th><th>Remark</th></tr>${m.attendance.map(a => a.instructor ? `<tr><td>${e(a.staff_name)} <span class="b sbD">Instructor</span></td><td colspan="3" class="pf-note">Invited and notified. Instructor attendance is not scored here.</td></tr>` : `<tr><td>${e(a.staff_name)}</td><td>${selx('ms' + a.staff_id, [['PENDING', 'Pending'], ...['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'].map(x => [x, label(x)])], a.status)}</td><td><input id="ma${a.staff_id}" type="time" value="${e((a.arrival_time || '').slice(0, 5))}" style="width:110px"></td><td><input id="mr${a.staff_id}" value="${e(a.remark || '')}"></td></tr>`).join('')}</table></div>
<div class="row" style="margin-top:10px"><button class="btn pr" onclick="PF.saveMeetAtt(${id})">Save attendance</button></div>` : ''}
<h2 class="pf-h">Minutes & action points</h2><textarea id="mn" style="width:100%;min-height:90px" placeholder="Minutes / notes">${e(m.notes || '')}</textarea>
<div class="pf-note" style="margin:8px 0 4px">Action points — one per line: <code>text | due date YYYY-MM-DD | assignee names separated by ;</code></div><textarea id="map" style="width:100%;min-height:90px">${e(ap.map(a => [a.text, a.due_date || '', (a.assignee_ids || []).map(i => (m.attendance.find(x => x.staff_id === i) || {}).staff_name).join('; ')].join(' | ')).join('\n'))}</textarea>
<div class="row" style="margin-top:8px"><button class="btn" onclick="PF.saveMinutes(${id},false)">Save notes</button><button class="btn pr" onclick="PF.saveMinutes(${id},true)">Save & create tasks from action points</button></div>
${ap.some(a => a.task_id) ? `<div class="pf-note">${ap.filter(a => a.task_id).length} action point(s) already linked to tasks.</div>` : ''}`);
    window.__meet = m;
  }
  async function saveMeetAtt(id) {
    const m = window.__meet; const recs = m.attendance.filter(a => !a.instructor && V('ms' + a.staff_id) && V('ms' + a.staff_id) !== 'PENDING').map(a => ({ staff_id: a.staff_id, status: V('ms' + a.staff_id), arrival_time: V('ma' + a.staff_id) || null, remark: V('mr' + a.staff_id), reason: 'Meeting attendance correction' }));
    if (!recs.length) return toast('Choose a status for at least one person', 1);
    try { await A(`/meetings/${id}/attendance`, { method: 'POST', body: { records: recs } }); toast('Attendance saved'); X.c = {}; openMeeting(id) } catch (err) { toast(err.message, 1) }
  }
  async function saveMinutes(id, convert) {
    const m = window.__meet, byName = n => (m.attendance.find(a => a.staff_name.toLowerCase() === n.trim().toLowerCase()) || {}).staff_id;
    const old = m.action_points || [];
    const pts = V('map').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const [text, due, who_] = l.split('|').map(x => (x || '').trim()); const prev = old.find(o => o.text === text);
      return { text, due_date: due || null, assignee_ids: (who_ || '').split(';').map(byName).filter(Boolean), priority: 'MEDIUM', task_id: prev ? prev.task_id : null };
    });
    try {
      await A('/meetings/' + id, { method: 'PATCH', body: { notes: V('mn'), action_points: pts } });
      if (convert) { const r = await A(`/meetings/${id}/convert-actions`, { method: 'POST', body: {} }); toast(`${r.created} task(s) created${r.skipped ? `, ${r.skipped} skipped (need assignee + due date, or already linked)` : ''}`) } else toast('Saved');
      X.c = {}; openMeeting(id);
    } catch (err) { toast(err.message, 1) }
  }

  /* ======================================================= WEEKLY REPORTS & ACTIVITIES ======================================================= */
  const mondayOf = d => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10) };
  function wr() {
    X.wt = X.wt || 'reports';
    const head = `<h1>Weekly Reports</h1><div class="p">Weekly reports and the daily activity log. Staff submit; management reviews.</div>${mnav()}${filt()}<div class="pf-tabs"><button class="btn ${X.wt === 'reports' ? 'on' : ''}" onclick="X_f('wt','reports')">Weekly reports</button><button class="btn ${X.wt === 'acts' ? 'on' : ''}" onclick="X_f('wt','acts')">Daily activities</button></div>`;
    if (X.wt === 'acts') {
      const d = need('acts:' + qs(), () => A('/activities?' + qs())); if (!d) return head + loading(); if (bad(d)) return head + errBox(d);
      return head + `<div class="row pf-noprint"><button class="btn pr" onclick="PF.newAct()">+ Log activity</button></div>${tbl(['Date', 'Staff', 'Activity', 'Minutes', 'Output', 'Status', 'Review', ''], d.map(a => `<tr><td>${a.activity_date}</td><td>${e(a.staff_name)}</td><td class="wrap" style="min-width:200px"><b>${e(a.activity)}</b><div class="pf-note">${e(a.description || '')}</div></td><td>${a.minutes_spent == null ? '—' : a.minutes_spent}</td><td class="wrap pf-det">${e(a.output || '')}${a.evidence ? ` <a href="${e(a.evidence)}" target="_blank" rel="noopener" style="color:var(--or)">evidence</a>` : ''}</td><td>${statusBadge(a.status)}</td><td>${statusBadge(a.review_status)}${a.review_comment ? `<div class="pf-note">${e(a.review_comment)}</div>` : ''}</td><td>${a.review_status === 'UNREVIEWED' ? `<button class="btn" onclick="PF.reviewAct(${a.id},'REVIEWED')">Mark reviewed</button> <button class="btn" onclick="PF.reviewAct(${a.id},'FLAGGED')">Flag</button>` : ''}</td></tr>`), 'No activities logged for these filters.')}`;
    }
    const d = need('reps:' + qs(), () => A('/reports?' + qs())); if (!d) return head + loading(); if (bad(d)) return head + errBox(d);
    return head + `<div class="row pf-noprint"><button class="btn pr" onclick="PF.newReport()">+ Record weekly report</button></div>${tbl(['Week of', 'Staff', 'Status', 'Timeliness', 'Highlights', 'Review', ''], d.map(r => `<tr><td>${r.week_start}</td><td>${e(r.staff_name)}</td><td>${statusBadge(r.status)}</td><td>${r.status === 'DRAFT' ? '—' : r.on_time ? '<span class="b sbS">On time</span>' : '<span class="b sbN">Late</span>'}</td><td class="wrap pf-det" style="min-width:220px">${e((r.achievements || r.activities || '').slice(0, 160))}${r.files && r.files.length ? `<div>${fbtns(r.files)}</div>` : ''}</td><td class="wrap pf-det">${e(r.review_comment || '')}</td><td><button class="btn" onclick="PF.openReport(${r.id})">Open</button></td></tr>`), 'No weekly reports for these filters.')}`;
  }
  const RF = [['activities', 'Major activities'], ['tasks_completed', 'Tasks completed'], ['tasks_pending', 'Tasks pending'], ['challenges', 'Challenges'], ['achievements', 'Achievements'], ['evidence', 'Evidence / links'], ['next_priorities', 'Next week priorities']];
  function newReport() {
    M(`<h2 style="font-size:24px">Record weekly report</h2><div class="pf-fg">${fg('rst', 'Staff', selx('rst', actives().map(s => [s.id, s.name]), ''))}${fg('rwk', 'Any date in the week', inp('rwk', TODAY, 'type="date"'))}${RF.map(([k, l]) => fg('rf_' + k, l, `<textarea id="rf_${k}"></textarea>`)).join('')}</div>${mfoot('Submit report', 'PF.saveReport()')}`);
    $('mc').classList.add('wide');
  }
  async function saveReport() {
    const b = { staff_id: +V('rst'), week_start: mondayOf(V('rwk')), submit: true }; RF.forEach(([k]) => b[k] = V('rf_' + k));
    try { await A('/reports', { method: 'POST', body: b }); mcl(); toast('Report recorded, awaiting review'); inv() } catch (err) { toast(err.message, 1) }
  }
  function paReps() {
    const f = X.pr || (X.pr = { status: '', q: '' }), d = need('reps:pa:' + f.status, () => A('/reports' + (f.status ? '?status=' + f.status : ''))); if (!d) return '<h1>Weekly reports</h1>' + loading(); if (bad(d)) return '<h1>Weekly reports</h1>' + errBox(d);
    const rows = d.filter(r => r.status !== 'DRAFT' && (!f.q || (r.staff_name || '').toLowerCase().includes(f.q.toLowerCase())));
    return `<h1>Weekly reports</h1><div class="p">Every staff member's weekly report. You can read them, download attached files, and send a report back for changes. Approval is done by management.</div><div class="row pf-noprint"><select onchange="PF.X.pr.status=this.value;render()">${[['', 'All submitted'], ['SUBMITTED', 'Waiting for review'], ['APPROVED', 'Approved'], ['REJECTED', 'Sent back']].map(([v, l]) => `<option value="${v}" ${v === f.status ? 'selected' : ''}>${l}</option>`).join('')}</select><input placeholder="Search by name" value="${e(f.q)}" onchange="PF.X.pr.q=this.value;render()" style="max-width:260px"></div>${tbl(['Week of', 'Staff', 'Status', 'Timeliness', 'Highlights', 'Review', ''], rows.map(r => `<tr><td>${r.week_start}</td><td>${e(r.staff_name)}</td><td>${statusBadge(r.status)}</td><td>${r.on_time ? '<span class="b sbS">On time</span>' : '<span class="b sbN">Late</span>'}</td><td class="wrap pf-det" style="min-width:220px">${e((r.achievements || r.activities || '').slice(0, 160))}${r.files && r.files.length ? `<div>${fbtns(r.files)}</div>` : ''}</td><td class="wrap pf-det">${e(r.review_comment || '')}</td><td><button class="btn" onclick="PF.openReport(${r.id})">Open</button></td></tr>`), 'No weekly reports for this filter.')}`;
  }
  async function openReport(id) {
    const d = Object.keys(X.c).filter(k => k.startsWith('reps:')).flatMap(k => Array.isArray(X.c[k]) ? X.c[k] : []).find(x => x.id === id); if (!d) return;
    MW(`<div class="row" style="justify-content:space-between;margin:0"><div><h2 style="font-size:26px">${e(d.staff_name)} — week of ${d.week_start}</h2><div>${statusBadge(d.status)} ${d.status !== 'DRAFT' ? (d.on_time ? '<span class="b sbS">On time</span>' : '<span class="b sbN">Late</span>') : ''}</div></div><button class="btn" onclick="mcl()">Close</button></div>
${RF.map(([k, l]) => `<h2 class="pf-h" style="font-size:17px">${l}</h2><div class="c wrap" style="white-space:pre-wrap">${e(d[k] || '—')}</div>`).join('')}
${d.files && d.files.length ? `<h2 class="pf-h" style="font-size:17px">Attached files</h2><div class="c">${fbtns(d.files)}</div>` : ''}${d.status === 'SUBMITTED' ? `<div class="pf-fg" style="margin-top:14px">${fg('rvc', 'Comment', '<textarea id="rvc"></textarea>')}</div><div class="row" style="justify-content:flex-end"><button class="btn" onclick="PF.doReport(${id},'REJECTED')">Reject (needs comment)</button>${X.pa ? '' : `<button class="btn pr" onclick="PF.doReport(${id},'APPROVED')">Approve</button>`}</div>` : d.review_comment ? `<div class="fm">Review: ${e(d.review_comment)}</div>` : ''}`);
  }
  async function doReport(id, decision) { try { await A(`/reports/${id}/review`, { method: 'POST', body: { decision, comment: V('rvc') } }); mcl(); toast(decision === 'APPROVED' ? 'Report approved' : 'Report sent back'); inv() } catch (err) { toast(err.message, 1) } }
  function newAct() {
    M(`<h2 style="font-size:24px">Log activity</h2><div class="pf-fg">${fg('acs', 'Staff', selx('acs', actives().map(s => [s.id, s.name]), ''))}${fg('acd', 'Date', inp('acd', TODAY, 'type="date"'))}${fg('aca', 'Activity *', inp('aca', ''))}${fg('acx', 'Description', '<textarea id="acx"></textarea>')}${fg('acm', 'Minutes spent', inp('acm', '', 'type="number" min="0"'))}${fg('aco', 'Output', inp('aco', ''))}${fg('ace', 'Evidence link', inp('ace', ''))}</div>${mfoot('Save', 'PF.saveAct()')}`);
  }
  async function saveAct() { try { await A('/activities', { method: 'POST', body: { staff_id: +V('acs'), activity_date: V('acd'), activity: V('aca'), description: V('acx'), minutes_spent: num(V('acm')), output: V('aco'), evidence: V('ace') } }); mcl(); toast('Activity logged'); inv() } catch (err) { toast(err.message, 1) } }
  async function reviewAct(id, rs) { const c = rs === 'FLAGGED' ? prompt('Why is this flagged?') : ''; if (rs === 'FLAGGED' && !c) return; await act(() => A(`/activities/${id}/review`, { method: 'POST', body: { review_status: rs, comment: c } }), 'Saved') }

  /* ======================================================= OFFICE KPIs (monthly entry) ======================================================= */
  function ok() {
    const o = officeList(); if (!o) return loading(); if (bad(o)) return errBox(o);
    X.ko = X.ko || (o[0] && o[0].id);
    const d = X.ko ? need('kpir:' + X.pm + ':' + X.ko, () => A(`/kpi-results?month=${X.pm}&office_id=${X.ko}`)) : null;
    const head = `<h1>Office KPIs</h1><div class="p">Enter each KPI result for the month. Results feed the KPI part of the score. KPIs marked Auto are calculated by SAP2 from tasks, attendance and reports.</div>${mnav()}
<div class="row pf-noprint"><select onchange="X_f('ko',this.value)">${o.map(x => `<option value="${x.id}" ${String(X.ko) === String(x.id) ? 'selected' : ''}>${e(x.name)}</option>`).join('')}</select><button class="btn" onclick="PF.office(${X.ko})">Edit office / KPI settings</button></div>`;
    if (!d) return head + loading(); if (bad(d)) return head + errBox(d);
    if (!d.staff.length) return head + '<div class="fm">No administrative staff are assigned to this office yet.</div>';
    const val = (k, s) => { const r = d.results.find(x => x.kpi_id === k.id && x.staff_id === s.id && (x.month === X.pm || k.frequency === 'QUARTERLY')); return r ? (['RATING_10', 'QUALITY'].includes(k.measurement_type) ? r.rating : r.actual) : '' };
    const unit = k => ({ PERCENTAGE: '%', RATING_10: '/10', QUALITY: '/10', YES_NO: '1=Yes 0=No', NUMBER: '' }[k.measurement_type] || '');
    return head + tbl(['KPI', 'Target', 'Weight', 'Basis', ...d.staff.map(s => e(s.name))], d.kpis.map(k => `<tr><td class="wrap" style="min-width:240px"><b>${e(k.name)}</b></td><td>${k.target == null ? '—' : k.target} ${unit(k)}</td><td>${k.weight}</td><td>${k.auto_source ? '<span class="b sbM">Auto</span>' : e(label(k.frequency))}</td>${d.staff.map(s => k.auto_source ? '<td class="pf-mu">auto</td>' : `<td><input type="number" step="0.1" min="0" value="${e(val(k, s))}" data-old="${e(val(k, s))}" onchange="PF.saveKpiResult(${k.id},${s.id},this)"></td>`).join('')}</tr>`), 'No KPIs configured.', 'pf-kpi');
  }
  async function saveKpiResult(kid, sid, el) {
    const k = (X.c['kpir:' + X.pm + ':' + X.ko] || { kpis: [] }).kpis.find(x => x.id === kid); const rating = k && ['RATING_10', 'QUALITY'].includes(k.measurement_type);
    const body = { kpi_id: kid, staff_id: sid, month: X.pm, [rating ? 'rating' : 'actual']: num(el.value) };
    if (el.dataset.old !== '' && el.dataset.old !== el.value) { const why = prompt('This changes an existing result. Reason?'); if (!why) { el.value = el.dataset.old; return } body.reason = why }
    if (el.value === '') return;
    try { await A('/kpi-results', { method: 'PUT', body }); el.dataset.old = el.value; toast('KPI result saved'); delete X.c['dash:' + X.pm]; Object.keys(X.c).filter(k2 => k2.startsWith('score:')).forEach(k2 => delete X.c[k2]) } catch (err) { toast(err.message, 1); el.value = el.dataset.old }
  }

  /* ======================================================= PERFORMANCE REPORTS ======================================================= */
  const RT = [['monthly-performance', 'Monthly staff performance'], ['office-performance', 'Office performance'], ...(ATT ? [['attendance', 'Attendance']] : []), ['task-completion', 'Task completion'], ['kpi', 'KPI'], ['payroll-performance', 'Payroll performance'], ['staff-history', 'Staff history (trend)'], ['at-risk', 'At-risk staff']];
  function pr2() {
    const o = officeList(), key = `rep:${X.rtype}:${X.pm}:${X.off}:${X.stf}`;
    const d = need(key, () => A(`/performance-reports/${X.rtype}?month=${X.pm}${X.off ? '&office_id=' + X.off : ''}${X.stf ? '&staff_id=' + X.stf : ''}`));
    const head = `<h1>Performance Reports</h1><div class="p">Filter, then print or export. Figures come from the same calculation as the scoreboard.</div>${mnav()}
<div class="row pf-noprint"><select onchange="X_f('rtype',this.value)">${RT.map(([k, l]) => `<option value="${k}" ${X.rtype === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
<select onchange="X_f('off',this.value)"><option value="">All offices</option>${(o && !bad(o) ? o : []).map(x => `<option value="${x.id}" ${String(X.off) === String(x.id) ? 'selected' : ''}>${e(x.name)}</option>`).join('')}</select>
<select onchange="X_f('stf',this.value)"><option value="">All staff</option>${actives().map(s => `<option value="${s.id}" ${String(X.stf) === String(s.id) ? 'selected' : ''}>${e(s.name)}</option>`).join('')}</select>
<button class="btn" onclick="window.print()">🖨 Print</button><button class="btn" onclick="PF.csv()">Export CSV</button></div>`;
    if (!d) return head + loading(); if (bad(d)) return head + errBox(d);
    X.rep = d;
    return head + `<div class="pf-print-head"><h2 style="font-size:24px">Simba Technology Hub — ${e(d.title)}</h2><div>Month: ${e(d.month)} · Generated ${String(d.generated_at).slice(0, 16).replace('T', ' ')}</div></div><h2 class="pf-h">${e(d.title)} — ${e(d.month)}</h2>
${tbl(d.columns.map(c => e(c.label)), d.rows.map(r => `<tr>${d.columns.map(c => `<td>${e(r[c.key] == null ? '—' : r[c.key])}</td>`).join('')}</tr>`), 'No data for this report and filter.')}${d.totals ? `<div class="fm">${Object.entries(d.totals).map(([k, v]) => `${e(label(k))}: <b>${e(v)}</b>`).join(' · ')}</div>` : ''}`;
  }
  function csv() {
    const d = X.rep; if (!d) return; const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const t = [d.columns.map(c => q(c.label)).join(','), ...d.rows.map(r => d.columns.map(c => q(r[c.key])).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = `${d.type}-${d.month}.csv`; a.click();
  }

  /* ======================================================= ADMINISTRATIVE STAFF page (enhanced) ======================================================= */
  function admPage() {
    const sb = need('admsc:' + X.pm, () => A('/performance?month=' + X.pm)); const by = new Map(((sb && !bad(sb)) ? sb.rows : []).map(r => [r.staff_id, r]));
    const L = S().filter(s => isA(s) && (s.n + s.role + s.ph).toLowerCase().includes(q.toLowerCase()));
    const rep = r => { if (!r) return '—'; const c = r.details.components.find(x => x.component === 'reports').details; return c.not_submitted > 0 ? '<span class="b sbC">Missing</span>' : c.awaiting_review > 0 ? '<span class="b sbN">Awaiting review</span>' : c.weeks_due > 0 ? '<span class="b sbS">Up to date</span>' : '—' };
    const tk_ = r => { if (!r) return '—'; const c = r.details.components.find(x => x.component === 'task').details; return c.total ? `${c.done}/${c.total} · ${pc(r.task)}` : '—' };
    return `<h1>Administrative Staff</h1><div class="p">Salary, monthly performance and the pay recommendation. Click a name for the full performance page.</div>${mnav()}
<div class="row"><input placeholder="Search" value="${esc(q)}" oninput="q=this.value;render();this.focus()"></div>
${!sb ? '<div class="p">Loading performance…</div>' : bad(sb) ? errBox(sb) : ''}
<div class="tw"><table><tr><th>Name</th><th>Office</th><th>Salary</th><th>Score</th>${ATT ? '<th>Attendance</th>' : ''}<th>Tasks</th><th>Report</th><th>Payment recommendation</th><th>Status</th><th></th></tr>${L.map(s => {
      const r = by.get(s.id);
      return `<tr><td><button class="pf-link" onclick="PF.prof(${s.id})">${s.n}</button><div class="pf-note">${s.role}${s.t == 'B' ? ' + Instructor' : ''}</div></td><td>${r ? e(r.office || 'No office') : '—'}${r && !r.office_id ? ` <button class="pf-link" onclick="PF.assignOffice(${s.id})">Assign</button>` : ''}</td><td>${s.sal == null ? '<span class="l">Not set</span>' : fmt(s.sal)}</td>
<td>${r && r.has_data ? `<b>${pc(r.final_score)}</b> ${bandBadge(r)}` : '<span class="pf-mu">Not scored</span>'}</td>${ATT ? `<td>${r ? pc(r.attendance) : '—'}</td>` : ''}<td>${tk_(r)}</td><td>${rep(r)}</td><td>${r && r.has_data ? `${payBadge(r)} <span class="pf-note">${fmt(r.recommended_pay)}</span>` : '—'}${r && r.exit_review_required ? '<div><span class="b sbC">EXIT REVIEW REQUIRED</span></div>' : ''}</td>
<td>${bd(s.active ? 'Active' : 'Inactive', s.active ? 'Active' : 'Bad')}${r ? '<div>' + stateBadge(r.state) + '</div>' : ''}</td><td><button class="btn" onclick="prof(${s.id})">View / Edit</button> <button class="btn" onclick="PF.accessCode(${s.id})" title="Optional: a personal code for this one person, instead of the shared office code">Personal code</button></td></tr>`
    }).join('') || '<tr><td colspan="10" class="l">No administrative staff.</td></tr>'}</table></div>`;
  }

  /* ======================================================= PAYROLL page (adds performance columns) ======================================================= */
  function payPage() {
    const T = tot(), ok = [...sel].filter(k => T.R.find(r => r.k == k && !pd(r) && !r.aw && r.amt > 0));
    const awaiting = T.R.filter(r => r.aw && r.ps === 'FINALIZED').length, unscored = T.R.filter(r => r.aw && r.ps !== 'FINALIZED').length;
    return `<h1>Payroll</h1><div class="row" style="margin-top:6px"><button class="btn" onclick="setMo(mv(-1))">←</button><b>${mo}</b><button class="btn" onclick="setMo(mv(1))">→</button></div>
<div class="fm">Instructor pay = confirmed appearances × rate (unchanged). Administrative pay = base salary × the score-based percentage, and <b>only becomes payable after management approves it</b>. Calculated ≠ approved ≠ paid: only "Confirm Payroll" marks Paid.</div>
${awaiting ? `<div class="fm">${awaiting} administrative score(s) are finalized and waiting for approval. <button class="btn pr" onclick="PF.approvePay()">Approve recommended pay</button></div>` : ''}${unscored ? `<div class="fm">${unscored} administrative staff have no finalized performance score for ${mo}. <button class="pf-link" onclick="PF.X.tab='close';X.pm=mo;go('ap')">Open month closing</button></div>` : ''}
<div class="gr">${stat('Total Payroll', fmt(T.t), 1)}${stat('Instructor Payroll', fmt(T.i))}${stat('Administrative Payroll', fmt(T.a))}${stat('Paid / Pending', fmt(T.p) + ' / ' + fmt(T.pend))}</div>
<div class="row"><button class="btn pr" ${ok.length ? '' : 'disabled'} onclick="cfp()">Process Selected (${ok.length})</button></div>
<div class="tw"><table style="min-width:1150px"><tr><th></th><th>Staff</th><th>Type</th><th>Appts</th><th>Base salary / rate</th><th>Score</th><th>Recommended</th><th>Approved</th><th>Bonus (₦, edit)</th><th>Total payable</th><th>Actual paid</th><th>Status</th></tr>${T.R.map(r => {
      const adm = r.type !== 'Instructor';
      return `<tr><td><input type="checkbox" ${sel.has(r.k) ? 'checked' : ''} ${pd(r) || r.aw || r.amt == 0 ? 'disabled' : ''} onchange="tsel('${r.k}')"></td><td><b>${r.s.n}</b></td><td>${r.type}</td><td>${adm ? '—' : r.n}</td><td>${adm ? (r.bs == null ? '<span class="l">Not set</span>' : fmt(r.bs)) : fmt(r.rate)}</td>
<td>${adm ? (r.sc == null ? '<span class="pf-mu">—</span>' : `${pc(r.sc)}<div class="pf-note">${e(label(r.band))}</div>`) : '—'}</td><td>${adm ? (r.rec == null ? '—' : fmt(r.rec)) : '—'}</td><td>${adm ? (r.apv == null ? '<span class="pf-warn">Not approved</span>' : fmt(r.apv)) : '—'}</td>
<td><input type="number" min="0" step="1000" placeholder="0" value="${r.bonus || ''}" ${pd(r) ? 'disabled' : ''} style="width:100px" onchange="setB('${r.k}',this.value)"></td><td>${r.aw ? '<span class="pf-mu">' + fmt(r.amt) + ' (provisional)</span>' : fmt(r.amt)}</td><td>${r.actual == null ? '—' : fmt(r.actual)}</td>
<td>${r.aw ? '<span class="b sbN">Awaiting approval</span>' : bd(pd(r) ? 'Paid' : r.amt ? 'Pending' : 'No amount', pd(r) ? 'Paid' : r.amt ? 'Pending' : 'Bad')}</td></tr>`
    }).join('')}</table></div>`;
  }
  async function approvePay() {
    let sb; try { sb = await A('/performance?month=' + mo) } catch (err) { return toast(err.message, 1) }
    const items = sb.rows.filter(r => ['FINALIZED', 'CLOSED'].includes(r.state) && r.payroll.approved_pay == null && r.payroll.actual_paid == null).map(r => ({ staff_id: r.staff_id }));
    if (!items.length) return toast('Nothing to approve', 1);
    if (!confirm(`Approve the recommended pay for ${items.length} staff? Approving does not pay them.`)) return;
    try { await A('/payroll/approve', { method: 'POST', body: { month: mo, items } }); toast('Payroll approved'); await refresh() } catch (err) { toast(err.message, 1) }
  }


  /* ---------- file uploads / downloads (tasks, weekly reports, meeting minutes) ---------- */
  const authH = () => Object.assign({ 'x-api-key': typeof KEY === 'undefined' ? '' : KEY }, window.SP ? (window.SP.mode == 'personal' ? { 'x-staff-id': window.SP.id, 'x-staff-code': window.SP.code } : { 'x-staff-id': window.SP.id, 'x-office-code': window.SP.code }) : {});
  const fsize = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const MAXF = 25 * 1048576;
  async function upFile(file, q) {
    if (file.size > MAXF) throw new Error(`${file.name} is ${fsize(file.size)}. The limit is 25 MB. Upload bigger files to a drive and paste the link as evidence.`);
    const qs = new URLSearchParams(Object.assign({}, q, { name: file.name, mime: file.type || '' }));
    const r = await fetch(BASE + '/api/admin/files?' + qs, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, authH()), body: file });
    let j = null; try { j = await r.json() } catch (err) { }
    if (!r.ok) throw new Error((j && j.error) || 'Upload failed (' + r.status + ')');
    return j;
  }
  async function upFiles(list, q) { let n = 0; for (const f of list) { toast(`Uploading ${f.name} (${fsize(f.size)})…`); await upFile(f, q); n++ } return n }
  async function dlFile(id) {
    try {
      const r = await fetch(BASE + '/api/admin/files/' + id + '/download', { headers: authH() });
      if (!r.ok) { let j = null; try { j = await r.json() } catch (err) { } throw new Error((j && j.error) || 'Download failed') }
      const cd = r.headers.get('content-disposition') || '', m = /filename\*=UTF-8''([^;]+)/i.exec(cd), name = m ? decodeURIComponent(m[1]) : 'file';
      const url = URL.createObjectURL(await r.blob()), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) { toast(err.message, 1) }
  }
  const fbtns = fs => (fs || []).map(f => `<button class="pf-link" onclick="PF.dlFile(${f.id})" title="Download">&#128206; ${e(f.name)} <span class="pf-mu">(${fsize(f.size_bytes)})</span></button>`).join('<br>');
  const FKIND = { TASK: 'Task', REPORT: 'Weekly report', MEETING: 'Meeting', OTHER: 'Other' };
  function fl() {
    const f = X.fl || (X.fl = { kind: '', q: '' }), key = 'files:' + f.kind + '|' + f.q;
    const d = need(key, () => A('/files?' + new URLSearchParams({ kind: f.kind, q: f.q }))); if (!d) return `<h1>Files</h1>` + loading(); if (bad(d)) return `<h1>Files</h1>` + errBox(d);
    const total = d.reduce((a, x) => a + (x.size_bytes || 0), 0);
    return `<h1>Files</h1><div class="p">Every file staff attach to tasks, weekly reports and meeting minutes, with who sent it and when. Click a file to download it.</div>
<div class="row pf-noprint"><select onchange="PF.X.fl.kind=this.value;render()">${[['', 'All files'], ['TASK', 'Task files'], ['REPORT', 'Weekly report files'], ['MEETING', 'Meeting files'], ['OTHER', 'Other files']].map(([v, l]) => `<option value="${v}" ${v === f.kind ? 'selected' : ''}>${l}</option>`).join('')}</select><input placeholder="Search file, person, task or meeting" value="${e(f.q)}" onchange="PF.X.fl.q=this.value;render()" style="max-width:340px"><span class="pf-mu">${d.length} file(s) &middot; ${fsize(total)}</span></div>${(X.pa || !window.SP) ? `<div class="c pf-noprint"><b>Upload a file</b><div class="pf-note" style="margin:4px 0 8px">Add any file (document, video, CSV, ZIP, image). It is kept here with the date and your name.</div><input type="file" id="pafl" multiple> <button class="btn pr" onclick="PF.paUpload()">Upload</button></div>` : ''}
${tbl(['Sent', 'File', 'Type', 'For', 'Sent by', 'Office', ''], d.map(x => `<tr><td>${new Date(x.created_at).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</td><td class="wrap" style="min-width:180px"><button class="pf-link" onclick="PF.dlFile(${x.id})"><b>${e(x.name)}</b></button><div class="pf-note">${fsize(x.size_bytes)}${x.note ? ' · ' + e(x.note) : ''}</div></td><td><span class="b sbD">${FKIND[x.kind] || x.kind}</span></td><td class="wrap">${x.kind === 'TASK' ? e(x.task_title || 'Deleted task') : x.kind === 'REPORT' ? 'Week of ' + String(x.report_week).slice(0, 10) : x.kind === 'MEETING' ? e(x.meeting_title || 'Deleted meeting') : '—'}</td><td>${e(x.staff_name || x.uploaded_by || '—')}${x.staff_name && x.uploaded_by && x.uploaded_by !== x.staff_name ? `<div class="pf-note">uploaded by ${e(x.uploaded_by)}</div>` : ''}</td><td class="wrap">${e(x.office || '—')}</td><td><button class="btn" onclick="PF.dlFile(${x.id})">Download</button> <button class="btn" onclick="PF.delFile(${x.id})">Delete</button></td></tr>`), 'No files yet.')}`;
  }
  async function paUpload() { const l = [...(document.getElementById('pafl') || { files: [] }).files]; if (!l.length) return toast('Choose one or more files first', 1); try { const n = await upFiles(l, {}); toast(n + ' file(s) uploaded'); X.c = {}; render() } catch (err) { toast(err.message, 1); X.c = {}; render() } }
  async function delFile(id) { if (!confirm('Delete this file? This cannot be undone.')) return; try { await A('/files/' + id, { method: 'DELETE' }); toast('File deleted'); X.c = {}; render() } catch (err) { toast(err.message, 1) } }
  async function rUpload() {
    const fl_ = [...(document.getElementById('rfl') || { files: [] }).files]; if (!fl_.length) return toast('Choose one or more files first', 1);
    try { const n = await upFiles(fl_, { report_week: X.rw || mondayOf(nowYmd()) }); toast(n + ' file(s) attached to this week\'s report'); X.c = {}; render() } catch (err) { toast(err.message, 1); X.c = {}; render() }
  }
  /* Personal Assistant: set meetings, edit them, add minutes and files */
  function paMeet() {
    const d = need('pa:meet', () => A('/meetings')); if (!d) return loading(); if (bad(d)) return errBox(d);
    const fc = need('pa:mfiles', () => A('/files?kind=MEETING')) || [];
    return `<h1>Meetings</h1><div class="p">Set up meetings, change the time or place, and add the minutes and files. Everyone invited is notified straight away. Attendance is recorded by management.</div><div class="row pf-noprint"><button class="btn pr" onclick="PF.newMeeting()">Set a meeting</button></div>${tbl(['Date', 'Meeting', 'Invited', 'Minutes', 'Files', ''], d.filter(m => !m.private || m.mine).map(m => `<tr><td>${String(m.meeting_date).slice(0, 10)}${m.meeting_time ? '<div class="pf-note">' + String(m.meeting_time).slice(0, 5) + '</div>' : ''}</td><td class="wrap"><b>${e(m.title)}</b>${m.private ? ' <span class="b sbD">Private</span>' : ''}<div class="pf-note">${e(m.location || '')}</div></td><td>${m.participants}</td><td>${m.notes ? '<span class="b sbS">Added</span>' : '<span class="pf-mu">None yet</span>'}</td><td>${fc.filter(x => x.meeting_id === m.id).length || '—'}</td><td><button class="btn" onclick="PF.editMeeting(${m.id})">Edit time / details</button> <button class="btn pr" onclick="PF.paMin(${m.id})">Minutes & files</button></td></tr>`), 'No meetings yet.')}`;
  }
  async function paMin(id) {
    let m, fs; try { [m, fs] = await Promise.all([A('/meetings/' + id), A('/files?meeting_id=' + id)]) } catch (err) { return toast(err.message, 1) }
    window.__meet = m; const ap = m.action_points || [];
    M(`<h2 style="font-size:24px">${e(m.title)}</h2><div class="pf-note">${String(m.meeting_date).slice(0, 10)} ${e(String(m.meeting_time || '').slice(0, 5))} ${e(m.location || '')}</div>
<h2 class="pf-h">Minutes</h2><textarea id="mn" style="width:100%;min-height:120px" placeholder="Minutes / notes">${e(m.notes || '')}</textarea>
<div class="pf-note" style="margin:8px 0 4px">Action points, one per line: <code>text | due date YYYY-MM-DD | names separated by ;</code></div><textarea id="map" style="width:100%;min-height:80px">${e(ap.map(a => [a.text, a.due_date || '', (a.assignee_ids || []).map(i => (m.attendance.find(x => x.staff_id === i) || {}).staff_name).join('; ')].join(' | ')).join('\n'))}</textarea>
<h2 class="pf-h">Minutes files and attachments</h2>${fs.length ? `<div>${fbtns(fs)}</div>` : '<div class="pf-note">No files yet.</div>'}<div style="margin-top:8px"><input type="file" id="mfl" multiple><div class="pf-note">Word, PDF, text, video, CSV or ZIP, up to 25 MB each.</div></div>
${mfoot('Save minutes', `PF.paSaveMin(${id})`)}`);
  }
  async function paSaveMin(id) {
    const m = window.__meet, byName = n => (m.attendance.find(a => a.staff_name.toLowerCase() === n.trim().toLowerCase()) || {}).staff_id, old = m.action_points || [];
    const pts = V('map').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [text, due, who_] = l.split('|').map(x => (x || '').trim()); const prev = old.find(o => o.text === text); return { text, due_date: due || null, assignee_ids: (who_ || '').split(';').map(byName).filter(Boolean), priority: 'MEDIUM', task_id: prev ? prev.task_id : null } });
    try {
      await A('/meetings/' + id, { method: 'PATCH', body: { notes: V('mn'), action_points: pts } });
      const fl_ = [...(document.getElementById('mfl') || { files: [] }).files]; if (fl_.length) await upFiles(fl_, { meeting_id: id });
      mcl(); toast('Minutes saved'); X.c = {}; render()
    } catch (err) { toast(err.message, 1) }
  }
  /* ======================================================= STAFF PORTAL (staff see and submit only their own work) ======================================================= */
  try { const s = JSON.parse(sessionStorage.getItem('sap2staff') || 'null'); if (s && s.id && s.code) window.SP = s } catch (err) { }
  const portalOn = () => !!window.SP;
  function portalExit() { logout() }
  const PT = [['me', 'My performance'], ['tasks', 'My tasks'], ['acts', 'My activities'], ['rep', 'Weekly report'], ['deliv', 'Deliverables'], ['notif', 'Notifications']];
  // Extra read-only screens for the Personal Assistant (she coordinates staff). Pay, bank and salary data are never sent to her.
  const PA_T = [['pmeet', 'Meetings'], ['sched', 'Weekly schedule'], ['dir', 'All staff'], ['pperf', 'Staff performance'], ['atasks', 'All tasks'], ['preps', 'Weekly reports'], ['pfiles', 'Files'], ['ann', 'Send announcement']];
  const PA_CAMPS = ['Airport Road Campus', 'Ekehuan Campus', 'Ewah Campus', 'Ogida Campus', 'Ugbowo Campus'];
  function renderPortal() {
    const me0 = need('me:' + X.pm, () => A('/me?month=' + X.pm)); if (me0 && me0.pa) X.pa = true;
    if (me0 && me0.head) X.head = true;
    const tabs = PT.concat(X.pa ? PA_T : X.head ? HEAD_T : []);
    const lab = (k, l) => k === 'notif' && X.unread ? `${l} <span class="b sbC">${X.unread}</span>` : l;
    $('nv').innerHTML = tabs.map(([k, l]) => `<button class="${X.pt === k ? 'on' : ''}" onclick="PF.X.pt='${k}';render()">${lab(k, l)}</button>`).join('') + `<button onclick="PF.portalExit()">Exit staff portal</button>`;
    $('bt').innerHTML = tabs.filter(([k]) => ['me', 'tasks', 'rep', 'notif'].concat(X.pa ? ['pmeet', 'atasks'] : X.head ? ['htasks', 'hmeet'] : []).includes(k)).map(([k, l]) => `<button class="${X.pt === k ? 'on' : ''}" onclick="PF.X.pt='${k}';render()">${lab(k, l.replace('My ', '').replace('Notifications', 'Alerts').replace('Weekly schedule', 'Schedule').replace('All tasks', 'Tasks').replace('Team tasks', 'Team').replace('Team meetings', 'Meetings'))}</button>`).join('');
    if (!X.poll) { X.poll = setInterval(pollUnread, 60000); pollUnread() }
    let body;
    if (X.pa && X.pt === 'pmeet') body = paMeet(); else if (X.pa && X.pt === 'sched') body = paSched(); else if (X.pa && X.pt === 'dir') body = paDir(); else if (X.pa && X.pt === 'pperf') body = paPerf(); else if (X.pa && X.pt === 'atasks') body = paTasks(); else if (X.pa && X.pt === 'preps') body = paReps(); else if (X.pa && X.pt === 'pfiles') body = fl(); else if (X.pa && X.pt === 'ann') body = paAnn();
    else if (X.head && X.pt === 'hperf') body = paPerf(); else if (X.head && X.pt === 'htasks') body = hTasks(); else if (X.head && X.pt === 'hmeet') body = hMeet(); else if (X.head && X.pt === 'ann') body = paAnn();
    else if (X.pt === 'tasks') body = ptasks(); else if (X.pt === 'acts') body = pacts(); else if (X.pt === 'rep') body = prep(); else if (X.pt === 'deliv') body = pdeliv(); else if (X.pt === 'notif') body = pnotif(); else body = pme();
    $('m').innerHTML = mh() + body;
  }
  // The Creative Director heads the Content Creator and Social Media offices: team performance, tasks, private meetings and announcements for those two only.
  const HEAD_T = [['hperf', 'Team performance'], ['htasks', 'Team tasks'], ['hmeet', 'Team meetings'], ['ann', 'Send announcement']];
  const paStaff = () => need('pa:dir', () => A('/directory'));
  function paSched() {
    const d = paStaff(); if (!d) return loading(); if (bad(d)) return errBox(d);
    const ins = d.filter(s => s.active && ['instructor', 'both'].includes(s.staff_type));
    return `<h1>Weekly schedule</h1><div class="p">Campuses and how many times per week each instructor coaches. View only.</div><div class="gr" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">${PA_CAMPS.map(c => `<div class="c"><h2 style="font-size:22px;color:var(--or)">${e(c.replace(' Campus', ''))}</h2>${ins.filter(s => s.campuses.includes(c)).map(s => `<div style="padding:6px 0;border-top:1px solid var(--ln)"><b>${e(s.name)}</b><div class="l">${e(s.frequency || '')}${s.skills.length ? ' · ' + e(s.skills.join(', ')) : ''}</div></div>`).join('') || '<div class="l">No instructor yet</div>'}</div>`).join('')}</div>`;
  }
  function paDir() {
    const d = paStaff(); if (!d) return loading(); if (bad(d)) return errBox(d);
    const q = (X.paq || '').toLowerCase(), rows = d.filter(s => !q || (s.name + ' ' + (s.role || '') + ' ' + (s.office || '')).toLowerCase().includes(q));
    return `<h1>All staff</h1><div class="p">View only. Pay and bank details are not shown here.</div><input placeholder="Search name, role or office" value="${e(X.paq || '')}" onchange="PF.X.paq=this.value;render()" style="max-width:320px;margin-bottom:10px">${tbl(['Name', 'Role', 'Type', 'Office', 'Campuses', 'Phone', 'Email', 'Status'], rows.map(s => `<tr><td><b>${e(s.name)}</b></td><td class="wrap">${e(s.role || '')}</td><td>${e(label(s.staff_type))}</td><td class="wrap">${e(s.office || '—')}</td><td class="wrap">${e((s.campuses || []).map(c => c.replace(' Campus', '')).join(', ') || '—')}</td><td>${e(s.phone || '—')}</td><td class="wrap">${e(s.email || '—')}</td><td>${s.active ? '<span class="b sbS">Active</span>' : '<span class="b sbN">Inactive</span>'}</td></tr>`))}`;
  }
  function paPerf() {
    const d = need('pa:pb:' + X.pm, () => A('/performance?month=' + X.pm)); if (!d) return loading(); if (bad(d)) return errBox(d);
    return `<h1>Staff performance</h1><div class="p">View only. Scores and bands for administrative staff. Pay amounts are not shown.</div>${mnav()}${tbl(['#', 'Staff', 'Office', 'Score', 'Band', 'Tasks', 'Reports', 'Teamwork'], d.rows.map(r => `<tr><td>${r.rank}</td><td><b>${e(r.name)}</b><div class="pf-note">${e(r.role || '')}</div></td><td class="wrap">${e(r.office || '—')}</td><td>${r.has_data ? `<b>${pc(r.final_score)}</b>${bar(r.final_score)}` : '<span class="pf-mu">Not scored</span>'}</td><td>${r.has_data ? bandBadge(r) : '—'}</td><td>${pc(r.task)}</td><td>${pc(r.reports)}</td><td>${pc(r.teamwork)}</td></tr>`))}<div class="pf-note" style="margin-top:8px">A running month is scored by weeks (each week of the month counts equally), so scores rise as the month goes on.</div>`;
  }
  function paTasks() {
    const d = need('pa:tasks', () => A('/tasks')); if (!d) return loading(); if (bad(d)) return errBox(d);
    const offs = [...new Set(d.map(t => t.office).filter(Boolean))].sort(), f = X.pao || '';
    const rows = d.filter(t => !f || t.office === f);
    return `<h1>All tasks</h1><div class="p">Tasks assigned to every office. View only.</div><div class="row pf-noprint"><label class="l">Office</label><select onchange="PF.X.pao=this.value;render()"><option value="">All offices</option>${offs.map(o => `<option ${o === f ? 'selected' : ''}>${e(o)}</option>`).join('')}</select><span class="pf-mu">${rows.length} task(s)</span></div>${tbl(['Office', 'Assigned to', 'Task', 'Due', 'Status', 'Priority'], rows.map(t => `<tr><td class="wrap">${e(t.office || '—')}</td><td>${e(t.staff_name || '')}</td><td class="wrap" style="min-width:220px"><b>${e(t.title)}</b></td><td>${t.due_date}</td><td>${statusBadge(t.status)}</td><td>${e(label(t.priority))}</td></tr>`))}`;
  }

  const hTeam = () => need('h:team', () => A('/directory'));
  const hRefresh = () => { delete X.c['h:tasks']; delete X.c['h:meet']; render() };
  function hTasks() {
    const d = need('h:tasks', () => A('/tasks?team=1')), tm = hTeam(); if (!d || !tm) return loading(); if (bad(d)) return errBox(d);
    const rows = d.slice().sort((a, b) => (a.status === 'SUBMITTED' ? 0 : 1) - (b.status === 'SUBMITTED' ? 0 : 1) || b.task_id - a.task_id);
    return `<h1>Team tasks</h1><div class="p">Tasks for the Content Creator and Social Media offices. Give a task, then approve or send back what they submit.</div><div class="row pf-noprint"><button class="btn pr" onclick="PF.hNewTask()">Give a task</button><span class="pf-mu">${rows.filter(t => t.status === 'SUBMITTED').length} waiting for your approval</span></div>${tbl(['Assigned to', 'Task', 'Due', 'Status', 'Submitted work', ''], rows.map(t => `<tr><td>${e(t.staff_name)}<div class="pf-note">${e(t.office || '')}</div></td><td class="wrap" style="min-width:200px"><b>${e(t.title)}</b><div class="pf-note">${e(t.description || '')}</div></td><td>${String(t.due_date).slice(0, 10)}</td><td>${statusBadge(t.status)}</td><td class="wrap pf-det">${e(t.actual_output || '')}${t.evidence_url ? `<div><a href="${e(t.evidence_url)}" target="_blank" rel="noopener">Evidence</a></div>` : ''}${t.management_comment ? `<div class="pf-note">Feedback: ${e(t.management_comment)}</div>` : ''}</td><td>${t.status === 'SUBMITTED' ? `<button class="btn pr" onclick="PF.hReview(${t.task_id},${t.staff_id},'verify')">Approve</button> <button class="btn" onclick="PF.hReview(${t.task_id},${t.staff_id},'reject')">Send back</button>` : ''}</td></tr>`), 'No tasks for your team yet.')}`;
  }
  function hNewTask() {
    const tm = hTeam(); if (!tm || bad(tm)) return toast('Still loading, try again', 1);
    M(`<h2 style="font-size:24px">Give a task</h2><div class="pf-fg">${fg('ht_s', 'Give to', selx('ht_s', [['all', 'Everyone in my team']].concat(tm.filter(x => x.active).map(x => [x.id, x.name + ' (' + (x.office || '') + ')'])), 'all'))}${fg('ht_t', 'Task *', inp('ht_t', ''))}${fg('ht_d', 'Details', '<textarea id="ht_d"></textarea>')}${fg('ht_p', 'Priority', selx('ht_p', [['MEDIUM', 'Medium'], ['HIGH', 'High'], ['LOW', 'Low']], 'MEDIUM'))}${fg('ht_u', 'Due date *', inp('ht_u', '', 'type="date"'))}${fg('ht_e', 'Expected output', inp('ht_e', ''))}</div>${mfoot('Give task', 'PF.hDoTask()')}`);
  }
  async function hDoTask() {
    const tm = hTeam(), who = V('ht_s'); try {
      const ids = who === 'all' ? tm.filter(x => x.active).map(x => x.id) : [Number(who)];
      await A('/tasks', { method: 'POST', body: { title: V('ht_t'), description: V('ht_d'), scope: 'STAFF', staff_ids: ids, priority: V('ht_p'), due_date: V('ht_u'), expected_output: V('ht_e') } });
      mcl(); toast('Task given'); hRefresh()
    } catch (err) { toast(err.message, 1) }
  }
  function hReview(taskId, staffId, mode) {
    M(`<h2 style="font-size:24px">${mode === 'verify' ? 'Approve task' : 'Send back for correction'}</h2><div class="pf-fg">${mode === 'verify' ? fg('hr_s', 'Quality score (0-100)', inp('hr_s', '100', 'type="number" min="0" max="100"')) : ''}${fg('hr_c', mode === 'verify' ? 'Comment' : 'What must be fixed? *', '<textarea id="hr_c"></textarea>')}</div>${mfoot(mode === 'verify' ? 'Approve' : 'Send back', `PF.hDoReview(${taskId},${staffId},'${mode}')`)}`);
  }
  async function hDoReview(taskId, staffId, mode) {
    try { await A(`/tasks/${taskId}/${mode}`, { method: 'POST', body: { staff_id: staffId, comment: V('hr_c'), performance_score: mode === 'verify' ? V('hr_s') : undefined, final: true } }); mcl(); toast(mode === 'verify' ? 'Task approved' : 'Sent back'); hRefresh() } catch (err) { toast(err.message, 1) }
  }
  function hMeet() {
    const d = need('h:meet', () => A('/meetings')), tm = hTeam(); if (!d || !tm) return loading(); if (bad(d)) return errBox(d);
    const mine = d.filter(m => m.mine);
    return `<h1>Team meetings</h1><div class="p">Private meetings with your team. Only the people you invite, you and management can see them. Missed meetings are recorded and lower the person's score.</div><div class="row pf-noprint"><button class="btn pr" onclick="PF.hNewMeet()">Call a meeting</button></div>${tbl(['Date', 'Meeting', 'Invited', 'Present', 'Absent', ''], mine.map(m => `<tr><td>${String(m.meeting_date).slice(0, 10)}${m.meeting_time ? '<div class="pf-note">' + String(m.meeting_time).slice(0, 5) + '</div>' : ''}</td><td class="wrap"><b>${e(m.title)}</b><div class="pf-note">${e(m.location || '')}</div></td><td>${m.participants}</td><td>${m.present + m.late}</td><td>${m.absent ? `<span class="pf-warn">${m.absent}</span>` : 0}</td><td><button class="btn" onclick="PF.hAtt(${m.id})">Record attendance</button> <button class="btn" onclick="PF.editMeeting(${m.id})">Edit time</button></td></tr>`), 'You have not called any meeting yet.')}`;
  }
  function hNewMeet() {
    const tm = hTeam(); if (!tm || bad(tm)) return toast('Still loading, try again', 1);
    M(`<h2 style="font-size:24px">Call a private meeting</h2><div class="pf-fg">${fg('hm_t', 'Title *', inp('hm_t', ''))}${fg('hm_d', 'Date *', inp('hm_d', nowYmd(), 'type="date"'))}${fg('hm_h', 'Time', inp('hm_h', '', 'type="time"'))}${fg('hm_l', 'Where', inp('hm_l', ''))}${fg('hm_a', 'Agenda', '<textarea id="hm_a"></textarea>')}<label>Invite</label><div>${tm.filter(x => x.active).map(x => `<label style="display:flex;gap:8px;align-items:center;margin:4px 0"><input type="checkbox" class="hm_p" value="${x.id}" checked style="width:auto"> ${e(x.name)} <span class="pf-note">${e(x.office || '')}</span></label>`).join('')}</div></div>${mfoot('Call meeting', 'PF.hDoMeet()')}`);
  }
  async function hDoMeet() {
    const ids = [...document.querySelectorAll('.hm_p:checked')].map(x => Number(x.value));
    try { await A('/meetings', { method: 'POST', body: { title: V('hm_t'), meeting_date: V('hm_d'), meeting_time: V('hm_h') || null, location: V('hm_l'), agenda: V('hm_a'), required_staff_ids: ids } }); mcl(); toast('Meeting called. They have been notified.'); hRefresh() } catch (err) { toast(err.message, 1) }
  }
  async function hAtt(id) {
    let m; try { m = await A('/meetings/' + id) } catch (err) { return toast(err.message, 1) }
    const st = [['PRESENT', 'Present'], ['LATE', 'Late'], ['ABSENT', 'Absent (missed)'], ['EXCUSED', 'Excused']];
    M(`<h2 style="font-size:24px">${e(m.title)}</h2><div class="pf-note">${String(m.meeting_date).slice(0, 10)}. Absent and late are recorded and count toward the score.</div>${m.attendance.map(a => `<div class="row" style="margin:10px 0;align-items:flex-start"><div style="min-width:170px"><b>${e(a.staff_name)}</b></div>${selx('ha_s' + a.staff_id, st, a.status === 'PENDING' ? 'PRESENT' : a.status)}<input id="ha_r${a.staff_id}" placeholder="Remark (optional)" value="${e(a.remark || '')}" style="flex:1;min-width:140px"></div>`).join('')}${mfoot('Save attendance', `PF.hDoAtt(${id},[${m.attendance.map(a => a.staff_id)}])`)}`);
  }
  async function hDoAtt(id, ids) {
    try { await A(`/meetings/${id}/attendance`, { method: 'POST', body: { records: ids.map(i => ({ staff_id: i, status: V('ha_s' + i), remark: V('ha_r' + i) })) } }); mcl(); toast('Attendance saved'); hRefresh() } catch (err) { toast(err.message, 1) }
  }
  function paAnn() {
    return X.head ? `<h1>Send announcement</h1><div class="p">Send an email and an in-app / phone notification to your team: the Content Creator and the Social Media & Community Manager, or one of them.</div><button class="btn pr" onclick="PF.announce()">Write an announcement</button>` : `<h1>Send announcement</h1><div class="p">Send an email (and an in-app / phone notification) to administrative staff, all instructors, everyone, or one person.</div><button class="btn pr" onclick="PF.announce()">Write an announcement</button>`;
  }
  function pme() {
    const d = need('me:' + X.pm, () => A('/me?month=' + X.pm)); if (!d) return loading(); if (bad(d)) return errBox(d);
    const cl = d.calc, p = d.payroll || {};
    return `<h1>Hello, ${e(d.staff.name)}</h1><div class="p">${e(d.staff.office || 'No office assigned yet')} · ${e(d.staff.role || '')}</div>${mnav()}
<div class="pf-2"><div class="c"><div class="l">Your score for ${X.pm} (so far)</div><div class="pf-big">${pc(cl.final_score)}</div>${cl.month_progress_pct < 100 ? `<div class="pf-note">Month in progress: ${cl.weeks_elapsed} of ${cl.weeks_in_month} weeks counted (each week is worth ${Math.round(100 / cl.weeks_in_month)}%). Quality so far: ${pc(cl.pace_score)}.</div>` : ''}<div style="margin:6px 0">${bandBadge({ band: cl.performance_band, band_label: cl.band_label, final_score: cl.final_score })} ${payBadge({ payment_percentage: cl.payment_percentage })}</div>${bar(cl.final_score)}<div class="pf-note" style="margin-top:6px">Live estimate. It becomes official when management finalizes the month.</div></div>
<div class="c"><div class="l">Trend</div>${trendSvg(d.trend)}</div></div>
<h2 class="pf-h">Where your points come from</h2>${tbl(['Component', 'Weight', 'Your score'], cl.components.filter(c => !c.hidden).map(c => `<tr><td>${COMP_LABEL[c.component]}</td><td>${c.weight}%</td><td>${c.raw_score === null ? '<span class="pf-mu">No data yet</span>' : pc(c.raw_score * 100)}</td></tr>`), '', 'pf-tbl-small')}
${(cl.data_quality && cl.data_quality.warnings || []).length ? `<div class="fm">${cl.data_quality.warnings.map(e).join(' ')}</div>` : ''}
<h2 class="pf-h">My office responsibilities</h2><div class="c"><ul style="margin:0;padding-left:18px">${(d.responsibilities || []).map(r => `<li style="margin:3px 0">${e(r)}</li>`).join('')}</ul></div>
<h2 class="pf-h">My KPIs</h2>${tbl(['KPI', 'Target', 'Frequency'], (d.kpis || []).map(k => `<tr><td class="wrap">${e(k.name)}</td><td>${k.target == null ? '—' : k.target}</td><td>${e(label(k.frequency))}</td></tr>`), 'No KPIs.', 'pf-tbl-small')}`;
  }
  function ptasks() {
    const d = need('mt:' + X.pm, () => A('/tasks?month=' + X.pm)); if (!d) return loading(); if (bad(d)) return errBox(d);
    return `<h1>My tasks</h1><div class="p">Start a task, then submit your output and evidence. Management verifies it.</div>${mnav()}${tbl(['Task', 'Due', 'Status', 'Expected', 'Feedback', ''], d.map(t => `<tr><td class="wrap" style="min-width:200px"><b>${e(t.title)}</b><div class="pf-note">${e(t.description || '')}</div>${t.files && t.files.length ? `<div>${fbtns(t.files)}</div>` : ''}</td><td>${t.due_date}</td><td>${statusBadge(t.status)}</td><td class="wrap pf-det">${e(t.expected_output || '')}</td><td class="wrap pf-det">${e(t.management_comment || '')}</td><td>${t.status === 'TODO' ? `<button class="btn" onclick="PF.pStart(${t.task_id})">Start</button> ` : ''}${['TODO', 'IN_PROGRESS', 'OVERDUE'].includes(t.status) ? `<button class="btn pr" onclick="PF.pSubmit(${t.task_id})">Submit</button>` : ''}</td></tr>`), 'No tasks assigned to you this month.')}`;
  }
  async function pStart(id) { try { await A(`/tasks/${id}/start`, { method: 'POST', body: {} }); toast('Task started'); X.c = {}; render() } catch (err) { toast(err.message, 1) } }
  function pSubmit(id) { M(`<h2 style="font-size:24px">Submit task</h2><div class="pf-fg">${fg('po', 'What you did', '<textarea id="po"></textarea>')}${fg('pe2', 'Evidence link', inp('pe2', '', 'placeholder="https://…"'))}${fg('pfl', 'Attach files', '<input type="file" id="pfl" multiple><div class="pf-note">Text, CSV, ZIP, video, images, PDF or Office files, up to 25 MB each.</div>')}</div>${mfoot('Submit', `PF.pDoSubmit(${id})`)}`) }
  async function pDoSubmit(id) { try { const fl_ = [...(document.getElementById('pfl') || { files: [] }).files]; if (fl_.length) await upFiles(fl_, { task_id: id }); await A(`/tasks/${id}/submit`, { method: 'POST', body: { actual_output: V('po'), evidence_url: V('pe2') } }); mcl(); toast('Submitted for verification'); X.c = {}; render() } catch (err) { toast(err.message, 1) } }
  function pacts() {
    const d = need('ma:' + X.pm, () => A('/activities?month=' + X.pm)); if (!d) return loading(); if (bad(d)) return errBox(d);
    return `<h1>My activities</h1><div class="p">Log what you work on each day.</div>${mnav()}<div class="row"><button class="btn pr" onclick="PF.pNewAct()">+ Log activity</button></div>${tbl(['Date', 'Activity', 'Minutes', 'Output', 'Review'], d.map(a => `<tr><td>${a.activity_date}</td><td class="wrap"><b>${e(a.activity)}</b><div class="pf-note">${e(a.description || '')}</div></td><td>${a.minutes_spent == null ? '—' : a.minutes_spent}</td><td class="wrap pf-det">${e(a.output || '')}</td><td>${statusBadge(a.review_status)}</td></tr>`), 'Nothing logged yet.')}`;
  }
  function pNewAct() { M(`<h2 style="font-size:24px">Log activity</h2><div class="pf-fg">${fg('acd', 'Date', inp('acd', TODAY, 'type="date"'))}${fg('aca', 'Activity *', inp('aca', ''))}${fg('acx', 'Description', '<textarea id="acx"></textarea>')}${fg('acm', 'Minutes spent', inp('acm', '', 'type="number" min="0"'))}${fg('aco', 'Output', inp('aco', ''))}${fg('ace', 'Evidence link', inp('ace', ''))}</div>${mfoot('Save', 'PF.pSaveAct()')}`) }
  async function pSaveAct() { try { await A('/activities', { method: 'POST', body: { activity_date: V('acd'), activity: V('aca'), description: V('acx'), minutes_spent: num(V('acm')), output: V('aco'), evidence: V('ace') } }); mcl(); toast('Activity logged'); X.c = {}; render() } catch (err) { toast(err.message, 1) } }
  const nowYmd = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') };
  const addD = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) };
  function prep() {
    const d = need('mrall', () => A('/reports')); if (!d) return loading(); if (bad(d)) return errBox(d);
    const thisWk = mondayOf(nowYmd());
    const g = need('rwnow', () => A('/reports/window')); if (!g) return loading(); if (bad(g)) return errBox(g);
    if (!X.rw) X.rw = g.open_week || thisWk; /* the week that is accepting reports right now */
    const wk = X.rw, cur = d.find(r => r.week_start === wk) || {};
    const w = need('rw:' + wk, () => A('/reports/window?week_start=' + wk)); if (!w) return loading(); if (bad(w)) return errBox(w);
    const fmt = iso => new Date(iso).toLocaleString([], { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const canEdit = w.state === 'OPEN' || cur.status === 'REJECTED';
    const locked = ['SUBMITTED', 'APPROVED'].includes(cur.status) || !canEdit, future = wk > thisWk && w.state === 'NOT_OPEN';
    const banner = w.state === 'OPEN' ? `<div class="pf-note" style="color:var(--ok,#1a7f37)"><b>Open</b> - this report is for ${wk} to ${addD(wk, 6)}; closes ${fmt(w.closes)}.</div>` : w.state === 'NOT_OPEN' ? `<div class="pf-note"><b>Not open yet</b> - opens ${fmt(w.opens)}.${g.open_week ? ` <button class="btn" onclick="PF.rwk(0,'${g.open_week}')">Go to the open week (${g.open_week})</button>` : ''}</div>` : `<div class="pf-note" style="color:var(--bad,#b42318)"><b>Closed</b> - this week's window ended ${fmt(w.closes)}. Ask management if you need it recorded.${g.open_week ? ` <button class="btn" onclick="PF.rwk(0,'${g.open_week}')">Go to the open week (${g.open_week})</button>` : ''}</div>`;
    return `<h1>Weekly report</h1><div class="p">Reports for each week (Monday to Sunday) open on Friday at 1:00 am and close on Sunday at 11:00 pm. Pick the week, then fill in or drop your report. ${cur.status ? 'Status: ' : ''}${cur.status ? statusBadge(cur.status) : ''} ${cur.review_comment ? '· Management: ' + e(cur.review_comment) : ''}</div>
<div class="row pf-noprint"><button class="btn" onclick="PF.rwk(-7)">← Previous week</button><input type="date" id="rwpick" value="${wk}" onchange="PF.rwk(0,this.value)" style="width:170px"><button class="btn" onclick="PF.rwk(7)" ${wk >= thisWk ? 'disabled' : ''}>Next week →</button><button class="btn" onclick="PF.rwk(0,'${thisWk}')">This week</button><span class="pf-mu">Week of ${wk} to ${addD(wk, 6)}</span></div>
${banner}<div class="c">${locked ? '' : `<div id="rdrop" style="border:2px dashed var(--bd,#999);border-radius:10px;padding:14px;text-align:center;margin-bottom:12px" ondragover="event.preventDefault()" ondrop="PF.rdrop(event)">Drop your report file here (.txt, .md, .csv) or <label style="text-decoration:underline;cursor:pointer">browse<input type="file" accept=".txt,.md,.csv,.json,text/plain" style="display:none" onchange="PF.rfile(this.files[0])"></label><div class="pf-note">The text goes into "Major activities" so you can edit it. For PDF/Word files, upload to Drive and paste the link under Evidence / links.</div></div>`}
<div class="pf-fg">${RF.map(([k, l]) => fg('rf_' + k, l, `<textarea id="rf_${k}" ${locked ? 'disabled' : ''}>${e(cur[k] || '')}</textarea>`)).join('')}</div>${locked ? `<div class="pf-note">${['SUBMITTED', 'APPROVED'].includes(cur.status) ? 'Submitted reports cannot be edited.' : 'This report cannot be edited right now.'}</div>` : future ? '' : `<div class="row" style="margin:10px 0 0"><button class="btn" onclick="PF.pSaveRep(false)">Save draft</button><button class="btn pr" onclick="PF.pSaveRep(true)">Submit report</button></div>`}</div>
<h2 class="pf-h">Attach files to this week's report</h2><div class="c">${(() => { const wf = need('wf:' + wk, () => A('/files?kind=REPORT')); const mine = wf && !bad(wf) ? wf.filter(x => String(x.report_week).slice(0, 10) === wk) : null; return (mine === null ? '<div class="pf-note">Loading files…</div>' : mine.length ? `<div style="margin-bottom:8px">${fbtns(mine)}</div>` : '<div class="pf-note" style="margin-bottom:8px">No files attached yet.</div>') })()}<input type="file" id="rfl" multiple> <button class="btn pr" onclick="PF.rUpload()">Upload files</button><div class="pf-note">Videos, CSV, ZIP, text, images, PDF or Office files, up to 25 MB each. Management can download them.</div></div>
<h2 class="pf-h">All my reports</h2>${tbl(['Week', 'Status', 'Timeliness', ''], d.map(r => `<tr><td>${r.week_start}</td><td>${statusBadge(r.status)}</td><td>${r.status === 'DRAFT' ? '—' : r.on_time ? 'On time' : 'Late'}</td><td><button class="btn" onclick="PF.rwk(0,'${r.week_start}')">Open</button></td></tr>`), 'No reports yet.', 'pf-tbl-small')}`;
  }
  function rwk(n, v) { X.rw = mondayOf(v || addD(X.rw || mondayOf(nowYmd()), n)); render() }
  function rfile(f) { if (!f) return; if (f.size > 200000) return toast('File too large - paste the text or use a link', 1); const r = new FileReader(); r.onload = () => { const t = document.getElementById('rf_activities'); if (t) t.value = (t.value ? t.value + '\n\n' : '') + String(r.result).slice(0, 20000); toast('Report loaded - check it, then Save or Submit') }; r.readAsText(f) }
  function rdrop(ev) { ev.preventDefault(); const f = ev.dataTransfer && ev.dataTransfer.files[0]; if (f && !/\.(txt|md|csv|json)$/i.test(f.name)) return toast('Only text files can be read here. Upload PDF/Word to Drive and paste the link under Evidence.', 1); rfile(f) }
  async function pSaveRep(submit) { const b = { week_start: X.rw || mondayOf(nowYmd()), submit }; RF.forEach(([k]) => b[k] = V('rf_' + k)); try { await A('/reports', { method: 'POST', body: b }); toast(submit ? 'Report submitted' : 'Draft saved'); X.c = {}; render() } catch (err) { toast(err.message, 1) } }
  /* ---------- notifications (staff) ---------- */
  async function pollUnread() {
    if (!portalOn()) { clearInterval(X.poll); X.poll = null; return }
    try { const d = await A('/notifications'); const old = X.unread || 0; X.unread = d.unread; if (d.unread !== old) { if (d.unread > old && old !== undefined && X.pt !== 'notif') toast('You have a new notification'); if (X.pt === 'notif') X.c = {}; render() } } catch (err) { }
  }
  const ago = iso => { const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' }) };
  function pnotif() {
    const d = need('notifs', () => A('/notifications')); if (!d) return loading(); if (bad(d)) return errBox(d);
    const cfg = need('notifcfg', () => A('/notifications/config')) || {};
    X.unread = d.unread;
    const phone = d.devices ? `<span class="b sbS">Phone notifications ON (${d.devices} device${d.devices > 1 ? 's' : ''})</span>` : '<span class="b sbN">Phone notifications OFF</span>';
    return `<h1>Notifications</h1><div class="p">New tasks, reviews, meetings and report reminders appear here${cfg.email ? ' and are emailed to you' : ''}.</div>
<div class="c" style="margin-bottom:14px"><div class="row" style="margin:0;gap:8px;align-items:center">${phone}<button class="btn pr" onclick="PF.pPush()">${d.devices ? 'Re-enable on this device' : 'Turn on phone notifications'}</button><button class="btn" onclick="PF.pTestNotif()">Send me a test</button><button class="btn" onclick="PF.pReadAll()" ${d.unread ? '' : 'disabled'}>Mark all as read</button></div>
<div class="pf-note" style="margin-top:8px">Android: tap "Turn on phone notifications" and allow. iPhone: first tap Share, then "Add to Home Screen", open SAP2 from the Home Screen icon, then turn them on.</div></div>
${d.items.length ? d.items.map(n => `<div class="c" style="margin:8px 0;cursor:pointer;${n.read_at ? 'opacity:.7' : 'border-left:4px solid var(--ac,#c9a227)'}" onclick="PF.pOpenNotif(${n.id},'${e(n.link || '')}')"><div class="row" style="margin:0;justify-content:space-between"><b>${e(n.title)}</b><span class="pf-note">${ago(n.created_at)}</span></div>${n.body ? `<div class="pf-note" style="white-space:pre-line">${e(n.body)}</div>` : ''}</div>`).join('') : '<div class="c">Nothing yet.</div>'}`;
  }
  async function pOpenNotif(id, link) { try { await A('/notifications/read', { method: 'POST', body: { ids: [id] } }) } catch (err) { } X.c = {}; if (link && PT.some(([k]) => k === link)) X.pt = link; pollUnread(); render() }
  async function pReadAll() { try { await A('/notifications/read', { method: 'POST', body: {} }); X.c = {}; X.unread = 0; render() } catch (err) { toast(err.message, 1) } }
  async function pTestNotif() { try { await A('/notifications/test', { method: 'POST', body: {} }); toast('Test sent - it appears below' + ((need('notifcfg', () => A('/notifications/config')) || {}).email ? ' and by email' : '')); X.c = {}; setTimeout(pollUnread, 1500); render() } catch (err) { toast(err.message, 1) } }
  const u8 = b64 => { const p = '='.repeat((4 - b64.length % 4) % 4), r = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map(c => c.charCodeAt(0))) };
  const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  async function pPush() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return toast('This browser cannot receive phone notifications. On iPhone use Share > Add to Home Screen first, then open SAP2 from that icon.', 1);
      const cfg = await A('/notifications/config'); if (!cfg.push) return toast('Phone notifications are not switched on yet. Please ask management.', 1);
      if ((await Notification.requestPermission()) !== 'granted') return toast('Notifications were blocked. Allow them in your browser/site settings, then try again.', 1);
      const reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(cfg.publicKey) });
      await A('/notifications/push-subscribe', { method: 'POST', body: { endpoint: sub.endpoint, keys: { p256dh: b64u(sub.getKey('p256dh')), auth: b64u(sub.getKey('auth')) }, user_agent: navigator.userAgent.slice(0, 200) } });
      toast('Phone notifications are on for this device'); X.c = {}; render();
    } catch (err) { toast(err.message || 'Could not turn on notifications', 1) }
  }
  /* ---------- notifications (management) ---------- */
  function notifSection() {
    const d = need('notifsAdmin', () => A('/notifications')); if (!d) return '';
    if (bad(d)) return '';
    const on = (v, t) => v ? `<span class="b sbS">${t}</span>` : `<span class="b sbN">${t} - not set up</span>`;
    return `<h2 class="pf-h">Notifications</h2><div class="c" style="margin-bottom:14px"><div class="row" style="margin:0;gap:8px;align-items:center">${on(d.email, 'Email' + (d.email ? ' (' + d.email + ')' : ''))}${on(d.push, 'Phone alerts')}${on(d.sms, 'SMS')}<span class="pf-note">${d.devices || 0} phone(s) registered</span><button class="btn pr" onclick="PF.announce()">Send announcement</button></div>
<div class="pf-note" style="margin-top:8px">Staff are notified automatically about new tasks, approvals/rejections, report reviews, meetings, deliverables, and report/task reminders.</div>
${tbl(['When', 'Staff', 'Message', 'In app', 'Email', 'Phone', 'SMS'], d.items.slice(0, 15).map(n => `<tr><td>${ago(n.created_at)}</td><td>${e(n.staff_name || '')}</td><td class="wrap"><b>${e(n.title)}</b></td><td>${n.read_at ? 'Read' : 'Unread'}</td><td>${e(n.email_status || '-')}</td><td>${e(n.push_status || '-')}</td><td>${e(n.sms_status || '-')}</td></tr>`), 'No notifications sent yet.', 'pf-tbl-small')}</div>`;
  }
  async function announce() { try { if (!staffList() || bad(staffList())) { const d = await A(portalOn() ? '/directory' : '/staff'); X.c.staff = d } } catch (err) { toast(err.message, 1) } M(`<h2 style="font-size:24px">Send announcement</h2><div class="pf-note">Sent by email (and in the app / to phones for staff who use them).</div><div class="pf-fg">${X.head ? `<input type="hidden" id="an_a" value="ADMIN"><div class="pf-note" style="grid-column:1/-1">Goes to your team (Content Creator and Social Media) unless you pick one person below.</div>` : fg('an_a', 'Send to', selx('an_a', [['ADMIN', 'Administrative staff'], ['INSTRUCTORS', 'All instructors'], ['ALL', 'Everyone (staff and instructors)']], 'ADMIN'))}${fg('an_p', 'Or send to one person only', selx('an_p', [['', '- Use the group above -']].concat(actives().map(x => [x.id, x.name])), ''))}${fg('an_t', 'Title *', inp('an_t', ''))}<label style="display:flex;gap:8px;align-items:center;margin:6px 0"><input id="an_s" type="checkbox" style="width:auto"> Also send as SMS (uses SMS credit)</label>${fg('an_b', 'Message', '<textarea id="an_b"></textarea>')}</div>${mfoot('Send', 'PF.doAnnounce()')}`) }
  async function doAnnounce() { try { const r = await A('/notifications/send', { method: 'POST', body: { title: V('an_t'), body: V('an_b'), audience: V('an_a'), staff_ids: V('an_p') ? [Number(V('an_p'))] : undefined, sms: VC('an_s') } }); mcl(); toast('Sent to ' + r.sent + ' staff'); X.c = {}; render() } catch (err) { toast(err.message, 1) } }
  function pdeliv() {
    const d = need('md:' + X.pm, () => A('/deliverables?month=' + X.pm)); if (!d) return loading(); if (bad(d)) return errBox(d);
    return `<h1>Deliverables</h1><div class="p">Work products management expects from you.</div>${mnav()}${tbl(['Deliverable', 'Expected', 'Status', 'Feedback', ''], d.map(x => `<tr><td class="wrap"><b>${e(x.title)}</b><div class="pf-note">${e(x.deliverable_type || '')}</div></td><td>${x.expected_date}${x.overdue ? ' <span class="b sbC">Overdue</span>' : ''}</td><td>${statusBadge(x.status)}</td><td class="wrap pf-det">${e(x.review_comment || '')}</td><td>${['EXPECTED', 'REJECTED'].includes(x.status) ? `<button class="btn pr" onclick="PF.pDelivSub(${x.id})">Submit</button>` : ''}</td></tr>`), 'No deliverables this month.')}`;
  }
  function pDelivSub(id) { M(`<h2 style="font-size:24px">Submit deliverable</h2><div class="pf-fg">${fg('dev', 'Link to the work *', inp('dev', ''))}</div>${mfoot('Submit', `PF.pDoDeliv(${id})`)}`) }
  async function pDoDeliv(id) { try { await A(`/deliverables/${id}/submit`, { method: 'POST', body: { evidence_url: V('dev') } }); mcl(); toast('Submitted for review'); X.c = {}; render() } catch (err) { toast(err.message, 1) } }

  /* ======================================================= management: access codes (used from the staff profile / Administrative Staff page) ======================================================= */
  async function accessCode(id) {
    if (!confirm('Create a new personal access code for this staff member? Any earlier code stops working.')) return;
    try { const r = await A(`/staff/${id}/access-code`, { method: 'POST', body: {} }); M(`<h2 style="font-size:24px">Staff access code</h2><p class="l">Optional personal code. Give it to the staff member now; it is shown only once. On the login page they choose Staff, then \"I have a personal code instead\".</p><dl><dt>Staff ID</dt><dd><b>${id}</b></dd><dt>Access code</dt><dd><b style="font-size:22px;letter-spacing:.1em;color:var(--or)">${e(r.code)}</b></dd></dl><div class="row" style="margin:14px 0 0;justify-content:flex-end"><button class="btn pr" onclick="mcl()">Done</button></div>`) } catch (err) { toast(err.message, 1) }
  }

  /* ======================================================= wiring ======================================================= */
  window.XV = { ap, tk, aa, mt, wr, ok, pr2, fl, adm: admPage, pay: payPage };
  window.PF = {
    flags, att: () => ATT, X, tab: t => { X.tab = t; render() }, mv: d => { X.pm = mPlus(X.pm, d); render() }, setM: v => { if (/^\d{4}-\d{2}$/.test(v)) { X.pm = v; render() } },
    prof, recalc, finalize, reopenRv, doReopen, adjust, doAdjust, teamwork, doTeamwork, comment, doComment, decision, doDecision, approve, doApprove, calcAll, ack, assignOffice, doOffice,
    office, editKpi, saveKpi, editResp, saveResp, editOffice, saveOffice, finAll, closeMonth, doClose, reopenMonth, doReopenMonth, approveAll, saveSettings, resetSettings: () => { delete X.c.settings; render() },
    newTask, saveTask, review, doReview, submitFor, doSubmitFor, cancelTask, doCancel, newDeliv, saveDeliv, submitDeliv, doSubmitDeliv, reviewDeliv, doReviewDeliv,
    recordAtt, saveAtt, newMeeting, saveMeeting, editMeeting, saveMeetingEdit, openMeeting, saveMeetAtt, saveMinutes, newReport, saveReport, openReport, doReport, newAct, saveAct, reviewAct, saveKpiResult, csv, approvePay,
    portalOn, portalExit, viewTask, viewStaffTasks, togglePriv, pickAll, syncAll, paUpload, tickGroup, dlFile, delFile, rUpload, paMin, paSaveMin, hNewTask, hDoTask, hReview, hDoReview, hNewMeet, hDoMeet, hAtt, hDoAtt, pPush, pTestNotif, pReadAll, pOpenNotif, announce, doAnnounce, pollUnread, genCode, genAllOffices, copyCode, renderPortal, pStart, pSubmit, pDoSubmit, pNewAct, pSaveAct, pSaveRep, rwk, rfile, rdrop, pDelivSub, pDoDeliv, accessCode,
    pm: () => X.pm, setMonthFromPayroll: m => { X.pm = m }
  };
})();
