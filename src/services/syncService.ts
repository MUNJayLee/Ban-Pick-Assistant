import type { BpRecord, BpState } from '@/types';
import { getSupabase, isCloudSyncEnabled } from '@/lib/supabase';
import { getDeviceId } from '@/lib/deviceId';

const APP_VERSION = '1.0.0';

function resultToCorrect(result: BpRecord['result']): boolean | null {
  if (result === 'CORRECT') return true;
  if (result === 'INCORRECT') return false;
  return null;
}

/** 上传 BP 记录（幂等：以本地 record.id 作为主键 upsert）。 */
export async function uploadBpRecord(record: BpRecord): Promise<void> {
  if (!isCloudSyncEnabled()) return;
  const sb = getSupabase();
  if (!sb) return;

  const row = {
    local_id: record.id,
    device_id: getDeviceId(),
    created_at: new Date(record.timestamp).toISOString(),
    blue_picks: record.bluePicks,
    red_picks: record.redPicks,
    blue_bans: record.blueBans,
    red_bans: record.redBans,
    blue_power: record.bluePower,
    red_power: record.redPower,
    favored: record.favored,
    predicted_correct: resultToCorrect(record.result),
    actual_result: record.actualResult ?? null,
    my_hero_id: record.myHeroId ?? null,
    my_side: record.mySide ?? null,
    my_role: record.myRole ?? null,
    note: record.note ?? null,
    app_version: APP_VERSION,
  };
  const { local_id: _omit, ...updateRow } = row;

  try {
    // 先尝试插入（新记录）；主键冲突时改为更新。
    // 不用 upsert：新式发布密钥下 upsert 会被 RLS 拦截，而 insert / update 单独都正常。
    const { error: insErr } = await sb.from('bp_records').insert(row);
    if (!insErr) return;

    const { error: updErr } = await sb
      .from('bp_records')
      .update(updateRow)
      .eq('local_id', record.id);
    if (updErr) {
      console.warn('[sync] 上传 BP 记录失败（插入+更新均失败）：', insErr.message, '/', updErr.message);
    }
  } catch (err) {
    console.warn('[sync] 上传 BP 记录异常：', err);
  }
}

/** 记录一次 ban 位识别事件（截图导入时调用）。batchId 作为事件主键，用于关联训练样本。 */
export async function recordRecognitionEvent(params: {
  batchId: string;
  blueBans: string[];
  redBans: string[];
  manualInput: number;
  corrections: number;
  imageB64?: string;
}): Promise<void> {
  if (!isCloudSyncEnabled()) return;
  const sb = getSupabase();
  if (!sb) return;

  try {
    const { error } = await sb.from('recognition_events').insert({
      id: params.batchId,
      device_id: getDeviceId(),
      blue_bans: params.blueBans,
      red_bans: params.redBans,
      manual_input: params.manualInput,
      corrections: params.corrections,
      image_b64: params.imageB64 ?? null,
      app_version: APP_VERSION,
    });
    if (error) console.warn('[sync] 记录识别事件失败：', error.message);
  } catch (err) {
    console.warn('[sync] 记录识别事件异常：', err);
  }
}

/** 上传一条训练样本（截图识别修正的标注数据），batchId 关联所属识别批次。 */
export async function recordTrainingSample(params: {
  heroId: string;
  imageB64: string;
  batchId: string;
}): Promise<void> {
  if (!isCloudSyncEnabled()) return;
  const sb = getSupabase();
  if (!sb) return;

  try {
    const { error } = await sb.from('training_samples').insert({
      hero_id: params.heroId,
      image_b64: params.imageB64,
      device_id: getDeviceId(),
      source: 'correction',
      batch_id: params.batchId,
    });
    if (error) console.warn('[sync] 上传训练样本失败：', error.message);
  } catch (err) {
    console.warn('[sync] 上传训练样本异常：', err);
  }
}

/** 上传一条推荐反馈（👍/👎）。 */
export async function uploadFeedback(params: {
  heroId: string;
  phase: 'PICK' | 'BAN';
  helpful: boolean;
  context: Partial<BpState>;
  note?: string;
}): Promise<void> {
  if (!isCloudSyncEnabled()) return;
  const sb = getSupabase();
  if (!sb) return;

  try {
    const { error } = await sb.from('recommendation_feedback').insert({
      device_id: getDeviceId(),
      hero_id: params.heroId,
      phase: params.phase,
      helpful: params.helpful,
      context: params.context as unknown as Record<string, unknown>,
      note: params.note ?? null,
    });
    if (error) console.warn('[sync] 上传推荐反馈失败：', error.message);
  } catch (err) {
    console.warn('[sync] 上传推荐反馈异常：', err);
  }
}
