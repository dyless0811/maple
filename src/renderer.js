'use strict';

// ── 전역 상태 ───────────────────────────────────────────────────────────
let DATA = { units: [], upgrades: [], meta: {} };
let state = { counts: {}, upgradeLevels: {} };
let searchTerm = '';

const $ = (sel) => document.querySelector(sel);

function tierColor(level) {
  const t = (DATA.meta.tiers || []).find((x) => x.level === level);
  return t ? t.color : '#888';
}
function tierName(level) {
  const t = (DATA.meta.tiers || []).find((x) => x.level === level);
  return t ? t.name : `T${level}`;
}
function attackLabel(type) {
  return type === 'both' ? '지상+공중' : type === 'air' ? '공중' : '지상';
}
function damageLabel(type) {
  return type === 'magic' ? '마법' : '물리';
}

async function persist() {
  try { await window.maple.saveState(state); } catch (_) { /* 저장 실패는 조용히 무시 */ }
}

function setCount(id, delta) {
  const next = Math.max(0, (state.counts[id] || 0) + delta);
  state.counts[id] = next;
  render();
  persist();
}
function setUpgrade(id, delta) {
  const up = DATA.upgrades.find((u) => u.id === id);
  if (!up) return;
  const next = Math.min(up.maxLevel, Math.max(0, (state.upgradeLevels[id] || 0) + delta));
  state.upgradeLevels[id] = next;
  render();
  persist();
}

// ── 렌더링 ──────────────────────────────────────────────────────────────
function renderUnits() {
  const grid = $('#unitGrid');
  grid.innerHTML = '';
  const term = searchTerm.trim().toLowerCase();
  const units = DATA.units
    .filter((u) => !term || u.name.toLowerCase().includes(term) || (u.synergy || []).some((s) => s.toLowerCase().includes(term)))
    .slice()
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name, 'ko'));

  for (const u of units) {
    const count = state.counts[u.id] || 0;
    const card = document.createElement('div');
    card.className = 'unit-card' + (count > 0 ? ' owned' : '');
    card.style.setProperty('--tier-color', tierColor(u.tier));
    const tags = []
      .concat(`<span class="tag ${u.attackType === 'air' ? 'air' : u.attackType === 'ground' ? 'ground' : ''}">${attackLabel(u.attackType)}</span>`)
      .concat(`<span class="tag ${u.damageType}">${damageLabel(u.damageType)}</span>`)
      .concat((u.synergy || []).map((s) => `<span class="tag">${s}</span>`))
      .join('');
    card.innerHTML = `
      <span class="tier-badge" style="background:${tierColor(u.tier)}">${tierName(u.tier)}</span>
      <div class="uname">${u.name}</div>
      <div class="umeta">DPS ${u.dps}${u.combinesTo ? ` · 합성 ${u.combineCount}개→${(DATA.units.find((x) => x.id === u.combinesTo) || {}).name || ''}` : ''}</div>
      <div class="tags">${tags}</div>
      <div class="counter">
        <button data-act="dec" data-id="${u.id}">−</button>
        <span class="count">${count}</span>
        <button data-act="inc" data-id="${u.id}">+</button>
      </div>`;
    grid.appendChild(card);
  }
}

function renderUpgrades() {
  const list = $('#upgradeList');
  list.innerHTML = '';
  for (const up of DATA.upgrades) {
    const lvl = state.upgradeLevels[up.id] || 0;
    const pct = Math.round((lvl / up.maxLevel) * 100);
    const cost = MapleEngine.upgradeCost(up, lvl);
    const item = document.createElement('div');
    item.className = 'upgrade-item';
    item.innerHTML = `
      <div class="uphead"><span class="upname">${up.name}</span><span class="sub">+${Math.round(up.perLevel * 100)}%/Lv</span></div>
      <div class="updesc">${up.desc || ''}</div>
      <div class="lvlbar"><span style="width:${pct}%"></span></div>
      <div class="counter">
        <button data-act="updec" data-id="${up.id}">−</button>
        <span class="count">Lv.${lvl} / ${up.maxLevel}</span>
        <button data-act="upinc" data-id="${up.id}">+</button>
        <span class="sub" style="margin-left:auto">${lvl < up.maxLevel ? `다음 ${cost}` : 'MAX'}</span>
      </div>`;
    list.appendChild(item);
  }
}

