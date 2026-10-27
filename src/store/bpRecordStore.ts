import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BpRecord, BpRecordResult, ActualResult, Side } from '@/types';
import { uploadBpRecord } from '@/services/syncService';

const STORAGE_KEY = 'bp-records-v1';

/**
 * 根据预测倾向、我的阵营和实际结果，自动判定预测是否正确。
 * - favored === 'EVEN' 或 mySide 未知时，无法判定，返回 PENDING
 * - 预测我方优势且我赢了 → CORRECT
 * - 预测我方优势但我输了 → INCORRECT
 * - 预测对方优势但我赢了 → INCORRECT
 * - 预测对方优势且我输了 → CORRECT
 */
export function autoJudgeResult(
  favored: 'BLUE' | 'RED' | 'EVEN',
  mySide: Side | undefined,
  actualResult: ActualResult
): BpRecordResult {
  if (actualResult === 'PENDING') return 'PENDING';
  if (!mySide || favored === 'EVEN') return 'PENDING';
  const mySideFavored = favored === mySide;
  if (mySideFavored) {
    return actualResult === 'WIN' ? 'CORRECT' : 'INCORRECT';
  }
  return actualResult === 'WIN' ? 'INCORRECT' : 'CORRECT';
}

interface BpRecordStore {
  records: BpRecord[];
  addRecord: (record: Omit<BpRecord, 'id'>) => BpRecord;
  updateResult: (id: string, result: BpRecordResult, note?: string) => void;
  /** 更新实际对局结果，并自动判定预测正确与否 */
  updateActualResult: (id: string, actualResult: ActualResult) => void;
  /** 通用的记录更新方法 */
  updateRecord: (id: string, updates: Partial<Omit<BpRecord, 'id' | 'timestamp'>>) => void;
  deleteRecord: (id: string) => void;
  getStats: () => {
    total: number;
    correct: number;
    incorrect: number;
    pending: number;
    accuracy: number;
  };
  clearAll: () => void;
}

export const useBpRecordStore = create<BpRecordStore>()(
  persist(
    (set, get) => ({
      records: [],
      addRecord: (record) => {
        const newRecord: BpRecord = {
          ...record,
          id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        };
        set((state) => ({
          records: [newRecord, ...state.records],
        }));
        void uploadBpRecord(newRecord);
        return newRecord;
      },
      updateResult: (id, result, note) => {
        const { records } = get();
        const target = records.find((r) => r.id === id);
        if (!target) return;
        const updated: BpRecord = {
          ...target,
          result,
          ...(note !== undefined ? { note } : {}),
        };
        set((state) => ({
          records: state.records.map((r) => (r.id === id ? updated : r)),
        }));
        void uploadBpRecord(updated);
      },
      updateActualResult: (id, actualResult) => {
        const { records } = get();
        const target = records.find((r) => r.id === id);
        if (!target) return;
        const judged = autoJudgeResult(target.favored, target.mySide, actualResult);
        const updated: BpRecord = {
          ...target,
          actualResult: actualResult === 'PENDING' ? undefined : actualResult,
          result: judged,
        };
        set((state) => ({
          records: state.records.map((r) => (r.id === id ? updated : r)),
        }));
        void uploadBpRecord(updated);
      },
      updateRecord: (id, updates) => {
        const { records } = get();
        const target = records.find((r) => r.id === id);
        if (!target) return;
        const updated: BpRecord = { ...target, ...updates };
        set((state) => ({
          records: state.records.map((r) => (r.id === id ? updated : r)),
        }));
        void uploadBpRecord(updated);
      },
      deleteRecord: (id) => {
        set((state) => ({
          records: state.records.filter((r) => r.id !== id),
        }));
      },
      getStats: () => {
        const { records } = get();
        const total = records.length;
        const correct = records.filter((r) => r.result === 'CORRECT').length;
        const incorrect = records.filter(
          (r) => r.result === 'INCORRECT'
        ).length;
        const pending = records.filter((r) => r.result === 'PENDING').length;
        const decided = correct + incorrect;
        const accuracy = decided > 0 ? correct / decided : 0;
        return { total, correct, incorrect, pending, accuracy };
      },
      clearAll: () => {
        set({ records: [] });
      },
    }),
    {
      name: STORAGE_KEY,
      version: 1,
    }
  )
);
