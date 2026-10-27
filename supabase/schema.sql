-- 王者BP助手 · 数据回传表结构
-- 在 Supabase 后台 SQL Editor 里整段粘贴执行即可。

-- 1) BP 记录表（预测 vs 实际 自动回传）
create table if not exists public.bp_records (
  local_id text primary key,               -- 本地记录 id，幂等去重
  device_id text not null,                 -- 匿名设备 id
  created_at timestamptz not null default now(),
  blue_picks text[] not null default '{}',
  red_picks text[] not null default '{}',
  blue_bans text[] not null default '{}',
  red_bans text[] not null default '{}',
  blue_power numeric,
  red_power numeric,
  favored text,                            -- BLUE | RED | EVEN
  predicted_correct boolean,               -- 预测是否正确（CORRECT/INCORRECT 映射，PENDING 为 null）
  actual_result text,                      -- WIN | LOSE
  my_hero_id text,
  my_side text,
  my_role text,
  note text,
  app_version text
);

create index if not exists bp_records_created_at_idx on public.bp_records (created_at desc);
create index if not exists bp_records_device_idx on public.bp_records (device_id);

-- 2) 推荐反馈表（👍/👎）
create table if not exists public.recommendation_feedback (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  created_at timestamptz not null default now(),
  hero_id text not null,
  phase text not null,                     -- PICK | BAN
  helpful boolean not null,                -- true=👍 false=👎
  context jsonb,                           -- 当时的 BP 快照
  note text
);

create index if not exists recommendation_feedback_hero_idx on public.recommendation_feedback (hero_id);
create index if not exists recommendation_feedback_created_idx on public.recommendation_feedback (created_at desc);

-- 3) 行级安全：测试期允许匿名写入（你在后台仍可查看全部数据）
alter table public.bp_records enable row level security;
alter table public.recommendation_feedback enable row level security;

drop policy if exists "allow anon insert" on public.bp_records;
create policy "allow anon insert" on public.bp_records
  for insert to anon with check (true);

-- upsert（先插入、后更新）需要 update 权限
drop policy if exists "allow anon update" on public.bp_records;
create policy "allow anon update" on public.bp_records
  for update to anon using (true) with check (true);

drop policy if exists "allow anon insert" on public.recommendation_feedback;
create policy "allow anon insert" on public.recommendation_feedback
  for insert to anon with check (true);

-- 供后台/看板查询：允许匿名读取（看板页用发布密钥读数据）。
-- 注意：这会让你库里的数据可被任何持有发布密钥的人读取；对非敏感测试数据够用。
drop policy if exists "allow anon read" on public.bp_records;
create policy "allow anon read" on public.bp_records
  for select to anon using (true);

drop policy if exists "allow anon read" on public.recommendation_feedback;
create policy "allow anon read" on public.recommendation_feedback
  for select to anon using (true);

-- 供后台/看板查询：允许服务端角色读取（如后续接自己的看板）
drop policy if exists "allow service read" on public.bp_records;
create policy "allow service read" on public.bp_records
  for select to service_role using (true);

drop policy if exists "allow service read" on public.recommendation_feedback;
create policy "allow service read" on public.recommendation_feedback
  for select to service_role using (true);

-- 4) 训练样本表（截图识别手动修正的标注数据，用于后续深度学习/参考集增强）
create table if not exists public.training_samples (
  id uuid primary key default gen_random_uuid(),
  hero_id text not null,                    -- 修正后的正确英雄 id（标注）
  image_b64 text not null,                  -- 裁剪后的头像 base64（JPEG，小图）
  device_id text,
  source text default 'correction',         -- 数据来源：correction / manual
  batch_id text,                            -- 所属识别批次（关联 recognition_events.id，便于整批删除）
  created_at timestamptz not null default now()
);

-- 补充：给已存在的 training_samples 表加 batch_id 列（若尚未有）
alter table public.training_samples add column if not exists batch_id text;

create index if not exists training_samples_hero_idx on public.training_samples (hero_id);
create index if not exists training_samples_created_idx on public.training_samples (created_at desc);

alter table public.training_samples enable row level security;

drop policy if exists "allow anon insert" on public.training_samples;
create policy "allow anon insert" on public.training_samples
  for insert to anon with check (true);

drop policy if exists "allow anon read" on public.training_samples;
create policy "allow anon read" on public.training_samples
  for select to anon using (true);

-- 5) 识别事件表（每次截图导入 ban 位时记录一次，含识别结果、手动输入/修正数、原始截图）
create table if not exists public.recognition_events (
  id uuid primary key default gen_random_uuid(),
  device_id text,
  created_at timestamptz not null default now(),
  blue_bans text[] not null default '{}',
  red_bans text[] not null default '{}',
  manual_input int not null default 0,      -- 手动输入的槽位数（非修正，如自己方预填）
  corrections int not null default 0,       -- 修正识别结果的次数
  image_b64 text,                           -- 原始截图（降采样后的 base64，供将来训练）
  app_version text
);

-- 补充：给已存在的 recognition_events 表加新列（若尚未有）
alter table public.recognition_events add column if not exists manual_input int not null default 0;
alter table public.recognition_events add column if not exists corrections int not null default 0;
alter table public.recognition_events add column if not exists image_b64 text;

create index if not exists recognition_events_created_idx on public.recognition_events (created_at desc);

alter table public.recognition_events enable row level security;

drop policy if exists "allow anon insert" on public.recognition_events;
create policy "allow anon insert" on public.recognition_events
  for insert to anon with check (true);

drop policy if exists "allow anon read" on public.recognition_events;
create policy "allow anon read" on public.recognition_events
  for select to anon using (true);
