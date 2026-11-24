'use strict';
/* Авто Сфера · Управленка
   Данные: Firebase Realtime Database, узел /as. Вход: Firebase Auth (почта + пароль).
   Доступ: узел /members/<почта с запятыми вместо точек> = {name, role: "edit" | "view"}.
   Без config.js или с ?demo открывается демо-режим с вымышленными данными. */

// ───────── утилиты ─────────
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = v => { const n = parseFloat(String(v ?? '').replace(/\s/g,'').replace(',','.')); return isFinite(n) ? n : 0; };
const fmt = n => (n == null || !isFinite(n)) ? '—' : Math.round(n).toLocaleString('ru-RU');
const rub = n => fmt(n) + ' ₽';
const signed = n => (n > 0 ? '+' : '') + fmt(n);
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); };
const pd = s => s ? new Date(s + 'T00:00:00') : null;
const daysBetween = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
const dstr = s => s ? s.slice(8,10) + '.' + s.slice(5,7) + '.' + s.slice(0,4) : '';
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const monthLabel = ym => MONTHS[+ym.slice(5,7)-1] + ' ' + ym.slice(0,4);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const emailKey = e => String(e || '').toLowerCase().replace(/\./g, ',');
const managerOf = d => String(d.manager || '').split('(')[0].trim() || '—';
const vals = o => o ? Object.entries(o).map(([k, v]) => ({...v, id: k})) : [];

const DEFAULT_SETTINGS = {
  investorPct: 50,
  vatRate: 22,
  investors: { rostov: {name: 'Ростов', capital: 6000000}, tolik: {name: 'Толик', capital: 3000000} },
  rs: 0, rsDate: '', rsBy: ''
};
const STATUS = { bron: 'Бронь', work: 'В работе', sold: 'Продано' };
const STATUS_TAG = { bron: 't-bron', work: 't-work', sold: 't-sold' };

// ───────── состояние ─────────
const CFG = window.AS_FIREBASE_CONFIG || null;
const DEMO = !CFG || new URLSearchParams(location.search).has('demo');
let D = {};            // сырые данные узла /as
let me = null;         // {email, key, name, role}
let tab = 'summary';
let dealFilter = { status: 'all', month: 'all', manager: 'all', q: '' };
let db = null, auth = null;

// ───────── хранилище ─────────
const Store = {
  _demo: {},
  _emit() { D = JSON.parse(JSON.stringify(this._demo)); render(); },
  _setPath(obj, path, val) {
    const parts = path.split('/'); let o = obj;
    for (let i = 0; i < parts.length - 1; i++) { if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {}; o = o[parts[i]]; }
    const last = parts[parts.length-1];
    if (val === null || val === undefined) delete o[last]; else o[last] = JSON.parse(JSON.stringify(val));
  },
  async set(path, val) {
    if (DEMO) { this._setPath(this._demo, path, val); this._emit(); return; }
    setSync('save'); try { await db.ref('as/' + path).set(val); setSync('ok'); } catch (e) { onWriteError(e); }
  },
  async update(map) {
    if (DEMO) { for (const [p, v] of Object.entries(map)) this._setPath(this._demo, p, v); this._emit(); return; }
    setSync('save'); try { await db.ref('as').update(map); setSync('ok'); } catch (e) { onWriteError(e); }
  },
  listen() {
    if (DEMO) { this._demo = demoData(); this._emit(); return; }
    db.ref('as').on('value', snap => { D = snap.val() || {}; render(); }, err => {
      $('#view').innerHTML = `<div class="alert-r">Не удалось прочитать данные: ${esc(err.message)}</div>`;
    });
  }
};
function onWriteError(e) { setSync('err'); alert('Не сохранилось: ' + (e && e.message || e)); }
function setSync(s) {
  const dot = $('#sdot'), l = $('#slbl'); if (!dot) return;
  dot.className = 'sdot ' + (s === 'save' ? 'ssav' : s === 'err' ? 'serr' : 'sok');
  l.textContent = s === 'save' ? 'сохраняем…' : s === 'err' ? 'ошибка сохранения' : 'синхронизировано';
}
const stamp = () => ({ by: me ? me.name : '', ts: Date.now() });

