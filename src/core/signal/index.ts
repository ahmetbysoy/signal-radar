import type { SignalEvent, SignalSide, SignalState, IndicatorValues } from '../../types/index';

// ─── Sinyal Motoru Durumu ─────────────────────────────────────────────────

export interface SignalEngineState {
  state: SignalState;
  candidateSide: SignalSide | null;
  candidateTicks: number;   // aday sinyal kaç tick korundu
  lastFiredTs: number;      // son sinyal zamanı (ms)
  lastFiredSide: SignalSide | null;
}

export function createSignalEngineState(): SignalEngineState {
  return {
    state: 'IDLE',
    candidateSide: null,
    candidateTicks: 0,
    lastFiredTs: 0,
    lastFiredSide: null,
  };
}

// ─── Sinyal Motoru ────────────────────────────────────────────────────────

export interface SignalEngineConfig {
  threshold: number;       // |S| >= threshold → aday (varsayılan 0.6)
  confirmTicks: number;    // aday kaç tick korunmalı (varsayılan 2)
  cooldownS: number;       // sinyal sonrası bekleme süresi (sn, varsayılan 15)
  hysteresissDown: number; // sinyal sonrası düşme eşiği (varsayılan 0.3)
}

export interface SignalEngineResult {
  newState: SignalEngineState;
  firedEvent: SignalEvent | null;
}

/**
 * Saf sinyal motoru — tick başına çağrılır.
 *
 * Durum makinesi:
 *   IDLE → (threshold üstü, yön tespit) → ARMED (onay tick biriktirir)
 *   ARMED → (confirmTicks adet aynı yön tick) → FIRED → COOLDOWN
 *   COOLDOWN → (cooldownS doldu) → IDLE
 *
 * Histerezis: FIRED sonrası, skor |hysteresissDown| altına inmeden yeni sinyal tetiklenmez
 * (aynı yönde sürekli sinyal gelmesini engeller).
 */
export function processTick(
  indicators: IndicatorValues,
  prevState: SignalEngineState,
  config: SignalEngineConfig,
  currentPrice: number,
): SignalEngineResult {
  const { compositeScore: score, confidence, cvdZ, obi, velocityZ } = indicators;
  const now = Date.now();

  // Deep copy (yeni referans döner)
  const s: SignalEngineState = { ...prevState };

  // ─── COOLDOWN kontrolü ────────────────────────────────────────
  if (s.state === 'COOLDOWN') {
    const elapsed = (now - s.lastFiredTs) / 1000;
    if (elapsed >= config.cooldownS) {
      s.state = 'IDLE';
      s.candidateSide = null;
      s.candidateTicks = 0;
    } else {
      return { newState: s, firedEvent: null };
    }
  }

  // ─── Histerezis: son sinyalin ters yöne dönmesi için skor eşik altına inmeli ──
  // Skor hysteresissDown'un altındaysa (karşı tarafa geçmeye müsait) lastFiredSide sıfırla.
  if (s.lastFiredSide !== null) {
    // Son BUY sinyalinden sonra skor negatife/histerezis altına döndüyse tekrar BUY tetiklenebilir.
    // Son SELL'den sonra pozitife/histerezis üstüne döndüyse tekrar SELL.
    const crossedBackToNeutral =
      (s.lastFiredSide === 'BUY' && score < config.hysteresissDown) ||
      (s.lastFiredSide === 'SELL' && score > -config.hysteresissDown);
    if (crossedBackToNeutral) {
      s.lastFiredSide = null;
    }
  }

  // Skor yönü
  const absScore = Math.abs(score);
  const thisSide: SignalSide | null = absScore >= config.threshold
    ? (score > 0 ? 'BUY' : 'SELL')
    : null;

  // ─── IDLE ve ARMED durumları ──────────────────────────────────
  if (thisSide === null) {
    // Eşik altına düştü → IDLE'a dön
    s.state = 'IDLE';
    s.candidateSide = null;
    s.candidateTicks = 0;
    return { newState: s, firedEvent: null };
  }

  // Aynı yönde bir aday var mı?
  if (s.candidateSide !== thisSide) {
    // Yön değişti veya ilk defa → ARMED, tick sayacı 1
    s.state = 'ARMED';
    s.candidateSide = thisSide;
    s.candidateTicks = 1;
  } else {
    // Aynı yön → tick sayacını artır
    s.candidateTicks += 1;
    s.state = 'ARMED';
  }

  // Histerezis: son sinyal aynı yön ise ve daha nötr bölgeye dönmemişsek yeni sinyal verme
  if (s.lastFiredSide !== null && s.lastFiredSide === thisSide) {
    s.candidateTicks = 0;
    return { newState: s, firedEvent: null };
  }

  // Onay tick sayısı yeterli mi?
  if (s.candidateTicks < config.confirmTicks) {
    return { newState: s, firedEvent: null };
  }

  // ─── FIRED ────────────────────────────────────────────────────
  const side = thisSide;
  const event: SignalEvent = {
    id: `${now}-${side}-${Math.random().toString(36).slice(2, 8)}`,
    ts: now,
    side,
    price: currentPrice,
    confidence,
    scores: {
      cvd: cvdZ,
      obi,
      vel: velocityZ,
      composite: score,
    },
  };

  s.state = 'COOLDOWN';
  s.lastFiredTs = now;
  s.lastFiredSide = side;
  s.candidateSide = null;
  s.candidateTicks = 0;

  return { newState: s, firedEvent: event };
}

// ─── Sinyal Günlüğü (localStorage persist) ───────────────────────────────

const STORAGE_KEY = 'signal-radar:signals';
const STORAGE_VERSION_KEY = 'signal-radar:version';
const CURRENT_VERSION = 2; // Hit rate düzeltmesi sonrası eski veriyi temizlemek için
const MAX_SIGNALS = 200;

export function loadSignalLog(): SignalEvent[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    // Versiyon kontrolü — eski/uyumsuz veriyi sıfırla
    const v = parseInt(localStorage.getItem(STORAGE_VERSION_KEY) || '0', 10);
    if (v < CURRENT_VERSION) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(STORAGE_VERSION_KEY, String(CURRENT_VERSION));
      return [];
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SignalEvent[];
  } catch {
    return [];
  }
}

export function saveSignalLog(signals: SignalEvent[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const trimmed = signals.slice(-MAX_SIGNALS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage dolu / gizli mod olabilir
  }
}

export function appendSignal(signals: SignalEvent[], event: SignalEvent): SignalEvent[] {
  const updated = [...signals, event].slice(-MAX_SIGNALS);
  saveSignalLog(updated);
  return updated;
}
