'use strict';

/**
 * 메이플 랜덤 디펜스 추천 엔진 (데미지 타입 × 적 크기 기반)
 *
 * 데미지 공식 (한 대당):
 *   HP 데미지  = max(minDamage, 공격력 × 크기배율 − 방어력)
 *   쉴드 데미지 = max(minDamage, 공격력 − 쉴드방어력)   ← 쉴드는 크기배율 무시
 *
 * 적이 쉴드를 가지면 쉴드를 먼저 깎은 뒤 HP를 깎는다.
 * 체젠(hpRegen)은 HP에만 적용되며, 초당 회복량이 HP 데미지를 넘으면 "처치 불가".
 *
 * 브라우저(window.MapleEngine)와 Node(module.exports) 양쪽에서 동작.
 */
(function (root) {
  function sizeMod(meta, damageType, size) {
    const table = (meta.sizeModifiers || {})[damageType];
    if (!table) return 1;
    return table[size] != null ? table[size] : 1;
  }

  function upgradeBonus(unit, upgrades, levels) {
    let bonus = 0;
    for (const up of upgrades) {
      if (up.unit !== unit.id) continue;
      const lvl = (levels && levels[up.id]) || 0;
      bonus += lvl * (up.perLevelFlat || 0);
    }
    return bonus;
  }

  // 유닛 1기가 적 1기에게 가하는 한 대당 데미지 (HP/쉴드 분리)
  function perHit(unit, enemy, meta, bonus) {
    const min = meta.minDamage != null ? meta.minDamage : 0.5;
    const atk = unit.damage + (bonus || 0);
    const mod = sizeMod(meta, unit.damageType, enemy.size);
    const hpDmg = Math.max(min, atk * mod - (enemy.armor || 0));
    const shieldDmg = Math.max(min, atk - (enemy.shieldArmor || 0));
    return { hpDmg, shieldDmg, atk, mod };
  }

  /**
   * 유닛 1기가 적 1기를 처치하는 데 걸리는 시간(초).
   * 처치 불가(체젠 벽)면 Infinity.
   */
  function timeToKill(unit, enemy, meta, bonus) {
    const cd = unit.cooldown || 1;
    const { hpDmg, shieldDmg } = perHit(unit, enemy, meta, bonus);

    let hits = 0;
    const shield = enemy.shield || 0;
    if (shield > 0) hits += Math.ceil(shield / shieldDmg);

    const hp = enemy.hp || 0;
    const regenPerHit = (enemy.hpRegen || 0) * cd;
    const netHpDmg = hpDmg - regenPerHit;
    if (netHpDmg <= 0) return Infinity; // 체젠이 HP 데미지를 따라잡지 못함
    hits += Math.ceil(hp / netHpDmg);

    return hits * cd;
  }

  // 유닛 1기의 적 1기에 대한 실효 DPS ((쉴드+HP) / 처치시간). 처치 불가면 0.
  function effDpsVsEnemy(unit, enemy, meta, bonus) {
    const ttk = timeToKill(unit, enemy, meta, bonus);
    if (!isFinite(ttk) || ttk <= 0) return 0;
    return ((enemy.shield || 0) + (enemy.hp || 0)) / ttk;
  }

  function enemiesOfStage(stage, enemyById) {
    const list = [];
    for (const sp of (stage.spawns || [])) {
      const e = enemyById[sp.enemy];
      if (e) list.push({ enemy: e, count: sp.count || 1 });
    }
    return list;
  }

  // 유닛 1기가 스테이지 전체에 대해 갖는 가치 = 적 수로 가중한 실효 DPS 합
  function unitValueVsStage(unit, stage, meta, bonus, enemyById) {
    const list = enemiesOfStage(stage, enemyById);
    let value = 0;
    const unkillable = [];
    for (const { enemy, count } of list) {
      const dps = effDpsVsEnemy(unit, enemy, meta, bonus);
      if (dps === 0) unkillable.push(enemy.name);
      value += dps * count;
    }
    return { value, unkillable };
  }

  function upgradeCost(up, currentLevel) {
    return Math.round(up.baseCost * Math.pow(up.costGrowth || 1, currentLevel));
  }

  /**
   * 메인 분석
   * @param {{units,upgrades,enemies,stages,meta}} data
   * @param {{counts,upgradeLevels,currentStage}} state
   */
  function analyze(data, state) {
    const units = data.units || [];
    const upgrades = data.upgrades || [];
    const enemies = data.enemies || [];
    const stages = data.stages || [];
    const meta = data.meta || {};
    const counts = (state && state.counts) || {};
    const levels = (state && state.upgradeLevels) || {};

    const enemyById = {};
    for (const e of enemies) enemyById[e.id] = e;

    const totalUnits = units.reduce((s, u) => s + (counts[u.id] || 0), 0);

    // 현재(목표) 스테이지
    const curNum = (state && state.currentStage) || (stages[0] ? stages[0].stage : 1);
    const stage = stages.find((s) => s.stage === curNum) || stages[0] || null;

    const result = {
      totalUnits,
      stage: stage ? { stage: stage.stage, name: stage.name, boss: !!stage.boss } : null,
      enemyTable: [],
      perUnit: [],
      bestUnitId: null,
      armyDps: 0,
      upgradeSuggestions: [],
      warnings: [],
      tips: [],
      sellAdvice: []
    };

    if (!stage) {
      result.tips.push('스테이지 데이터가 없습니다. data/stages.json 을 확인하세요.');
      return result;
    }

    const bonusOf = (u) => upgradeBonus(u, upgrades, levels);

    // 스테이지 적 표 (유닛별 처치시간 포함)
    for (const { enemy, count } of enemiesOfStage(stage, enemyById)) {
      const perUnitTtk = {};
      for (const u of units) {
        const ttk = timeToKill(u, enemy, meta, bonusOf(u));
        perUnitTtk[u.id] = isFinite(ttk) ? Math.round(ttk * 10) / 10 : null;
      }
      result.enemyTable.push({
        id: enemy.id, name: enemy.name, size: enemy.size, boss: !!enemy.boss, count,
        hp: enemy.hp, armor: enemy.armor, shield: enemy.shield || 0,
        shieldArmor: enemy.shieldArmor || 0, hpRegen: enemy.hpRegen || 0,
        ttk: perUnitTtk
      });
    }

    // 유닛별 스테이지 가치 + 보유 화력
    let best = null;
    let armyDps = 0;
    for (const u of units) {
      const { value, unkillable } = unitValueVsStage(u, stage, meta, bonusOf(u), enemyById);
      const owned = counts[u.id] || 0;
      armyDps += value * owned;
      const row = {
        id: u.id, name: u.name, damageType: u.damageType,
        owned, valuePerUnit: Math.round(value), unkillable
      };
      result.perUnit.push(row);
      if (!best || value > best.valuePerUnit) best = row;
      if (unkillable.length > 0) {
        result.warnings.push(`${u.name}(으)로는 이 스테이지의 ${unkillable.join(', ')} 을(를) 잡을 수 없습니다 (체젠 벽).`);
      }
    }
    // 가치 내림차순
    result.perUnit.sort((a, b) => b.valuePerUnit - a.valuePerUnit);
    result.bestUnitId = best ? best.id : null;
    result.armyDps = Math.round(armyDps);

    // 업그레이드 추천 (현재 스테이지 기준 비용 대비 화력 증가)
    for (const up of upgrades) {
      const cur = levels[up.id] || 0;
      if (cur >= up.maxLevel) continue;
      const unit = units.find((u) => u.id === up.unit);
      if (!unit) continue;
      const owned = counts[unit.id] || 0;
      if (owned <= 0) continue;
      const before = unitValueVsStage(unit, stage, meta, bonusOf(unit), enemyById).value;
      const patched = Object.assign({}, levels, { [up.id]: cur + 1 });
      const after = unitValueVsStage(unit, stage, meta, upgradeBonus(unit, upgrades, patched), enemyById).value;
      const marginal = (after - before) * owned;
      if (marginal <= 0) continue;
      const cost = upgradeCost(up, cur);
      result.upgradeSuggestions.push({
        id: up.id, name: up.name, currentLevel: cur, maxLevel: up.maxLevel,
        nextCost: cost, marginalDps: Math.round(marginal), ratio: marginal / cost
      });
    }
    result.upgradeSuggestions.sort((a, b) => b.ratio - a.ratio);

    // 다음 스테이지들에 대한 권장 보유 유닛 (앞으로 3스테이지)
    const upcoming = stages.filter((s) => s.stage > stage.stage).slice(0, 3);
    const futureScore = {};
    for (const u of units) futureScore[u.id] = 0;
    for (const s of upcoming) {
      for (const u of units) {
        futureScore[u.id] += unitValueVsStage(u, s, meta, bonusOf(u), enemyById).value;
      }
    }
    const futureRank = units
      .map((u) => ({ id: u.id, name: u.name, score: futureScore[u.id] }))
      .sort((a, b) => b.score - a.score);

    // 코칭 노트
    if (totalUnits === 0) {
      result.tips.push('유닛을 뽑을 때마다 왼쪽에서 + 를 눌러 카운트하세요. 위쪽에서 목표 스테이지를 선택하면 그에 맞는 추천이 나옵니다.');
    } else {
      if (best) {
        const sizeNames = result.enemyTable.map((e) => (meta.sizes || []).find((s) => s.id === e.size)?.name || e.size);
        result.tips.push(`이번 스테이지(${stage.name})에는 "${best.name}"이(가) 가장 효율적입니다. 등장: ${[...new Set(sizeNames)].join('/')}.`);
      }
      if (result.upgradeSuggestions.length > 0) {
        const u = result.upgradeSuggestions[0];
        result.tips.push(`업그레이드는 "${u.name}"(Lv.${u.currentLevel}→${u.currentLevel + 1}, 비용 ${u.nextCost})가 지금 가장 효율적입니다.`);
      }
      if (upcoming.length > 0 && futureRank[0].score > 0) {
        result.tips.push(`앞으로 ${upcoming.length}스테이지 기준으로는 "${futureRank[0].name}" 보유가 가장 유리합니다. 약한 유닛은 팔아 정비를 고려하세요.`);
        // 판매 조언: 미래 가치가 0에 가깝고 보유 중인 유닛
        for (const f of futureRank) {
          const owned = counts[f.id] || 0;
          if (owned > 0 && f.score === 0) {
            result.sellAdvice.push(`${f.name} ×${owned}: 앞 스테이지에서 효율이 없습니다(처치 불가/배율 낮음). 판매 검토.`);
          }
        }
      }
    }

    return result;
  }

  const api = {
    analyze, perHit, timeToKill, effDpsVsEnemy, unitValueVsStage,
    sizeMod, upgradeBonus, upgradeCost
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.MapleEngine = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