function compBar(label, share, color) {
  const pct = Math.round(share * 100);
  return `<div class="comp-bar"><div class="lab"><span>${label}</span><span>${pct}%</span></div>
    <div class="track"><div class="fill" style="width:${pct}%;background:${color}"></div></div></div>`;
}

function renderRecommendations() {
  const r = MapleEngine.analyze(DATA, state);

  $('#statUnits').textContent = r.totalUnits;
  $('#statPower').textContent = r.totalPower.toLocaleString();

  $('#compBars').innerHTML =
    compBar('지상 대상 화력', r.composition.groundShare, '#f0c889') +
    compBar('공중 대상 화력', r.composition.airShare, '#8fd5ff') +
    compBar('물리 데미지', r.composition.physicalShare, '#f59e0b') +
    compBar('마법 데미지', r.composition.magicShare, '#d2a8ff');

  // 합성
  const cl = $('#combineList');
  if (r.combineSuggestions.length === 0) {
    cl.innerHTML = '<div class="empty">합성 가능한 유닛이 없습니다.</div>';
  } else {
    cl.innerHTML = r.combineSuggestions.map((c) => `
      <div class="rec-item combine">
        <div><div class="main">${c.fromName} → ${c.toName}</div>
        <div class="sub">${c.fromName} ${c.need}개 소모 · 보유 ${c.have}개 · ${tierName(c.toTier)}로 승급</div></div>
        <span class="pill">${c.times}회 가능</span>
      </div>`).join('');
  }

  // 업그레이드 우선순위
  const ur = $('#upgradeRec');
  if (r.upgradeSuggestions.length === 0) {
    ur.innerHTML = '<div class="empty">유닛을 보유하면 효율적인 업그레이드를 추천합니다.</div>';
  } else {
    ur.innerHTML = r.upgradeSuggestions.slice(0, 4).map((u, i) => `
      <div class="rec-item">
        <div><div class="main">${i === 0 ? '⭐ ' : ''}${u.name} (Lv.${u.currentLevel}→${u.currentLevel + 1})</div>
        <div class="sub">화력 +${u.marginalDps.toLocaleString()} · 비용 ${u.nextCost} · 효율 ${u.ratio.toFixed(2)}</div></div>
        <span class="pill">${i === 0 ? '추천' : i + 1 + '순위'}</span>
      </div>`).join('');
  }

  // 보유 유닛 화력
  const inv = $('#inventory');
  if (r.byUnit.length === 0) {
    inv.innerHTML = '<div class="empty">아직 보유한 유닛이 없습니다.</div>';
  } else {
    inv.innerHTML = r.byUnit.map((u) => `
      <div class="rec-item">
        <div><div class="main">${u.name} ×${u.count} <span class="sub">(${u.tierName})</span></div>
        <div class="sub">개당 ${u.effDps.toLocaleString()} DPS</div></div>
        <span class="pill">${u.totalDps.toLocaleString()}</span>
      </div>`).join('');
  }

  // 코치 노트
  const notes = $('#notes');
  const items = []
    .concat(r.warnings.map((w) => `<div class="note warn">⚠️ ${w}</div>`))
    .concat(r.tips.map((t) => `<div class="note">💡 ${t}</div>`));
  notes.innerHTML = items.length ? items.join('') : '<div class="empty">분석할 데이터가 충분하지 않습니다.</div>';
}

function render() {
  renderUnits();
  renderUpgrades();
  renderRecommendations();
}

// ── 이벤트 ──────────────────────────────────────────────────────────────
function wireEvents() {
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    switch (btn.dataset.act) {
      case 'inc': setCount(id, +1); break;
      case 'dec': setCount(id, -1); break;
      case 'upinc': setUpgrade(id, +1); break;
      case 'updec': setUpgrade(id, -1); break;
    }
  });

  $('#search').addEventListener('input', (e) => { searchTerm = e.target.value; renderUnits(); });

  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('모든 카운트와 업그레이드를 초기화할까요?')) return;
    state = { counts: {}, upgradeLevels: {} };
    render();
    persist();
  });
}

// ── 초기화 ──────────────────────────────────────────────────────────────
async function init() {
  DATA = await window.maple.loadData();
  const saved = await window.maple.loadState();
  if (saved && saved.counts) state = saved;

  $('#dataNote').textContent = DATA.meta.note || '';
  wireEvents();
  render();
}

init();
