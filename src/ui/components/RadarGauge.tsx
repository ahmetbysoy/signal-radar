import { useEffect, useRef, useCallback } from 'react'
import { useDataStore, useUiStore } from '../../store/index'
import './RadarGauge.css'

const TWO_PI = Math.PI * 2
const SCAN_DURATION = 3000 // 3 sn/tur

// ─── Konfeti parçacığı ────────────────────────────────────────────────────

interface Particle {
  x: number; y: number
  vx: number; vy: number
  color: string; size: number
  life: number; maxLife: number
  rot: number; rotV: number
}

function spawnConfetti(cx: number, cy: number, side: 'BUY' | 'SELL'): Particle[] {
  const colors = side === 'BUY'
    ? ['#34D399', '#22D3EE', '#A78BFA', '#fff']
    : ['#F87171', '#FBBF24', '#A78BFA', '#fff']
  const particles: Particle[] = []
  for (let i = 0; i < 60; i++) {
    const angle = Math.random() * TWO_PI
    const speed = 2 + Math.random() * 5
    particles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 3 + Math.random() * 5,
      life: 1, maxLife: 0.7 + Math.random() * 0.5,
      rot: Math.random() * TWO_PI,
      rotV: (Math.random() - 0.5) * 0.3,
    })
  }
  return particles
}

