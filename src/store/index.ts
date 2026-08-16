import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  WsStatus,
  IndicatorValues,
  SignalEvent,
  SignalState,
  Settings,
  Candle,
} from '../types/index';
import { DEFAULT_SETTINGS } from '../types/index';

// ─── Data Store (≤10Hz tick verisi) ─────────────────────────────────────

interface DataStore {
  price: number;
  priceDir: 'up' | 'down' | 'same';
  indicators: IndicatorValues | null;
  candles: Candle[];
  liveCandle: Candle | null;
  signalState: SignalState;
  // Actions
  setPrice(price: number): void;
  setIndicators(v: IndicatorValues): void;
  setCandles(candles: Candle[], live: Candle | null): void;
  setSignalState(s: SignalState): void;
}

export const useDataStore = create<DataStore>()((set, get) => ({
  price: 0,
  priceDir: 'same',
  indicators: null,
  candles: [],
  liveCandle: null,
  signalState: 'IDLE',

  setPrice(price) {
    const prev = get().price;
    set({
      price,
      priceDir: price > prev ? 'up' : price < prev ? 'down' : 'same',
    });
  },

  setIndicators(v) {
    set({ indicators: v });
  },

  setCandles(candles, live) {
    set({ candles, liveCandle: live });
  },

  setSignalState(s) {
    set({ signalState: s });
  },
}));

// ─── UI Store ────────────────────────────────────────────────────────────

export type TabId = 'radar' | 'chart' | 'signals' | 'settings';

interface UiStore {
  activeTab: TabId;
  wsStatus: WsStatus;
  wsAttempt: number;
  signalEvents: SignalEvent[];
  lastSignalAt: number; // timestamp — sinyal anı animasyonu tetikler
  // Actions
  setTab(tab: TabId): void;
  setWsStatus(status: WsStatus, attempt: number): void;
  addSignalEvent(event: SignalEvent): void;
  setSignalEvents(events: SignalEvent[]): void;
}

export const useUiStore = create<UiStore>()((set) => ({
  activeTab: 'radar',
  wsStatus: 'connecting',
  wsAttempt: 0,
  signalEvents: [],
  lastSignalAt: 0,

  setTab(tab) {
    set({ activeTab: tab });
  },

  setWsStatus(status, attempt) {
    set({ wsStatus: status, wsAttempt: attempt });
  },

  addSignalEvent(event) {
    set((s) => ({
      signalEvents: [...s.signalEvents, event].slice(-200),
      lastSignalAt: event.ts,
    }));
  },

  setSignalEvents(events) {
    set({ signalEvents: events });
  },
}));

// ─── Settings Store (localStorage persist) ───────────────────────────────

interface SettingsStore {
  settings: Settings;
  updateSettings(patch: Partial<Settings>): void;
  resetSettings(): void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,

      updateSettings(patch) {
        set((s) => ({ settings: { ...s.settings, ...patch } }));
      },

      resetSettings() {
        set({ settings: DEFAULT_SETTINGS });
      },
    }),
    {
      name: 'signal-radar:settings',
    },
  ),
);
