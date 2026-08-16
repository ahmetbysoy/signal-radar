import type { NormalizedTrade, NormalizedDepth, IndicatorValues } from '../../types/index';
import type { Buffers } from '../buffers/index';

// ─── Matematiksel yardımcılar ─────────────────────────────────────────────

/** Exponential Moving Average — tek adım */
export function emaStep(prev: number, current: number, alpha: number): number {
  return alpha * current + (1 - alpha) * prev;
}

/** Bir dizinin aritmetik ortalaması */
export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/** Standart sapma (population) */
export function std(arr: number[], mu?: number): number {
  if (arr.length < 2) return 1; // sıfır bölme koruması
  const m = mu ?? mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance) || 1;
}

/** Z-score */
export function zscore(value: number, arr: number[]): number {
  const m = mean(arr);
  const s = std(arr, m);
  return (value - m) / s;
}

// ─── CVD Hesaplama ─────────────────────────────────────────────────────────

export interface CvdResult {
  cvdNorm: number;
  cvdZ: number;
  divergenceAdjust: number;
}

/**
 * CVD = son windowS saniye içindeki alıcı - satıcı hacim
 * CVD_norm = CVD / toplamHacim ∈ [-1, +1]
 * CVD_z    = z-score(CVD_norm, geçmiş 20 örnek)
 */
export function computeCvd(
  trades: NormalizedTrade[],
  cvdHistory: number[],
  windowS: number,
  divergenceAdjust: number,
): CvdResult {
  const now = Date.now();
  const cutoff = now - windowS * 1000;
  const recent = trades.filter((t) => t.ts >= cutoff);

  let buyVol = 0;
  let sellVol = 0;
  for (const t of recent) {
    if (t.side === 'buy') buyVol += t.qty;
    else sellVol += t.qty;
  }
  const totalVol = buyVol + sellVol;
  const cvdNorm = totalVol > 0 ? (buyVol - sellVol) / totalVol : 0;

  // Z-score için tarihsel örnekler (son 20)
  const history = cvdHistory.slice(-20);
  const cvdZ = history.length >= 3 ? zscore(cvdNorm, history) : 0;

  // Divergence: son 20 saniyede fiyat tepe yaparken CVD düşüyorsa → bearish
  let divergence = 0;
  if (recent.length >= 4) {
    const half = Math.floor(recent.length / 2);
    const firstHalf = recent.slice(0, half);
    const secondHalf = recent.slice(half);
    const avgPriceFirst = mean(firstHalf.map((t) => t.price));
    const avgPriceSecond = mean(secondHalf.map((t) => t.price));

    let cvdFirst = 0, volFirst = 0;
    for (const t of firstHalf) {
      cvdFirst += t.side === 'buy' ? t.qty : -t.qty;
      volFirst += t.qty;
    }
    let cvdSecond = 0, volSecond = 0;
    for (const t of secondHalf) {
      cvdSecond += t.side === 'buy' ? t.qty : -t.qty;
      volSecond += t.qty;
    }
    const cvdNormFirst = volFirst > 0 ? cvdFirst / volFirst : 0;
    const cvdNormSecond = volSecond > 0 ? cvdSecond / volSecond : 0;

    if (avgPriceSecond > avgPriceFirst && cvdNormSecond < cvdNormFirst) {
      // Bearish divergence
      divergence = -divergenceAdjust;
    } else if (avgPriceSecond < avgPriceFirst && cvdNormSecond > cvdNormFirst) {
      // Bullish divergence
      divergence = +divergenceAdjust;
    }
  }

  return { cvdNorm, cvdZ, divergenceAdjust: divergence };
}

// ─── OBI Hesaplama ──────────────────────────────────────────────────────────

export interface ObiResult {
  obi: number;    // EMA smoothed
  obiRaw: number; // anlık
}

/**
 * OBI = (B - A) / (B + A)
 * B = N seviyenin teklif hacmi, A = arz hacmi
 */
