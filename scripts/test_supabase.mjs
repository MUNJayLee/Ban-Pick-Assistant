// 测试 Supabase 云端回传：insert -> (冲突时) update，并验证 RLS 在发布密钥下是否放行
import { createClient } from '@supabase/supabase-js';

const URL = 'https://nvgvaphzhqgsbxqrfoyb.supabase.co';
const KEY = 'sb_publishable_DJHwKetxg1LHNFdwlhF6jA_eQ88lwaZ';

const sb = createClient(URL, KEY);

async function main() {
  const localId = `test_full_chain_${Date.now()}`;
  const row = {
    local_id: localId,
    device_id: 'test-device-full-chain',
    created_at: new Date().toISOString(),
    blue_picks: ['dunshan', 'haiyue', 'xinmoliuer', 'ailin', 'peiqinhu'],
    red_picks: ['aoyin', 'daqiao', 'yuanliuzhizi_tank', 'shaosiyuan', 'ying'],
    blue_bans: ['xiangyu', 'yixing', 'cang', 'yuanliuzhizi_support', 'niumo'],
    red_bans: ['lixin', 'yunzhongjun', 'cang', 'zhugeliang', 'caocao'],
    blue_power: 67.3,
    red_power: 68.8,
    favored: 'EVEN',
    predicted_correct: null,
    actual_result: null,
    my_hero_id: 'dunshan',
    my_side: 'BLUE',
    my_role: 'TANK',
    note: '全链路测试',
    app_version: '1.0.0',
  };

  console.log('1. 插入新记录 local_id =', localId);
  const { error: insErr, status: insStatus } = await sb.from('bp_records').insert(row).select();
  if (insErr) {
    console.log('   插入失败:', insErr.message);
  } else {
    console.log('   插入成功 (HTTP', insStatus + ')');
  }

  console.log('2. 测试更新路径（同 local_id 再次插入触发冲突 -> update）');
  const updateRow = { ...row };
  delete updateRow.local_id;
  updateRow.note = '全链路测试-已更新';
  const { error: updErr } = await sb.from('bp_records').update(updateRow).eq('local_id', localId);
  if (updErr) {
    console.log('   更新失败:', updErr.message);
  } else {
    console.log('   更新成功');
  }

  console.log('3. 读取回该记录验证');
  const { data, error: selErr } = await sb.from('bp_records').select('local_id, note, blue_power, red_power').eq('local_id', localId);
  if (selErr) {
    console.log('   读取失败:', selErr.message);
  } else {
    console.log('   读取到', data.length, '条:', JSON.stringify(data));
  }

  console.log('4. 清理测试记录');
  const { error: delErr } = await sb.from('bp_records').delete().eq('local_id', localId);
  console.log(delErr ? '   清理失败: ' + delErr.message : '   已清理');
}

main().then(() => process.exit(0)).catch((e) => { console.error('异常:', e); process.exit(1); });
