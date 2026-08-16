import { describe, it, expect } from 'vitest'
import {
  computeCvd,
  computeObi,
  computeVelocity,
  mean,
  std,
  zscore,
  emaStep,
} from './index'
import type { NormalizedTrade, NormalizedDepth, IndicatorValues } from '../../types/index'
import {
  processTick,
  createSignalEngineState,
  appendSignal,
  loadSignalLog,
  saveSignalLog,
} from '../signal/index'
import { RingBuffer, CandleAggregator } from '../buffers/index'

// ─── Yardımcı ────────────────────────────────────────────────────────────

function makeTrade(side: 'buy' | 'sell', qty = 1, price = 50000, offsetMs = 0): NormalizedTrade {
  return { ts: Date.now() - offsetMs, price, qty, side }
}

function makeIndicators(composite: number): IndicatorValues {
  return {
    cvdNorm: composite * 0.5,
    cvdZ: composite,
    cvdDivergence: 0,
    obi: composite * 0.3,
    obiRaw: 0,
    velocityZ: composite * 0.3,
    velocityRaw: 0,
    compositeScore: composite,
    confidence: Math.min(100, Math.round(Math.abs(composite) / 1.2 * 100)),
    ts: Date.now(),
  }
}

const DEFAULT_CONFIG = {
  threshold: 0.6,
  confirmTicks: 2,
  cooldownS: 15,
  hysteresissDown: 0.3,
}

// ─── Matematik testleri ───────────────────────────────────────────────────