// ───────── расчёты ─────────
function settings() {
  const s = Object.assign({}, DEFAULT_SETTINGS, D.settings || {});
  s.investors = (D.settings && D.settings.investors) || DEFAULT_SETTINGS.investors;
  return s;
}
function calcDeal(d, s) {
  const sold = d.status === 'sold';
  const sell = num(d.sell), buy = num(d.buy), exp = num(d.exp), bonus = num(d.bonus);
  const rate = num(s.vatRate), pct = num(s.investorPct);
  const margin = sold ? sell - buy - exp - bonus : 0;
  const vat = sold ? (sell - buy) * rate / (100 + rate) : 0;
  const hasP = d.profitOverride !== undefined && d.profitOverride !== null && d.profitOverride !== '';
  const profit = sold ? (hasP ? num(d.profitOverride) : margin - vat) : 0;
  const hasI = d.investorOverride !== undefined && d.investorOverride !== null && d.investorOverride !== '';
  const investor = sold ? (hasI ? num(d.investorOverride) : Math.max(profit, 0) * pct / 100) : 0;
  const end = sold ? (d.sellDate || null) : todayStr();
  const days = d.buyDate && end ? daysBetween(d.buyDate, end) : null;
  return { sold, sell, buy, exp, bonus, margin, vat, profit, investor, company: profit - investor, days, hasP, hasI };
}
function model() {
  const s = settings();
  const deals = vals(D.deals).filter(x => !x.deleted).map(d => ({...d, c: calcDeal(d, s)}))
    .sort((a, b) => (a.buyDate || '').localeCompare(b.buyDate || '') || (a.ts || 0) - (b.ts || 0));
  const sold = deals.filter(d => d.c.sold), active = deals.filter(d => !d.c.sold);
  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const invested = sum(active, d => num(d.buy) + num(d.exp));
  const earned = sum(sold, d => d.c.investor);
  const payouts = vals(D.payouts).filter(x => !x.deleted).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const paid = sum(payouts, p => num(p.amount));
  const due = earned - paid;
  const recv = vals(D.recv).filter(x => !x.deleted), owe = vals(D.owe).filter(x => !x.deleted);
  const pay = vals(D.pay).filter(x => !x.deleted).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const recvT = sum(recv, x => num(x.amount)), oweT = sum(owe, x => num(x.amount)), payT = sum(pay, x => num(x.amount));
  const rs = num(s.rs);
  const plan = sum(Object.values(s.investors), i => num(i.capital));
  const fact = rs + invested + recvT - oweT - due;
  const gap = fact - plan;
  // инвесторы
  const invList = Object.entries(s.investors).map(([id, i]) => {
    const share = plan ? num(i.capital) / plan : 0;
    const paidI = sum(payouts, p => p.investor === id ? num(p.amount) : (p.investor === 'all' || !p.investor) ? num(p.amount) * share : 0);
    return { id, name: i.name, capital: num(i.capital), share, earned: earned * share, paid: paidI, due: earned * share - paidI };
  });
  // квартал
  const now = new Date(), q = Math.floor(now.getMonth() / 3);
  const qs = now.getFullYear() + '-' + pad(q*3+1) + '-01', qe = now.getFullYear() + '-' + pad(q*3+3) + '-31';
  const qVat = sum(sold.filter(d => d.sellDate && d.sellDate >= qs && d.sellDate <= qe), d => Math.max(d.c.vat, 0));
  return { s, deals, sold, active, invested, earned, payouts, paid, due, recv, owe, pay, recvT, oweT, payT, rs, plan, fact, gap, invList, qVat, qLabel: ['янв–мар','апр–июн','июл–сен','окт–дек'][q] };
}
function byMonth(m) {
  const map = {};
  for (const d of m.sold) {
    const k = (d.sellDate || '').slice(0, 7) || 'без даты';
    const r = map[k] || (map[k] = { k, n: 0, sell: 0, buy: 0, exp: 0, bonus: 0, margin: 0, vat: 0, profit: 0, investor: 0, company: 0, days: [] });
    r.n++; r.sell += d.c.sell; r.buy += d.c.buy; r.exp += d.c.exp; r.bonus += d.c.bonus; r.margin += d.c.margin;
    r.vat += d.c.vat; r.profit += d.c.profit; r.investor += d.c.investor; r.company += d.c.company;
    if (d.c.days != null && d.c.days >= 0) r.days.push(d.c.days);
  }
  return Object.values(map).sort((a, b) => a.k.localeCompare(b.k));
}
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2; };
function warnings(m) {
  const w = [], t = todayStr();
  for (const d of m.deals) {
    const n = esc(d.name);
    if (d.c.sold && !d.sellDate) w.push(`«${n}»: продано, но нет даты продажи`);
    if (d.c.sold && !num(d.sell)) w.push(`«${n}»: продано, но нет цены продажи`);
    if (d.sellDate && d.buyDate && d.sellDate < d.buyDate) w.push(`«${n}»: дата продажи ${dstr(d.sellDate)} раньше даты покупки ${dstr(d.buyDate)}`);
    if (d.sellDate && d.sellDate > t) w.push(`«${n}»: дата продажи ${dstr(d.sellDate)} ещё не наступила`);
  }
  if (!m.s.rsDate) w.push('Остаток на р/с ещё ни разу не вносили');
  else if (daysBetween(m.s.rsDate, t) > 3) w.push(`Остаток на р/с обновляли ${dstr(m.s.rsDate)}, больше 3 дней назад`);
  return w;
}

// ───────── отрисовка ─────────
function render() {
  if (!me) return;
  const m = model();
  const trashN = ['deals','payouts','recv','owe','pay'].reduce((a, k) => a + vals(D[k]).filter(x => x.deleted).length, 0);
  const tb = $('#trash-btn'); if (tb) tb.textContent = '🗑 Корзина' + (trashN ? ` (${trashN})` : '');
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const v = $('#view');
  const keepScroll = window.scrollY;
  v.innerHTML = ({ summary: viewSummary, deals: viewDeals, investors: viewInvestors, money: viewMoney, months: viewMonths })[tab](m);
  window.scrollTo(0, keepScroll);
}

function bodyCard(m) {
  const low = m.plan > 0 && m.fact < m.plan;
  const pct = m.plan ? m.fact / m.plan * 100 : 0;
  return `
  ${low ? `<div class="alert-r">🚨 Тело ниже плана на ${rub(-m.gap)} · Факт ${rub(m.fact)} · План ${rub(m.plan)}</div>` : ''}
  <div class="card ${low ? 'card-red' : ''}">
    <div class="sec">Тело инвесторов</div>
    <div class="grid g6">
      <div class="surface"><div class="lbl">Факт тела</div>
        <div class="big ${low ? 'neg pulse' : 'pos'}">${rub(m.fact)}</div>
        <div class="hint">${pct.toLocaleString('ru-RU',{maximumFractionDigits:1})}% от плана</div></div>
      <div class="surface"><div class="lbl">План тела</div><div class="big">${rub(m.plan)}</div>
        <div class="hint">${m.invList.map(i => esc(i.name) + ' ' + fmt(i.capital/1e6) + ' млн').join(' · ')}</div></div>
      <div class="surface"><div class="lbl">Отклонение</div><div class="big ${m.gap < 0 ? 'neg' : 'pos'}">${signed(m.gap)} ₽</div></div>
      <div class="surface"><div class="lbl">Остаток на р/с</div><div class="big blue">${rub(m.rs)}</div>
        <div class="hint">${m.s.rsDate ? 'на ' + dstr(m.s.rsDate) + (m.s.rsBy ? ' · ' + esc(m.s.rsBy) : '') : 'не вносили'}</div>
        <button class="btn btn-sm ed" style="margin-top:6px" data-act="rs-edit">Обновить</button></div>
      <div class="surface"><div class="lbl">В технике и бронях</div><div class="big brown">${rub(m.invested)}</div>
        <div class="hint">${m.active.length} поз.</div></div>
      <div class="surface"><div class="lbl">Инвесторам к выплате</div><div class="big violet">${rub(m.due)}</div></div>
    </div>
    <div class="hint" style="margin-top:10px">Факт тела = р/с + в технике и бронях + нам должны (${fmt(m.recvT)}) − мы должны (${fmt(m.oweT)}) − к выплате инвесторам</div>
  </div>`;
}

