# 📡 Signal Radar

Canlı WebSocket (WSS) **emir akışından** beslenen, klasik indikatör kullanmayan, kendi sinyal motoruna sahip, mobil-öncelikli ve eğlenceli bir trading radarı.

## Fikir

RSI, MACD, EMA gibi hazır indikatörler **YOK**. Bunun yerine ham piyasa verisinden (işlem akışı + emir defteri) kendi metriklerimizi türetiyoruz:

| Metrik | Ne ölçer |
|---|---|
| **CVD** (Cumulative Volume Delta) | Alıcı/satıcı hacim dengesi |
| **Imbalance** | Emir defteri dengesizliği |
| **Velocity** | Fiyatın hızı / ivmelenmesi |

Üçünün ağırlıklı **kompozit skoru** AL / SAT / NÖTR sinyali üretir. Arayüz "kokpit radarı" temasında; tarama animasyonları, sinyal anında konfeti + ses + titreşim ile canlı çalışır. Hedef: **mobil uygulama gibi hissettiren** bir web uygulaması.

## Durum

- [x] **Faz 0** — Blueprint, gereksinimler, tasarım, indikatör matematiği (`docs/`)
- [x] **Faz 1** — React + Vite uygulaması: WSS akışı, CVD/OBI/Velocity, sinyal motoru, 4 ekran, animasyonlar ✅
- [ ] **Faz 2** — Web Worker, çoklu sembol, backtest, push bildirim (planlandı)

## Dokümanlar

| Dosya | İçerik |
|---|---|
| `docs/01-blueprint.md` | Mimari, veri akışı, klasör yapısı, faz planı |
| `docs/02-requirements.md` | Fonksiyonel & teknik gereksinimler, kabul kriterleri |
| `docs/03-design.md` | Tasarım sistemi, ekranlar, animasyon specleri |
| `docs/04-indicators.md` | İndikatörlerin matematik tanımları |
| `docs/05-phase1-todo-prompt.md` | Faz 1 kod üretimi için kopyala-yapıştır prompt + görev listesi |
| `docs/06-github-push.md` | Repoyu GitHub'a yayınlama adımları |

## Hızlı başlangıç

```bash
# Bağımlılıkları kur
npm install

# Geliştirme sunucusu (http://localhost:5173)
npm run dev

# Test (Vitest) — 26 birim testi
npm test

# Üretim build
npm run build
npm run preview
```

### Fontlar

Fontlar `public/fonts/` altında self-host olarak gelir (Space Grotesk 600, JetBrains Mono 500/700). CDN kullanmaz, çevrimdışı çalışır. Font dosyası eksik olursa sistem fontları (system-ui, ui-monospace) fallback olarak devreye girer.

### Canlı Veri

Uygulama başladığında **OKX** veya **Binance** public WebSocket'inden BTC-USDT verisi çeker. Ayarlar ekranından kaynak değiştirilebilir. İnternet bağlantısı gereklidir.

## Uyarı

⚠️ **Eğitim ve eğlence amaçlıdır; yatırım tavsiyesi DEĞİLDİR.** Gerçek parayla işlem emri üretmez, üretmeyecek. Yalnızca kamuya açık piyasa verisi kullanılır.
