import { useEffect, useRef, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const API = 'http://127.0.0.1:8900';

/** 缩略图目标宽度（显示尺寸更小，靠 CSS 缩放）。 */
const THUMB_WIDTH = 160;
/** 最多缓存多少张缩略图（dataURL，单张约 3~6KB）。 */
const MAX_CACHE = 80;
/** 同时解析的帧数，避免一次性拉取大量原图把 API 打满。 */
const MAX_CONCURRENT = 3;

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
let running = 0;
const waiters: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiters.push(() => {
      running += 1;
      resolve();
    });
  });
}

function releaseSlot() {
  running = Math.max(0, running - 1);
  const next = waiters.shift();
  if (next) next();
}

function remember(name: string, url: string) {
  cache.set(name, url);
  // 简单的 LRU：超限时删最久未使用的一张
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

/**
 * 拉取原始帧（大图 PNG），在浏览器里缩到 THUMB_WIDTH 后转成小 dataURL 缓存。
 * 原图解码后立即释放，避免 100 多帧 × 数 MB 的位图常驻内存。
 */
async function renderThumb(name: string): Promise<string | null> {
  await acquireSlot();
  try {
    const res = await fetch(`${API}/api/review/frame_raw?frame=${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    const blob = await res.blob();

    if (typeof createImageBitmap !== 'function') {
      // 极老浏览器兜底：直接用原图 blob（缓存上限仍会清理）
      const raw = URL.createObjectURL(blob);
      remember(name, raw);
      return raw;
    }

    const bitmap = await createImageBitmap(blob);
    const width = THUMB_WIDTH;
    const height = Math.max(1, Math.round((bitmap.height / Math.max(1, bitmap.width)) * width));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const dataUrl = canvas.toDataURL('image/webp', 0.72);
    remember(name, dataUrl);
    return dataUrl;
  } catch {
    return null;
  } finally {
    releaseSlot();
  }
}

function loadThumb(name: string): Promise<string | null> {
  const cached = cache.get(name);
  if (cached) {
    // 刷新 LRU 顺序
    cache.delete(name);
    cache.set(name, cached);
    return Promise.resolve(cached);
  }
  const pending = inflight.get(name);
  if (pending) return pending;
  const task = renderThumb(name).finally(() => {
    inflight.delete(name);
  });
  inflight.set(name, task);
  return task;
}

interface FrameThumbProps {
  frame: string;
  /** 尺寸/圆角由调用方控制，例如 "h-10 w-16" */
  className?: string;
  /** 已核对角标 */
  done?: boolean;
  /** 加载完成后的额外内容（如「查看原图」遮罩） */
  children?: React.ReactNode;
}

/**
 * 核对页帧缩略图：进入视口才加载（IntersectionObserver），解析后小图缓存复用。
 */
export function FrameThumb({ frame, className, done, children }: FrameThumbProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState<string | null>(() => cache.get(frame) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (url) return;
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    setFailed(false);

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        io.disconnect();
        void loadThumb(frame).then((result) => {
          if (cancelled) return;
          if (result) setUrl(result);
          else setFailed(true);
        });
      },
      { rootMargin: '160px' },
    );
    io.observe(host);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [frame, url]);

  return (
    <div
      ref={hostRef}
      className={cn(
        'relative shrink-0 overflow-hidden rounded-md border border-white/10 bg-ui-bg/60',
        className,
      )}
    >
      {url ? (
        <img src={url} alt={frame} draggable={false} className="h-full w-full object-cover" />
      ) : failed ? (
        <div className="flex h-full w-full items-center justify-center text-ui-muted-subtle">
          <ImageIcon className="h-3.5 w-3.5" />
        </div>
      ) : (
        <div className="h-full w-full animate-pulse bg-white/5" />
      )}
      {done && (
        <span className="absolute right-0.5 top-0.5 rounded bg-emerald-500/90 px-1 text-[8px] font-bold leading-3 text-white">
          ✓
        </span>
      )}
      {children}
    </div>
  );
}
