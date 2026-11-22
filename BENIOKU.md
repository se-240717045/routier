# Routier — Yayına Alma

Bu klasör kendi başına çalışan bir web uygulamasıdır (derleme gerekmez).

## iPhone'da "Ana Ekrana Ekle" için
1. Önce `config.js` dosyasını doldurun (bkz. SUPABASE_KURULUM.md; boş kalırsa demo modunda çalışır).
2. Bu klasördeki tüm dosyaları (index.html, config.js, manifest.webmanifest, icon-*.png) ücretsiz bir statik barındırmaya yükleyin:
   - **Netlify Drop:** https://app.netlify.com/drop adresine klasörü sürükleyip bırakın.
   - veya **GitHub Pages / Vercel / Cloudflare Pages**.
3. Size verilen https adresini iPhone'da **Safari** ile açın.
4. Paylaş → **Ana Ekrana Ekle**. Uygulama tam ekran, Routier ikonuyla açılır.

## Altyapı (ücretsiz, API anahtarı gerektirmez)
- Harita: MapLibre GL + OpenFreeMap vektör karoları (güncel OpenStreetMap verisi)
- Rota geometrisi: OSRM (OpenStreetMap tabanlı)
- İnternet yoksa veya karolar yüklenemezse uygulama otomatik olarak yerleşik SVG haritaya geçer.

## Kullanıcılar ve veri
Supabase ile e-posta, Google, Apple ve misafir girişi; araçlar ve sürüşler bulutta tutulur. Kurulum: `SUPABASE_KURULUM.md`, veritabanı: `supabase/schema.sql`.

## Kaynak kod
`App.jsx` dosyası uygulamanın tamamıdır (React + lucide-react + maplibre-gl@4 + @supabase/supabase-js + Tailwind).
