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

  it('TP vurunca HIT döner (BUY)', () => {
    const state = createHitRateState()
    const now = Date.now()
    const sig = makeSignal(now, 'BUY', 1000)
    trackSignal(state, sig)
    // %1 yukarı (TP %0.8'den fazla)
    const closed = evaluateTick(state, 1000 * 1.01, now + 60_000, DEFAULT_HITRATE_CONFIG)
    expect(closed).toHaveLength(1)
    expect(closed[0].result?.outcome).toBe('HIT')
    expect(state.trackers.size).toBe(0)
  })

  it('STOP vurunca STOP döner (BUY)', () => {
    const state = createHitRateState()
    const now = Date.now()
    const sig = makeSignal(now, 'BUY', 1000)
    trackSignal(state, sig)
    // %0.6 aşağı (SL %0.5'den fazla)
    const closed = evaluateTick(state, 1000 * 0.994, now + 30_000, DEFAULT_HITRATE_CONFIG)
    expect(closed).toHaveLength(1)
    expect(closed[0].result?.outcome).toBe('STOP')
  })

  it('SELL sinyalinde fiyat düşerse HIT', () => {
    const state = createHitRateState()
    const now = Date.now()
    const sig = makeSignal(now, 'SELL', 1000)
    trackSignal(state, sig)
    const closed = evaluateTick(state, 1000 * 0.99, now + 60_000, DEFAULT_HITRATE_CONFIG)
    expect(closed).toHaveLength(1)
    expect(closed[0].result?.outcome).toBe('HIT')
  })

  it('1 saat sonra kârda kapanırsa HIT', () => {
    const state = createHitRateState()
    const now = Date.now()
    const sig = makeSignal(now, 'BUY', 1000)
    trackSignal(state, sig)
    // 61 dk sonra %0.3 yukarıda (TP/SL yememiş ama kârda)
    const closed = evaluateTick(state, 1000.3, now + 61 * 60 * 1000, DEFAULT_HITRATE_CONFIG)
    expect(closed).toHaveLength(1)
    expect(closed[0].result?.outcome).toBe('HIT')
    expect(closed[0].result?.timeframe).toBe('1h')
  })

  it('1 saat sonra zararda kapanırsa MISS', () => {
    const state = createHitRateState()
    const now = Date.now()
    const sig = makeSignal(now, 'BUY', 1000)
    trackSignal(state, sig)
    const closed = evaluateTick(state, 999, now + 61 * 60 * 1000, DEFAULT_HITRATE_CONFIG)
    expect(closed).toHaveLength(1)
    expect(closed[0].result?.outcome).toBe('MISS')
  })

  it('computeSummary doğru sayar', () => {
    const events: SignalEvent[] = [
      { ...makeSignal(1, 'BUY', 100), result: { outcome: 'HIT', closedAt: 2, closedPrice: 101, maxGainPct: 0.01, maxLossPct: 0, pnlPct: 0.01, timeframe: '5m' } },
      { ...makeSignal(2, 'SELL', 100), result: { outcome: 'STOP', closedAt: 3, closedPrice: 101, maxGainPct: 0, maxLossPct: -0.01, pnlPct: -0.01, timeframe: '5m' } },
      { ...makeSignal(3, 'BUY', 100) }, // açık
      { ...makeSignal(4, 'SELL', 100), result: { outcome: 'MISS', closedAt: 5, closedPrice: 100.2, maxGainPct: 0.001, maxLossPct: -0.002, pnlPct: -0.002, timeframe: '1h' } },
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
