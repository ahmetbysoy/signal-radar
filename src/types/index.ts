// ─── Normalize WSS Şeması ──────────────────────────────────────────────────

export type TradeSide = 'buy' | 'sell';

export interface NormalizedTrade {
  ts: number;
  price: number;
  qty: number;
  side: TradeSide;
}

export interface NormalizedDepth {
  ts: number;
  bids: [number, number][]; // [fiyat, miktar]
  asks: [number, number][]; // [fiyat, miktar]
}

export interface NormalizedMark {
  ts: number;
  price: number;
}

export type NormalizedEvent =
  | { type: 'trade'; data: NormalizedTrade }
  | { type: 'depth'; data: NormalizedDepth }
  | { type: 'mark'; data: NormalizedMark };

// ─── WebSocket Durumu ─────────────────────────────────────────────────────

export type WsStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export type DataSource = 'okx' | 'binance';

// ─── WSS Adaptör Arayüzü ──────────────────────────────────────────────────

export interface WsAdapterHandlers {
  onData(event: NormalizedEvent): void;
  onStatus(status: WsStatus): void;
}

export interface WsAdapter {
  readonly id: DataSource;
  connect(handlers: WsAdapterHandlers): void;
  disconnect(): void;
}

// ─── Mum (OHLCV) ──────────────────────────────────────────────────────────

export interface Candle {
  time: number;   // saniye (Unix timestamp)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── İndikatör Çıktıları ─────────────────────────────────────────────────

export interface IndicatorValues {
  cvdNorm: number;      // [-1, +1]
  cvdZ: number;         // z-score
  cvdDivergence: number; // bearish/bullish ek düzeltme
  obi: number;          // [-1, +1] EMA smoothed
  obiRaw: number;       // anlık OBI
  velocityZ: number;    // z-score
  velocityRaw: number;  // m/s (fiyat/s)
  compositeScore: number; // ağırlıklı kompozit skor
  confidence: number;   // 0–100
  ts: number;
}

// ─── Sinyal ─────────────────────────────────────────────────────────────

export type SignalSide = 'BUY' | 'SELL';
export type SignalState = 'IDLE' | 'ARMED' | 'FIRED' | 'COOLDOWN';

export interface SignalEvent {
  id: string;
  ts: number;
  side: SignalSide;
  price: number;
  confidence: number;
  scores: {
    cvd: number;
    obi: number;
    vel: number;
    composite: number;
  };
  // Hit rate sonucu (değerlendirilmemişse undefined)
  result?: SignalResult;
}

// ─── Hit Rate (Başarı Takibi) ────────────────────────────────────────────

export type SignalOutcome = 'HIT' | 'MISS' | 'STOP';

export interface SignalResult {
  outcome: SignalOutcome;   // sonuç
  closedAt: number;         // kapanış zamanı (ms)
  closedPrice: number;      // kapanış fiyatı
  maxGainPct: number;       // pozisyonda gördüğü max kazanç %
  maxLossPct: number;       // pozisyonda gördüğü max kayıp %
  pnlPct: number;           // kapanıştaki net kazanç %
  timeframe: HitTimeframe;  // hangi zaman diliminde değerlendirildi
}

export type HitTimeframe = '5m' | '15m' | '1h';

export interface HitRateConfig {
  takeProfitPct: number;    // HIT eşiği: varsayılan +%0.8
  stopLossPct: number;      // STOP eşiği: varsayılan -%0.5
  evalWindowsMs: Record<HitTimeframe, number>;
}

// ─── Ayarlar ─────────────────────────────────────────────────────────────

export interface SignalWeights {
  cvd: number;  // 0–1
  obi: number;  // 0–1
  vel: number;  // 0–1
}

export interface Settings {
  source: DataSource;
  symbol: string;
  // İndikatör parametreleri
  windowS: number;        // CVD pencere (30–300 sn)
  depthLevels: number;    // OBI derinlik seviyesi (5–50)
  obiEmaAlpha: number;    // OBI EMA alpha (0.05–0.5)
  velEmaAlpha: number;    // Velocity EMA alpha (0.05–0.5)
  // Sinyal parametreleri
  weights: SignalWeights;
  threshold: number;      // 0.3–1.2
  confirmTicks: number;   // 1–10
  cooldownS: number;      // 5–120 sn
  divergenceAdjust: number; // 0–0.5
  // Bildirim
  soundEnabled: boolean;
  vibrationEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  source: 'okx',
  symbol: 'BTC-USDT',
  windowS: 60,
  depthLevels: 20,
  obiEmaAlpha: 0.2,
  velEmaAlpha: 0.3,
  weights: { cvd: 0.4, obi: 0.3, vel: 0.3 },
  threshold: 0.6,
  confirmTicks: 2,
  cooldownS: 15,
  divergenceAdjust: 0.3,
  soundEnabled: true,
  vibrationEnabled: true,
};