describe('math helpers', () => {
  it('mean hesaplar', () => {
    expect(mean([1, 2, 3, 4, 5])).toBeCloseTo(3)
  })

  it('mean boş dizi için 0 döner', () => {
    expect(mean([])).toBe(0)
  })

  it('std hesaplar', () => {
    expect(std([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 0)
  })

  it('zscore merkez için 0 yakın döner', () => {
    const arr = [1, 2, 3, 4, 5]
    expect(Math.abs(zscore(3, arr))).toBeLessThan(0.1)
  })

  it('emaStep alpha=1 ise current döner', () => {
    expect(emaStep(100, 200, 1)).toBe(200)
  })

  it('emaStep alpha=0 ise prev döner', () => {
    expect(emaStep(100, 200, 0)).toBe(100)
  })
})

// ─── CVD testleri ─────────────────────────────────────────────────────────

describe('CVD', () => {
  it('sadece buy trade varsa cvdNorm +1', () => {
    const trades = [makeTrade('buy', 1), makeTrade('buy', 2), makeTrade('buy', 3)]
    const { cvdNorm } = computeCvd(trades, [], 60, 0.3)
    expect(cvdNorm).toBeCloseTo(1)
  })

  it('sadece sell trade varsa cvdNorm -1', () => {
    const trades = [makeTrade('sell', 1), makeTrade('sell', 2)]
    const { cvdNorm } = computeCvd(trades, [], 60, 0.3)
    expect(cvdNorm).toBeCloseTo(-1)
  })

  it('eşit buy/sell varsa cvdNorm ≈ 0', () => {
    const trades = [makeTrade('buy', 5), makeTrade('sell', 5)]
    const { cvdNorm } = computeCvd(trades, [], 60, 0.3)
    expect(Math.abs(cvdNorm)).toBeLessThan(0.01)
  })

  it('pencere dışındaki trade görmezden gelinir', () => {
    const old = makeTrade('buy', 100, 50000, 120_000) // 2 dk önce
    const recent = makeTrade('sell', 1)
    const { cvdNorm } = computeCvd([old, recent], [], 60, 0.3)
    expect(cvdNorm).toBeCloseTo(-1)
  })
})

// ─── OBI testleri ──────────────────────────────────────────────────────────

describe('OBI', () => {
  it('sadece bid varsa OBI +1 e yakın', () => {
    const depth: NormalizedDepth = {
      ts: Date.now(),
      bids: [[50000, 10], [49990, 5]],
      asks: [],
    }
    const { obiRaw } = computeObi(depth, 0, 20, 0.2)
    expect(obiRaw).toBeCloseTo(1)
  })

  it('sadece ask varsa OBI -1 e yakın', () => {
    const depth: NormalizedDepth = {
      ts: Date.now(),
      bids: [],
      asks: [[50010, 10], [50020, 5]],
    }
    const { obiRaw } = computeObi(depth, 0, 20, 0.2)
    expect(obiRaw).toBeCloseTo(-1)
  })

  it('depth null ise prevObi döner', () => {
    const { obi } = computeObi(null, 0.5, 20, 0.2)
    expect(obi).toBe(0.5)
  })
})

// ─── Velocity testleri ─────────────────────────────────────────────────────

describe('Velocity', () => {
  it('tek trade varsa velocityRaw 0', () => {
    const trades = [makeTrade('buy', 1, 50000)]
    const { velocityRaw } = computeVelocity(trades, 0, [], 0.3)
    expect(velocityRaw).toBe(0)
  })

  it('artan fiyat → pozitif velocity', () => {
    const t1 = { ts: Date.now() - 500, price: 50000, qty: 1, side: 'buy' as const }
    const t2 = { ts: Date.now(), price: 50100, qty: 1, side: 'buy' as const }
    const { velocityRaw } = computeVelocity([t1, t2], 0, [], 1)
    expect(velocityRaw).toBeGreaterThan(0)
  })
})

// ─── Ring Buffer testleri ──────────────────────────────────────────────────

describe('RingBuffer', () => {
  it('sabit boyutu korur', () => {
    const buf = new RingBuffer<number>(3)
    for (let i = 0; i < 10; i++) buf.push(i)
    expect(buf.size).toBe(3)
    const arr = buf.toArray()
    expect(arr[arr.length - 1]).toBe(9)
  })

  it('latest son eklenen elemanı döner', () => {
    const buf = new RingBuffer<number>(5)
    buf.push(42)
    buf.push(99)
    expect(buf.latest()).toBe(99)
  })
})

// ─── CandleAggregator testleri ────────────────────────────────────────────

describe('CandleAggregator', () => {
  it('trade\'lerden OHLCV doğru toplanır', () => {
    const agg = new CandleAggregator(10)
    const base = Math.floor(Date.now() / 15000) * 15000

    agg.addTrade({ ts: base + 100, price: 100, qty: 1, side: 'buy' })
    agg.addTrade({ ts: base + 200, price: 120, qty: 2, side: 'buy' })
    agg.addTrade({ ts: base + 300, price: 90, qty: 1, side: 'sell' })
    agg.addTrade({ ts: base + 400, price: 110, qty: 3, side: 'buy' })

    const live = agg.getLiveCandle()
    expect(live).not.toBeNull()
    expect(live!.open).toBe(100)
    expect(live!.high).toBe(120)
    expect(live!.low).toBe(90)
    expect(live!.close).toBe(110)
    expect(live!.volume).toBeCloseTo(7)
  })
})

// ─── Sinyal motoru testleri ───────────────────────────────────────────────

describe('Signal Engine', () => {
  it('IDLE → eşik altında → IDLE kalır', () => {
    const state = createSignalEngineState()
    const { newState, firedEvent } = processTick(
      makeIndicators(0.3),
      state, DEFAULT_CONFIG, 50000
    )
    expect(newState.state).toBe('IDLE')
    expect(firedEvent).toBeNull()
  })

  it('IDLE → eşik üstü 1 tick → ARMED', () => {
    const state = createSignalEngineState()
    const { newState } = processTick(
      makeIndicators(0.8),
      state, DEFAULT_CONFIG, 50000
    )
    expect(newState.state).toBe('ARMED')
  })

  it('2 tick sonra BUY FIRED', () => {
    let state = createSignalEngineState()
    state = processTick(makeIndicators(0.8), state, DEFAULT_CONFIG, 50000).newState
    const { newState, firedEvent } = processTick(makeIndicators(0.8), state, DEFAULT_CONFIG, 50000)
    expect(newState.state).toBe('COOLDOWN')
    expect(firedEvent).not.toBeNull()
    expect(firedEvent!.side).toBe('BUY')
  })

  it('SELL sinyali negatif skor ile', () => {
    let state = createSignalEngineState()
    state = processTick(makeIndicators(-0.9), state, DEFAULT_CONFIG, 50000).newState
    const { firedEvent } = processTick(makeIndicators(-0.9), state, DEFAULT_CONFIG, 50000)
    expect(firedEvent?.side).toBe('SELL')
  })

  it('cooldown süresinde yeni sinyal çıkmaz', () => {
    let state = createSignalEngineState()
    // FIRED
    state = processTick(makeIndicators(0.9), state, DEFAULT_CONFIG, 50000).newState
    state = processTick(makeIndicators(0.9), state, DEFAULT_CONFIG, 50000).newState
    expect(state.state).toBe('COOLDOWN')
    // Cooldown içinde tekrar dene
    const { firedEvent } = processTick(makeIndicators(0.9), state, DEFAULT_CONFIG, 50000)
    expect(firedEvent).toBeNull()
  })

  it('güven %  0-100 aralığında', () => {
    let state = createSignalEngineState()
    state = processTick(makeIndicators(1.5), state, DEFAULT_CONFIG, 50000).newState
    const { firedEvent } = processTick(makeIndicators(1.5), state, DEFAULT_CONFIG, 50000)
    if (firedEvent) {
      expect(firedEvent.confidence).toBeGreaterThanOrEqual(0)
      expect(firedEvent.confidence).toBeLessThanOrEqual(100)
    }
  })
})

// ─── Sinyal log persist testleri ─────────────────────────────────────────

describe('Signal log', () => {
  it('appendSignal son 200 ile sınırlar', () => {
    const base = Array.from({ length: 201 }, (_, i) => ({
      id: `${i}`,
      ts: Date.now(),
      side: 'BUY' as const,
      price: 50000,
      confidence: 75,
      scores: { cvd: 0, obi: 0, vel: 0, composite: 0.8 },
    }))
    const result = appendSignal(base.slice(0, 200), base[200])
    expect(result.length).toBeLessThanOrEqual(200)
  })

  it('saveSignalLog + loadSignalLog round-trip', () => {
    const signals = [{
      id: 'test-1',
      ts: 1234567890,
      side: 'BUY' as const,
      price: 50000,
      confidence: 80,
      scores: { cvd: 1, obi: 0.5, vel: 0.3, composite: 0.8 },
    }]
    saveSignalLog(signals)
    const loaded = loadSignalLog()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe('test-1')
  })
})
