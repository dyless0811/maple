'use strict';

// 의존성 없는 가벼운 테스트
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const engine = require('../src/engine.js');

const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '../data', f), 'utf-8'));
const DATA = {
  units: load('units.json'),
  upgrades: load('upgrades.json'),
  enemies: load('enemies.json'),
  stages: load('stages.json'),
  meta: load('meta.json')
};

const U = (id) => DATA.units.find((u) => u.id === id);
const E = (id) => DATA.enemies.find((e) => e.id === id);

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`); }

console.log('engine 테스트');

test('진동형(고스트)은 소형에 풀데미지, 대형에 25%', () => {
  const ghost = U('ghost');
  const small = { size: 'small', hp: 1000, armor: 0, shield: 0, shieldArmor: 0, hpRegen: 0 };
  const large = { size: 'large', hp: 1000, armor: 0, shield: 0, shieldArmor: 0, hpRegen: 0 };
  const onSmall = engine.perHit(ghost, small, DATA.meta, 0).hpDmg;
  const onLarge = engine.perHit(ghost, large, DATA.meta, 0).hpDmg;
  assert.strictEqual(onSmall, 20);          // 20 × 1.0
  assert.strictEqual(onLarge, 5);           // 20 × 0.25
});

test('폭발형(드라군)은 대형에 풀데미지, 소형에 50%', () => {
  const d = U('dragoon');
  const small = { size: 'small', hp: 1000, armor: 0 };
  const large = { size: 'large', hp: 1000, armor: 0 };
  assert.strictEqual(engine.perHit(d, small, DATA.meta, 0).hpDmg, 12.5); // 25 × 0.5
  assert.strictEqual(engine.perHit(d, large, DATA.meta, 0).hpDmg, 25);   // 25 × 1.0
});

test('노말형(히드라)은 모든 크기에 동일 배율', () => {
  const h = U('hydra');
  const mk = (size) => ({ size, hp: 1000, armor: 0 });
  const s = engine.perHit(h, mk('small'), DATA.meta, 0).hpDmg;
  const m = engine.perHit(h, mk('medium'), DATA.meta, 0).hpDmg;
  const l = engine.perHit(h, mk('large'), DATA.meta, 0).hpDmg;
  assert.ok(s === m && m === l);
});

test('방어력은 크기배율 적용 후 차감되고 최소 데미지가 보장된다', () => {
  const ghost = U('ghost'); // 진동, dmg 20
  // 대형 + 높은 방어력 → 20×0.25=5, armor 12 → max(0.5, 5-12)=0.5
  const tanky = { size: 'large', hp: 100, armor: 12 };
  assert.strictEqual(engine.perHit(ghost, tanky, DATA.meta, 0).hpDmg, 0.5);
});

test('쉴드는 크기배율 무시하고 쉴드방어력만 차감', () => {
  const ghost = U('ghost'); // dmg 20, 진동
  const enemy = { size: 'large', hp: 100, armor: 0, shield: 50, shieldArmor: 2 };
  const ph = engine.perHit(ghost, enemy, DATA.meta, 0);
  assert.strictEqual(ph.shieldDmg, 18);  // 20 - 2, 크기배율 무시
  assert.strictEqual(ph.hpDmg, 5);       // 20 × 0.25 (대형)
});

test('체젠이 HP 데미지를 넘으면 처치 불가(Infinity)', () => {
  const ghost = U('ghost'); // 대형에 5 데미지/1초
  const regenTank = { size: 'large', hp: 500, armor: 0, shield: 0, hpRegen: 10 };
  assert.strictEqual(engine.timeToKill(ghost, regenTank, DATA.meta, 0), Infinity);
  assert.strictEqual(engine.effDpsVsEnemy(ghost, regenTank, DATA.meta, 0), 0);
});

test('업그레이드가 데미지에 반영된다', () => {
  const ghost = U('ghost');
  const target = { size: 'small', hp: 1000, armor: 0 };
  const base = engine.perHit(ghost, target, DATA.meta, 0).hpDmg;
  const bonus = engine.upgradeBonus(ghost, DATA.upgrades, { ghost_atk: 5 });
  const up = engine.perHit(ghost, target, DATA.meta, bonus).hpDmg;
  assert.strictEqual(bonus, 10);        // 5 × +2
  assert.strictEqual(up, base + 10);
});

test('소형 스테이지에서는 고스트가 최적 추천', () => {
  // 1스테이지 = 소형 슬라임
  const r = engine.analyze(DATA, { counts: { ghost: 1, hydra: 1, dragoon: 1 }, upgradeLevels: {}, currentStage: 1 });
  assert.strictEqual(r.bestUnitId, 'ghost');
});

test('대형 골렘 스테이지에서는 드라군이 고스트보다 우수', () => {
  const r = engine.analyze(DATA, { counts: {}, upgradeLevels: {}, currentStage: 6 });
  const ghost = r.perUnit.find((p) => p.id === 'ghost');
  const dragoon = r.perUnit.find((p) => p.id === 'dragoon');
  assert.ok(dragoon.valuePerUnit > ghost.valuePerUnit);
});

test('보스 스테이지 적 표에 보스가 포함된다', () => {
  const r = engine.analyze(DATA, { counts: {}, upgradeLevels: {}, currentStage: 5 });
  assert.ok(r.stage.boss);
  assert.ok(r.enemyTable.some((e) => e.boss));
});

console.log(`\n${passed}개 테스트 통과 ✅`);
