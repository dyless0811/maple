'use strict';

let DATA = { units: [], upgrades: [], enemies: [], stages: [], meta: {} };
let state = { counts: {}, upgradeLevels: {}, currentStage: 1, clearCounts: {} };

const $ = (sel) => document.querySelector(sel);

function gradeName(id) {
  return (DATA.meta.grades || []).find((g) => g.id === id)?.name || id;
}

function sizeName(id) {
  return (DATA.meta.sizes || []).find((s) => s.id === id)?.name || id;
}
function dmgTypeName(id) {
  return (DATA.meta.damageTypes || []).find((d) => d.id === id)?.name || id;
}
function unitById(id) { return DATA.units.find((u) => u.id === id); }

async function persist() {
  try { await window.maple.saveState(state); } catch (_) { /* 무시 */ }
}

function setCount(id, delta) {
  state.counts[id] = Math.max(0, (state.counts[id] || 0) + delta);
  render();
  persist();
}
function setUpgrade(id, delta) {
  const up = DATA.upgrades.find((u) => u.id === id);
  if (!up) return;
  state.upgradeLevels[id] = Math.min(up.maxLevel, Math.max(0, (state.upgradeLevels[id] || 0) + delta));
  render();
  persist();
}
function setClear(id, delta) {
  state.clearCounts[id] = Math.max(0, (state.clearCounts[id] || 0) + delta);
  renderClearSpec();
  persist();
}
function setStage(num) {
  const stages = DATA.stages;
  const min = stages[0]?.stage ?? 1;
  const max = stages[stages.length - 1]?.stage ?? 1;
  state.currentStage = Math.min(max, Math.max(min, num));
  render();
  persist();
}

// ── 렌더링 ──────────────────────────────────────────────────────────────
function renderStageSelect() {
  const sel = $('#stageSelect');
  sel.innerHTML = DATA.stages
    .map((s) => `<option value="${s.stage}" ${s.stage === state.currentStage ? 'selected' : ''}>${s.name}</option>`)
    .join('');
}

function renderUnits(rec) {
  const list = $('#unitList');
  list.innerHTML = '';
  // 추천 정보(이번 스테이지 유닛별 가치)를 맵으로
  const valueById = {};
  (rec.perUnit || []).forEach((p) => { valueById[p.id] = p; });

  for (const u of DATA.units) {
    const count = state.counts[u.id] || 0;
    const info = valueById[u.id] || { valuePerUnit: 0, unkillable: [] };
    const isBest = rec.bestUnitId === u.id && count >= 0;
    const card = document.createElement('div');
    card.className = 'unit-card' + (count > 0 ? ' owned' : '') + (isBest ? ' best' : '');
    card.innerHTML = `
      ${isBest ? '<span class="best-badge">이번 스테이지 추천</span>' : ''}
      <div class="uhead">
        <span class="uname">${u.name}</span>
        <span class="dtype ${u.damageType}">${dmgTypeName(u.damageType)}</span>
      </div>
      <div class="udesc">${u.desc || ''}</div>
      <div class="uvalue">이번 스테이지 가치: <b>${info.valuePerUnit.toLocaleString()}</b>${info.unkillable.length ? ` · <span class="warn-text">⚠ ${info.unkillable.join('/')} 처치불가</span>` : ''}</div>
      <div class="counter">
        <button data-act="dec" data-id="${u.id}" title="판매">−</button>
        <span class="count">${count}</span>
        <button data-act="inc" data-id="${u.id}" title="뽑기">+</button>
        <span class="sub" style="margin-left:auto">판매가 ${u.sellValue ?? 0}</span>
      </div>`;
    list.appendChild(card);
  }
}

function renderUpgrades() {
  const list = $('#upgradeList');
  list.innerHTML = DATA.upgrades.map((up) => {
    const lvl = state.upgradeLevels[up.id] || 0;
    const pct = Math.round((lvl / up.maxLevel) * 100);
    const cost = MapleEngine.upgradeCost(up, lvl);
    return `<div class="upgrade-item">
      <div class="uphead"><span class="upname">${up.name}</span><span class="sub">+${up.perLevelFlat}/Lv</span></div>
      <div class="lvlbar"><span style="width:${pct}%"></span></div>
      <div class="counter">
        <button data-act="updec" data-id="${up.id}">−</button>
        <span class="count">Lv.${lvl}/${up.maxLevel}</span>
        <button data-act="upinc" data-id="${up.id}">+</button>
        <span class="sub" style="margin-left:auto">${lvl < up.maxLevel ? `다음 ${cost}` : 'MAX'}</span>
      </div></div>`;
  }).join('');
}

