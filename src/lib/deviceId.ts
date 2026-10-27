const STORAGE_KEY = 'bp-device-id';

/**
 * 返回本设备的匿名 ID（持久化在 localStorage）。
 * 用于在无登录的情况下区分不同测试者，方便后续统计样本来源。
 */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    return `dev_${Date.now()}`;
  }
}
