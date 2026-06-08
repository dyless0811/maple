'use strict';

/**
 * 메이플 랜덤 디펜스 추천 엔진
 *
 * 입력: 게임 데이터(units, upgrades, meta)와 플레이어 상태(보유 유닛 카운트, 업그레이드 레벨)
 * 출력: 조합/합성/업그레이드 추천 및 진영 분석
 *
 * 브라우저(window.MapleEngine)와 Node(module.exports) 양쪽에서 동작.
 */
(function (root) {
  // appliesTo 조건이 해당 유닛에 맞는지 검사
  function unitMatches(unit, appliesTo) {
    for (const key of Object.keys(appliesTo || {})) {
      const cond = appliesTo[key];
      const val = unit[key];
      if (Array.isArray(cond)) {
        if (!cond.includes(val)) return false;
      } else if (val !== cond) {
        return false;
      }
    }
    return true;
  }

  // 특정 유닛에 적용되는 모든 업그레이드를 반영한 실효 DPS
  function effectiveDps(unit, upgrades, levels) {
    let multiplier = 1;
    for (const up of upgrades) {
      if (!unitMatches(unit, up.appliesTo)) continue;
      const lvl = (levels && levels[up.id]) || 0;
      multiplier *= 1 + lvl * up.perLevel;
    }
    return unit.dps * multiplier;
  }

  // 업그레이드를 levelOverride 레벨로 가정했을 때의 실효 DPS (한계효용 계산용)
  function effectiveDpsWithOverride(unit, upgrades, levels, overrideId, overrideLevel) {
    const patched = Object.assign({}, levels);
    patched[overrideId] = overrideLevel;
    return effectiveDps(unit, upgrades, patched);
  }

  // 다음 레벨로 올리는 비용
  function upgradeCost(up, currentLevel) {
    return Math.round(up.baseCost * Math.pow(up.costGrowth, currentLevel));
  }

  function tierOf(meta, level) {
    return (meta.tiers || []).find((t) => t.level === level) || { name: `T${level}`, color: '#9aa4b2', weight: 1 };
  }

  /**
   * 메인 분석 함수
   * @param {{units:Array, upgrades:Array, meta:Object}} data
   * @param {{counts:Object, upgradeLevels:Object}} state
   */
  function analyze(data, state) {
    const units = data.units || [];
    const upgrades = data.upgrades || [];
    const meta = data.meta || {};
    const counts = (state && state.counts) || {};
    const levels = (state && state.upgradeLevels) || {};
    const unitById = {};
    for (const u of units) unitById[u.id] = u;

    // ── 보유 유닛별 화력 ──
    const byUnit = [];
    let totalPower = 0;
    let totalUnits = 0;
    let groundPower = 0; // 지상 대상에 가할 수 있는 화력
    let airPower = 0; // 공중 대상에 가할 수 있는 화력
    let physicalPower = 0;
    let magicPower = 0;

    for (const u of units) {
      const count = counts[u.id] || 0;
      if (count <= 0) continue;
      const eff = effectiveDps(u, upgrades, levels);
      const total = eff * count;
      totalPower += total;
      totalUnits += count;
      if (u.attackType === 'ground' || u.attackType === 'both') groundPower += total;
      if (u.attackType === 'air' || u.attackType === 'both') airPower += total;
      if (u.damageType === 'physical') physicalPower += total;
      if (u.damageType === 'magic') magicPower += total;
      byUnit.push({
        id: u.id, name: u.name, tier: u.tier, tierName: tierOf(meta, u.tier).name,
        count, effDps: Math.round(eff), totalDps: Math.round(total),
        attackType: u.attackType, damageType: u.damageType
      });
    }
    byUnit.sort((a, b) => b.totalDps - a.totalDps);

    // ── 합성 추천 ──
    const combineSuggestions = [];
    for (const u of units) {
      const count = counts[u.id] || 0;
      if (!u.combinesTo || !u.combineCount || u.combineCount <= 0) continue;
      if (count < u.combineCount) continue;
      const target = unitById[u.combinesTo];
      if (!target) continue;
      const times = Math.floor(count / u.combineCount);
      combineSuggestions.push({
        fromId: u.id, fromName: u.name, fromTier: u.tier,
        toId: target.id, toName: target.name, toTier: target.tier,
        need: u.combineCount, have: count, times,
        tierGain: target.tier - u.tier
      });
    }
    // 더 높은 등급으로 가는 합성 우선
    combineSuggestions.sort((a, b) => b.toTier - a.toTier || b.times - a.times);

    // ── 업그레이드 추천 (비용 대비 화력 증가) ──
    const upgradeSuggestions = [];
    for (const up of upgrades) {
      const cur = levels[up.id] || 0;
      if (cur >= up.maxLevel) continue;
      let marginalDps = 0;
      for (const u of units) {
        const count = counts[u.id] || 0;
        if (count <= 0 || !unitMatches(u, up.appliesTo)) continue;
        const before = effectiveDps(u, upgrades, levels);
        const after = effectiveDpsWithOverride(u, upgrades, levels, up.id, cur + 1);
        marginalDps += (after - before) * count;
      }
      if (marginalDps <= 0) continue;
      const cost = upgradeCost(up, cur);
      upgradeSuggestions.push({
        id: up.id, name: up.name, currentLevel: cur, maxLevel: up.maxLevel,
        nextCost: cost, marginalDps: Math.round(marginalDps),
        ratio: marginalDps / cost
      });
    }
    upgradeSuggestions.sort((a, b) => b.ratio - a.ratio);

    // ── 진영 분석 ──
    const t = meta.thresholds || {};
    const composition = {
      groundShare: totalPower ? groundPower / totalPower : 0,
      airShare: totalPower ? airPower / totalPower : 0,
      physicalShare: totalPower ? physicalPower / totalPower : 0,
      magicShare: totalPower ? magicPower / totalPower : 0
    };

    const warnings = [];
    const tips = [];

    if (totalUnits === 0) {
      tips.push('유닛을 뽑을 때마다 왼쪽 목록에서 + 를 눌러 카운트하세요. 보유 현황과 추천이 실시간으로 갱신됩니다.');
    } else {
      if (composition.airShare < (t.lowAirShare ?? 0.15)) {
        warnings.push('공중 대상 화력이 부족합니다. 공중 보스/유닛 웨이브에 취약할 수 있어요 (대공/궁수/마법 계열 보강 권장).');
      }
      if (composition.groundShare < (t.lowGroundShare ?? 0.15)) {
        warnings.push('지상 대상 화력이 부족합니다. 지상 물량 웨이브에 취약할 수 있어요.');
      }
      const low = t.lowTypeShare ?? 0.1;
      if (composition.physicalShare < low) {
        tips.push('물리 데미지 비중이 매우 낮습니다. 마법 저항 보스 대비 물리 딜러를 일부 확보하면 안정적입니다.');
      }
      if (composition.magicShare < low) {
        tips.push('마법 데미지 비중이 매우 낮습니다. 물리 방어 보스 대비 마법 딜러를 일부 확보하면 안정적입니다.');
      }
      if (combineSuggestions.length > 0) {
        const best = combineSuggestions[0];
        tips.push(`합성 가능: ${best.fromName} ${best.need}개 → ${best.toName}(${tierOf(meta, best.toTier).name}). 등급을 올리면 화력이 크게 상승합니다.`);
      }
      if (upgradeSuggestions.length > 0) {
        const best = upgradeSuggestions[0];
        tips.push(`지금 가장 효율적인 업그레이드는 "${best.name}" (Lv.${best.currentLevel}→${best.currentLevel + 1}, 비용 ${best.nextCost}) 입니다.`);
      }
    }

    return {
      totalUnits,
      totalPower: Math.round(totalPower),
      byUnit,
      combineSuggestions,
      upgradeSuggestions,
      composition,
      warnings,
      tips
    };
  }

  const api = { analyze, effectiveDps, upgradeCost, unitMatches, tierOf };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.MapleEngine = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
