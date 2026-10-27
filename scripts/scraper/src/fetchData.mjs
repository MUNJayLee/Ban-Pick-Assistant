import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { mapNameToId, getHeroMetaById, HEROES } from './nameMap.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, '../config.json');

/**
 * 将天元之弈的梯度评分 (0-100) 映射为类似胜率的 0-1 小数，用于兼容推荐算法。
 * 天元之弈评分分布：T0≈75-90, T0.5≈60-75, T1≈45-60, T2≈30-45, T3≈15-30, T4≈0-15
 * 映射到 0.42-0.58 的胜率区间，保持推荐算法中 aiWinRate 权重的平衡。
 * 公式：0.42 + (score / 100) * 0.16
 *   - score=0   → 0.42 (T4)
 *   - score=50  → 0.50 (T1.5 中位)
 *   - score=100 → 0.58 (T0 顶尖)
 * @param {number} score - 0-100 的梯度评分
 * @returns {number} 0.42-0.58 的小数
 */
function tierScoreToWinRate(score) {
  if (score === null || score === undefined) return 0.5;
  return 0.42 + (Math.max(0, Math.min(100, score)) / 100) * 0.16;
}

/**
 * 将天元之弈的分路名称映射为项目内部的 HeroRole。
 * 天元之弈分路：对抗路、中路、发育路、游走、打野
 * @param {string} roleStr - 分路字符串，如 "对抗路/打野"
 * @returns {string[]} HeroRole 数组
 */
function parseRoles(roleStr) {
  const ROLE_MAP = {
    '对抗路': 'WARRIOR',
    '中路': 'MAGE',
    '发育路': 'MARKSMAN',
    '游走': 'SUPPORT',
    '打野': 'ASSASSIN',
  };
  if (!roleStr) return [];
  // 分路可能包含主/次分路，如 "对抗路/打野" 或 "游走/中路(次分路)"
  const roles = [];
  for (const [key, value] of Object.entries(ROLE_MAP)) {
    if (roleStr.includes(key)) {
      roles.push(value);
    }
  }
  return roles.length > 0 ? roles : [];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadConfig() {
  const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw);
}

function getField(item, fieldPath) {
  if (!fieldPath) return undefined;
  const keys = fieldPath.split('.');
  let value = item;
  for (const key of keys) {
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value) && /^\d+$/.test(key)) {
      value = value[parseInt(key, 10)];
    } else {
      value = value[key];
    }
  }
  return value;
}

