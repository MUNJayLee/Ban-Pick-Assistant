import { create } from 'zustand';
import type { BpState, BpPhase, Side } from '@/types';
import { PICK_SEQUENCE } from '@/data/config';

const BAN_COUNT = 5;
const PICK_COUNT = PICK_SEQUENCE.length;

interface BpStore extends BpState {
  /** 内部操作历史栈（不持久化，用于 undo 精确恢复） */
  _history: BpState[];
  setUserSide: (side: Side) => void;
  /** 选择/输入一个英雄（当前阶段自动判断是加入我方 Ban、敌方 Ban 还是 Pick） */
  selectHero: (heroId: string) => void;
  /** 撤销上一步 */
  undo: () => void;
  /** 重置整局 */
  reset: () => void;
  /** 当前操作方（我方/敌方） */
  getActiveOperator: () => 'ME' | 'ENEMY' | null;
  /** 当前阶段名称 */
  getPhaseLabel: () => string;
  /** 当前是否为我方操作回合 */
  isMyTurn: () => boolean;
  /** 标记某个 Pick 为"我" */
  setMyHero: (heroId: string | undefined) => void;
  /** 截图识别导入：直接设置双方 ban 位并进入 Pick 阶段 */
  importBans: (blueBans: string[], redBans: string[], userSide: Side) => void;
  /** 结束当前 ban 阶段（未选中的空位视为「空 ban」，支持双方各自 0-5 个 ban） */
  skipBan: () => void;
  /** 手动指定某个 ban 槽位（side + index），覆盖默认顺序 */
  setBanAt: (side: Side, index: number, heroId: string) => void;
  /** 手动指定某个 pick 槽位（side + index），覆盖默认顺序 */
  setPickAt: (side: Side, index: number, heroId: string) => void;
}

const initialState: BpState = {
  userSide: 'BLUE',
  blueBans: [],
  redBans: [],
  bluePicks: [],
  redPicks: [],
  phase: 'MY_BAN',
  pickTurnIndex: 0,
};

// ---------------------------------------------------------------------------
// 撤销栈 / 填位工具
// ---------------------------------------------------------------------------
/** 快照当前业务状态（不含 _history），用于 undo 恢复 */
function snapshot(state: BpState): BpState {
  return {
    userSide: state.userSide,
    blueBans: [...state.blueBans],
    redBans: [...state.redBans],
    bluePicks: [...state.bluePicks],
    redPicks: [...state.redPicks],
    phase: state.phase,
    pickTurnIndex: state.pickTurnIndex,
  };
}

/** 把当前状态压入历史栈（返回要合并进 set 的 partial） */
function pushHistory(state: BpStore): { _history: BpState[] } {
  const h = state._history || [];
  return { _history: [...h, snapshot(state)].slice(-50) };
}

/**
 * 填入一个槽位：优先填数组里第一个空位（''），没有空位才追加到末尾。
 * - 返回 null 表示已满
 * - 修复「点击非顺序槽位后，selectHero 追加到末尾导致顺序错乱」
 */
function fillSlot(arr: string[], heroId: string, max: number): string[] | null {
  const copy = [...arr];
  const idx = copy.indexOf('');
  if (idx >= 0) {
    copy[idx] = heroId;
    return copy;
  }
  if (copy.length >= max) return null;
  copy.push(heroId);
  return copy;
}

/**
 * 计算「下一个该填的 turn 下标」：按 PICK_SEQUENCE 顺序，
 * 找到第一个「该方已填数量还不够」的 turn。
 * 与 fillSlot（填空位）配合，支持乱序点击槽位后继续按顺序补位。
 */
function nextTurnIndex(bluePicks: string[], redPicks: string[]): number {
  const blueFilled = bluePicks.filter(Boolean).length;
  const redFilled = redPicks.filter(Boolean).length;
  let b = 0;
  let r = 0;
  for (let i = 0; i < PICK_SEQUENCE.length; i += 1) {
    const t = PICK_SEQUENCE[i];
    if (t.side === 'BLUE') {
      if (b >= blueFilled) return i;
      b += 1;
    } else {
      if (r >= redFilled) return i;
      r += 1;
    }
  }
  return PICK_SEQUENCE.length;
}

function opposite(side: Side): Side {
  return side === 'BLUE' ? 'RED' : 'BLUE';
}

function getMySide(state: BpState): Side {
  return state.userSide;
}

function getEnemySide(state: BpState): Side {
  return opposite(state.userSide);
}

function getBans(state: BpState, side: Side): string[] {
  return side === 'BLUE' ? state.blueBans : state.redBans;
}

function getPicks(state: BpState, side: Side): string[] {
  return side === 'BLUE' ? state.bluePicks : state.redPicks;
}

function setBans(state: BpState, side: Side, bans: string[]): Partial<BpState> {
  return side === 'BLUE' ? { blueBans: bans } : { redBans: bans };
}

function setPicks(state: BpState, side: Side, picks: string[]): Partial<BpState> {
  return side === 'BLUE' ? { bluePicks: picks } : { redPicks: picks };
}

function advancePhase(state: BpState): BpPhase {
  if (state.phase === 'MY_BAN') {
    const myBans = getBans(state, getMySide(state));
    if (myBans.length >= BAN_COUNT) return 'ENEMY_BAN';
    return 'MY_BAN';
  }
  if (state.phase === 'ENEMY_BAN') {
    const enemyBans = getBans(state, getEnemySide(state));
    if (enemyBans.length >= BAN_COUNT) return 'PICK';
    return 'ENEMY_BAN';
  }
  if (state.phase === 'PICK') {
    return state.pickTurnIndex >= PICK_COUNT ? 'FINISHED' : 'PICK';
  }
  return state.phase;
}