function renderModTable() {
  const sizes = DATA.meta.sizes || [];
  const mods = DATA.meta.sizeModifiers || {};
  let html = `<tr><th>공격형</th>${sizes.map((s) => `<th>${s.name}</th>`).join('')}</tr>`;
  for (const dt of (DATA.meta.damageTypes || [])) {
    const row = mods[dt.id] || {};
    html += `<tr><td class="dtype ${dt.id}">${dt.name}</td>${sizes.map((s) => {
      const v = row[s.id] != null ? Math.round(row[s.id] * 100) : 100;
      const cls = v >= 100 ? 'm-high' : v >= 75 ? 'm-mid' : v >= 50 ? 'm-low' : 'm-min';
      return `<td class="${cls}">${v}%</td>`;
    }).join('')}</tr>`;
  }
  $('#modTable').innerHTML = html;
}

function renderGacha() {
  const grades = DATA.meta.grades || [];
  if (!grades.length) return;
  const pulls = Math.max(1, Number($('#gachaPulls').value) || 1);
  const pullCost = DATA.meta.economy?.pullCost || 0;
  $('#gachaCost').textContent = `${pulls}회 = ${(pulls * pullCost).toLocaleString()} ${DATA.meta.economy?.pullCostUnit || '미네랄'}`;

  const expected = MapleEngine.gachaExpected(grades, pulls);
  let html = '<tr><th>등급</th><th>확률</th><th>기대 수</th><th>최소1개 확률</th></tr>';
  for (let i = 0; i < grades.length; i++) {
    const g = grades[i];
    const e = expected[i];
    const atLeast = MapleEngine.atLeastOnce(g.prob, pulls);
    const pct = (g.prob * 100);
    const probStr = pct >= 1 ? pct.toFixed(1) + '%' : pct.toFixed(3) + '%';
    html += `<tr>
      <td style="color:${g.color};font-weight:700">${g.name}</td>
      <td>${probStr}</td>
      <td>${e.expected >= 1 ? e.expected.toFixed(1) : e.expected.toFixed(3)}</td>
      <td class="${atLeast >= 0.5 ? 'm-high' : atLeast >= 0.1 ? 'm-mid' : 'm-min'}">${(atLeast * 100).toFixed(1)}%</td>
    </tr>`;
  }
  $('#gachaTable').innerHTML = html;
}

function renderClearSpec() {
  const spec = DATA.meta.clearSpec;
  const host = $('#clearSpec');
  if (!spec) { host.innerHTML = ''; return; }
  const r = MapleEngine.clearScore(spec, state.clearCounts);
  const pct = Math.min(100, Math.round(r.ratio * 100));
  const rows = spec.units.map((u) => {
    const n = state.clearCounts[u.id] || 0;
    return `<div class="cs-row">
      <span class="cs-name" style="color:${u.color}">${u.name}</span>
      <span class="sub">×${u.weight}전설</span>
      <span class="counter cs-counter">
        <button data-act="cleardec" data-id="${u.id}">−</button>
        <span class="count">${n}</span>
        <button data-act="clearinc" data-id="${u.id}">+</button>
      </span>
    </div>`;
  }).join('');
  host.innerHTML = `
    ${rows}
    <div class="cs-total ${r.ok ? 'ok' : ''}">
      <div class="cs-bar"><span style="width:${pct}%"></span></div>
      <div>전설 환산 <b>${r.total}</b> / 목표 ${r.target}기 — ${r.ok ? '<span class="ok-text">✅ 클각!</span>' : `<span class="sub">${(r.target - r.total).toFixed(2)}기 부족</span>`}</div>
    </div>`;
}

function rewardText(reward) {
  if (!reward) return '';
  if (reward.clear) return '🏆 클리어';
  const parts = [];
  if (reward.ticket) parts.push(`[${gradeName(reward.ticket)}]선택권${reward.ticketCount > 1 ? '×' + reward.ticketCount : ''}`);
  if (reward.minerals) parts.push(`${reward.minerals}미네랄`);
  return parts.join(' · ');
}

function renderEnemyTable(rec) {
  const rwd = rec.stage && rec.stage.reward ? rewardText(rec.stage.reward) : '';
  $('#stageTitle').innerHTML = (rec.stage ? rec.stage.name : '스테이지') +
    (rwd ? ` <span class="reward-tag">보상: ${rwd}</span>` : '');
  const el = $('#enemyTable');
  if (!rec.enemyTable.length) { el.innerHTML = '<div class="empty">적 정보가 없습니다.</div>'; return; }

  const unitCols = DATA.units.map((u) => `<th>${u.name}<br><span class="sub">처치(초)</span></th>`).join('');
  let html = `<table class="etable"><tr>
    <th>적</th><th>크기</th><th>HP</th><th>방어</th><th>쉴드</th><th>체젠</th><th>수</th>${unitCols}</tr>`;
  for (const e of rec.enemyTable) {
    const ttkCells = DATA.units.map((u) => {
      const v = e.ttk[u.id];
      return `<td class="${v == null ? 'm-min' : ''}">${v == null ? '불가' : v + 's'}</td>`;
    }).join('');
    html += `<tr class="${e.boss ? 'boss-row' : ''}">
      <td class="ename">${e.boss ? '👑 ' : ''}${e.name}</td>
      <td>${sizeName(e.size)}</td>
      <td>${e.hp.toLocaleString()}</td>
      <td>${e.armor}</td>
      <td>${e.shield ? e.shield + (e.shieldArmor ? `/${e.shieldArmor}` : '') : '-'}</td>
      <td>${e.hpRegen || '-'}</td>
      <td>×${e.count}</td>${ttkCells}</tr>`;
  }
  html += '</table>';
  el.innerHTML = html;
}