function viewSummary(m) {
  const t = todayStr(), ym = t.slice(0, 7), y = t.slice(0, 4);
  const months = byMonth(m);
  const cur = months.find(r => r.k === ym) || { n: 0, sell: 0, profit: 0, company: 0 };
  const ytd = months.filter(r => r.k.startsWith(y));
  const sumY = f => ytd.reduce((a, r) => a + r[f], 0);
  const allDays = m.sold.map(d => d.c.days).filter(x => x != null && x >= 0);
  const marginPct = m.sold.reduce((a, d) => a + d.c.sell, 0) ? m.sold.reduce((a, d) => a + d.c.profit, 0) / m.sold.reduce((a, d) => a + d.c.sell, 0) * 100 : 0;
  const w = warnings(m);
  const stale = m.active.filter(d => d.status === 'work' && d.c.days > 30);
  return bodyCard(m) + `
  <div class="card">
    <div class="sec">Показатели</div>
    <div class="grid g4">
      <div class="surface"><div class="lbl">Продано в ${MONTHS[+ym.slice(5)-1].toLowerCase()}</div><div class="med">${cur.n} шт · ${rub(cur.sell)}</div><div class="hint">прибыль ${rub(cur.profit)}</div></div>
      <div class="surface"><div class="lbl">Прибыль за ${y} год</div><div class="med pos">${rub(sumY('profit'))}</div><div class="hint">${sumY('n')} сделок · компании ${rub(sumY('company'))}</div></div>
      <div class="surface"><div class="lbl">Средний срок продажи</div><div class="med">${median(allDays) ?? '—'} дн.</div><div class="hint">медиана по ${allDays.length} сделкам</div></div>
      <div class="surface"><div class="lbl">Прибыль от выручки</div><div class="med">${marginPct.toLocaleString('ru-RU',{maximumFractionDigits:1})}%</div><div class="hint">по всем продажам</div></div>
      <div class="surface"><div class="lbl">НДС за квартал (${m.qLabel})</div><div class="med neg">${rub(m.qVat)}</div></div>
      <div class="surface"><div class="lbl">Инвесторам выплачено</div><div class="med">${rub(m.paid)}</div><div class="hint">начислено ${rub(m.earned)}</div></div>
      <div class="surface"><div class="lbl">Предстоящие платежи</div><div class="med violet">${rub(m.payT)}</div><div class="hint">${m.pay.length} шт, в тело не входят</div></div>
      <div class="surface"><div class="lbl">Нам должны / мы должны</div><div class="med"><span class="pos">${fmt(m.recvT)}</span> / <span class="neg">${fmt(m.oweT)}</span></div></div>
    </div>
  </div>
  ${stale.length ? `<div class="alert-y"><b>Долго стоят в работе (больше 30 дней):</b><br>${stale.map(d => `${esc(d.name)}: ${d.c.days} дн.`).join('<br>')}</div>` : ''}
  ${w.length ? `<div class="alert-y"><b>Проверьте данные:</b><br>${w.join('<br>')}</div>` : ''}
  <div class="card">
    <div class="card-head"><div class="card-title">Сейчас в работе</div><button class="btn btn-sm ed" data-act="deal-new">+ Сделка</button></div>
    ${dealsTable(m.active, m, true)}
  </div>`;
}

function dealsTable(list, m, compact) {
  if (!list.length) return '<div class="empty">Нет сделок</div>';
  const tot = f => list.reduce((a, d) => a + f(d), 0);
  const rows = list.map(d => {
    const c = d.c, bad = d.sellDate && d.buyDate && (d.sellDate < d.buyDate || d.sellDate > todayStr());
    const daysTag = c.days == null ? '' : `<span class="tag ${!c.sold && c.days > 60 ? 't-warn' : !c.sold && c.days > 30 ? 't-work' : 't-gray'}">${c.days} дн.</span>`;
    return `<tr class="clickable" data-act="deal-edit" data-id="${esc(d.id)}">
      <td class="l">${dstr(d.buyDate)}</td>
      <td class="l name">${esc(d.name)}${c.hasP || c.hasI ? ' <span class="tag t-gray" title="Есть ручная поправка">✎</span>' : ''}<div class="small">${esc(d.manager || '')}</div></td>
      <td class="l"><span class="tag ${STATUS_TAG[d.status] || 't-gray'}">${STATUS[d.status] || esc(d.status)}</span> ${daysTag}</td>
      <td>${fmt(c.buy)}</td>
      ${compact ? `<td>${fmt(c.exp)}</td>` : `
      <td>${c.sold ? fmt(c.sell) : ''}</td>
      <td>${fmt(c.exp)}</td><td>${c.sold ? fmt(c.bonus) : ''}</td>
      <td>${c.sold ? fmt(c.vat) : ''}</td>
      <td class="${c.profit < 0 ? 'neg' : 'pos'}">${c.sold ? fmt(c.profit) : ''}</td>
      <td>${c.sold ? fmt(c.investor) : ''}</td>
      <td class="l ${bad ? 'neg' : ''}">${dstr(d.sellDate)}</td>`}
    </tr>`;
  }).join('');
  return `<div class="tbl-wrap"><table>
    <thead><tr><th class="l">Покупка</th><th class="l">Предмет</th><th class="l">Статус</th><th>Цена покупки</th>
    ${compact ? '<th>Расходы</th>' : '<th>Продажа</th><th>Расходы</th><th>Бонус</th><th>НДС</th><th>Прибыль</th><th>Инвестору</th><th class="l">Продано</th>'}</tr></thead>
    <tbody>${rows}
    <tr class="total"><td class="l" colspan="3">Итого: ${list.length}</td><td>${fmt(tot(d => d.c.buy))}</td>
    ${compact ? `<td>${fmt(tot(d => d.c.exp))}</td>` : `<td>${fmt(tot(d => d.c.sell))}</td><td>${fmt(tot(d => d.c.exp))}</td><td>${fmt(tot(d => d.c.bonus))}</td>
    <td>${fmt(tot(d => d.c.vat))}</td><td>${fmt(tot(d => d.c.profit))}</td><td>${fmt(tot(d => d.c.investor))}</td><td></td>`}</tr>
    </tbody></table></div>`;
}