export const useBpStore = create<BpStore>((set, get) => ({
  ...initialState,
  _history: [],

  setUserSide: (side) => {
    // 只切换阵营，保留已填的 ban/pick。
    // 场景：BP 填到一半发现红蓝方选错了，切换时不应该丢掉已填数据。
    set({ userSide: side });
  },

  selectHero: (heroId) => {
    const state = get();
    if (state.phase === 'FINISHED') return;

    if (state.phase === 'MY_BAN' || state.phase === 'ENEMY_BAN') {
      const side = state.phase === 'MY_BAN' ? getMySide(state) : getEnemySide(state);
      // 优先填第一个空位（手动点槽位清空后留下的 ''），没有才追加到末尾
      const bans = fillSlot(getBans(state, side), heroId, BAN_COUNT);
      if (!bans) return;
      const nextState = setBans(state, side, bans);
      set({
        ...nextState,
        ...pushHistory(state),
        phase: advancePhase({ ...state, ...nextState }),
      });
      return;
    }

    if (state.phase === 'PICK') {
      const turn = PICK_SEQUENCE[state.pickTurnIndex];
      if (!turn) return;
      const side = turn.side;
      const picks = fillSlot(getPicks(state, side), heroId, 5);
      if (!picks) return;
      const nextState = setPicks(state, side, picks);
      const nextBlue = side === 'BLUE' ? picks : state.bluePicks;
      const nextRed = side === 'RED' ? picks : state.redPicks;
      // 按 PICK_SEQUENCE 计算下一个 turn（不是简单数量相加，兼容乱序点槽位）
      const turnIdx = nextTurnIndex(nextBlue, nextRed);
      set({
        ...nextState,
        ...pushHistory(state),
        pickTurnIndex: turnIdx,
        phase: turnIdx >= PICK_COUNT ? 'FINISHED' : 'PICK',
      });
    }
  },

  undo: () => {
    const state = get();
    const h = state._history || [];
    if (!h.length) return;
    const prev = h[h.length - 1];
    // 精确恢复快照（含空格位/phase/pickTurnIndex），不再按数量反推
    set({ ...snapshot(prev), _history: h.slice(0, -1) });
  },

  // 注意：set(initialState) 是 merge 语义，不在 initialState 里的可选字段（myHeroId）会残留
  // 必须显式清空，否则 reset 后上一局的「我的英雄」会带到新局
  reset: () => set({ ...initialState, _history: [], myHeroId: undefined }),

  setMyHero: (heroId) => set({ myHeroId: heroId }),

  importBans: (blueBans, redBans, userSide) => {
    const state = get();
    const turnIdx = nextTurnIndex(state.bluePicks, state.redPicks);
    set({
      blueBans: blueBans.slice(0, 5),
      redBans: redBans.slice(0, 5),
      // 保留识别期间已经选的 pick（不清空），按 PICK_SEQUENCE 继续轮次
      userSide,
      phase: 'PICK',
      pickTurnIndex: turnIdx,
      ...pushHistory(state),
    });
  },

  skipBan: () => {
    const state = get();
    if (state.phase === 'MY_BAN') {
      // 我方 ban 结束（可能有空 ban），进入敌方 ban
      set({ phase: 'ENEMY_BAN', ...pushHistory(state) });
    } else if (state.phase === 'ENEMY_BAN') {
      // 敌方 ban 结束（可能有空 ban），进入 Pick
      set({ phase: 'PICK', pickTurnIndex: 0, ...pushHistory(state) });
    }
  },

  setBanAt: (side, index, heroId) => {
    const state = get();
    const key = side === 'BLUE' ? 'blueBans' : 'redBans';
    const arr = [...state[key]];
    while (arr.length < index) arr.push('');
    arr[index] = heroId;
    set({ [key]: arr, ...pushHistory(state) });
  },

  setPickAt: (side, index, heroId) => {
    const state = get();
    const key = side === 'BLUE' ? 'bluePicks' : 'redPicks';
    const arr = [...state[key]];
    while (arr.length < index) arr.push('');
    arr[index] = heroId;
    const blueArr = side === 'BLUE' ? arr : state.bluePicks;
    const redArr = side === 'RED' ? arr : state.redPicks;
    const turnIdx = nextTurnIndex(blueArr, redArr);
    set({
      [key]: arr,
      ...pushHistory(state),
      phase: turnIdx >= PICK_COUNT ? 'FINISHED' : 'PICK',
      pickTurnIndex: turnIdx,
    });
  },

  getActiveOperator: () => {
    const state = get();
    if (state.phase === 'MY_BAN') return 'ME';
    if (state.phase === 'ENEMY_BAN') return 'ENEMY';
    if (state.phase === 'PICK') {
      const turn = PICK_SEQUENCE[state.pickTurnIndex];
      if (!turn) return null;
      return turn.side === state.userSide ? 'ME' : 'ENEMY';
    }
    return null;
  },

  getPhaseLabel: () => {
    const state = get();
    if (state.phase === 'MY_BAN') return '我方盲 Ban';
    if (state.phase === 'ENEMY_BAN') return '敌方盲 Ban';
    if (state.phase === 'PICK') {
      const turn = PICK_SEQUENCE[state.pickTurnIndex];
      return turn ? `${turn.side === state.userSide ? '我方' : '敌方'}${turn.description}` : '选英雄';
    }
    return 'BP 完成';
  },

  isMyTurn: () => {
    const op = get().getActiveOperator();
    return op === 'ME';
  },
}));

export function getCurrentTurnFromState(state: BpState) {
  if (state.phase !== 'PICK') return null;
  return PICK_SEQUENCE[state.pickTurnIndex] || null;
}
