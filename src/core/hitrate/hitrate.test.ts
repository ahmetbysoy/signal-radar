import { describe, it, expect } from 'vitest'
import {
  createHitRateState,
  trackSignal,
  evaluateTick,
  computeSummary,
  DEFAULT_HITRATE_CONFIG,
} from './index'
import type { SignalEvent } from '../../types/index'

function makeSignal(ts: number, side: 'BUY' | 'SELL', price: number): SignalEvent {
  return {
    id: `sig-${ts}-${side}`,
    ts,
    side,
    price,
    confidence: 80,
    scores: { cvd: 1, obi: 0.5, vel: 0.3, composite: 0.8 },
  }
}

describe('Hit Rate Motoru', () => {
  it('yeni sinyali takibe alır', () => {
    const state = createHitRateState()
    trackSignal(state, makeSignal(Date.now(), 'BUY', 50000))
    expect(state.trackers.size).toBe(1)
  })

  it('aynı id ile iki kez eklemez', () => {
    const state = createHitRateState()
    const sig = makeSignal(1, 'BUY', 1000)
    trackSignal(state, sig)
    trackSignal(state, sig)
    expect(state.trackers.size).toBe(1)
  })

  it('fiyat 0 veya negatifse takip etmez', () => {
    const state = createHitRateState()
    trackSignal(state, makeSignal(1, 'BUY', 0))
    trackSignal(state, makeSignal(2, 'BUY', -10))
    expect(state.trackers.size).toBe(0)
  })

  it('TP vurunca HIT döner (BUY)', () => {
    const state = createHitRateState()
    const now = Date.now()
    const sig = makeSignal(now, 'BUY', 1000)
    trackSignal(state, sig)
    // %0.5 yukarı (TP %0.4'ten fazla)
    const closed = evaluateTick(state, 1000 * 1.005, now + 30_000, DEFAULT_HITRATE_CONFIG)
    expect(closed).toHaveLength(1)
    expect(closed[0].result?.outcome).toBe('HIT')
    expect(closed[0].result?.pnlPct).toBeCloseTo(0.005, 3)
    expect(state.trackers.size).toBe(0)
  })

  it('STOP vurunca STOP döner (BUY)', () => {
    const state = createHitRateState()
    const now = Date.now()
    const sig = makeSignal(now, 'BUY', 1000)
    trackSignal(state, sig)
    // %0.4 aşağı (SL %0.3'ten fazla)
    const closed = evaluateTick(state, 1000 * 0.996, now + 30_000, DEFAULT_HITRATE_CONFIG)
    expect(closed).toHaveLength(1)
    expect(closed[0].result?.outcome).toBe('STOP')
  })

  it('SELL sinyalinde fiyat düşerse HIT', () => {
    const state = createHitRateState()
    const now = Date.now()
    const sig = makeSignal(now, 'SELL', 1000)
    trackSignal(state, sig)
    const closed = evaluateTick(state, 1000 * 0.995, now + 30_000, DEFAULT_HITRATE_CONFIG)
    expect(closed).toHaveLength(1)
    expect(closed[0].result?.outcome).toBe('HIT')
  })

  it('SELL sinyalinde fiyat yükselirse STOP', () => {
    const state = createHitRateState()
    const now = Date.now()
    const sig = makeSignal(now, 'SELL', 1000)
    trackSignal(state, sig)
    const closed = evaluateTick(state, 1000 * 1.004, now + 30_000, DEFAULT_HITRATE_CONFIG)
    expect(closed).toHaveLength(1)
    expect(closed[0].result?.outcome).toBe('STOP')
  })

  it('5 dakika sonra kârda kapanırsa HIT', () => {
    const state = createHitRateState()
    const now = Date.now()
    const sig = makeSignal(now, 'BUY', 1000)
    trackSignal(state, sig)
    // 5dk 1sn sonra %0.2 yukarıda (TP/SL yememiş, kârda)
    const closed = evaluateTick(state, 1000.2, now + 5 * 60 * 1000 + 1000, DEFAULT_HITRATE_CONFIG)
    expect(closed).toHaveLength(1)
    expect(closed[0].result?.outcome).toBe('HIT')
    expect(closed[0].result?.timeframe).toBe('5m')
  })

  it('5 dakika sonra zararda kapanırsa MISS', () => {
    const state = createHitRateState()
    const now = Date.now()
    const sig = makeSignal(now, 'BUY', 1000)
    trackSignal(state, sig)
    const closed = evaluateTick(state, 999.5, now + 5 * 60 * 1000 + 1000, DEFAULT_HITRATE_CONFIG)
    expect(closed).toHaveLength(1)
    expect(closed[0].result?.outcome).toBe('MISS')
  })

  it('5dk dolmadan önce hiçbir şey döndürmez (TP/SL harici)', () => {
    const state = createHitRateState()
    const now = Date.now()
    const sig = makeSignal(now, 'BUY', 1000)
    trackSignal(state, sig)
    // 4dk sonra fiyat aynı yerde
    const closed = evaluateTick(state, 1000, now + 4 * 60 * 1000, DEFAULT_HITRATE_CONFIG)
    expect(closed).toHaveLength(0)
    expect(state.trackers.size).toBe(1) // hala takipte
  })

  it('maxGainPct/maxLossPct doğru tutulur', () => {
    const state = createHitRateState()
    const now = Date.now()
    const sig = makeSignal(now, 'BUY', 1000)
    trackSignal(state, sig)
    // Önce %0.3 yukarı çık (TP'ye yakın ama altında), sonra %0.2 aşağı düş
    evaluateTick(state, 1003, now + 1000, DEFAULT_HITRATE_CONFIG) // +%0.3
    evaluateTick(state, 998, now + 2000, DEFAULT_HITRATE_CONFIG)  // -%0.2
    const tracker = Array.from(state.trackers.values())[0]
    expect(tracker).toBeDefined()
    expect(tracker.maxGainPct).toBeCloseTo(0.003, 3)
    expect(tracker.maxLossPct).toBeCloseTo(-0.002, 3)
  })

  it('computeSummary doğru sayar', () => {
    const events: SignalEvent[] = [
      { ...makeSignal(1, 'BUY', 100), result: { outcome: 'HIT', closedAt: 2, closedPrice: 101, maxGainPct: 0.01, maxLossPct: 0, pnlPct: 0.01, timeframe: '5m' } },
      { ...makeSignal(2, 'SELL', 100), result: { outcome: 'STOP', closedAt: 3, closedPrice: 101, maxGainPct: 0, maxLossPct: -0.01, pnlPct: -0.01, timeframe: '5m' } },
      { ...makeSignal(3, 'BUY', 100) }, // açık
      { ...makeSignal(4, 'SELL', 100), result: { outcome: 'MISS', closedAt: 5, closedPrice: 100.2, maxGainPct: 0.001, maxLossPct: -0.002, pnlPct: -0.002, timeframe: '5m' } },
    ]
    const s = computeSummary(events)
    expect(s.total).toBe(4)
    expect(s.evaluated).toBe(3)
    expect(s.hits).toBe(1)
    expect(s.stops).toBe(1)
    expect(s.misses).toBe(1)
    expect(s.open).toBe(1)
    expect(s.winRate).toBeCloseTo(1 / 3)
  })
})
