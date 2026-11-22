# Routier — Supabase Kurulumu

Uygulama, `config.js` doldurulduğunda kullanıcıları ve verileri Supabase'de tutar. Boş bırakılırsa demo modunda çalışır ve veriler cihazda kalır.

## Neler tutuluyor?

| Tablo | İçerik |
|---|---|
| `auth.users` (Supabase) | Hesap, e-posta, şifre özeti, oturumlar |
| `profiles` | Ad, soyad, e-posta, avatar, **ilk giriş yöntemi** (`email`/`google`/`apple`/`anonymous`), **bağlı tüm yöntemler**, son giriş zamanı, aktif araç, ayarlar |
| `vehicles` | Garajım: marka, model, yıl, yakıt tipi, tüketim, güncel fiyat |
| `trips` | Sürüşler: hedef, rota tipi, km, süre, yakıt, maliyet, tasarruf |
| `monthly_stats` (görünüm) | Aylık sürüş sayısı, km, harcama, tasarruf |

Satır düzeyi güvenlik (RLS) açıktır: her kullanıcı yalnızca kendi verisini görür. Kimlik alanlarını (giriş yöntemi, e-posta) ise istemci değiştiremez.

---

## 1. Proje ve veritabanı
1. https://supabase.com adresinde yeni bir proje oluşturun. Bölge olarak Frankfurt (eu-central-1) Türkiye'ye en yakın seçenektir.
2. **SQL Editor**'e gidin, `supabase/schema.sql` dosyasının tamamını yapıştırıp **Run**'a basın.
3. **Project Settings → API** sayfasından *Project URL* ve *anon / publishable* anahtarını kopyalayıp `config.js`'e yazın:
   ```js
   window.ROUTIER_CONFIG = {
     supabaseUrl: 'https://PROJE-REF.supabase.co',
     supabaseAnonKey: 'eyJhbGciOi...'
   };
   ```
   ⚠️ `service_role` anahtarını asla bu dosyaya koymayın.

## 2. Yönlendirme adresleri
**Authentication → URL Configuration**
- **Site URL:** uygulamanın yayın adresi (ör. `https://routier.netlify.app`)
- **Redirect URLs:** aynı adresi ekleyin. Yerel test için `http://localhost:8080` da eklenebilir.

## 3. E-posta + şifre
**Authentication → Sign In / Providers → Email**: açık olmalı (varsayılan olarak açıktır).
- "Confirm email" açıksa kullanıcı kayıttan sonra e-postasını onaylar. Uygulama bunun için "Onay bağlantısı gönderildi" mesajını gösterir.
- Şifre sıfırlama bağlantısı uygulamaya geri döner ve "Yeni Şifre Belirle" penceresini açar.
- Canlıya çıkmadan önce **Authentication → Emails → SMTP Settings** bölümünden kendi SMTP sağlayıcınızı ekleyin. Dahili e-posta servisinin gönderim limiti çok düşüktür.

## 4. Misafir girişi
**Authentication → Sign In / Providers → Allow anonymous sign-ins**: açın.
Misafir kullanıcı da kendi araç ve sürüş verisine sahip olur. Kötüye kullanımı önlemek için CAPTCHA (Attack Protection) açılması önerilir.

## 5. Google ile giriş
1. [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → OAuth consent screen**: uygulama adı (Routier), destek e-postası ve logo girin.
2. **Credentials → Create Credentials → OAuth client ID → Web application**
   - *Authorized JavaScript origins:* `https://routier.netlify.app`
   - *Authorized redirect URIs:* `https://PROJE-REF.supabase.co/auth/v1/callback`
3. Oluşan **Client ID** ve **Client Secret** bilgilerini Supabase'de **Sign In / Providers → Google** bölümüne yapıştırıp etkinleştirin.

> "Google Play ile giriş" için standart yöntem Google hesabıyla giriştir (yukarıdaki adımlar). Google Play Games girişi yalnızca oyunlar içindir. İleride Android'e native uygulama çıkarsanız aynı Supabase projesine bir **Android** OAuth istemcisi eklemeniz yeterli olur.

## 6. Apple ile giriş
Ücretli bir Apple Developer hesabı gerekir.
1. **Certificates, IDs & Profiles → Identifiers → App IDs**: bir App ID oluşturun ve *Sign in with Apple*'ı işaretleyin.
2. **Identifiers → Services IDs**: yeni bir Services ID oluşturun (ör. `com.routier.web`). *Sign in with Apple → Configure* bölümünde:
   - *Domains:* `routier.netlify.app` ve `PROJE-REF.supabase.co`
   - *Return URLs:* `https://PROJE-REF.supabase.co/auth/v1/callback`
3. **Keys**: *Sign in with Apple* için bir anahtar oluşturun ve `.p8` dosyasını indirin. Ayrıca Key ID ile Team ID'yi not alın.
4. Supabase **Sign In / Providers → Apple**:
   - *Client IDs:* Services ID (`com.routier.web`)
   - *Secret Key:* `.p8` dosyasından üretilen JWT. Supabase dokümanındaki üreticiyi kullanabilirsiniz.
   - ⚠️ Bu gizli anahtar **en fazla 6 ayda bir yenilenmelidir.** Takviminize hatırlatma koyun.

> Apple, kullanıcının ad-soyadını **yalnızca ilk girişte** gönderir. Ad gelmezse uygulama "Apple Kullanıcısı" gösterir. Kullanıcı e-postasını gizlerse `@privaterelay.appleid.com` uzantılı bir adres gelir.
> App Store'a native uygulama olarak çıkarsanız, Google girişi sunan uygulamalarda Apple girişini de sunmanız beklenir (App Store kuralı 4.8). Uygulamada ikisi de hazır.

## 7. iPhone "Ana Ekrana Ekle" notu
iOS'ta ana ekrana eklenmiş web uygulamaları Safari'den ayrı bir depolama kullanır. Google veya Apple girişi bazen Safari'de tamamlanıp oturum uygulamaya geçmeyebilir. Bu durumda uygulamayı ana ekrandan yeniden açıp tekrar giriş yapmak yeterlidir. E-posta ile giriş her zaman uygulamanın içinde tamamlanır. Mutlaka gerçek bir iPhone'da deneyin.

## Test kontrol listesi
- [ ] E-posta ile kayıt → `profiles` satırında ad, soyad ve `auth_provider = email` görünüyor
- [ ] Google ile giriş → `auth_provider = google`, avatar dolu
- [ ] Apple ile giriş → `auth_provider = apple`
- [ ] Misafir girişi → `is_anonymous = true`
- [ ] Araç ekle, aktif yap, fiyat değiştir, sil → `vehicles` ve `profiles.active_vehicle_id` güncelleniyor
- [ ] Sürüşü bitir → `trips` tablosuna kayıt düşüyor
- [ ] Çıkış yap, başka bir cihazdan giriş yap → araçlar geri geliyor
