import { useUiStore } from '../../store/index'
import { computeSummary } from '../../core/hitrate/index'
import type { SignalEvent, SignalOutcome } from '../../types/index'
import './SignalsScreen.css'

function formatPct(p: number): string {
  const sign = p >= 0 ? '+' : ''
  return `${sign}${(p * 100).toFixed(2)}%`
}

function outcomeBadge(outcome?: SignalOutcome) {
  if (!outcome) {
    return { label: '◌ AÇIK', cls: 'sc-outcome--open' }
  }
  if (outcome === 'HIT') return { label: '✓ HIT', cls: 'sc-outcome--hit' }
  if (outcome === 'STOP') return { label: '✕ STOP', cls: 'sc-outcome--stop' }
  return { label: '○ MISS', cls: 'sc-outcome--miss' }
}

function HitRateCard() {
  const signalEvents = useUiStore((s) => s.signalEvents)
  const s = computeSummary(signalEvents)

  return (
    <div className="hitrate-card">
      <div className="hitrate-header">
        <span className="hitrate-title">BAŞARI ORANI</span>
        <span className="hitrate-total">{s.evaluated} değerlendirildi · {s.open} açık</span>
      </div>
      <div className="hitrate-row">
        <div className="hitrate-stat">
          <div className="hitrate-value hitrate-value--win">
            {s.winRate > 0 ? `${Math.round(s.winRate * 100)}%` : '—'}
          </div>
          <div className="hitrate-label">Kazanma</div>
        </div>
        <div className="hitrate-stat">
          <div className="hitrate-value hitrate-value--hit">{s.hits}</div>
          <div className="hitrate-label">HIT</div>
        </div>
        <div className="hitrate-stat">
          <div className="hitrate-value hitrate-value--stop">{s.stops}</div>
          <div className="hitrate-label">STOP</div>
        </div>
        <div className="hitrate-stat">
          <div className="hitrate-value hitrate-value--miss">{s.misses}</div>
          <div className="hitrate-label">MISS</div>
        </div>
        <div className="hitrate-stat">
          <div className={`hitrate-value ${s.totalPnlPct >= 0 ? 'hitrate-value--win' : 'hitrate-value--stop'}`}>
            {formatPct(s.totalPnlPct)}
          </div>
          <div className="hitrate-label">Toplam</div>
        </div>
      </div>
      {s.evaluated > 0 && (
        <div className="hitrate-bar">
          <div className="hitrate-bar__hit" style={{ width: `${(s.hits / s.evaluated) * 100}%` }} />
          <div className="hitrate-bar__miss" style={{ width: `${(s.misses / s.evaluated) * 100}%` }} />
          <div className="hitrate-bar__stop" style={{ width: `${(s.stops / s.evaluated) * 100}%` }} />
        </div>
      )}
    </div>
  )
}

function SignalCard({ event }: { event: SignalEvent }) {
  const ts = new Date(event.ts)
  const timeStr = ts.toLocaleTimeString('tr-TR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
  const dateStr = ts.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })
  const isBuy = event.side === 'BUY'
  const badge = outcomeBadge(event.result?.outcome)

  return (
    <div className={`signal-card signal-card--${event.side.toLowerCase()}`}>
      <div className="sc-header">
        <span className={`sc-badge sc-badge--${event.side.toLowerCase()}`}>
          {isBuy ? '▲ AL' : '▼ SAT'}
        </span>
        <span className={`sc-outcome ${badge.cls}`}>{badge.label}</span>
        <span className="sc-time">
          {dateStr} {timeStr}
        </span>
        <span className="sc-price">
          {event.price.toLocaleString('en-US', { maximumFractionDigits: 1 })} ₮
        </span>
      </div>

      {/* Güven çubuğu */}
      <div className="sc-confidence">
        <div
          className="sc-confidence-fill"
          style={{
            width: `${event.confidence}%`,
            background: isBuy ? 'var(--green)' : 'var(--red)',
          }}
        />
        <span className="sc-confidence-label">%{event.confidence} güven</span>
      </div>

      {/* Sonuç (kapanmışsa) */}
      {event.result && (
        <div className={`sc-result sc-result--${event.result.outcome.toLowerCase()}`}>
          <span className="sc-result-price">
            Kapanış: {event.result.closedPrice.toLocaleString('en-US', { maximumFractionDigits: 1 })} ₮
          </span>
          <span className="sc-result-pnl">
            {formatPct(event.result.pnlPct)} ({event.result.timeframe})
          </span>
        </div>
      )}

      {/* Skor dökümü */}
      <div className="sc-scores">
        <span>CVD <b>{event.scores.cvd >= 0 ? '+' : ''}{event.scores.cvd.toFixed(2)}</b></span>
        <span>OBI <b>{event.scores.obi >= 0 ? '+' : ''}{event.scores.obi.toFixed(2)}</b></span>
        <span>VEL <b>{event.scores.vel >= 0 ? '+' : ''}{event.scores.vel.toFixed(2)}</b></span>
        <span>∑ <b>{event.scores.composite >= 0 ? '+' : ''}{event.scores.composite.toFixed(2)}</b></span>
      </div>
    </div>
  )
}

export function SignalsScreen() {
  const signalEvents = useUiStore((s) => s.signalEvents)
  const reversed = [...signalEvents].reverse()

  if (reversed.length === 0) {
    return (
      <div className="signals-empty">
        <div className="signals-empty-icon">📡</div>
        <p>Henüz sinyal yok</p>
        <p className="signals-empty-sub">Radar tarıyor…</p>
      </div>
    )
  }

  return (
    <div className="signals-screen">
      <HitRateCard />
      <div className="signals-count">
        {reversed.length} sinyal (son 200)
      </div>
      <div className="signals-list">
        {reversed.map((ev: SignalEvent) => (
          <SignalCard key={ev.id} event={ev} />
        ))}
      </div>
    </div>
  )
}
