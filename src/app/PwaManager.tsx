import { useEffect, useRef, useState } from 'react'

/**
 * PWA Manager:
 * - Service Worker'ı register eder
 * - "Ana ekrana ekle" install prompt'unu yakalar, banner gösterir
 * - Yeni SW bulunduğunda kullanıcıya "Yenile" seçeneği sunar
 */

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function PwaManager(): null {
  const [, setReady] = useState(false)
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null)
  const [showInstall, setShowInstall] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    // SW register
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((reg) => {
            setReady(true)
            // Yeni SW bekliyorsa bildirim göster
            if (reg.waiting) {
              showUpdateNotification(reg.waiting)
            }
            reg.addEventListener('updatefound', () => {
              const newSw = reg.installing
              if (!newSw) return
              newSw.addEventListener('statechange', () => {
                if (newSw.state === 'installed' && navigator.serviceWorker.controller) {
                  showUpdateNotification(newSw)
                }
              })
            })
          })
          .catch(() => {
            // SW yok (örneğin HTTP üzerinden), sessizce yut
          })
      })

      // Controller değiştiğinde sayfayı yenile (yeni SW aktif)
      let refreshing = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true
          window.location.reload()
        }
      })
    }

    // Install prompt yakala (iOS/Chrome)
    const handler = (e: Event) => {
      e.preventDefault()
      const promptEvent = e as BeforeInstallPromptEvent
      deferredPrompt.current = promptEvent
      // Global window'a da referans tut (banner'daki button click için)
      ;(window as unknown as { deferredPrompt?: BeforeInstallPromptEvent }).deferredPrompt = promptEvent
      // 3 saniye sonra banner göster
      setTimeout(() => setShowInstall(true), 3000)
    }
    window.addEventListener('beforeinstallprompt', handler)

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  // Hiçbir UI render etme; global banner'ı ayrı bir portal olarak değil,
  // sadece localStorage'da bir kere göster, sonra bir daha gösterme
  useEffect(() => {
    if (!showInstall) return
    if (localStorage.getItem('pwa-install-dismissed') === '1') return
    mountInstallBanner()
  }, [showInstall])

  return null
}

function showUpdateNotification(sw: ServiceWorker): void {
  const el = document.createElement('div')
  el.className = 'pwa-banner pwa-banner--update'
  el.innerHTML = `
    <span>📡 Yeni sürüm hazır</span>
    <button class="pwa-btn">Yenile</button>
    <button class="pwa-btn pwa-btn--dismiss" aria-label="Kapat">✕</button>
  `
  document.body.appendChild(el)

  const [refresh, dismiss] = el.querySelectorAll('button')
  refresh.addEventListener('click', () => {
    sw.postMessage('SKIP_WAITING')
    el.remove()
  })
  dismiss.addEventListener('click', () => el.remove())
}

function mountInstallBanner(): void {
  const el = document.createElement('div')
  el.className = 'pwa-banner pwa-banner--install'
  el.innerHTML = `
    <span>📱 Ana ekrana ekle</span>
    <button class="pwa-btn">Kur</button>
    <button class="pwa-btn pwa-btn--dismiss" aria-label="Kapat">✕</button>
  `
  document.body.appendChild(el)

  const [install, dismiss] = el.querySelectorAll('button')
  dismiss.addEventListener('click', () => {
    localStorage.setItem('pwa-install-dismissed', '1')
    el.remove()
  })
  install.addEventListener('click', async () => {
    // beforeinstallprompt event'ini tetikle
    const evt = (window as unknown as { deferredPrompt?: BeforeInstallPromptEvent }).deferredPrompt
    if (evt) {
      evt.prompt()
      const { outcome } = await evt.userChoice
      if (outcome === 'accepted') {
        el.remove()
      }
    } else {
      // iOS Safari: manuel yönlendir
      alert(
        'Safari: Paylaş butonuna tıkla → "Ana Ekrana Ekle"\n' +
        'Chrome: Menü → "Uygulamayı yükle"'
      )
    }
  })
}
