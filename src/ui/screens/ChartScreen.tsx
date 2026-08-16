import { useEffect, useRef } from 'react'
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type Time,
  type SeriesMarker,
  type ISeriesMarkersPluginApi,
} from 'lightweight-charts'
import { useDataStore, useUiStore } from '../../store/index'
import type { Candle, SignalEvent } from '../../types/index'
import './ChartScreen.css'

function toChartCandle(c: Candle): CandlestickData {
  return {
    time: c.time as Time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }
}

export function ChartScreen() {
  const containerRef = useRef<HTMLDivElement>(null)
  const cvdContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const cvdChartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const cvdSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)

  const candles = useDataStore((s) => s.candles)
  const liveCandle = useDataStore((s) => s.liveCandle)
  const signalEvents = useUiStore((s) => s.signalEvents)

  // Chart başlat
  useEffect(() => {
    const container = containerRef.current
    const cvdContainer = cvdContainerRef.current
    if (!container || !cvdContainer) return

    const chartOptions = {
      layout: {
        background: { type: ColorType.Solid, color: '#0F1626' },
        textColor: '#7C8DB0',
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: '#1E2A44' },
        horzLines: { color: '#1E2A44' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1E2A44' },
      timeScale: { borderColor: '#1E2A44', timeVisible: true, secondsVisible: false },
      handleScroll: true,
      handleScale: true,
    } as const

    // Ana mum grafiği
    const chart = createChart(container, {
      ...chartOptions,
      height: container.clientHeight || 240,
      width: container.clientWidth,
    })
    chartRef.current = chart

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#34D399',
      downColor: '#F87171',
      borderUpColor: '#34D399',
      borderDownColor: '#F87171',
      wickUpColor: '#34D399',
      wickDownColor: '#F87171',
    })
    candleSeriesRef.current = candleSeries
    markersPluginRef.current = createSeriesMarkers(candleSeries, [])

    // CVD histogram
    const cvdChart = createChart(cvdContainer, {
      ...chartOptions,
      height: cvdContainer.clientHeight || 100,
      width: cvdContainer.clientWidth,
    })
    cvdChartRef.current = cvdChart

    const cvdSeries = cvdChart.addSeries(HistogramSeries, {
      priceFormat: { type: 'price', precision: 4 },
    })
    cvdSeriesRef.current = cvdSeries

    // Zaman ölçeklerini senkronize et
    const syncTimeScale = (e: { visibleRange: unknown } | null) => {
      if (!e) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const range = (cvdChart.timeScale() as any).getVisibleRange()
      if (range) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(chart.timeScale() as any).setVisibleRange(range)
      }
    }
    cvdChart.timeScale().subscribeVisibleTimeRangeChange(syncTimeScale as () => void)

    // Resize observer
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight || 240 })
      cvdChart.applyOptions({ width: cvdContainer.clientWidth, height: cvdContainer.clientHeight || 100 })
    })
    ro.observe(container)
    ro.observe(cvdContainer)

    return () => {
      ro.disconnect()
      markersPluginRef.current = null
      cvdChart.timeScale().unsubscribeVisibleTimeRangeChange(syncTimeScale as () => void)
      chart.remove()
      cvdChart.remove()
    }
  }, [])

  // Mum verisi güncelle
  useEffect(() => {
    const series = candleSeriesRef.current
    if (!series) return

    const allCandles: Candle[] = liveCandle ? [...candles, liveCandle] : candles
    if (allCandles.length === 0) return

    try {
      series.setData(allCandles.map(toChartCandle))
    } catch {
      // Duplicate time koruması
    }
  }, [candles, liveCandle])

  // CVD histogram güncelle (her mum için delta)
  useEffect(() => {
    const series = cvdSeriesRef.current
    if (!series || candles.length === 0) return

    const allCandles: Candle[] = liveCandle ? [...candles, liveCandle] : candles
    const cvdData: HistogramData[] = allCandles.map((c) => {
      const delta = c.close - c.open
      return {
        time: c.time as Time,
        value: delta,
        color: delta >= 0 ? '#34D399' : '#F87171',
      }
    })

    try {
      series.setData(cvdData)
    } catch {
      // Duplicate time koruması
    }
  }, [candles, liveCandle])

  // Sinyal marker'ları güncelle
  useEffect(() => {
    const series = candleSeriesRef.current
    if (!series) return

    const markers: SeriesMarker<Time>[] = signalEvents
      .filter((ev: SignalEvent) => candles.some((c) => Math.abs(c.time - ev.ts / 1000) < 30))
      .map((ev: SignalEvent) => ({
        time: (Math.floor(ev.ts / 1000 / 15) * 15) as Time,
        position: ev.side === 'BUY' ? 'belowBar' as const : 'aboveBar' as const,
        color: ev.side === 'BUY' ? '#34D399' : '#F87171',
        shape: ev.side === 'BUY' ? 'arrowUp' as const : 'arrowDown' as const,
        text: `${ev.side} %${ev.confidence}`,
      }))

    try {
      if (markersPluginRef.current) {
        markersPluginRef.current.setMarkers(markers)
      }
    } catch {
      // Marker hatası
    }
  }, [signalEvents, candles])

  return (
    <div className="chart-screen">
      <div className="chart-header">
        <span className="chart-title">BTC-USDT · 15s</span>
        <span className="chart-badge">Canlı</span>
      </div>
      <div ref={containerRef} className="chart-main-container" />
      <div className="chart-cvd-label">CVD Δ</div>
      <div ref={cvdContainerRef} className="chart-cvd-container" />
    </div>
  )
}