function viewDeals(m) {
  const months = [...new Set(m.deals.map(d => (d.c.sold ? d.sellDate : d.buyDate || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  const managers = [...new Set(m.deals.map(managerOf))].sort();
  const f = dealFilter, q = f.q.toLowerCase();
  const list = m.deals.filter(d =>
    (f.status === 'all' || (f.status === 'active' ? !d.c.sold : d.status === f.status)) &&
    (f.month === 'all' || (d.c.sold ? d.sellDate : d.buyDate || '').startsWith(f.month)) &&
    (f.manager === 'all' || managerOf(d) === f.manager) &&
    (!q || (d.name + ' ' + (d.manager || '') + ' ' + (d.note || '')).toLowerCase().includes(q))
  ).reverse();
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  return `<div class="card">
    <div class="card-head">
      <div class="filters">
        <select class="inp" data-filter="status">${opt('all','Все статусы',f.status)}${opt('active','Бронь и в работе',f.status)}${opt('bron','Бронь',f.status)}${opt('work','В работе',f.status)}${opt('sold','Продано',f.status)}</select>
        <select class="inp" data-filter="month">${opt('all','Все месяцы',f.month)}${months.map(x => opt(x, monthLabel(x), f.month)).join('')}</select>
        <select class="inp" data-filter="manager">${opt('all','Все менеджеры',f.manager)}${managers.map(x => opt(x, x, f.manager)).join('')}</select>
        <input class="inp" data-filter="q" placeholder="Поиск" value="${esc(f.q)}" style="width:140px">
      </div>
      <button class="btn ed" data-act="deal-new">+ Сделка</button>
    </div>
    <div class="hint" style="margin:-4px 0 8px">Месяц для проданных считается по дате продажи, для остальных по дате покупки. Нажмите на строку, чтобы открыть сделку.</div>
    ${dealsTable(list, m, false)}
  </div>`;
}

function viewInvestors(m) {
  return bodyCard(m) + `
  <div class="grid g2" style="margin-bottom:12px">
    ${m.invList.map(i => `<div class="card" style="margin-bottom:0">
      <div class="card-title" style="margin-bottom:10px">${esc(i.name)} · ${(i.share*100).toLocaleString('ru-RU',{maximumFractionDigits:2})}%</div>
      <div class="grid g2">
        <div class="surface"><div class="lbl">Вклад</div><div class="med">${rub(i.capital)}</div></div>
        <div class="surface"><div class="lbl">Начислено дохода</div><div class="med pos">${rub(i.earned)}</div></div>
        <div class="surface"><div class="lbl">Выплачено</div><div class="med">${rub(i.paid)}</div></div>
        <div class="surface"><div class="lbl">К выплате</div><div class="med violet">${rub(i.due)}</div></div>
      </div></div>`).join('')}
  </div>
  <div class="card">
    <div class="card-head"><div class="card-title">Выплаты инвесторам</div><button class="btn btn-sm ed" data-act="payout-new">+ Выплата</button></div>
    <div class="hint" style="margin:-4px 0 8px">Доход инвестора = ${m.s.investorPct}% прибыли сделки (убыточные сделки дают 0). Выплата «всем» делится по долям вклада.</div>
    ${m.payouts.length ? m.payouts.map(p => `<div class="row">
      <div class="row-main"><div>${p.investor === 'all' || !p.investor ? 'Всем по долям' : esc((m.s.investors[p.investor] || {}).name || p.investor)}${p.note ? ' · <span class="muted">' + esc(p.note) + '</span>' : ''}</div>
      <div class="small">${dstr(p.date)}${p.by ? ' · ' + esc(p.by) : ''}</div></div>
      <div class="row-side"><b>${rub(num(p.amount))}</b>
      <button class="ib ed" data-act="payout-edit" data-id="${esc(p.id)}">✏️</button>
      <button class="ib btn-del ed" data-act="del" data-col="payouts" data-id="${esc(p.id)}">✕</button></div></div>`).join('') : '<div class="empty">Выплат нет</div>'}
    <div class="totline"><span class="muted">Итого выплачено</span><b>${rub(m.paid)}</b></div>
  </div>`;
}

function listCard(col, title, items, sign, color, withDate, note) {
  const total = items.reduce((a, x) => a + num(x.amount), 0);
  return `<div class="card">
    <div class="card-head"><div class="card-title">${title}</div>${note ? `<span class="tag t-gray">${note}</span>` : ''}</div>
    ${items.length ? items.map(x => `<div class="row">
      <div class="row-main"><div>${esc(x.name)}</div><div class="small">${withDate && x.date ? dstr(x.date) + ' · ' : ''}${esc(x.by || '')}</div></div>
      <div class="row-side"><b class="${color}">${sign}${rub(num(x.amount))}</b>
        <button class="ib ed" data-act="item-edit" data-col="${col}" data-id="${esc(x.id)}">✏️</button>
        <button class="ib btn-del ed" data-act="del" data-col="${col}" data-id="${esc(x.id)}">✕</button></div></div>`).join('') : '<div class="empty">Нет записей</div>'}
    <form class="inline-form ed" data-form="${col}">
      <input class="inp" name="name" placeholder="${col === 'pay' ? 'Статья' : col === 'recv' ? 'От кого / за что' : 'Кому / за что'}" required>
      <input class="inp" name="amount" type="number" step="any" placeholder="Сумма ₽" required>
      <input class="inp" name="date" type="date" ${withDate ? '' : 'style="display:none"'}>
      <button class="btn" type="submit">+</button>
    </form>
    <div class="totline"><span class="muted">Итого</span><b class="${color}">${rub(total)}</b></div>
  </div>`;
}

function viewMoney(m) {
  const hist = vals(D.rsHistory).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 10);
  return `
  <div class="card">
    <div class="card-head"><div class="card-title">Остаток на расчётном счёте</div></div>
    <div class="grid g2">
      <div><div class="big blue">${rub(m.rs)}</div><div class="hint">${m.s.rsDate ? 'на ' + dstr(m.s.rsDate) + (m.s.rsBy ? ' · ' + esc(m.s.rsBy) : '') : 'не вносили'}</div>
        <form class="ed" data-form="rs" style="display:flex;gap:6px;margin-top:10px;max-width:360px">
          <input class="inp" name="amount" type="number" step="any" placeholder="Новый остаток ₽" required>
          <button class="btn" type="submit">Сохранить</button></form></div>
      <div><div class="lbl">История изменений</div>
        ${hist.length ? hist.map(h => `<div class="row"><span class="muted">${dstr(h.date)} · ${esc(h.by || '')}</span><b>${rub(num(h.amount))}</b></div>`).join('') : '<div class="empty">Пока пусто</div>'}</div>
    </div>
  </div>
  <div class="grid g2">
    ${listCard('recv', '📥 Нам должны', m.recv, '+', 'pos', false, '+ к телу')}
    ${listCard('owe', '📤 Мы должны', m.owe, '−', 'neg', false, '− из тела')}
  </div>
  ${listCard('pay', '📅 Предстоящие платежи', m.pay, '', 'violet', true, 'для сведения')}`;
}

function viewMonths(m) {
  const months = byMonth(m);
  const maxP = Math.max(1, ...months.map(r => Math.abs(r.profit)));
  const tot = f => months.reduce((a, r) => a + r[f], 0);
  const mgr = {};
  for (const d of m.sold) { const k = managerOf(d); const r = mgr[k] || (mgr[k] = { k, n: 0, sell: 0, profit: 0, bonus: 0 }); r.n++; r.sell += d.c.sell; r.profit += d.c.profit; r.bonus += d.c.bonus; }
  const mgrs = Object.values(mgr).sort((a, b) => b.profit - a.profit);
  return `<div class="card">
    <div class="card-head"><div class="card-title">Результат по месяцам продажи</div></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th class="l">Месяц</th><th>Сделок</th><th>Выручка</th><th>Себестоимость</th><th>Расходы</th><th>Бонусы</th><th>Маржа</th><th>НДС</th><th>Прибыль</th><th>Инвесторам</th><th>Компании</th><th>Срок, дн.</th><th class="l" style="min-width:110px"></th></tr></thead>
      <tbody>${months.map(r => `<tr>
        <td class="l">${r.k.length === 7 ? monthLabel(r.k) : esc(r.k)}</td><td>${r.n}</td><td>${fmt(r.sell)}</td><td>${fmt(r.buy)}</td><td>${fmt(r.exp)}</td><td>${fmt(r.bonus)}</td>
        <td>${fmt(r.margin)}</td><td>${fmt(r.vat)}</td><td class="${r.profit < 0 ? 'neg' : 'pos'}"><b>${fmt(r.profit)}</b></td><td>${fmt(r.investor)}</td><td>${fmt(r.company)}</td>
        <td>${r.days.length ? fmt(median(r.days)) : '—'}</td><td class="l"><div class="bar ${r.profit < 0 ? 'neg' : ''}" style="width:${Math.abs(r.profit) / maxP * 100}%"></div></td></tr>`).join('')}
        <tr class="total"><td class="l">Итого</td><td>${tot('n')}</td><td>${fmt(tot('sell'))}</td><td>${fmt(tot('buy'))}</td><td>${fmt(tot('exp'))}</td><td>${fmt(tot('bonus'))}</td>
        <td>${fmt(tot('margin'))}</td><td>${fmt(tot('vat'))}</td><td>${fmt(tot('profit'))}</td><td>${fmt(tot('investor'))}</td><td>${fmt(tot('company'))}</td><td></td><td></td></tr>
      </tbody></table></div>
    <div class="hint" style="margin-top:8px">Маржа = выручка − покупка − расходы − бонусы. НДС = (продажа − покупка) × ${m.s.vatRate}/${100 + num(m.s.vatRate)}. Прибыль = маржа − НДС. Компании = прибыль − доля инвесторов. Срок = медиана дней от покупки до продажи.</div>
  </div>
  <div class="card">
    <div class="card-head"><div class="card-title">Менеджеры</div></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th class="l">Менеджер</th><th>Сделок</th><th>Выручка</th><th>Прибыль</th><th>Бонусы</th><th>Прибыль на сделку</th></tr></thead>
      <tbody>${mgrs.map(r => `<tr><td class="l">${esc(r.k)}</td><td>${r.n}</td><td>${fmt(r.sell)}</td><td class="${r.profit < 0 ? 'neg' : ''}">${fmt(r.profit)}</td><td>${fmt(r.bonus)}</td><td>${fmt(r.profit / r.n)}</td></tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

// ───────── модальные окна ─────────
function openModal(title, html) {
  $('#modal-box').innerHTML = `<div class="modal-head"><div class="modal-title">${title}</div><button class="btn btn-sm" data-act="close">✕</button></div>${html}`;
  $('#modal').style.display = 'block';
}
function closeModal() { $('#modal').style.display = 'none'; $('#modal-box').innerHTML = ''; }
const field = (label, input, full) => `<div class="field ${full ? 'full' : ''}"><label>${label}</label>${input}</div>`;

function dealForm(d) {
  const ro = me.role !== 'edit';
  d = d || { buyDate: todayStr(), status: 'bron' };
  const v = k => esc(d[k] ?? '');
  const opt = s => `<option value="${s}" ${d.status === s ? 'selected' : ''}>${STATUS[s]}</option>`;
  openModal(d.id ? 'Сделка' : 'Новая сделка', `
  <form id="deal-form" data-id="${v('id')}">
    <fieldset ${ro ? 'disabled' : ''} style="border:none">
    <div class="form-grid">
      ${field('Предмет договора', `<input class="inp" name="name" value="${v('name')}" required>`, true)}
      ${field('Дата покупки', `<input class="inp" type="date" name="buyDate" value="${v('buyDate')}">`)}
      ${field('Ответственный (банк)', `<input class="inp" name="manager" value="${v('manager')}" placeholder="Илья(ВТБ)">`)}
      ${field('Статус', `<select class="inp" name="status">${opt('bron')}${opt('work')}${opt('sold')}</select>`)}
      ${field('Цена покупки (или сумма брони), ₽', `<input class="inp" type="number" step="any" name="buy" value="${v('buy')}">`)}
      ${field('Расходы на продажу, ₽', `<input class="inp" type="number" step="any" name="exp" value="${v('exp')}">`)}
      ${field('За что расходы', `<input class="inp" name="expNote" value="${v('expNote')}" placeholder="ремонт, доставка…">`)}
      ${field('Цена продажи, ₽', `<input class="inp" type="number" step="any" name="sell" value="${v('sell')}">`)}
      ${field('Дата продажи', `<input class="inp" type="date" name="sellDate" value="${v('sellDate')}">`)}
      ${field('Бонус менеджера, ₽', `<input class="inp" type="number" step="any" name="bonus" value="${v('bonus')}">`)}
      ${field('Комментарий', `<input class="inp" name="note" value="${v('note')}">`, true)}
    </div>
    <details ${d.profitOverride != null && d.profitOverride !== '' || d.investorOverride != null && d.investorOverride !== '' ? 'open' : ''}><summary>Ручные поправки (если расчёт по формуле не подходит)</summary>
      <div class="form-grid" style="margin-top:8px">
        ${field('Прибыль вручную, ₽', `<input class="inp" type="number" step="any" name="profitOverride" value="${v('profitOverride')}" placeholder="по формуле">`)}
        ${field('Доход инвестора вручную, ₽', `<input class="inp" type="number" step="any" name="investorOverride" value="${v('investorOverride')}" placeholder="по формуле">`)}
      </div></details>
    </fieldset>
    <div class="calc-box" id="deal-calc"></div>
    ${d.by ? `<div class="small" style="margin-top:8px">Последнее изменение: ${esc(d.by)}${d.ts ? ', ' + new Date(d.ts).toLocaleString('ru-RU') : ''}</div>` : ''}
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:14px;flex-wrap:wrap" class="ed">
      ${d.id ? `<button type="button" class="btn btn-del" data-act="del" data-col="deals" data-id="${v('id')}">Удалить</button>` : '<span></span>'}
      <button type="submit" class="btn btn-primary">Сохранить</button>
    </div>
  </form>`);
  const upd = () => {
    const x = readForm($('#deal-form')), c = calcDeal(x, settings());
    $('#deal-calc').innerHTML = x.status === 'sold'
      ? `Маржа <b>${rub(c.margin)}</b> · НДС <b>${rub(c.vat)}</b> · Прибыль <b class="${c.profit < 0 ? 'neg' : 'pos'}">${rub(c.profit)}</b><br>Инвестору <b>${rub(c.investor)}</b> · Компании <b>${rub(c.company)}</b>${c.days != null ? ' · ' + c.days + ' дн.' : ''}`
      : `В тело идёт как вложение: <b>${rub(num(x.buy) + num(x.exp))}</b>${c.days != null ? ' · ' + c.days + ' дн. с покупки' : ''}`;
  };
  $('#deal-form').addEventListener('input', upd); upd();
}
function readForm(f) {
  const o = {}; new FormData(f).forEach((v, k) => { o[k] = typeof v === 'string' ? v.trim() : v; }); return o;
}
async function saveDeal(f) {
  const x = readForm(f), id = f.dataset.id || newId();
  if (!x.name) return;
  const old = (D.deals || {})[id] || {};
  const rec = { ...old, name: x.name, buyDate: x.buyDate || '', manager: x.manager || '', status: x.status,
    buy: num(x.buy), exp: num(x.exp), expNote: x.expNote || '', sell: num(x.sell), sellDate: x.sellDate || '',
    bonus: num(x.bonus), note: x.note || '',
    profitOverride: x.profitOverride === '' ? null : num(x.profitOverride),
    investorOverride: x.investorOverride === '' ? null : num(x.investorOverride), ...stamp() };
  if (rec.status !== 'sold') { rec.sell = num(x.sell) || 0; }
  Object.keys(rec).forEach(k => rec[k] === null && delete rec[k]);
  if (rec.status === 'sold' && !rec.sellDate) rec.sellDate = todayStr();
  closeModal();
  await Store.set('deals/' + id, rec);
}

function payoutForm(p) {
  const s = settings(); p = p || { date: todayStr(), investor: 'all' };
  const opts = [['all', 'Всем по долям'], ...Object.entries(s.investors).map(([k, i]) => [k, i.name])]
    .map(([k, l]) => `<option value="${esc(k)}" ${p.investor === k ? 'selected' : ''}>${esc(l)}</option>`).join('');
  openModal(p.id ? 'Выплата' : 'Новая выплата', `<form id="payout-form" data-id="${esc(p.id || '')}"><div class="form-grid">
    ${field('Дата', `<input class="inp" type="date" name="date" value="${esc(p.date || '')}" required>`)}
    ${field('Кому', `<select class="inp" name="investor">${opts}</select>`)}
    ${field('Сумма, ₽', `<input class="inp" type="number" step="any" name="amount" value="${esc(p.amount ?? '')}" required>`)}
    ${field('Комментарий', `<input class="inp" name="note" value="${esc(p.note || '')}">`)}
  </div><div style="text-align:right;margin-top:14px"><button class="btn btn-primary" type="submit">Сохранить</button></div></form>`);
}
function itemForm(col, x) {
  openModal('Изменить запись', `<form id="item-form" data-col="${col}" data-id="${esc(x.id)}"><div class="form-grid">
    ${field('Название', `<input class="inp" name="name" value="${esc(x.name)}" required>`, true)}
    ${field('Сумма, ₽', `<input class="inp" type="number" step="any" name="amount" value="${esc(x.amount)}" required>`)}
    ${field('Дата', `<input class="inp" type="date" name="date" value="${esc(x.date || '')}">`)}
  </div><div style="text-align:right;margin-top:14px"><button class="btn btn-primary" type="submit">Сохранить</button></div></form>`);
}
function rsForm() {
  openModal('Остаток на р/с', `<form data-form="rs"><div class="form-grid">
    ${field('Остаток, ₽', `<input class="inp" type="number" step="any" name="amount" value="${esc(settings().rs || '')}" required>`, true)}
  </div><div style="text-align:right;margin-top:14px"><button class="btn btn-primary" type="submit">Сохранить</button></div></form>`);
}
async function saveRs(amount) {
  const id = newId(), t = todayStr();
  closeModal();
  await Store.update({ 'settings/rs': amount, 'settings/rsDate': t, 'settings/rsBy': me.name,
    ['rsHistory/' + id]: { amount, date: t, ...stamp() } });
}

function settingsForm() {
  const s = settings();
  const inv = Object.entries(s.investors);
  openModal('Настройки', `<form id="settings-form">
    <div class="sec">Инвесторы (план тела)</div>
    <div class="form-grid" id="inv-rows">
      ${inv.map(([k, i]) => field('Имя', `<input class="inp" name="inv-name-${esc(k)}" value="${esc(i.name)}">`) + field('Вклад, ₽', `<input class="inp" type="number" step="any" name="inv-cap-${esc(k)}" value="${esc(i.capital)}">`)).join('')}
    </div>
    <div class="sec" style="margin-top:14px">Расчёт</div>
    <div class="form-grid">
      ${field('Доля инвесторов в прибыли, %', `<input class="inp" type="number" step="any" name="investorPct" value="${esc(s.investorPct)}">`)}
      ${field('Ставка НДС, %', `<input class="inp" type="number" step="any" name="vatRate" value="${esc(s.vatRate)}">`)}
    </div>
    <div style="text-align:right;margin-top:14px"><button class="btn btn-primary" type="submit">Сохранить</button></div>
  </form>
  <div class="sec" style="margin-top:22px">Загрузка из Excel</div>
  <div class="muted" style="margin-bottom:8px;line-height:1.5">Берёт лист со сделками (как «15+7» в «АСИнвестиции»): все сделки, сумму уже выплаченного инвесторам и остаток на р/с. <b>Заменит все текущие сделки и выплаты.</b> Нужно один раз, при переходе с Excel.</div>
  <input type="file" id="xlsx-file" accept=".xlsx,.xls" class="inp">
  <div id="import-msg" class="muted" style="margin-top:8px"></div>`);
}
async function saveSettings(f) {
  const x = readForm(f), s = settings(), investors = {};
  for (const k of Object.keys(s.investors)) investors[k] = { name: x['inv-name-' + k] || s.investors[k].name, capital: num(x['inv-cap-' + k]) };
  closeModal();
  await Store.update({ 'settings/investors': investors, 'settings/investorPct': num(x.investorPct), 'settings/vatRate': num(x.vatRate) });
}

function trashView() {
  const labels = { deals: 'Сделка', payouts: 'Выплата', recv: 'Нам должны', owe: 'Мы должны', pay: 'Платёж' };
  const all = Object.keys(labels).flatMap(k => vals(D[k]).filter(x => x.deleted).map(x => ({ ...x, _col: k })));
  openModal('🗑 Корзина', all.length ? all.map(x => `<div class="row">
    <div class="row-main"><span class="tag t-gray">${labels[x._col]}</span> ${esc(x.name || x.note || dstr(x.date))} <span class="muted">${x.amount != null ? rub(num(x.amount)) : x.buy != null ? rub(num(x.buy)) : ''}</span></div>
    <div class="row-side"><button class="btn btn-sm btn-ok" data-act="restore" data-col="${x._col}" data-id="${esc(x.id)}">Восстановить</button>
    <button class="btn btn-sm btn-del" data-act="purge" data-col="${x._col}" data-id="${esc(x.id)}">Навсегда</button></div></div>`).join('')
    : '<div class="empty">Корзина пуста</div>');
}

// ───────── импорт Excel ─────────
function xlDate(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth()+1) + '-' + pad(d.getUTCDate());
  }
  if (typeof v === 'string' && /^\d{2}\.\d{2}\.\d{4}/.test(v.trim())) { const [dd, mm, yy] = v.trim().slice(0, 10).split('.'); return `${yy}-${mm}-${dd}`; }
  return '';
}
const isNum = v => typeof v === 'number' && isFinite(v);
function parseWorkbook(wb, s) {
  let rows = null;
  for (const name of wb.SheetNames) {
    const r = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
    if (r.some(row => row.some(c => typeof c === 'string' && c.trim().toUpperCase() === 'ПРОДАЖА'))) { rows = r; break; }
  }
  if (!rows) throw new Error('Не нашёл лист со столбцом «ПРОДАЖА»');
  const hi = rows.findIndex(row => row.some(c => typeof c === 'string' && c.trim().toUpperCase() === 'ПРОДАЖА'));
  const H = rows[hi].map(c => String(c || '').toLowerCase());
  const col = (...keys) => H.findIndex(h => keys.every(k => h.includes(k)));
  const C = { buyDate: col('дата закупки'), name: col('предмет'), sell: col('продажа'), buy: col('покупка'), exp: col('расходы'),
    profit: col('прибыль'), invAcc: col('начислено'), invPaid: col('выплачено'), status: col('статус'), bonus: col('бонус'),
    manager: col('ответственный'), sellDate: col('дата продажи') };
  H.forEach((h, i) => { if (h.trim() === 'прибыль') C.profit = i; });
  const g = (row, k) => C[k] >= 0 ? row[C[k]] : null;
  const deals = {}; let paid = 0, rs = null, n = 0, overrides = 0;
  const pct = num(s.investorPct);
  for (let i = hi + 1; i < rows.length; i++) {
    const row = rows[i];
    const label = row.map(c => typeof c === 'string' ? c : '').join(' ').toLowerCase();
    if (label.includes('остаток на р/с')) { const v = row.find(isNum); if (v != null) rs = v; continue; }
    const bd = xlDate(g(row, 'buyDate')), name = String(g(row, 'name') || '').replace(/\s+/g, ' ').trim();
    if (!bd || !name) continue;
    const st = String(g(row, 'status') || '').toLowerCase();
    const status = st.includes('продан') ? 'sold' : /брон/i.test(name) ? 'bron' : 'work';
    const d = { name, buyDate: bd, manager: String(g(row, 'manager') || '').trim(), status,
      buy: num(g(row, 'buy')), exp: num(g(row, 'exp')), sell: num(g(row, 'sell')), bonus: num(g(row, 'bonus')),
      sellDate: xlDate(g(row, 'sellDate')), by: 'импорт из Excel', ts: Date.now() + n };
    const c = calcDeal(d, s);
    const xp = g(row, 'profit');
    if (status === 'sold' && isNum(xp) && Math.abs(xp - c.profit) > 1) { d.profitOverride = xp; overrides++; }
    const c2 = calcDeal(d, s);
    const ia = g(row, 'invAcc'), ip = g(row, 'invPaid');
    if (status === 'sold' && (isNum(ia) || isNum(ip))) {
      const xi = (isNum(ia) ? ia : 0) + (isNum(ip) ? ip : 0);
      if (Math.abs(xi - Math.max(c2.profit, 0) * pct / 100) > 1) { d.investorOverride = xi; overrides++; }
    }
    if (isNum(ip)) paid += ip;
    deals['x' + pad(++n) + newId()] = d;
  }
  return { deals, paid, rs, n, overrides };
}
async function importExcel(file) {
  const msg = $('#import-msg');
  try {
    msg.textContent = 'Читаю файл…';
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const r = parseWorkbook(wb, settings());
    if (!confirm(`Найдено сделок: ${r.n}. Выплачено инвесторам: ${fmt(r.paid)} ₽. Остаток р/с: ${r.rs != null ? fmt(r.rs) + ' ₽' : 'не найден'}.\n\nЗаменить текущие сделки и выплаты?`)) { msg.textContent = 'Отменено'; return; }
    const t = todayStr();
    const map = { deals: r.deals, payouts: r.paid ? { ['x' + newId()]: { date: t, investor: 'all', amount: Math.round(r.paid * 100) / 100, note: 'Выплачено до перехода на дашборд (из Excel)', ...stamp() } } : null };
    if (r.rs != null) { map['settings/rs'] = r.rs; map['settings/rsDate'] = t; map['settings/rsBy'] = me.name + ' (Excel)';
      map['rsHistory/' + newId()] = { amount: r.rs, date: t, ...stamp() }; }
    await Store.update(map);
    msg.textContent = `Готово: ${r.n} сделок, ручных поправок из Excel: ${r.overrides}.`;
  } catch (e) { msg.textContent = 'Ошибка: ' + e.message; }
}

// ───────── события ─────────
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act],[data-tab]'); if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const a = t.dataset.act, id = t.dataset.id, col = t.dataset.col;
  if (a === 'close') return closeModal();
  if (a === 'logout') return logout();
  if (a === 'deal-new') return dealForm();
  if (a === 'deal-edit') return dealForm({ ...(D.deals || {})[id], id });
  if (a === 'payout-new') return payoutForm();
  if (a === 'payout-edit') return payoutForm({ ...(D.payouts || {})[id], id });
  if (a === 'item-edit') return itemForm(col, { ...(D[col] || {})[id], id });
  if (a === 'rs-edit') return rsForm();
  if (a === 'settings') return settingsForm();
  if (a === 'trash') return trashView();
  if (a === 'del') {
    if (!confirm('Удалить? Запись попадёт в корзину, её можно восстановить.')) return;
    closeModal(); return Store.set(`${col}/${id}/deleted`, true);
  }
  if (a === 'restore') { await Store.set(`${col}/${id}/deleted`, null); return trashView(); }
  if (a === 'purge') { if (!confirm('Удалить навсегда?')) return; await Store.set(`${col}/${id}`, null); return trashView(); }
});
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
document.addEventListener('submit', async e => {
  const f = e.target; e.preventDefault();
  if (f.id === 'login-form') return login();
  if (me && me.role !== 'edit') return;
  if (f.id === 'deal-form') return saveDeal(f);
  if (f.id === 'settings-form') return saveSettings(f);
  if (f.id === 'payout-form') {
    const x = readForm(f), id = f.dataset.id || newId(); closeModal();
    return Store.set('payouts/' + id, { ...((D.payouts || {})[id] || {}), date: x.date, investor: x.investor, amount: num(x.amount), note: x.note || '', ...stamp() });
  }
  if (f.id === 'item-form') {
    const x = readForm(f), col = f.dataset.col, id = f.dataset.id; closeModal();
    return Store.set(`${col}/${id}`, { ...((D[col] || {})[id] || {}), name: x.name, amount: num(x.amount), date: x.date || '', ...stamp() });
  }
  const form = f.dataset.form;
  if (form === 'rs') { const x = readForm(f); if (x.amount === '') return; return saveRs(num(x.amount)); }
  if (['recv', 'owe', 'pay'].includes(form)) {
    const x = readForm(f); if (!x.name || !num(x.amount)) return;
    f.reset();
    return Store.set(`${form}/${newId()}`, { name: x.name, amount: num(x.amount), date: x.date || '', ...stamp() });
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'xlsx-file' && e.target.files[0]) importExcel(e.target.files[0]);
  if (e.target.dataset.filter && e.target.dataset.filter !== 'q') { dealFilter[e.target.dataset.filter] = e.target.value; render(); }
});
let qTimer = null;
document.addEventListener('input', e => {
  if (e.target.dataset.filter === 'q') {
    dealFilter.q = e.target.value; clearTimeout(qTimer);
    qTimer = setTimeout(() => { render(); const i = document.querySelector('[data-filter="q"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
  }
});

// ───────── вход и присутствие ─────────
function show(id) { ['login-screen', 'noaccess-screen', 'main-screen'].forEach(s => $('#' + s).style.display = s === id ? 'block' : 'none'); }
async function login() {
  const msg = $('#login-msg'); msg.textContent = '';
  try { await auth.signInWithEmailAndPassword($('#login-email').value.trim(), $('#login-pass').value); }
  catch (e) {
    const c = e.code || '';
    msg.textContent = c.includes('invalid') || c.includes('wrong-password') || c.includes('user-not-found') ? 'Неверная почта или пароль'
      : c.includes('too-many') ? 'Слишком много попыток, попробуйте позже' : 'Ошибка входа: ' + e.message;
  }
}
async function logout() { if (DEMO) { location.reload(); return; } if (me) db.ref('presence/' + me.key).remove().catch(() => {}); await auth.signOut(); }
let presenceTimer = null;
function startPresence() {
  if (DEMO) { $('#online-users').innerHTML = pillHtml(me.name, true); return; }
  const ref = db.ref('presence/' + me.key);
  const beat = () => ref.set({ name: me.name, t: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
  beat(); ref.onDisconnect().remove(); clearInterval(presenceTimer); presenceTimer = setInterval(beat, 60000);
  db.ref('presence').on('value', snap => {
    const p = snap.val() || {}, now = Date.now();
    $('#online-users').innerHTML = Object.entries(p).filter(([, v]) => v && now - v.t < 150000).map(([k, v]) => pillHtml(v.name, k === me.key)).join('');
  });
}
function pillHtml(name, isMe) {
  const ini = String(name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return `<span class="pill"><span class="avatar">${esc(ini)}</span>${esc(name)}${isMe ? ' (вы)' : ''}</span>`;
}
function enter(user) {
  document.body.classList.toggle('ro', me.role !== 'edit');
  show('main-screen'); startPresence(); Store.listen();
}

// ───────── демо ─────────
function demoData() {
  const deals = {}, names = ['Самосвал Демо 8х4', 'Тягач Демо 4х2', 'АБС Демо', 'Самосвал Демо 6х4', 'Тягач Демо 6х4'], mgr = ['Иван(Банк А)', 'Пётр(Банк Б)', 'Олег(Лизинг В)'];
  const base = new Date(); base.setMonth(base.getMonth() - 9);
  let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 30; i++) {
    const bd = new Date(base.getTime() + i * 9 * 864e5), sold = i < 24;
    const sd = new Date(bd.getTime() + Math.round(5 + rnd() * 40) * 864e5);
    const buy = Math.round((2 + rnd() * 3) * 100) * 10000, ds = x => x.getFullYear() + '-' + pad(x.getMonth()+1) + '-' + pad(x.getDate());
    const isBron = !sold && i % 2 === 0;
    deals['d' + i] = { name: names[i % 5] + ' №' + (100 + i), buyDate: ds(bd), manager: mgr[i % 3], status: sold ? 'sold' : isBron ? 'bron' : 'work',
      buy: isBron ? 100000 : buy, exp: sold ? Math.round(rnd() * 8) * 10000 : 0, sell: sold ? buy + Math.round((1 + rnd() * 6) * 10) * 10000 : 0,
      bonus: sold ? Math.round(rnd() * 8) * 10000 : 0, sellDate: sold && sd <= new Date() ? ds(sd) : sold ? ds(new Date()) : '', by: 'Демо', ts: i };
  }
  return { deals, payouts: { p1: { date: todayStr(), investor: 'all', amount: 1500000, note: 'Демо-выплата', by: 'Демо' } },
    settings: { ...DEFAULT_SETTINGS, rs: 2500000, rsDate: todayStr(), rsBy: 'Демо' },
    recv: { r1: { name: 'Покупатель Демо, остаток оплаты', amount: 300000, by: 'Демо' } },
    owe: { o1: { name: 'Поставщику Демо', amount: 150000, by: 'Демо' } },
    pay: { y1: { name: 'Аренда площадки', amount: 120000, date: todayStr(), by: 'Демо' } } };
}

// ───────── старт ─────────
if (DEMO) {
  $('#demo-banner').style.display = 'block';
  me = { email: 'demo', key: 'demo', name: 'Демо', role: 'edit' };
  enter();
} else {
  firebase.initializeApp(CFG);
  auth = firebase.auth(); db = firebase.database();
  $('#forgot-btn').addEventListener('click', async () => {
    const e = $('#login-email').value.trim(), msg = $('#login-msg');
    if (!e) { msg.textContent = 'Введите почту, и я пришлю ссылку для сброса пароля'; return; }
    try { await auth.sendPasswordResetEmail(e); msg.style.color = '#1a6b3c'; msg.textContent = 'Письмо отправлено на ' + e; }
    catch (err) { msg.textContent = 'Не получилось: ' + err.message; }
  });
  auth.onAuthStateChanged(async user => {
    if (!user) { me = null; db.ref('as').off(); db.ref('presence').off(); clearInterval(presenceTimer); show('login-screen'); return; }
    const key = emailKey(user.email);
    try {
      const snap = await db.ref('members/' + key).once('value');
      const m = snap.val();
      if (!m) throw new Error('not member');
      me = { email: user.email, key, name: m.name || user.email, role: m.role === 'edit' ? 'edit' : 'view' };
      enter();
    } catch (e) {
      $('#noaccess-text').textContent = `Почта ${user.email} не добавлена в список доступа. Попросите Егора добавить её.`;
      show('noaccess-screen');
    }
  });
}