function renderRecPanel(rec) {
  $('#statUnits').textContent = rec.totalUnits;
  $('#statPower').textContent = rec.armyDps.toLocaleString();

  // 최적 유닛 (가치순)
  $('#bestUnit').innerHTML = rec.perUnit.length
    ? rec.perUnit.map((p, i) => `
      <div class="rec-item ${i === 0 ? 'best' : ''}">
        <div><div class="main">${i === 0 ? '⭐ ' : ''}${p.name} <span class="sub">(${dmgTypeName(p.damageType)})</span></div>
        <div class="sub">보유 ×${p.owned}${p.unkillable.length ? ` · ⚠ ${p.unkillable.join('/')} 불가` : ''}</div></div>
        <span class="pill">가치 ${p.valuePerUnit.toLocaleString()}</span>
      </div>`).join('')
    : '<div class="empty">유닛 데이터가 없습니다.</div>';

  // 업그레이드
  $('#upgradeRec').innerHTML = rec.upgradeSuggestions.length
    ? rec.upgradeSuggestions.slice(0, 3).map((u, i) => `
      <div class="rec-item ${i === 0 ? 'best' : ''}">
        <div><div class="main">${i === 0 ? '⭐ ' : ''}${u.name} (Lv.${u.currentLevel}→${u.currentLevel + 1})</div>
        <div class="sub">화력 +${u.marginalDps.toLocaleString()} · 비용 ${u.nextCost} · 효율 ${u.ratio.toFixed(2)}</div></div>
        <span class="pill">${i === 0 ? '추천' : i + 1 + '순위'}</span>
      </div>`).join('')
    : '<div class="empty">보유 유닛이 있으면 업그레이드를 추천합니다.</div>';

  // 판매 조언
  $('#sellAdvice').innerHTML = rec.sellAdvice.length
    ? rec.sellAdvice.map((s) => `<div class="rec-item"><div class="main">💰 ${s}</div></div>`).join('')
    : '<div class="empty">지금 팔 만한 유닛이 없습니다.</div>';

  // 코치 노트
  const items = []
    .concat(rec.warnings.map((w) => `<div class="note warn">⚠️ ${w}</div>`))
    .concat(rec.tips.map((t) => `<div class="note">💡 ${t}</div>`));
  $('#notes').innerHTML = items.length ? items.join('') : '<div class="empty">분석할 데이터가 부족합니다.</div>';
}

function render() {
  const rec = MapleEngine.analyze(DATA, state);
  renderStageSelect();
  renderUnits(rec);
  renderUpgrades();
  renderModTable();
  renderGacha();
  renderClearSpec();
  renderEnemyTable(rec);
  renderRecPanel(rec);
}

// ── 이벤트 ──────────────────────────────────────────────────────────────
function wireEvents() {
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === 'inc') setCount(id, +1);
    else if (btn.dataset.act === 'dec') setCount(id, -1);
    else if (btn.dataset.act === 'upinc') setUpgrade(id, +1);
    else if (btn.dataset.act === 'updec') setUpgrade(id, -1);
    else if (btn.dataset.act === 'clearinc') setClear(id, +1);
    else if (btn.dataset.act === 'cleardec') setClear(id, -1);
  });
  $('#stageSelect').addEventListener('change', (e) => setStage(Number(e.target.value)));
  $('#gachaPulls').addEventListener('input', renderGacha);
  $('#stagePrev').addEventListener('click', () => setStage(state.currentStage - 1));
  $('#stageNext').addEventListener('click', () => setStage(state.currentStage + 1));
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('카운트와 업그레이드를 초기화할까요?')) return;
    state = { counts: {}, upgradeLevels: {}, currentStage: DATA.stages[0]?.stage ?? 1, clearCounts: {} };
    render();
    persist();
  });
}

async function init() {
  DATA = await window.maple.loadData();
  const saved = await window.maple.loadState();
  if (saved && saved.counts) {
    state = Object.assign({ counts: {}, upgradeLevels: {}, currentStage: DATA.stages[0]?.stage ?? 1, clearCounts: {} }, saved);
  } else {
    state.currentStage = DATA.stages[0]?.stage ?? 1;
  }
  $('#dataNote').textContent = DATA.meta.note || '';
  wireEvents();
  render();
}

init();
