import type { SignalEvent, SignalResult, HitRateConfig, HitTimeframe, SignalOutcome } from '../../types/index';

/**
 * Hit Rate Motoru — açık sinyallerin fiyat hareketini takip edip
 * HIT / MISS / STOP olarak etiketler.
 *
 * Kurallar:
 *   BUY sinyali:
 *     - Fiyat entryPrice * (1 + TP) üstüne çıkarsa → HIT
 *     - Fiyat entryPrice * (1 - SL) altına düşerse → STOP
 *     - Zaman penceresi sonunda hala aradaysa (ya da yukarıdaysa ama TP'ye ulaşmamışsa):
 *         · kapanış fiyatı entry'den yukarıda → HIT (zaman aşımı kârı)
 *         · aşağıda → MISS
 *   SELL sinyali: tersi.
 */

const TIMEFRAME_MS: Record<HitTimeframe, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
};

export const DEFAULT_HITRATE_CONFIG: HitRateConfig = {
  takeProfitPct: 0.008,   // %0.8
  stopLossPct: 0.005,     // %0.5
  evalWindowsMs: TIMEFRAME_MS,
};

export interface HitRateState {
  /** Değerlendirilmemiş (açık) sinyaller için gördüğü en iyi/kötü fiyat */
  trackers: Map<string, {
    signalId: string;
    side: 'BUY' | 'SELL';
    entryPrice: number;
    createdAt: number;
    maxGainPct: number;
    maxLossPct: number;
    lastPrice: number;
    resolved: boolean;
  }>;
}

export function createHitRateState(): HitRateState {
  return { trackers: new Map() };
}

/**
 * Yeni bir sinyali takibe al (açık pozisyon açar).
 */
export function trackSignal(
  state: HitRateState,
  event: SignalEvent,
): void {
  if (state.trackers.has(event.id)) return;
  state.trackers.set(event.id, {
    signalId: event.id,
    side: event.side,
    entryPrice: event.price,
    createdAt: event.ts,
    maxGainPct: 0,
    maxLossPct: 0,
    lastPrice: event.price,
    resolved: false,
  });
}

/**
 * Her tick'te çağrılır: gelen fiyatla açık sinyalleri günceller ve
 * değerlendirmeye hazır olanları döner.
 *
 * @return Kapanan sinyaller (güncel result ile işaretlenmiş)
 */
export function evaluateTick(
  state: HitRateState,
  currentPrice: number,
  now: number,
  config: HitRateConfig = DEFAULT_HITRATE_CONFIG,
): SignalEvent[] {
  if (currentPrice <= 0) return [];

  const closed: SignalEvent[] = [];

  for (const tracker of state.trackers.values()) {
    if (tracker.resolved) continue;
    tracker.lastPrice = currentPrice;

    const entry = tracker.entryPrice;
    const movePct = tracker.side === 'BUY'
      ? (currentPrice - entry) / entry
      : (entry - currentPrice) / entry;

    tracker.maxGainPct = Math.max(tracker.maxGainPct, movePct);
    tracker.maxLossPct = Math.min(tracker.maxLossPct, movePct);

    // TP veya STOP vurdu mu?
    if (movePct >= config.takeProfitPct) {
      // En kısa zaman penceresinde hemen kapat
      closed.push(makeResult(tracker, currentPrice, 'HIT', '5m', now));
      tracker.resolved = true;
      continue;
    }
    if (movePct <= -config.stopLossPct) {
      closed.push(makeResult(tracker, currentPrice, 'STOP', '5m', now));
      tracker.resolved = true;
      continue;
    }

    // Zaman penceresi kontrolü:
    const elapsed = now - tracker.createdAt;
    let timeframe: HitTimeframe | null = null;
    if (elapsed >= config.evalWindowsMs['1h']) timeframe = '1h';
    else if (elapsed >= config.evalWindowsMs['15m']) timeframe = '15m';
    else if (elapsed >= config.evalWindowsMs['5m']) {
      // 5m dolduysa ama daha 15m/1h için takibe devam edeceğiz —
      // burada sadece ara bir sonuca bakıyoruz: eğer hala açık ve 5m dolmuş
      // ama TP/SL yememişse izlemeye devam. Zaman aşımında (1h) kapat.
      continue;
    }

    if (timeframe === '1h') {
      // 1 saat doldu, sonuca bağla: herhangi bir kâr HIT, kayıp MISS
      const outcome: SignalOutcome = movePct > 0 ? 'HIT' : movePct < 0 ? 'MISS' : 'MISS';
      closed.push(makeResult(tracker, currentPrice, outcome, '1h', now));
      tracker.resolved = true;
    }
  }

  // Çözülenleri temizle
  for (const [id, t] of state.trackers) {
    if (t.resolved) state.trackers.delete(id);
  }

  return closed;
}

function makeResult(
  tracker: HitRateState['trackers'] extends Map<string, infer V> ? V : never,
  closedPrice: number,
  outcome: SignalOutcome,
  timeframe: HitTimeframe,
  now: number,
): SignalEvent & { result: NonNullable<SignalEvent['result']> } {
  const pnlPct = tracker.side === 'BUY'
    ? (closedPrice - tracker.entryPrice) / tracker.entryPrice
    : (tracker.entryPrice - closedPrice) / tracker.entryPrice;

  return {
    // Bu fonksiyon aslında var olan event'e result ekleyerek döner;
    // fakat burada sadece result bilgisini üretmek için kullanıyoruz.
    // WsEngine tarafında ilgili event bulunup result'ı set edilecek.
    id: tracker.signalId,
    ts: tracker.createdAt,
    side: tracker.side,
    price: tracker.entryPrice,
    confidence: 0,
    scores: { cvd: 0, obi: 0, vel: 0, composite: 0 },
    result: {
      outcome,
      closedAt: now,
      closedPrice,
      maxGainPct: tracker.maxGainPct,
      maxLossPct: tracker.maxLossPct,
      pnlPct,
      timeframe,
    },
  };
}

/**
 * Hit rate özeti: verilen sinyal listesinden
 * HIT/MISS/STOP sayılarını ve win rate'i hesaplar.
 */
export interface HitRateSummary {
  total: number;
  evaluated: number;   // result'ı olan
  hits: number;
  misses: number;
  stops: number;
  open: number;       // henüz değerlendirilmemiş
  winRate: number;    // hits / evaluated
  avgPnlPct: number;  // değerlendirilmiş sinyallerin ortalama kârı
  totalPnlPct: number;
}

export function computeSummary(events: SignalEvent[]): HitRateSummary {
  let hits = 0, misses = 0, stops = 0, pnl = 0, evaluated = 0;
  for (const ev of events) {
    if (!ev.result) continue;
    evaluated++;
    if (ev.result.outcome === 'HIT') hits++;
    else if (ev.result.outcome === 'MISS') misses++;
    else if (ev.result.outcome === 'STOP') stops++;
    pnl += ev.result.pnlPct;
  }
  const open = events.filter((e) => !e.result).length;
  return {
    total: events.length,
    evaluated,
    hits,
    misses,
    stops,
    open,
    winRate: evaluated > 0 ? hits / evaluated : 0,
    avgPnlPct: evaluated > 0 ? pnl / evaluated : 0,
    totalPnlPct: pnl,
  };
}

// STORAGE key — sinyallerle birlikte tutulur, ayrı key gerekmez
export const STORAGE_KEY = 'signal-radar:signals';
