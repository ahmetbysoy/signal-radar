import type { SignalEvent, SignalResult, HitRateConfig, HitTimeframe, SignalOutcome } from '../../types/index';

/**
 * Hit Rate Motoru — açık sinyallerin fiyat hareketini takip edip
 * HIT / MISS / STOP olarak etiketler.
 *
 * Kurallar:
 *   BUY sinyali:
 *     - Fiyat entryPrice * (1 + TP) üstüne çıkarsa → HIT (anında kapat)
 *     - Fiyat entryPrice * (1 - SL) altına düşerse → STOP (anında kapat)
 *     - 5 dakika dolunca pozisyonu kapat: kârda ise HIT, zararda MISS
 *   SELL sinyali: tersi.
 *
 * Neden 5dk? Radar scalping odaklı; 15s mumlar ve 15sn cooldown ile çalışıyor.
 * 1 saat bekletmek mantıksız.
 */

const TIMEFRAME_MS: Record<HitTimeframe, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
};

export const DEFAULT_HITRATE_CONFIG: HitRateConfig = {
  takeProfitPct: 0.004,   // %0.4 — BTC'de ~250-300$'lık hareket
  stopLossPct: 0.003,     // %0.3 — ~200$
  evalWindowsMs: TIMEFRAME_MS,
};

export interface HitRateState {
  trackers: Map<string, {
    signalId: string;
    side: 'BUY' | 'SELL';
    entryPrice: number;
    createdAt: number;
    maxGainPct: number;
    maxLossPct: number;
    lastPrice: number;
    bestPrice: number;    // görülen en iyi fiyat (max yönünde)
    worstPrice: number;   // görülen en kötü fiyat (ters yönünde)
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
  if (!event || !event.id || event.price <= 0) return;
  if (state.trackers.has(event.id)) return;
  if (event.result) return; // zaten çözülmüşse takip etme
  state.trackers.set(event.id, {
    signalId: event.id,
    side: event.side,
    entryPrice: event.price,
    createdAt: event.ts,
    maxGainPct: 0,
    maxLossPct: 0,
    lastPrice: event.price,
    bestPrice: event.price,
    worstPrice: event.price,
    resolved: false,
  });
}

/**
 * Her tick'te çağrılır.
 * @return Kapanan sinyaller (güncel result ile)
 */
export function evaluateTick(
  state: HitRateState,
  currentPrice: number,
  now: number,
  config: HitRateConfig = DEFAULT_HITRATE_CONFIG,
): SignalEvent[] {
  if (currentPrice <= 0) return [];

  const closed: SignalEvent[] = [];
  const winMs = config.evalWindowsMs['5m']; // ana değerlendirme penceresi 5dk

  for (const tracker of state.trackers.values()) {
    if (tracker.resolved) continue;
    tracker.lastPrice = currentPrice;

    // En iyi/en kötü fiyat güncelle
    if (tracker.side === 'BUY') {
      tracker.bestPrice = Math.max(tracker.bestPrice, currentPrice);
      tracker.worstPrice = Math.min(tracker.worstPrice, currentPrice);
    } else {
      tracker.bestPrice = Math.min(tracker.bestPrice, currentPrice);
      tracker.worstPrice = Math.max(tracker.worstPrice, currentPrice);
    }

    const entry = tracker.entryPrice;
    const movePct = tracker.side === 'BUY'
      ? (currentPrice - entry) / entry
      : (entry - currentPrice) / entry;
    const bestMove = tracker.side === 'BUY'
      ? (tracker.bestPrice - entry) / entry
      : (entry - tracker.bestPrice) / entry;
    const worstMove = tracker.side === 'BUY'
      ? (tracker.worstPrice - entry) / entry
      : (entry - tracker.worstPrice) / entry;

    tracker.maxGainPct = bestMove;
    tracker.maxLossPct = worstMove;

    // ─── Anında TP/SL kontrolü ─────────────────────────
    if (movePct >= config.takeProfitPct) {
      closed.push(makeResult(tracker, currentPrice, 'HIT', '5m', now));
      tracker.resolved = true;
      continue;
    }
    if (movePct <= -config.stopLossPct) {
      closed.push(makeResult(tracker, currentPrice, 'STOP', '5m', now));
      tracker.resolved = true;
      continue;
    }

    // ─── Zaman penceresi: 5 dakika ─────────────────────
    const elapsed = now - tracker.createdAt;
    if (elapsed >= winMs) {
      // 5 dakika doldu, sonuca bağla
      // Pratik olarak: herhangi bir kâr HIT, sıfır veya kayıp MISS
      const outcome: SignalOutcome = movePct > 0 ? 'HIT' : 'MISS';
      closed.push(makeResult(tracker, currentPrice, outcome, '5m', now));
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
 * Hit rate özeti
 */
export interface HitRateSummary {
  total: number;
  evaluated: number;
  hits: number;
  misses: number;
  stops: number;
  open: number;
  winRate: number;
  avgPnlPct: number;
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

export const STORAGE_KEY = 'signal-radar:signals';
