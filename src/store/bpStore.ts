import { create } from 'zustand';
import type { BpState, BpPhase, Side } from '@/types';
import { PICK_SEQUENCE } from '@/data/config';

const BAN_COUNT = 5;
const PICK_COUNT = PICK_SEQUENCE.length;

interface BpStore extends BpState {
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

  setUserSide: (side) => {
    // 只切换阵营，保留已填的 ban/pick。
    // 场景：BP 填到一半发现红蓝方选错了，切换时不应该丢掉已填数据。
    set({ userSide: side });
  },

  selectHero: (heroId) => {
    const state = get();
    if (state.phase === 'FINISHED') return;

    if (state.phase === 'MY_BAN') {
      const side = getMySide(state);
      const bans = [...getBans(state, side), heroId];
      if (bans.length > BAN_COUNT) return;
      set({ ...setBans(state, side, bans), phase: advancePhase({ ...state, ...setBans(state, side, bans) }) });
      return;
    }

    if (state.phase === 'ENEMY_BAN') {
      const side = getEnemySide(state);
      const bans = [...getBans(state, side), heroId];
      if (bans.length > BAN_COUNT) return;
      set({ ...setBans(state, side, bans), phase: advancePhase({ ...state, ...setBans(state, side, bans) }) });
      return;
    }

    if (state.phase === 'PICK') {
      const turn = PICK_SEQUENCE[state.pickTurnIndex];
      if (!turn) return;
      const side = turn.side;
      const picks = [...getPicks(state, side), heroId];
      if (picks.length > 5) return;
      const nextState: Partial<BpState> = {
        ...setPicks(state, side, picks),
        pickTurnIndex: state.pickTurnIndex + 1,
      };
      set({ ...nextState, phase: advancePhase({ ...state, ...nextState } as BpState) });
    }
  },

  undo: () => {
    const state = get();

    if (state.phase === 'FINISHED') {
      // 从完成状态撤销，回退最后一个 pick
      const lastTurn = PICK_SEQUENCE[PICK_COUNT - 1];
      set({
        phase: 'PICK',
        pickTurnIndex: PICK_COUNT - 1,
        ...setPicks(state, lastTurn.side, getPicks(state, lastTurn.side).slice(0, -1)),
      });
      return;
    }

    if (state.phase === 'PICK') {
      if (state.pickTurnIndex === 0 && state.bluePicks.length === 0 && state.redPicks.length === 0) {
        // 选英雄阶段尚未选择，回到敌方 Ban 阶段并移除最后一个敌方 Ban
        const enemySide = getEnemySide(state);
        set({
          phase: 'ENEMY_BAN',
          ...setBans(state, enemySide, getBans(state, enemySide).slice(0, -1)),
        });
        return;
      }
      const prevTurn = PICK_SEQUENCE[state.pickTurnIndex - 1];
      set({
        pickTurnIndex: state.pickTurnIndex - 1,
        ...setPicks(state, prevTurn.side, getPicks(state, prevTurn.side).slice(0, -1)),
      });
      return;
    }

    if (state.phase === 'ENEMY_BAN') {
      const enemySide = getEnemySide(state);
      const enemyBans = getBans(state, enemySide);
      if (enemyBans.length === 0) {
        // 敌方 Ban 为空，回到我方 Ban 并移除最后一个我方 Ban
        const mySide = getMySide(state);
        set({
          phase: 'MY_BAN',
          ...setBans(state, mySide, getBans(state, mySide).slice(0, -1)),
        });
      } else {
        set({
          ...setBans(state, enemySide, enemyBans.slice(0, -1)),
        });
      }
      return;
    }

    if (state.phase === 'MY_BAN') {
      const mySide = getMySide(state);
      set({
        ...setBans(state, mySide, getBans(state, mySide).slice(0, -1)),
      });
    }
  },

  reset: () => set(initialState),

  setMyHero: (heroId) => set({ myHeroId: heroId }),

  importBans: (blueBans, redBans, userSide) => {
    const state = get();
    set({
      blueBans: blueBans.slice(0, 5),
      redBans: redBans.slice(0, 5),
      // 保留识别期间已经选的 pick（不清空），并按已有 pick 数继续轮次
      userSide,
      phase: 'PICK',
      pickTurnIndex: state.bluePicks.length + state.redPicks.length,
    });
  },

  skipBan: () => {
    const state = get();
    if (state.phase === 'MY_BAN') {
      // 我方 ban 结束（可能有空 ban），进入敌方 ban
      set({ phase: 'ENEMY_BAN' });
    } else if (state.phase === 'ENEMY_BAN') {
      // 敌方 ban 结束（可能有空 ban），进入 Pick
      set({ phase: 'PICK', pickTurnIndex: 0 });
    }
  },

  setBanAt: (side, index, heroId) => {
    const state = get();
    const key = side === 'BLUE' ? 'blueBans' : 'redBans';
    const arr = [...state[key]];
    while (arr.length < index) arr.push('');
    arr[index] = heroId;
    set({ [key]: arr });
  },

  setPickAt: (side, index, heroId) => {
    const state = get();
    const key = side === 'BLUE' ? 'bluePicks' : 'redPicks';
    const arr = [...state[key]];
    while (arr.length < index) arr.push('');
    arr[index] = heroId;
    const blueArr = side === 'BLUE' ? arr : state.bluePicks;
    const redArr = side === 'RED' ? arr : state.redPicks;
    set({
      [key]: arr,
      phase: 'PICK',
      pickTurnIndex: blueArr.filter(Boolean).length + redArr.filter(Boolean).length,
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