export function computeObi(
  depth: NormalizedDepth | null,
  prevObi: number,
  depthLevels: number,
  alpha: number,
): ObiResult {
  if (!depth) return { obi: prevObi, obiRaw: 0 };

  const bids = depth.bids.slice(0, depthLevels);
  const asks = depth.asks.slice(0, depthLevels);

  const B = bids.reduce((s, [, qty]) => s + qty, 0);
  const A = asks.reduce((s, [, qty]) => s + qty, 0);
  const total = B + A;
  const obiRaw = total > 0 ? (B - A) / total : 0;
  const obi = emaStep(prevObi, obiRaw, alpha);

  return { obi, obiRaw };
}

// ─── Velocity Hesaplama ────────────────────────────────────────────────────

export interface VelocityResult {
  velocityZ: number;
  velocityRaw: number;
}

/**
 * v_t = (P_t - P_{t-1}) / Δt   (1 sn pencere)
 * v   = EMA(v_t, alpha)
 * v_z = z-score(v, geçmiş 30 örnek)
 */
export function computeVelocity(
  trades: NormalizedTrade[],
  prevVelocity: number,
  velocityHistory: number[],
  alpha: number,
): VelocityResult {
  const now = Date.now();
  const cutoff = now - 1000;
  const recent = trades.filter((t) => t.ts >= cutoff);

  let velocityRaw = 0;
  if (recent.length >= 2) {
    const oldest = recent[0];
    const newest = recent[recent.length - 1];
    const dt = (newest.ts - oldest.ts) / 1000;
    if (dt > 0) {
      velocityRaw = (newest.price - oldest.price) / dt;
    }
  }

  const smoothed = emaStep(prevVelocity, velocityRaw, alpha);
  const history = velocityHistory.slice(-30);
  const velocityZ = history.length >= 3 ? zscore(smoothed, history) : 0;

  return { velocityZ, velocityRaw: smoothed };
}

// ─── Tick State (10Hz) ────────────────────────────────────────────────────

export interface TickState {
  prevObi: number;
  prevVelocity: number;
  cvdHistory: number[];
  velocityHistory: number[];
}

export function createTickState(): TickState {
  return {
    prevObi: 0,
    prevVelocity: 0,
    cvdHistory: [],
    velocityHistory: [],
  };
}

/**
 * 10Hz tick: buffer'lardan hesapla → IndicatorValues döner
 */
export function computeTick(
  buffers: Buffers,
  state: TickState,
  settings: {
    windowS: number;
    depthLevels: number;
    obiEmaAlpha: number;
    velEmaAlpha: number;
    divergenceAdjust: number;
    weights: { cvd: number; obi: number; vel: number };
  },
): IndicatorValues {
  const trades = buffers.trades.toArray();
  const cvdHistory = buffers.cvdHistory.toArray();

  // CVD
  const cvd = computeCvd(trades, cvdHistory, settings.windowS, settings.divergenceAdjust);
  buffers.cvdHistory.push(cvd.cvdNorm);
  state.cvdHistory = buffers.cvdHistory.toArray();

  // OBI
  const obiResult = computeObi(
    buffers.depth.snapshot,
    state.prevObi,
    settings.depthLevels,
    settings.obiEmaAlpha,
  );
  state.prevObi = obiResult.obi;

  // Velocity
  state.velocityHistory = state.velocityHistory.slice(-30);
  const velResult = computeVelocity(
    trades,
    state.prevVelocity,
    state.velocityHistory,
    settings.velEmaAlpha,
  );
  state.prevVelocity = velResult.velocityRaw;
  state.velocityHistory.push(velResult.velocityRaw);

  // Kompozit skor (divergence dahil)
  const { weights } = settings;
  const compositeScore =
    weights.cvd * cvd.cvdZ +
    weights.obi * obiResult.obi +
    weights.vel * velResult.velocityZ +
    cvd.divergenceAdjust;

  const confidence = Math.min(100, Math.round((Math.abs(compositeScore) / 1.2) * 100));

  return {
    cvdNorm: cvd.cvdNorm,
    cvdZ: cvd.cvdZ,
    cvdDivergence: cvd.divergenceAdjust,
    obi: obiResult.obi,
    obiRaw: obiResult.obiRaw,
    velocityZ: velResult.velocityZ,
    velocityRaw: velResult.velocityRaw,
    compositeScore,
    confidence,
    ts: Date.now(),
  };
}
