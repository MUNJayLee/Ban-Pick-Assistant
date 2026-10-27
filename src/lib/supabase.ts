import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase 配置通过 Vite 环境变量注入（部署时在平台后台填，或本地 .env）。
 * 未配置时返回 null，应用以纯离线模式运行，不影响任何功能。
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let client: SupabaseClient | null | undefined;

export function isCloudSyncEnabled(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function getSupabase(): SupabaseClient | null {
  if (!isCloudSyncEnabled()) return null;
  if (client === undefined) {
    client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
  }
  return client;
}
