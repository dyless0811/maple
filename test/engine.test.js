'use strict';

// 엔진 동작을 빠르게 검증하는 가벼운 테스트 (의존성 없음)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const engine = require('../src/engine.js');

const DATA = {
  units: JSON.parse(fs.readFileSync(path.join(__dirname, '../data/units.json'), 'utf-8')),
  upgrades: JSON.parse(fs.readFileSync(path.join(__dirname, '../data/upgrades.json'), 'utf-8')),
  meta: JSON.parse(fs.readFileSync(path.join(__dirname, '../data/meta.json'), 'utf-8'))
};

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('engine 테스트');

test('빈 상태는 0 화력, 안내 팁 제공', () => {
  const r = engine.analyze(DATA, { counts: {}, upgradeLevels: {} });
  assert.strictEqual(r.totalPower, 0);
  assert.strictEqual(r.totalUnits, 0);
  assert.ok(r.tips.length > 0);
});

test('실효 DPS에 업그레이드가 반영된다', () => {
  const sword = DATA.units.find((u) => u.id === 'swordman');
  const base = engine.effectiveDps(sword, DATA.upgrades, {});
  const up = engine.effectiveDps(sword, DATA.upgrades, { ground_atk: 10 });
  assert.strictEqual(base, sword.dps);
  assert.ok(up > base, '업그레이드 후 DPS가 증가해야 함');
});

test('합성 가능 개수를 정확히 추천한다', () => {
  const r = engine.analyze(DATA, { counts: { swordman: 7 }, upgradeLevels: {} });
  const c = r.combineSuggestions.find((x) => x.fromId === 'swordman');
  assert.ok(c, '검사 합성 추천이 있어야 함');
  assert.strictEqual(c.toId, 'knight');
  assert.strictEqual(c.times, 2); // 7 / 3 = 2회
});

test('합성 개수 미달이면 추천하지 않는다', () => {
  const r = engine.analyze(DATA, { counts: { swordman: 2 }, upgradeLevels: {} });
  assert.ok(!r.combineSuggestions.find((x) => x.fromId === 'swordman'));
});

test('공중 화력이 없으면 경고한다', () => {
  // siege(지상 전용)만 보유 → 공중 화력 0
  const r = engine.analyze(DATA, { counts: { siege: 3 }, upgradeLevels: {} });
  assert.strictEqual(r.composition.airShare, 0);
  assert.ok(r.warnings.some((w) => w.includes('공중')), '공중 부족 경고가 있어야 함');
});

test('업그레이드 추천은 비용 대비 효율순으로 정렬된다', () => {
  const r = engine.analyze(DATA, { counts: { swordman: 5, mage: 5 }, upgradeLevels: {} });
  assert.ok(r.upgradeSuggestions.length > 0);
  for (let i = 1; i < r.upgradeSuggestions.length; i++) {
    assert.ok(r.upgradeSuggestions[i - 1].ratio >= r.upgradeSuggestions[i].ratio);
  }
});

test('적용 대상이 없는 업그레이드는 추천에서 제외된다', () => {
  // 지상 전용 유닛만 보유 → 공중 공격력 업그레이드는 화력 증가 0 이므로 제외
  const r = engine.analyze(DATA, { counts: { swordman: 3 }, upgradeLevels: {} });
  assert.ok(!r.upgradeSuggestions.find((u) => u.id === 'air_atk'));
});

console.log(`\n${passed}개 테스트 통과 ✅`);
