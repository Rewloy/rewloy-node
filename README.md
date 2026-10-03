# Rewloy Node.js

**Rewloy API'nin resmî Node.js ve TypeScript kütüphanesi.**

> **Durum: hazırlanıyor.** Henüz yayımlanmış bir sürüm yok. O zamana kadar API'yi
> doğrudan kullanabilirsiniz. Aşağıdaki bağlantılar her şeyi anlatır.

[Rewloy](https://rewloy.com), işletmelerin dijital sadakat kartlarını
müşterinin telefonuna koyar. Kart türleri damga, puan, VIP, cashback, hediye
kartı, kupon ve indirimdir:
- iPhone'da Apple Cüzdan;
- Android'de Rewloy Cüzdan ve Google Cüzdan;
- her yerde web kartı.

Kasada QR okutulur; bakiye, ödül ve kampanyalar kartın kendisinde güncellenir.
Panelde yapılabilen her şey [Rewloy API v1](https://rewloy.com/gelistiriciler)
ile de yapılabilir.

## Neler olacak

- **Tam tipli bir istemci.** Tipler OpenAPI belgesinden
  ([`openapi.json`](https://app.rewloy.com/v1/openapi.json)) üretilir ve her
  API değişikliğinde otomatik olarak güncellenir. Node 22 ve üstünde
  bağımlılıksız çalışır (yerleşik `fetch`).
- **Kimlik:**
  - API anahtarı (`rwk_…`): kasa, e-ticaret ya da kendi sisteminiz için;
  - ekip oturumu (`rws_…`);
  - kart sahibi oturumu (`rwh_…`): Rewloy Cüzdan gibi müşteri uygulamaları
    için.
- **Webhook doğrulaması.** İmzalı istekleri doğrulayan, Express, Fastify ve
  benzerleriyle kullanılabilecek bir yardımcı.
- **Güvenli tekrar:** `Idempotency-Key` desteği ve geçici hatalarda ölçülü
  yeniden deneme.
- **Canlı akış:** kart hareketlerini dinlemek için `text/event-stream`
  desteği.

## Kurulum

Yayımlandığında npm'den kurulacak:

```sh
npm install @rewloy/node
```

Paket adı henüz kesin değildir.

## Belgeler

| | |
|---|---|
| Başlarken | https://rewloy.com/gelistiriciler |
| API referansı | https://rewloy.com/gelistiriciler/api |
| OpenAPI 3.1 | https://app.rewloy.com/v1/openapi.json |
| Hata kodları | https://rewloy.com/gelistiriciler/hatalar |
| Değişiklik günlüğü | https://rewloy.com/gelistiriciler/degisiklikler |

**Sürümler:**
- Kütüphane anlamsal sürümleme ([SemVer](https://semver.org)) kullanacak.
- API'ye alan eklemek geriye uyumludur.
- Kalkacak bir uç nokta en az 180 gün önce duyurulur ve bu süre boyunca
  `Deprecation` ve `Sunset` başlıklarını taşır.

## Güvenlik

Bir güvenlik açığı bulursanız [SECURITY.md](SECURITY.md) dosyasındaki yoldan
özel olarak bildirin. Lütfen herkese açık issue açmayın.

## Lisans

[MIT](LICENSE)

---

## English

**The official Node.js and TypeScript library for the Rewloy API.**

> **Status: in development.** There is no release yet.

Until there is a release, use the API directly:
- [getting started](https://rewloy.com/gelistiriciler)
- [reference](https://rewloy.com/gelistiriciler/api)
- [OpenAPI](https://app.rewloy.com/v1/openapi.json)

The documentation is in Turkish.

**Planned:**
- fully typed, generated from the OpenAPI document and kept current in CI;
- no dependencies on Node 22 or later;
- webhook signature verification;
- `Idempotency-Key` handling and retries;
- server-sent events for live card activity.

It will be published on npm, MIT licensed.
