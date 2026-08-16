import { useEffect, useRef } from 'react'
import { WsManager } from '../core/ws/WsManager'
import { createBuffers } from '../core/buffers/index'
import { computeTick, createTickState } from '../core/indicators/index'
import {
  createSignalEngineState,
  processTick,
  loadSignalLog,
  saveSignalLog,
} from '../core/signal/index'
import { useDataStore, useUiStore, useSettingsStore } from '../store/index'
import type { NormalizedEvent } from '../types/index'
import type { SignalEngineState } from '../core/signal/index'
import type { TickState } from '../core/indicators/index'

/**
 * WsEngine: WSS bağlantısı + 10Hz tick döngüsünü yönetir.
 * Bir kez mount edilir, unmount'ta teardown.
 * Kaynak/sembol ayarı değişince yeniden bağlanır.
 */
export function WsEngine(): null {
  const wsManagerRef = useRef<WsManager | null>(null)
  const buffersRef = useRef(createBuffers())
  const tickStateRef = useRef<TickState>(createTickState())
  const signalEngineRef = useRef<SignalEngineState>(createSignalEngineState())
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const initializedRef = useRef(false)
  const lastSourceRef = useRef<string>('')

  const { settings } = useSettingsStore()
  const setPrice = useDataStore((s) => s.setPrice)
  const setIndicators = useDataStore((s) => s.setIndicators)
  const setCandles = useDataStore((s) => s.setCandles)
  const setSignalState = useDataStore((s) => s.setSignalState)
  const setWsStatus = useUiStore((s) => s.setWsStatus)
  const addSignalEvent = useUiStore((s) => s.addSignalEvent)
  const setSignalEvents = useUiStore((s) => s.setSignalEvents)
  const signalEventsRef = useRef<ReturnType<typeof useUiStore.getState>['signalEvents']>([])

  // Abonelik: mevcut sinyal listesini ref'te tut (persist için)
  useEffect(() => {
    return useUiStore.subscribe((state) => {
      signalEventsRef.current = state.signalEvents
    })
  }, [])

  useEffect(() => {
    // Kaynak değişmediyse ilk init'te devam et
    const sourceKey = `${settings.source}:${settings.symbol}`
    if (initializedRef.current && lastSourceRef.current === sourceKey) {
      return
    }
    lastSourceRef.current = sourceKey

    // İlk açılışta: kayıtlı sinyalleri yükle
    if (!initializedRef.current) {
      initializedRef.current = true
      const savedSignals = loadSignalLog()
      setSignalEvents(savedSignals)
      signalEventsRef.current = savedSignals
    } else {
      // Kaynak değişti: buffer'ları ve durumu sıfırla
      buffersRef.current = createBuffers()
      tickStateRef.current = createTickState()
      signalEngineRef.current = createSignalEngineState()
    }

    // Önceki manager/temizle
    if (wsManagerRef.current) {
      wsManagerRef.current.destroy()
      wsManagerRef.current = null
    }
    if (tickIntervalRef.current !== null) {
      clearInterval(tickIntervalRef.current)
      tickIntervalRef.current = null
    }

    const manager = new WsManager()
    wsManagerRef.current = manager
    const buffers = buffersRef.current

    // WS başlat
    manager.start({
      source: settings.source,
      onData(event: NormalizedEvent) {
        if (event.type === 'trade') {
          buffers.trades.push(event.data)
          buffers.candleAgg.addTrade(event.data)
          setPrice(event.data.price)
        } else if (event.type === 'depth') {
          buffers.depth.snapshot = event.data
        } else if (event.type === 'mark') {
          buffers.mark.latest = event.data
          setPrice(event.data.price)
        }
      },
      onStatus(status, attempt) {
        setWsStatus(status, attempt)
      },
    })

    // 10Hz tick döngüsü
    tickIntervalRef.current = setInterval(() => {
      const iv = computeTick(buffers, tickStateRef.current, settings)
      setIndicators(iv)
      setCandles(buffers.candleAgg.getCandles(), buffers.candleAgg.getLiveCandle())
      setSignalState(signalEngineRef.current.state)

      const currentPrice = buffers.mark.latest?.price ?? buffers.trades.latest()?.price ?? 0
      const { newState, firedEvent } = processTick(
        iv,
        signalEngineRef.current,
        {
          threshold: settings.threshold,
          confirmTicks: settings.confirmTicks,
          cooldownS: settings.cooldownS,
          hysteresissDown: 0.3,
        },
        currentPrice,
      )
      signalEngineRef.current = newState

      if (firedEvent) {
        addSignalEvent(firedEvent)
        // Güncel listeden persist et
        const updated = [...signalEventsRef.current, firedEvent]
        signalEventsRef.current = updated
        saveSignalLog(updated)
        // ses + titreşim
        playSignalSound(firedEvent.side, settings.soundEnabled)
        triggerVibration(firedEvent.side, settings.vibrationEnabled)
      }
    }, 100) // 10Hz

    return () => {
      manager.destroy()
      if (tickIntervalRef.current !== null) {
        clearInterval(tickIntervalRef.current)
        tickIntervalRef.current = null
      }
      wsManagerRef.current = null
    }
  // settings.source değişince yeniden bağlan; diğer ayarlar anında tick içinde okunur
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.source])

  return null
}

// ─── Ses ─────────────────────────────────────────────────────────────────

let audioCtxRef: AudioContext | null = null

function getAudioCtx(): AudioContext | null {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!audioCtxRef) {
      audioCtxRef = new AC()
    }
    // Kullanıcı etkileşimiyle resume (otoplay politikası)
    if (audioCtxRef.state === 'suspended') {
      void audioCtxRef.resume()
    }
    return audioCtxRef
  } catch {
    return null
  }
}

function playSignalSound(side: 'BUY' | 'SELL', enabled: boolean): void {
  if (!enabled) return
  try {
    const ctx = getAudioCtx()
    if (!ctx) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = side === 'BUY' ? 880 : 330
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    const duration = side === 'BUY' ? 0.08 : 0.12
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    osc.start()
    osc.stop(ctx.currentTime + duration)
  } catch {
    // WebAudio desteksiz
  }
}

// ─── Titreşim ─────────────────────────────────────────────────────────────

function triggerVibration(side: 'BUY' | 'SELL', enabled: boolean): void {
  if (!enabled) return
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return
  if (side === 'BUY') {
    navigator.vibrate(60)
  } else {
    navigator.vibrate([40, 30, 40])
  }
}
