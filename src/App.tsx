import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Home } from '@/pages/Home';
import { HeroDetail } from '@/pages/HeroDetail';
import { Dashboard } from '@/pages/Dashboard';
import { Console } from '@/pages/Console';
import { setHeroesData } from '@/services/heroService';
import { isTauri } from '@/lib/utils';

function AppInitializer({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHeroes() {
      // Tauri 桌面环境：通过 Rust 命令读取数据，避免打包路径问题
      if (isTauri()) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const json = await invoke<string>('get_heroes_data');
          const data = JSON.parse(json);
          if (!cancelled) {
            setHeroesData(data);
          }
          return;
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err));
          }
          return;
        }
      }

      // Web / Vite 开发环境：直接 fetch public 下的 heroes.json
      try {
        const res = await fetch(`/data/heroes.json?t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setHeroesData(data);
          }
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    loadHeroes().finally(() => {
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080c14] text-ui-text">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-ui-primary/30 border-t-ui-primary rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-ui-muted">加载英雄数据中…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080c14] text-ui-text px-6">
        <div className="text-center max-w-md">
          <p className="text-sm text-ui-danger mb-2">加载英雄数据失败</p>
          <p className="text-xs text-ui-muted break-all">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 rounded-lg bg-ui-primary text-white text-xs hover:bg-ui-primary/80"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AppInitializer>
      <Router>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/console" element={<Console />} />
          <Route path="/hero/:heroId" element={<HeroDetail />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Routes>
      </Router>
    </AppInitializer>
  );
}