async function fetchJsonSource(source, rateLimit) {
  let url = source.url;
  // 替换 TODAY 为当天日期
  const today = new Date().toISOString().split('T')[0];
  url = url.replace('TODAY', today);

  const { method = 'GET', headers = {}, timeout = 10000, body } = source;
  if (rateLimit.enabled && rateLimit.delayMs > 0) {
    await sleep(rateLimit.delayMs);
  }

  let lastError;
  const retries = Math.max(1, source.retries ?? rateLimit.retries ?? 1);
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      console.log(`[scraper] 请求：${url}`);
      const response = await axios({
        url,
        method,
        headers,
        timeout,
        data: body,
        responseType: 'json',
        validateStatus: () => true,
      });
      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.data;
    } catch (err) {
      lastError = err;
      if (attempt < retries - 1) {
        await sleep(2000 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

function extractResults(data, mapping) {
  let results = data;
  if (mapping.resultPath) {
    const keys = mapping.resultPath.split('.');
    for (const key of keys) {
      results = results?.[key];
    }
  }
  if (!Array.isArray(results)) {
    throw new Error(
      `无法从数据源中提取数组，请检查 config.json 中的 resultPath。当前类型：${typeof results}`
    );
  }
  return results;
}

async function backupExisting(outputPath) {
  try {
    const stats = await fs.stat(outputPath);
    if (!stats.isFile()) return;
    const backupPath = `${outputPath}.backup.${Date.now()}.json`;
    await fs.copyFile(outputPath, backupPath);
    console.log(`[scraper] 已备份原数据到：${path.basename(backupPath)}`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[scraper] 备份失败：${err.message}`);
    }
  }
}

/**
 * 将天元之弈的分路名称（位置）映射为项目内部的 HeroPosition 数组。
 * 天元之弈位置：对抗路、中路、发育路、游走、打野
 * @param {string} roleStr - 位置字符串，如 "对抗路/打野"
 * @returns {string[]} HeroPosition 数组
 */
function parsePositions(roleStr) {
  const POSITION_MAP = {
    '对抗路': 'CLASH_LANE',
    '中路': 'MID_LANE',
    '发育路': 'FARM_LANE',
    '游走': 'ROAM',
    '打野': 'JUNGLE',
  };
  if (!roleStr) return [];
  const positions = [];
  for (const [key, value] of Object.entries(POSITION_MAP)) {
    if (roleStr.includes(key)) {
      positions.push(value);
    }
  }
  return positions;
}

/**
 * 将天元之弈的 profession（细分定位）映射为项目的职业类型 HeroRole[]。
 * 一个 profession 可能对应多个职业（如 "战野" → WARRIOR + ASSASSIN）。
 * @param {string} profession - 天元之弈细分定位
 * @returns {string[]} HeroRole 数组
 */
function professionToRoles(profession) {
  const MAP = {
    // 纯刺客
    '野核': ['ASSASSIN'],
    // 纯法师
    '法核': ['MAGE'],
    '大法核': ['MAGE'],
    '工具人法师': ['MAGE', 'SUPPORT'],
    // 纯战士
    '战野': ['WARRIOR', 'ASSASSIN'],
    '战边': ['WARRIOR'],
    '战边/战野': ['WARRIOR', 'ASSASSIN'],
    // 纯射手
    '射核': ['MARKSMAN'],
    '抗压射': ['MARKSMAN'],
    '自保射': ['MARKSMAN', 'ASSASSIN'],
    '自保射/战边': ['MARKSMAN', 'WARRIOR'],
    '边核/带线射': ['MARKSMAN', 'WARRIOR'],
    '边核/野核': ['WARRIOR', 'ASSASSIN'],   // 马超等：核心定位是战/刺，非射手
    '边核': ['MARKSMAN', 'WARRIOR'],
    '带线射': ['MARKSMAN', 'WARRIOR'],
    '射野': ['MARKSMAN', 'ASSASSIN'],
    // 坦克
    '坦边': ['TANK', 'WARRIOR'],
    '坦野': ['TANK', 'ASSASSIN'],
    '坦野/坦边': ['TANK', 'WARRIOR', 'ASSASSIN'],
    '战野/坦野': ['WARRIOR', 'TANK', 'ASSASSIN'],
    // 辅助
    '开团辅': ['TANK', 'SUPPORT'],
    '怕开团辅': ['SUPPORT'],
    '反手辅': ['TANK', 'SUPPORT'],
    '均衡辅': ['SUPPORT'],
    // 特殊
    '开除': ['WARRIOR', 'TANK'],     // 芈月/程咬金：官方定位是战士/坦克
    '法核/野核': ['MAGE', 'ASSASSIN'],
    '战边/反手辅': ['WARRIOR', 'SUPPORT'],
  };
  if (!profession) return [];
  // 直接匹配
  if (MAP[profession]) return MAP[profession];
  // 模糊匹配：检查 profession 中的关键词
  const roles = [];
  if (profession.includes('核') && (profession.includes('野') || profession.includes('战'))) roles.push('ASSASSIN');
  else if (profession.includes('核') && profession.includes('法')) roles.push('MAGE');
  else if (profession.includes('核') && profession.includes('射')) roles.push('MARKSMAN');
  // 注意：边核 = 战边+野核 核心是战/刺，不含射手
  if (profession.includes('战')) roles.push('WARRIOR');
  if (profession.includes('坦')) roles.push('TANK');
  if (profession.includes('辅')) roles.push('SUPPORT');
  if (profession.includes('野')) roles.push('ASSASSIN');
  if (profession.includes('法') && !roles.includes('MAGE')) roles.push('MAGE');
  if (profession.includes('射') && !roles.includes('MARKSMAN')) roles.push('MARKSMAN');
  return roles.length > 0 ? [...new Set(roles)] : [];
}

async function run() {
  console.log('[scraper] 加载配置...');
  const config = await loadConfig();

  const sources = Array.isArray(config.sources) ? config.sources : [config.source];
  if (!sources || sources.length === 0) {
    throw new Error('config.json 中未配置任何数据源（sources/source）');
  }

  const rateLimit = config.rateLimit || { enabled: true, delayMs: 1000, retries: 3 };
  const threshold = config.threshold ?? { minMatchRate: 0.1, minHeroCount: 3 };
  const outputPath = path.resolve(path.dirname(CONFIG_PATH), config.output || '../../src/data/heroes.json');

  console.log('[scraper] 开始获取数据源...');
  let rawData;
  let mapping;
  let lastError = null;

  for (const source of sources) {
    try {
      rawData = await fetchJsonSource(source, rateLimit);
      mapping = source.mapping || {};
      const items = extractResults(rawData, mapping);
      console.log(`[scraper] 数据源 ${source.name || source.type} 成功，获取 ${items.length} 条原始数据`);
    } catch (err) {
      lastError = err;
      console.warn(`[scraper] 数据源 ${source.name || source.type} 失败：${err.message}`);
      continue;
    }
  }

  if (!rawData) {
    throw new Error(`所有数据源均失败。最后错误：${lastError?.message}`);
  }

  const items = extractResults(rawData, mapping);
  if (items.length === 0) {
    throw new Error('数据源返回 0 条英雄记录，请检查字段映射。');
  }

  console.log('[scraper] 读取现有英雄数据...');
  const existingRaw = await fs.readFile(outputPath, 'utf-8');
  const existing = JSON.parse(existingRaw);
  if (!Array.isArray(existing.heroes)) {
    throw new Error('heroes.json 格式错误：缺少 heroes 数组');
  }
  const heroMap = new Map(existing.heroes.map((h) => [h.id, h]));

  let matched = 0;
  const unmatched = [];
  const updatedFields = { aiWinRate: 0, tier: 0, tierScore: 0, role: 0 };

  // 同一英雄可能有多个分路条目，先收集再取最佳
  const heroBest = new Map(); // heroId → { item, tierScore }

  for (const item of items) {
    const rawName = getField(item, mapping.nameField);
    const name = String(rawName ?? '').trim();
    const heroId = mapNameToId(name);
    if (!heroId) {
      if (name) unmatched.push(name);
      continue;
    }

    const tierScore = getField(item, mapping.tierScoreField) ?? 0;
    const existing = heroBest.get(heroId);
    if (!existing || tierScore > existing.tierScore) {
      heroBest.set(heroId, { item, tierScore, heroId, name });
    }
  }

  for (const { item, tierScore: bestScore, heroId, name } of heroBest.values()) {

    let hero = heroMap.get(heroId);
    if (!hero) {
      const meta = getHeroMetaById(heroId);
      if (!meta) continue;
      hero = {
        id: meta.id,
        name: meta.names[0] || name,
        title: meta.names[1] || '',
        roles: meta.roles,
        aiWinRate: 0.5,
        popularity: 5,
        difficulty: 3,
        counters: [],
        counteredBy: [],
        synergies: [],
        pickRate: 0,
        banRate: 0,
      };
      heroMap.set(heroId, hero);
    }

    // 梯度评分 → aiWinRate (0-1)
    const tierScore = getField(item, mapping.tierScoreField);
    if (tierScore !== null && tierScore !== undefined) {
      hero.aiWinRate = tierScoreToWinRate(tierScore);
      hero.tierScore = tierScore;
      updatedFields.aiWinRate += 1;
      updatedFields.tierScore += 1;
    }

    // 梯度评级 (T0, T0.5, T1, T2, T3, T4)
    const tier = getField(item, mapping.tierField);
    if (tier) {
      hero.tier = tier;
      updatedFields.tier += 1;
    }

    // 分路数据 (对抗路/中路/发育路/游走/打野) — 只更新 roleLabel，不覆盖英雄固有的 roles
    const roleStr = getField(item, mapping.roleField);
    if (roleStr) {
      hero.roleLabel = roleStr;
      updatedFields.role += 1;
    }

    // 战力值
    const heroPower = getField(item, mapping.heroPowerField);
    if (heroPower !== null && heroPower !== undefined) {
      hero.heroPower = heroPower;
    }

    // Ban 标记
    const highBan = getField(item, mapping.banField);
    if (highBan !== null && highBan !== undefined) {
      hero.highBan = highBan;
    }

    // 排名
    const rank = getField(item, mapping.rankField);
    if (rank !== null && rank !== undefined) {
      hero.tierRank = rank;
    }

    // 头像 URL
    const avatarUrl = getField(item, mapping.avatarField);
    if (avatarUrl && typeof avatarUrl === 'string') {
      hero.avatar = avatarUrl;
    }

    matched += 1;
  }

  const totalHeroes = existing.heroes.length;
  const matchRate = totalHeroes > 0 ? matched / totalHeroes : 0;

  console.log(`[scraper] 匹配结果：${matched}/${totalHeroes} 位英雄（匹配率 ${(matchRate * 100).toFixed(1)}%）`);
  console.log(
    `[scraper] 字段更新：aiWinRate/tierScore=${updatedFields.aiWinRate}, tier=${updatedFields.tier}, role=${updatedFields.role}`
  );

  if (matched < threshold.minHeroCount) {
    throw new Error(
      `匹配英雄数 ${matched} 小于阈值 ${threshold.minHeroCount}，为防止覆盖错误数据已中止写入。请检查 nameMap 或数据源字段映射。`
    );
  }
  if (matchRate < threshold.minMatchRate) {
    throw new Error(
      `匹配率 ${(matchRate * 100).toFixed(1)}% 小于阈值 ${(threshold.minMatchRate * 100).toFixed(
        0
      )}%，已中止写入。请检查 nameMap 或数据源。`
    );
  }

  // 将 nameMap 中已配置但数据源未出现的英雄也纳入英雄池
  for (const meta of HEROES) {
    if (heroMap.has(meta.id)) continue;
    heroMap.set(meta.id, {
      id: meta.id,
      name: meta.names[0] || meta.id,
      title: meta.names[1] || '',
      roles: meta.roles,
      aiWinRate: 0.5,
      popularity: 5,
      difficulty: 3,
      counters: [],
      counteredBy: [],
      synergies: [],
      pickRate: 0,
      banRate: 0,
    });
  }

  // === 补充位置和细分定位数据（从 allheroes API） ===
  let allHeroes = [];
  try {
    console.log('[scraper] 获取英雄位置/细分定位数据...');
    const allHeroesResp = await axios({
      url: 'https://tianyuanzhiyi.com/api/allheroes',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://tianyuanzhiyi.com/heroes'
      },
      timeout: 15000,
    });
    allHeroes = Array.isArray(allHeroesResp.data)
      ? allHeroesResp.data
      : allHeroesResp.data?.data || allHeroesResp.data?.heroes || [];

    if (allHeroes.length > 0) {
      let posUpdated = 0;
      // 建立天元之弈 heroId 到内部 heroId 的映射
      for (const ah of allHeroes) {
        const internalId = mapNameToId(ah.name);
        if (!internalId) continue;
        const hero = heroMap.get(internalId);
        if (!hero) continue;

        // 位置（分路）
        if (ah.roles) {
          hero.positions = parsePositions(ah.roles);
          hero.positionLabel = ah.roles;
        }
        // 细分定位（如 "法核"、"战边"、"开团辅"）
        if (ah.profession) {
          hero.profession = ah.profession;
          // 根据 profession 推断英雄职业（覆盖 nameMap 中的硬编码）
          const inferredRoles = professionToRoles(ah.profession);
          if (inferredRoles.length > 0) {
            hero.roles = inferredRoles;
          }
        }
        // 头像（如果 tier 数据中没拿到的话）
        if (ah.avatarUrl && !hero.avatar) {
          hero.avatar = ah.avatarUrl;
        }
        posUpdated++;
      }
      console.log(`[scraper] 位置/细分定位数据更新：${posUpdated} 位英雄`);
    }
  } catch (err) {
    console.warn(`[scraper] 获取位置数据失败（不影响主数据）：${err.message}`);
  }

  // === 补充克制/搭配关系数据（从 /api/hero/analysis） ===
  if (config.counterAnalysis?.enabled === false) {
    console.log('[scraper] 克制关系数据抓取已禁用（counterAnalysis.enabled=false）。');
  } else {
    try {
      const counterTopN = config.counterAnalysis?.topN ?? 4;
      const counterDelay = config.counterAnalysis?.delayMs ?? 500;
      console.log(`[scraper] 获取克制/搭配关系数据（${allHeroes.length} 位英雄）...`);

      let counterUpdated = 0;
      const unmatchedNames = new Set();

      for (let i = 0; i < allHeroes.length; i += 1) {
        const ah = allHeroes[i];
        const internalId = mapNameToId(ah.name);
        if (!internalId) {
          unmatchedNames.add(ah.name);
          continue;
        }
        const hero = heroMap.get(internalId);
        if (!hero) continue;

        try {
          if (counterDelay > 0) await sleep(counterDelay);
          const resp = await axios({
            url: `https://tianyuanzhiyi.com/api/hero/analysis?heroId=${ah.id}`,
            method: 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'application/json',
              'Referer': `https://tianyuanzhiyi.com/hero/${ah.id}`,
            },
            timeout: 15000,
          });

          const d = resp.data || {};
          const toIds = (list) =>
            (Array.isArray(list) ? list : [])
              .slice(0, counterTopN)
              .map((x) => mapNameToId(x.heroName))
              .filter(Boolean);

          const counters = toIds(d.counters);
          const counteredBy = toIds(d.counteredBy);
          const synergies = toIds(d.goodSynergies);
          const antiSynergies = toIds(d.badSynergies);

          if (counters.length || counteredBy.length || synergies.length || antiSynergies.length) {
            hero.counters = counters;
            hero.counteredBy = counteredBy;
            hero.synergies = synergies;
            hero.antiSynergies = antiSynergies;
            counterUpdated += 1;
          }
        } catch (err) {
          console.warn(`[scraper] 克制数据抓取失败 ${ah.name}：${err.message}`);
        }
      }

      console.log(`[scraper] 克制/搭配关系数据更新：${counterUpdated} 位英雄`);
      if (unmatchedNames.size > 0) {
        console.log(`[scraper] 克制数据未匹配名称（${unmatchedNames.size}）：${[...unmatchedNames].slice(0, 20).join(', ')}`);
      }
    } catch (err) {
      console.warn(`[scraper] 获取克制数据失败（不影响主数据）：${err.message}`);
    }
  }

  // 备份并写入
  await backupExisting(outputPath);
  existing.heroes = Array.from(heroMap.values());
  await fs.writeFile(outputPath, JSON.stringify(existing, null, 2), 'utf-8');

  console.log(`[scraper] 合并完成：成功匹配并更新 ${matched} 位英雄`);
  if (unmatched.length) {
    console.log(`[scraper] 未匹配的名称（共 ${unmatched.length} 个，前 20）：`);
    console.log(unmatched.slice(0, 20).join(', '));
  }
  console.log(`[scraper] 已写入 ${config.output || '../../src/data/heroes.json'}`);
}

run().catch((err) => {
  console.error('[scraper] 抓取失败：', err.message);
  process.exit(1);
});