export function RadarGauge() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const scanAngleRef = useRef(0)
  const lastTsRef = useRef(0)
  const particlesRef = useRef<Particle[]>([])
  const lastSignalAtRef = useRef(0)
  const pulseRef = useRef<{ progress: number; side: 'BUY' | 'SELL' } | null>(null)
  const reducedMotion = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  const indicators = useDataStore((s) => s.indicators)
  const lastSignalAt = useUiStore((s) => s.lastSignalAt)
  const signalEvents = useUiStore((s) => s.signalEvents)

  // Sinyal anı tetikle
  useEffect(() => {
    if (lastSignalAt > lastSignalAtRef.current) {
      lastSignalAtRef.current = lastSignalAt
      const last = signalEvents[signalEvents.length - 1]
      if (last && !reducedMotion.current) {
        const canvas = canvasRef.current
        if (canvas) {
          const cx = canvas.width / 2
          const cy = canvas.height / 2
          particlesRef.current = spawnConfetti(cx, cy, last.side)
          pulseRef.current = { progress: 0, side: last.side }
        }
      }
    }
  }, [lastSignalAt, signalEvents])

  const draw = useCallback((ts: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dt = lastTsRef.current ? ts - lastTsRef.current : 16
    lastTsRef.current = ts
    const W = canvas.width
    const H = canvas.height
    const cx = W / 2
    const cy = H / 2
    const R = Math.min(W, H) * 0.42

    ctx.clearRect(0, 0, W, H)

    // ─── Arka plan çemberleri ─────────────────────────────────────
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath()
      ctx.arc(cx, cy, R * (i / 4), 0, TWO_PI)
      ctx.strokeStyle = 'rgba(30,42,68,0.8)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    // Cross hairs
    ctx.strokeStyle = 'rgba(30,42,68,0.5)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy)
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R)
    ctx.stroke()

    // ─── Tarama çizgisi ───────────────────────────────────────────
    if (!reducedMotion.current) {
      scanAngleRef.current = (scanAngleRef.current + (TWO_PI * dt) / SCAN_DURATION) % TWO_PI
    }
    const scanAngle = scanAngleRef.current
    const grad = ctx.createConicGradient
      ? ctx.createConicGradient(scanAngle, cx, cy)
      : null

    if (grad) {
      grad.addColorStop(0, 'rgba(52,211,153,0.6)')
      grad.addColorStop(0.15, 'rgba(52,211,153,0.0)')
      grad.addColorStop(1, 'rgba(52,211,153,0.0)')
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, TWO_PI)
      ctx.fillStyle = grad
      ctx.fill()
    } else {
      // Fallback: tek çizgi
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(scanAngle)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(R, 0)
      ctx.strokeStyle = 'rgba(52,211,153,0.8)'
      ctx.lineWidth = 2
      ctx.stroke()
      // trailing fade
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.arc(0, 0, R, 0, -0.8, true)
      ctx.closePath()
      const trailGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, R)
      trailGrad.addColorStop(0, 'rgba(52,211,153,0.15)')
      trailGrad.addColorStop(1, 'rgba(52,211,153,0.0)')
      ctx.fillStyle = trailGrad
      ctx.fill()
      ctx.restore()
    }

    // ─── Kompozit skor oku ────────────────────────────────────────
    const score = indicators?.compositeScore ?? 0
    const confidence = indicators?.confidence ?? 0
    const clampedScore = Math.max(-1, Math.min(1, score))
    // -1 = sola (BUY güçlü sell?), +1 = sağa; ok -PI/2'den başlıyor
    const needleAngle = -Math.PI / 2 + clampedScore * (Math.PI / 2)
    const needleLen = R * 0.72

    const side = score > 0.1 ? 'BUY' : score < -0.1 ? 'SELL' : null
    const needleColor = side === 'BUY' ? '#34D399' : side === 'SELL' ? '#F87171' : '#7C8DB0'

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(needleAngle)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(needleLen, 0)
    ctx.strokeStyle = needleColor
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.shadowColor = needleColor
    ctx.shadowBlur = 10
    ctx.stroke()
    ctx.restore()

    // ─── Merkez LED ───────────────────────────────────────────────
    const ledColor = side === 'BUY' ? '#34D399' : side === 'SELL' ? '#F87171' : '#7C8DB0'
    const ledGlow = side === 'BUY' ? 'rgba(52,211,153,.5)' : side === 'SELL' ? 'rgba(248,113,113,.5)' : 'transparent'
    // Nefes animasyonu
    const breathPhase = !reducedMotion.current ? Math.sin(ts / 400) * 0.3 + 0.7 : 1
    ctx.beginPath()
    ctx.arc(cx, cy, 14, 0, TWO_PI)
    ctx.fillStyle = ledGlow
    ctx.fill()
    ctx.beginPath()
    ctx.arc(cx, cy, 10 * breathPhase, 0, TWO_PI)
    ctx.fillStyle = ledColor
    ctx.shadowColor = ledColor
    ctx.shadowBlur = 16
    ctx.fill()
    ctx.shadowBlur = 0

    // ─── Güven % metni ────────────────────────────────────────────
    ctx.fillStyle = '#E6EDF7'
    ctx.font = `700 ${Math.round(R * 0.18)}px 'JetBrains Mono', monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`%${confidence}`, cx, cy + R * 0.55)

    ctx.font = `600 ${Math.round(R * 0.12)}px 'Space Grotesk', sans-serif`
    ctx.fillStyle = '#7C8DB0'
    ctx.fillText('GÜVEN', cx, cy + R * 0.55 + R * 0.18)

    // Sinyal label
    if (side) {
      ctx.font = `700 ${Math.round(R * 0.22)}px 'Space Grotesk', sans-serif`
      ctx.fillStyle = needleColor
      ctx.shadowColor = needleColor
      ctx.shadowBlur = 12
      ctx.fillText(side, cx, cy - R * 0.45)
      ctx.shadowBlur = 0
    }

    // ─── Pulse halkası ────────────────────────────────────────────
    if (pulseRef.current) {
      const p = pulseRef.current
      p.progress += dt / 400
      if (p.progress >= 1) {
        pulseRef.current = null
      } else {
        const pulseR = R * (0.3 + p.progress * 0.7)
        const pulseAlpha = 1 - p.progress
        ctx.beginPath()
        ctx.arc(cx, cy, pulseR, 0, TWO_PI)
        ctx.strokeStyle = p.side === 'BUY'
          ? `rgba(52,211,153,${pulseAlpha})`
          : `rgba(248,113,113,${pulseAlpha})`
        ctx.lineWidth = 3
        ctx.stroke()
      }
    }

    // ─── Konfeti parçacıkları ─────────────────────────────────────
    const alive: Particle[] = []
    for (const p of particlesRef.current) {
      p.x += p.vx
      p.y += p.vy
      p.vy += 0.18 // yerçekimi
      p.vx *= 0.98
      p.life -= dt / (p.maxLife * 1000)
      p.rot += p.rotV
      if (p.life > 0) {
        ctx.save()
        ctx.globalAlpha = Math.max(0, p.life)
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
        ctx.restore()
        alive.push(p)
      }
    }
    particlesRef.current = alive

    rafRef.current = requestAnimationFrame(draw)
  }, [indicators])

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [draw])

  // Canvas boyutu responsive
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const size = Math.min(canvas.parentElement?.clientWidth ?? 320, 320)
      canvas.width = size
      canvas.height = size
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  return (
    <div className="radar-gauge-wrap">
      <canvas ref={canvasRef} className="radar-gauge-canvas" aria-label="Radar gauge" />
    </div>
  )
}
