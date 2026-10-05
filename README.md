# Rewloy Node.js

**Rewloy API'nin resmî Node.js ve TypeScript kütüphanesi.**

> **Durum: önizleme (0.x), npm'de yayımlandı. API kararlı; kütüphane arayüzü 1.0'a kadar değişebilir.**

[Rewloy](https://rewloy.com), işletmelerin dijital sadakat kartlarını
müşterinin telefonuna koyar. Kart türleri damga, puan, VIP, cashback, hediye
kartı, kupon ve indirimdir:
- iPhone'da Apple Cüzdan;
- Android'de Rewloy Cüzdan ve Google Cüzdan;
- her yerde web kartı.

Kasada QR okutulur; bakiye, ödül ve kampanyalar kartın kendisinde güncellenir.
Panelde yapılabilen her şey [Rewloy API v1](https://rewloy.com/gelistiriciler)
ile de yapılabilir; bu kütüphane onu Node.js'ten kullanır. Geliştirici
belgeleri: **https://rewloy.com/gelistiriciler**.

- **Tam tipli.** API'nin her işlemi, `operationId` adıyla bir metottur.
  Parametreler, gövdeler ve yanıtlar OpenAPI belgesinden
  ([`openapi.json`](https://app.rewloy.com/v1/openapi.json)) üretilen
  tiplerle gelir. CI belgeyi her gün okur ve değişince yeniden üretir.
- **Bağımlılıksız.** Node 22 ve üstü; yerleşik `fetch` ve `node:crypto`.
- **Güvenli tekrar.** Geçici hatalarda ölçülü yeniden deneme; satışta, kasa
  işleminde ve kampanyada `Idempotency-Key`.
- **Ötesi:** sayfalama, canlı akış (SSE), webhook imzası doğrulama,
  kullanımdan kalkma uyarıları.

## Kurulum

Node 22 ya da üstü gerekir:

```sh
npm install @rewloy/node
```

## Başlarken

```ts
import { Rewloy } from '@rewloy/node';

const rewloy = new Rewloy({ apiKey: process.env.REWLOY_API_KEY! });

const kart = await rewloy.getPass({ params: { serial: 'ABCD-EFGH-JKLM' } });
// "Şimdi ne yapılabilir?" için `actions[].ready` okunur; `rewardReady` yalnız damga ve puanda "ödül hazır"dır.
const odul = kart.actions.find((a) => a.action === 'redeem-stamps' || a.action === 'redeem-reward');
console.log(kart.type, kart.balance, odul?.ready ?? false);
```

Her işlem, adı `operationId` olan bir metottur
([API referansı](https://rewloy.com/gelistiriciler/api)). Tek bir argüman alır,
işlemin gerektirdikleriyle:
- `params`: adresteki parametreler (`{serial}`, `{id}`…);
- `query`: sorgu parametreleri;
- `body`: JSON gövde;
- `merchant`: `Rewloy-Merchant` başlığı;
- `idempotencyKey`: `Idempotency-Key` başlığı (satış, kasa işlemi, kampanya ve mağaza iadesinde zorunlu);
- `signal`, `timeoutMs`, `maxRetries`.

Metot yanıttaki `data`yı döndürür. Sayfalı listelerde `{ data, meta }`,
gövdesiz yanıtta (`204`) `undefined`, dosyada (QR, harita, CSV, `.pkpass`) bir
`Blob` döner.

Tipler de dışa açıktır: `IssuePassBody`, `GetPassData`, `ListCustomersItem`,
`ErrorCode`… Hepsi işlem adıyla `Operations` içinde de bulunur.

### Kimlik

| İstemci | Ne için |
|---|---|
| `new Rewloy({ apiKey: 'rwk_…' })` | API anahtarı: kasa, e-ticaret, kendi sisteminiz |
| `new Rewloy({ staffSession: 'rws_…', merchant })` | ekip oturumu: bir kişinin işletme uygulaması |
| `new Rewloy({ holderSession: 'rwh_…' })` | kart sahibi oturumu: Rewloy Cüzdan gibi müşteri uygulamaları |
| `new Rewloy()` | kimlik istemeyen uç noktalar: giriş, katılım, kod |

`merchant`, ekip oturumu birden fazla işletmede koltuk taşıyorsa hangi işletme
için çalıştığını söyler (`Rewloy-Merchant`). Her çağrıda `merchant` ile
değiştirilebilir. Oturumlar kimliksiz bir istemciyle açılır:

```ts
const { token, mfaRequired } = await new Rewloy().login({ body: { email, password } });
const ekip = new Rewloy({ staffSession: token, merchant: isletmeId });
if (mfaRequired) await ekip.proveMfa({ body: { code: '123456' } });
```

Bir işlem istemcinin kimlik türünü kabul etmiyor ama kimliksiz de çalışıyorsa
(örneğin `login`), istemci onu kimliksiz çağırır. API, işlemin kabul etmediği
bir kimliği reddeder (`CREDENTIAL_NOT_ALLOWED`).

Diğer seçenekler:
- `baseUrl` (varsayılan `https://app.rewloy.com`; sonuna `/v1` eklemeniz ya da eklememeniz fark etmez: `https://app.rewloy.com/v1` de olur, kütüphane `/v1`i kendisi ekler);
- `timeoutMs` (60000);
- `maxRetries` (2);
- `fetch`: kendi `fetch`iniz;
- `userAgent`: gönderilen `User-Agent`a eklenir, örneğin `"KasaPOS/4.2"`.

### Başka bir adres (staging)

API'nin başka bir kopyasına (kendi staging ortamınız ya da bir vekil sunucu)
`baseUrl` ile bağlanılır:

```ts
const rewloy = new Rewloy({
  apiKey: process.env.REWLOY_API_KEY!,
  baseUrl: 'https://rewloy-staging.ornek.com',   // sonuna /v1 yazsanız da olur
});
```

Gerçek müşterilere dokunmadan denemek için adres değiştirmeniz gerekmez:
[test modu](#test-modu) aynı adreste, ayrı bir test ortamıyla çalışır.

## Kart vermek ve kasada işlem

```ts
const { serial, cardUrl } = await rewloy.issuePass({
  body: { programId, email: 'ayse@ornek.com', firstName: 'Ayşe', kvkkConsent: true },
});

const sonuc = await rewloy.passAction({
  params: { serial },
  body: { action: 'earn-stamps', locationId, count: 1 },
  idempotencyKey: `kasa3-z0187-fis${fisNo}`,   // aşağıya bakın
});
if (sonuc.duplicate) console.log('Bu işlem zaten yazılmış');

// Yanlışlıkla bir harcama mı yapıldı? Yaparken gönderdiğiniz anahtarla geri alın:
await rewloy.passAction({
  params: { serial },
  body: { action: 'spend', locationId, amountMinor: 2500 },
  idempotencyKey: `kasa3-z0187-iptal${fisNo}`,
});
const iptal = await rewloy.reverseAction({ params: { serial }, body: { actionKey: `kasa3-z0187-iptal${fisNo}` } });
console.log(iptal.undone, iptal.restored, iptal.balance);   // 'spend', 2500, kartın bakiyesi
```

### Satış: `recordSale`

Kasa ya da kendi yazılımınız için en kolay yol `recordSale`dir: "bu satış
oldu, sen yaz". Ödenen toplamı (kartın para biriminde, kuruş) gönderirsiniz;
ne yazılacağına kartın türü ve programın kendi kuralı karar verir. Kartın
türünü bilmeniz gerekmez.

```ts
const kart = await rewloy.getPass({ params: { serial } });
// Kartın türüne özgü alanlar; `balance` yerine bunları okuyun.
if (kart.stamps) console.log(`${kart.stamps.count} / ${kart.stamps.max} damga`);
if (kart.points !== undefined) console.log(`${kart.points} puan`);
if (kart.money) console.log(`${kart.money.amountMinor / 100} ${kart.money.currency}`);
console.log(kart.programName, kart.customer?.name);   // customer: yalnız customers.read yetkisiyle

// Fiş numarası anahtar olamaz: kasa + Z no + fiş no, ya da satışla saklanan bir UUID.
const anahtar = `kasa3-z0187-fis${fisNo}`;
const satis = await rewloy.recordSale({
  params: { serial },
  body: {
    locationId,
    amountMinor: 4550,           // 45,50: kartın para biriminde (`kart.currency`), kuruş
    currency: kart.currency,     // isteğe bağlı güvence: uyuşmazsa 422 CURRENCY_MISMATCH
    reference: `fis-${fisNo}`,   // fiş numarası buraya yazılır
  },
  idempotencyKey: anahtar,
});
if (satis.applied === 'none') console.log('Yazılan bir şey yok:', satis.reason);
else console.log(`${satis.credited} ${satis.applied} yazıldı, bakiye ${satis.balance}`);
// Fişi çizmek için ayrıca okumanız gerekmez: yazımdan sonraki kart `satis.card`'dadır.
const odul = satis.card?.actions.find((a) => a.action === 'redeem-stamps' || a.action === 'redeem-reward');
if (odul?.ready) console.log('Ödül hazır');
```

`actions[].ready`, kartın kendi durumuna göre işlemin şimdi yapılıp
yapılamayacağıdır (damga ödülü hazır mı, puan bir ödüle yetiyor mu, bakiye var
mı, kupon kullanılmamış mı, VIP ziyareti bu pencerede sayılmış mı). `rewardReady`
aynen kalır ama türe göre anlam değiştirir: damga ve puanda "ödül hazır";
cashback ve hediye kartında bakiye sıfırdan büyükse; **VIP'te her zaman
`true`**. Kasa ekranında "Ödül hazır" yazısını yalnız damga ve puanda gösterin.

`GET /v1/passes/{serial}` ayrıca `actions` (kartın aldığı kasa işlemleri ve
şimdi yapılıp yapılamayacakları) ve `sale` (bir satışın bu kartta ne
yazacağı) alanlarını verir.

**İade.** `reverseSale` bir satışın karta yazdığını geri alır; satışı
yazarken gönderdiğiniz anahtarla (`saleKey`) ya da `reference`la bulur:

```ts
const geri = await rewloy.reverseSale({
  params: { serial },
  body: { saleKey: anahtar, locationId },
});
console.log(geri.reversed, geri.applied, geri.balance, geri.duplicate);
```

Bir satış bir kez geri alınır (tekrar `duplicate: true` döner). Kazanılan
kullanılmışsa (ödüle ya da harcamaya gitmişse) `409 SALE_ALREADY_SPENT` gelir ve
hiçbir şey yazılmaz.

**Çevrimdışı kasa kuyruğu: `occurredAt`.** Bağlantı koptuğunda satışı sonra
yazıyorsanız `occurredAt` ile satışın gerçekten olduğu anı (ISO 8601, saat
dilimiyle) gönderin; geçmişte, kartın geçmişinde o anla görünür. Gelecekte
olamaz (2 dakikalık saat farkı kabul edilir). `idempotencyKey` kuyruktaki
kayıtla birlikte saklanır, tekrar gönderilince satış ikinci kez yazılmaz.

```ts
await rewloy.recordSale({
  params: { serial },
  body: { locationId, amountMinor: 4550, reference: `fis-${fisNo}`, occurredAt: '2026-10-05T14:32:10+03:00' },
  idempotencyKey: anahtar,
});
```

**Kasa işlemini iptal etmek: `reverseAction`.** `passAction` ile yapılan bir
harcama, ödül ya da kullanım yanlışlıkla yapıldıysa (`spend`, `spend-points`,
`redeem-stamps`, `redeem-reward`, `use`) `reverseAction` tamamını geri verir.
İşlemi, yaparken gönderdiğiniz `Idempotency-Key` (`actionKey`) ya da işlemin
`reference` değeriyle bulur (`passAction` artık isteğe bağlı bir `reference`
alır). `reverseAction` bir `Idempotency-Key` **istemez**: bir işlem bir kez geri
alınır, tekrar `duplicate: true` döner.

```ts
const geri = await rewloy.reverseAction({
  params: { serial },
  body: { actionKey: `kasa3-z0187-fis${fisNo}`, locationId },   // ya da { reference: `fis-${fisNo}` }
});
console.log(geri.undone, geri.restored, geri.balance, geri.reopened, geri.duplicate);
```

`passAction`ın yanıtı kart türüne göre iki biçimdedir ve TypeScript'te bir
birleşim türüdür: bakiyeli kartlarda `balance` (damga, puan, VIP, cashback,
hediye kartı), kupon ve indirim kartında `status`, `uses` ve `usesLeft`
(`'uses' in sonuc` ile ayırın). Kazanımlar (`earn-stamps`, `earn-points`,
`visit`) `reverseAction`la değil `reverseSale`la geri alınır.

**Yazımın yanıtında kartın durumu: `card`.** `recordSale`, `passAction`,
`reverseSale` ve `reverseAction` yanıtları `card` taşır: yazımdan sonraki kart,
`getPass`'in `customer` hariç aynı alanlarıyla (`programName`, `currency`,
`stamps`/`points`/`money`, `actions`…). Yazımla aynı işlemde okunur, yanıtın
`balance`'ıyla aynı anı söyler. **Tekrarda** (`duplicate: true`) kartın
**şimdiki** durumudur. Kimliğin kartın programında `passes.read` yetkisi yoksa
(yalnız kasa yetkisi olan bir eklenti anahtarı) `card` `null`dır. `recordSale`
yanıtındaki `reversed: true`, bu anahtarla yazılan satışın sonradan geri
alındığını söyler (yalnız bir tekrarda olabilir; `credited` ilk isteğin
yazdığıdır, kart onu artık taşımaz): fişi yeniden yazmak için yeni bir anahtar
gönderin.

**Kartın işlemleri: `listPassOperations`.** Kartın defterindeki işlemler,
yeniden eskiye, sayfalı (`rewloy.paginate('listPassOperations', { params: { serial } })`):
bir kasa ekranındaki "son işlemler" listesi ve her birinin İade düğmesi için;
kasanın kendi anahtar günlüğünü tutması gerekmez. Her işlemde `undoWith` hangi
uç noktanın geri aldığını (`'sale/reverse'` ya da `'actions/reverse'`),
`reversible` bu kimliğin şimdi geri alıp alamayacağını söyler; bu kimliğin kendi
işlemlerinde `saleKey` ya da `actionKey` de gelir.

```ts
for await (const islem of rewloy.paginate('listPassOperations', { params: { serial } })) {
  if (!islem.reversible) continue;
  if (islem.undoWith === 'sale/reverse') await rewloy.reverseSale({ params: { serial }, body: { saleKey: islem.saleKey! } });
  else await rewloy.reverseAction({ params: { serial }, body: { actionKey: islem.actionKey! } });
}
```

**`occurredAt` reddedilirse** `400 VALIDATION` gelir ve `err.details[0].reason`
nedeni söyler: `in_future`, `too_old` (72 saatten eski), `before_issue` (kart o
anda yoktu: `occurredAt` olmadan yeniden gönderin), `invalid`. Tanımadığınız bir
`reason`'ı `invalid` gibi ele alın.

**İstek sınırı.** Kimlikli her yanıt `RateLimit-Limit`, `RateLimit-Remaining` ve
`RateLimit-Reset` başlıklarını taşır: `rewloy.request(...)` bunları
`res.rateLimit` (`{ limit, remaining, reset }`) olarak verir, `429` hatası da
(`RateLimitError`) `err.rateLimit` ve `err.retryAfter` taşır.

### `Idempotency-Key`

`recordSale`, `passAction`, `sendCampaign` ve `refundShopRedemption` bir
`Idempotency-Key` **ister**: API'nin tanımında (OpenAPI) bu başlık bu işlemlerde
zorunludur, bu yüzden `idempotencyKey` bu metotlarda zorunlu bir argümandır.
Verilmezse kütüphane istek göndermeden `TypeError` fırlatır; **sizin yerinize
anahtar üretmez**. Üretilmiş rastgele bir anahtar yalnızca tek çağrının yeniden
denemelerini korurdu: uygulama çöküp yeniden başlarsa yeni bir anahtar çıkar ve
satış ikinci kez yazılabilirdi. Anahtarı kendiniz üretip satışla birlikte
saklayın. Anahtar 8–64 karakterlik görünür ASCII olmalıdır (0x21–0x7E: harf,
rakam ve noktalama; boşluk, Türkçe harf ya da `fiş` gibi ASCII dışı karakter
olmaz); aksi halde kütüphane yine istek göndermeden `TypeError` fırlatır.
Başlığın isteğe bağlı olduğu işlemlerde (örneğin `issuePass`) anahtar verilmezse
kütüphane bir UUID üretir ve aynı çağrının her denemesinde aynısını gönderir.

- **Anahtar bir kimlik için kalıcı olarak tekildir** (8–64 karakter; defterden
  hiç silinmez). Aynı anahtarla aynı isteğin tekrarı ikinci kez yazmaz ve
  ilk sonucu `duplicate: true` ile döndürür. Aynı anahtar başka bir gövdeyle
  `422 IDEMPOTENCY_KEY_REUSED` alır.
- **Fiş numarası tek başına anahtar olamaz:** yazarkasa fiş numaraları Z
  raporundan sonra yeniden başlar. Kasa + Z no + fiş no birleşimi
  (`kasa3-z0187-fis0042`) ya da satışla birlikte saklanıp tekrarda yeniden
  gönderilen bir UUID kullanın.
- **Fiş numarası `reference` alanına** yazılır; müşterinin geçmişinde ve işlem
  dökümünde görünür.

## Sayfalama

```ts
for await (const musteri of rewloy.paginate('listCustomers', { query: { consent: 'yes', limit: 200 } })) {
  console.log(musteri.displayName, musteri.email);
}
```

`paginate` sayfalı her listeyi (`page`/`limit` ve `meta`) öğe öğe dolaşır ve
son sayfada durur. Tek bir sayfa için metodun kendisi yeter:
`const { data, meta } = await rewloy.listCustomers({ query: { page: 2 } })`.

## Canlı akış

```ts
const ac = new AbortController();
for await (const olay of rewloy.liveFeed({ signal: ac.signal })) {
  if (olay.event === 'event') {
    const { kind, location, program, delta, unit, name } = JSON.parse(olay.data);
    console.log(kind, location, program, delta, unit, name);
  }
}
```

`liveFeed` (işletmenin tezgâh akışı) ve `holderCardEvents` (kart sahibinin
kartındaki değişiklik) sunucu olayları (`text/event-stream`) yayınlar.
`rewloy.stream('liveFeed', argüman)` aynı işi görür. Her olay `event`, `data`
ve `id` taşır.

- **Yeniden bağlanma.** Bağlantı koparsa akış kendiliğinden yeniden bağlanır:
  sunucunun `retry:` süresi kadar bekler, bir olay `id` taşıdıysa
  `Last-Event-ID` gönderir. `reconnect: false` bunu kapatır.
- **Sessiz bağlantı.** API 25 saniyede bir `: hb` gönderir; 60 saniye hiç veri
  gelmezse bağlantı kopmuş sayılır (`idleTimeoutMs`).
- **Durdurmak:** `signal`, döngüden `break` ya da `akis.close()`.
- **Bitiren hatalar.** Yeniden bağlanmanın düzeltemeyeceği bir hata (`401`,
  `403`, `404`) akışı `RewloyError` ile bitirir.

## Webhook doğrulama

Rewloy her teslimi imzalar:

```
Rewloy-Signature: t=<unix saniye>,v1=<hex HMAC-SHA256(sır, "<t>.<ham gövde>")>
```

`verifyWebhook` imzayı **ham gövdeyle** ve webhook oluşturulurken bir kez
gösterilen sırla (`whsec_…`) doğrular:
- karşılaştırmayı sabit sürede yapar;
- `t` şimdiden 300 saniyeden (`toleranceSeconds`) uzaksa reddeder;
- gövdeyi ayrıştırılmış olarak döndürür.

Webhook'u panelden ya da API'den ekleyebilirsiniz. `webhooks.manage` yetkili
bir API anahtarı `createWebhook`, `listWebhooks`, `getWebhook`,
`setWebhookStatus`, `testWebhook` ve `listWebhookDeliveries`yi çağırabilir;
`webhookEvents` abone olunabilecek olayları söyler. Sır (`secret`) yalnız
`createWebhook` yanıtında gelir, saklayın:

```ts
const { webhook, secret } = await rewloy.createWebhook({
  body: { url: 'https://ornek.com/rewloy/webhook', events: ['pass.activity', 'pass.voided'] },
});
await rewloy.testWebhook({ params: { id: webhook.id } });   // webhook.test olayı gönderir
```

Adres herkese açık bir `https` adresi olmalıdır (test ortamında da);
yerelde bir tünel kullanın.

**Sırrı yenilemek.** Kaybolan ya da sızan bir sır için `rotateWebhookSecret`
webhook'a yeni bir sır verir (yeni `secret` yalnız o yanıtta döner); webhook'u
silip yeniden eklemek gerekmez. Eski sır 24 saat daha yeninin yanında imzalar:
o sürede `Rewloy-Signature` iki `v1` taşır ve teslimler
`Rewloy-Signature-Rotating: 1` başlığıyla gelir. `verifyWebhook` her `v1`'i ve
`secret` olarak verilen birden çok sırrı dener; yenilemeden önce alıcınızı
`secret: [yeni, eski]` ile güncelleyin. `deleteWebhook` webhook'u teslim
geçmişiyle birlikte kalıcı siler (`204`).

```ts
const { secret } = await rewloy.rotateWebhookSecret({ params: { id: webhook.id } });
// yeni sırrı alıcınıza ekleyin, 24 saat sonra eskisini bırakın
verifyWebhook({ payload, header, secret: [secret, eskiSir] });
```

Tutmazsa `WebhookSignatureError` atar: 400 ile yanıtlayın ve hiçbir işlem
yapmayın. Gövde mutlaka ham olmalıdır. JSON olarak ayrıştırılıp yeniden yazılan
bir gövde imzayı tutturmaz.

Express:

```ts
import express from 'express';
import { verifyWebhook, WebhookSignatureError } from '@rewloy/node';

const app = express();
app.post('/rewloy/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  let olay;
  try {
    olay = verifyWebhook({
      payload: req.body,
      header: req.get('Rewloy-Signature'),
      secret: process.env.REWLOY_WEBHOOK_SECRET!,
    });
  } catch (err) {
    if (err instanceof WebhookSignatureError) return res.sendStatus(400);
    throw err;
  }
  // Rewloy-Delivery bir teslimin her denemesinde aynıdır: işlediyseniz atlayın.
  if (dahaOnceIslendi(req.get('Rewloy-Delivery'))) return res.sendStatus(200);
  if (olay.type === 'pass.activity') {
    console.log(olay.data.card, olay.data.kind, olay.data.delta);
  }
  res.sendStatus(200);
});
```

Fastify (gövde yalnız bu yolda ham kalsın diye ayrı bir kapsamda):

```ts
app.register(async (scope) => {
  scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  scope.post('/rewloy/webhook', async (req, reply) => {
    try {
      const olay = verifyWebhook({
        payload: req.body as Buffer,
        header: req.headers['rewloy-signature'],
        secret: process.env.REWLOY_WEBHOOK_SECRET!,
      });
      // …
      return reply.code(200).send();
    } catch (err) {
      if (err instanceof WebhookSignatureError) return reply.code(400).send();
      throw err;
    }
  });
});
```

Başlıklar:
- `Rewloy-Event`: olay türü (`pass.issued`, `pass.activity`, `pass.voided`,
  `webhook.test`); gövdedeki `type` ile aynı.
- `Rewloy-Delivery`: teslimin kimliği. Teslim "en az bir kez"dir: çift gelen
  teslimi bununla ayıklayın.

Gövde kişinin iletişim bilgisini taşımaz; kişiyi `customer_id` ile API'den
okuyun. 2xx dışı bir yanıt yaklaşık 45 saat boyunca 8 kez yeniden denenir ve
her deneme yeni bir `t` ile imzalanır. Kendi işleyicinizi test etmek için
`signWebhook({ payload, secret })` aynı başlığı üretir.

## Hatalar ve yeniden deneme

```ts
import { RateLimitError, RewloyError } from '@rewloy/node';

try {
  await rewloy.passAction({
    params: { serial },
    body: { action: 'spend', locationId, amountMinor: 5000 },
    idempotencyKey: `kasa3-z0187-fis${fisNo}`,
  });
} catch (err) {
  if (err instanceof RateLimitError) console.log(`${err.retryAfter} saniye sonra yeniden deneyin`);
  else if (err instanceof RewloyError && err.code === 'INSUFFICIENT_BALANCE') console.log(err.detail);
  else throw err;
}
```

`RewloyError` şunları taşır:
- `status`: HTTP durumu;
- `code`: API'nin sabit kodu ([hata kodları](https://rewloy.com/gelistiriciler/hatalar));
  kodunuz buna göre davranmalı;
- `title`: kodun katalogdaki başlığı;
- `detail`: API'nin açıklaması (Türkçe, değişebilir);
- `details`: varsa ayrıntı; doğrulama hatasında `[{ field, rule, message }]`;
- `requestId`: `x-request-id`; destek talebinde bunu verin;
- `body`, `headers`, `docs` ve `operation`.

Alt sınıflar:
- `RateLimitError`: `429`; `retryAfter` saniye;
- `RewloyConnectionError`: yanıt gelmedi (`status` 0, `code`
  `CONNECTION_ERROR`);
- `RewloyTimeoutError`: zaman aşımı (`TIMEOUT`).

Rewloy'un olmayan bir hata gövdesi (örneğin bir vekil sunucunun 502 sayfası)
`HTTP_502` gibi bir kodla gelir.

**Yeniden deneme.** Şunlar en çok `maxRetries` kez (varsayılan 2) yeniden
denenir: bağlantı hatası, zaman aşımı, `429`, `502`, `503`, `504` ve
Cloudflare'in `520`–`524` hataları.
- **Bekleme:** üstel ve rastgele (0,5 sn, 1 sn, 2 sn… en çok 8 sn); yanıt
  `Retry-After` taşıyorsa o kadar. `Retry-After` 60 saniyeden uzunsa
  beklenmez, hata size gelir.
- **Yalnız tekrarı güvenli istekler:** `GET`, `PUT`, `DELETE` ve
  `Idempotency-Key` taşıyan `POST`. İlk istek hâlâ işlenirken gelen
  `409 IDEMPOTENCY_IN_PROGRESS` de beklenip yeniden denenir. Diğer `POST` ve
  `PATCH` istekleri hiç tekrar edilmez.
- **Süre:** her deneme `timeoutMs` (varsayılan 60 sn) içinde bitmelidir.

## Kullanımdan kalkma

Kalkacak bir uç nokta en az 180 gün önceden duyurulur. O süre boyunca her
yanıtı `Deprecation`, `Sunset` ve `Link` başlıklarını taşır.

- **Uyarı.** Kütüphane her işlem için bir kez `process.emitWarning` ile bir
  `DeprecationWarning` (kodu `REWLOY_DEPRECATED`) yayar. Uyarı işlemi, `Sunset`
  tarihini ve değişiklik günlüğündeki kaydı söyler.
- **Tipler.** O metot `@deprecated` olarak işaretlenir; editörünüz üstünü
  çizer.
- **Yönetmek.** Uyarıları kendi kayıtlarınıza almak için
  `process.on('warning', …)`; kapatmak için `node --no-deprecation`.

## Yanıtın tamamı ve test modu

```ts
const yanit = await rewloy.request('sendCampaign', {
  body: { body: 'Bu hafta kahveler 2 damga!' },
  idempotencyKey: 'kampanya-2026-10-03',
});
yanit.status;     // 201
yanit.replayed;   // true: aynı anahtarın ilk yanıtı yeniden döndü (Idempotent-Replayed)
yanit.requestId;  // x-request-id
yanit.mode;       // Rewloy-Mode
yanit.data;       // kampanya
```

`request(işlem, argüman)` her işlemi çağırır ve yanıtın tamamını döndürür:
`data`, sayfalı listede `meta`, `status`, `headers`, `requestId`, `mode` ve
`replayed`.

`mode`, yanıtın `Rewloy-Mode` başlığıdır: `live` ya da `test`. Başlık yoksa
`null`. Canlı akışta aynı bilgi `akis.mode`dadır.

İşlem tablosu da dışa açıktır: `OPERATIONS.passAction` →
`{ method, path, auth, merchant, idempotency, paged, stream, deprecated, … }`.

## Test modu

Gerçek müşterilere dokunmadan denemek için işletmenizin bir **test ortamı**
vardır: ona bağlı ayrı bir işletme (adı "· Test" ile biter); kendi
programları, müşterileri, kartları, anahtarları ve webhook'ları. Panel →
Geliştirici → "Test ortamını aç" ya da `POST /v1/test/environment`. Orada
oluşturulan anahtar `rwk_test_` ile başlar ve aynı adreste, aynı yollarla
çalışır:

```ts
const rewloy = new Rewloy({ apiKey: process.env.REWLOY_TEST_KEY! });   // rwk_test_…
const yanit = await rewloy.request('getPass', { params: { serial } });
yanit.mode;   // 'test'
```

- Test ortamı hiçbir şey göndermez (e-posta, bildirim, SMS); kartlar
  cüzdanlara eklenmez. Gönderilmeyenler `GET /v1/test/messages` ile okunur.
- Webhook'lar teslim edilir ve `Rewloy-Test: 1` başlığıyla `"test": true`
  taşır.
- Gerçek müşteri verisini test ortamına girmeyin.
- `resetTestEnvironment` (1.2.0'dan beri) müşterileri, kartları, kodları ve
  kayıtları siler; ortamın kimliği, programları, şubeleri, anahtarları ve
  webhook'ları kalır, entegrasyonunuz aynı anahtarla sürer. Bir anahtar
  sızdıysa `body: { revokeKeys: true }` anahtarları da geçersiz kılar ve
  webhook'ları kapatır. Yanıt `deleted` ve `kept` sayılarını verir; `closed`
  artık hep `null`dır.
- POS için anahtar: `createApiKey({ body: { kind: 'pos', locationId, register: 'Kasa 1', password } })`
  hazır Kasa rolüyle yalnız o şubede çalışan bir anahtar oluşturur; yanıttaki
  `baseUrl` POS'a yazılacak adrestir.
- `listAllBatches` işletmenin bütün hediye kartı, kupon ve indirim kodlarını
  sayfalar (`status`: `open`, `full`, `expired`, `closed` ya da `archived`: kodun
  programı arşivde, bağlantısı kart vermez). Arşivdeki bir programa kod
  oluşturmak `409 PROGRAM_ARCHIVED` verir.

Ayrıntı: https://rewloy.com/gelistiriciler#test-ortamı

## Geliştirme

```sh
npm install
npm run generate                                   # canlı belgeden: openapi/openapi.json ve src/generated/
npm run generate -- --file openapi/openapi.json    # kayıtlı belgeden
npm run typecheck && npm run build && npm test
```

- `src/generated/` elle düzenlenmez; üreteç `scripts/generator.ts`'tir.
- Testler ağa çıkmaz: yerel bir sahte API ile çalışır. TypeScript'i doğrudan
  çalıştırdıkları için Node 22.18 ya da üstünü ister.
- CI her gün canlı belgeyi okur ve bir değişiklik varsa bir pull request açar.
- Kararlar: [docs/DECISIONS.md](docs/DECISIONS.md).

## Belgeler

| | |
|---|---|
| Başlarken | https://rewloy.com/gelistiriciler |
| API referansı | https://rewloy.com/gelistiriciler/api |
| OpenAPI 3.1 | https://app.rewloy.com/v1/openapi.json |
| Hata kodları | https://rewloy.com/gelistiriciler/hatalar |
| API'nin değişiklik günlüğü | https://rewloy.com/gelistiriciler/degisiklikler |
| Bu kütüphanenin değişiklikleri | [CHANGELOG.md](CHANGELOG.md) |

**Sürümler:**
- Kütüphane anlamsal sürümleme ([SemVer](https://semver.org)) kullanır. 1.0'a
  kadar arayüzü değişebilir.
- API'ye alan eklemek geriye uyumludur; kütüphanenin tipleri her gün
  güncellenir.
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

> **Status: preview (0.x), published on npm. The API is stable; the
> library's interface may change until 1.0.**

The documentation of the API itself is in Turkish. Developer docs:
**https://rewloy.com/gelistiriciler**. In short:

- Every operation of the API is a method named by its `operationId`, typed
  from the OpenAPI document, which CI reads daily and regenerates from.
- No dependencies: Node 22 or later, built-in `fetch` and `node:crypto`.
- Safe retries, `Idempotency-Key` handling, pagination, server-sent events,
  webhook signature verification and deprecation warnings.

### Install

Node 22 or later:

```sh
npm install @rewloy/node
```

### Use

```ts
import { Rewloy } from '@rewloy/node';

const rewloy = new Rewloy({ apiKey: process.env.REWLOY_API_KEY! });   // or { staffSession, merchant } or { holderSession }

const { serial } = await rewloy.issuePass({ body: { programId, email, kvkkConsent: true } });
const sale = await rewloy.recordSale({
  params: { serial },
  body: { locationId, amountMinor: 4550, reference: `receipt-${receiptNo}` },  // amount in the card's currency, minor units
  idempotencyKey: `till3-z0187-r${receiptNo}`,
});

// A gift-card spend rung up by mistake? Void it by the key it was sent with:
await rewloy.passAction({
  params: { serial },
  body: { action: 'spend', locationId, amountMinor: 2500 },
  idempotencyKey: `till3-z0187-s${receiptNo}`,
});
const voided = await rewloy.reverseAction({ params: { serial }, body: { actionKey: `till3-z0187-s${receiptNo}` } });
console.log(voided.undone, voided.restored, voided.balance);   // 'spend', 2500, the balance again
```

- **Till.** `recordSale` writes a completed sale to a card (the card type and
  the programme's own rule decide what is written); `getPass` returns the
  card's structured fields (`programName`, `currency`, `stamps`, `points`,
  `money`, `customer`); `reverseSale` takes a refunded sale back:
  `rewloy.reverseSale({ params: { serial }, body: { saleKey: key } })`.
  A void is `reverseAction`: it takes back a `passAction` that was a mistake
  (`spend`, `spend-points`, `redeem-stamps`, `redeem-reward`, `use`), found by
  the `Idempotency-Key` you sent with it (`actionKey`) or its `reference`; it
  needs no `Idempotency-Key` of its own, and a repeat answers `duplicate: true`:
  `rewloy.reverseAction({ params: { serial }, body: { actionKey: key } })`.
  A till that queues sales while offline sends `occurredAt` (ISO 8601 with the
  UTC offset, not in the future) with `recordSale`, so the card's history shows
  when the sale really happened; the queued `idempotencyKey` makes the resend
  safe. `passAction` takes an optional `reference` too, and its answer is a union:
  the balance-card answer (`balance`) or the coupon / discount-card answer
  (`status`, `uses`, `usesLeft`).
- **`card` on write answers.** `recordSale`, `passAction`, `reverseSale` and
  `reverseAction` answer with `card`: the card after the write, the fields of
  `getPass` except `customer`, read in the same transaction (on a replay,
  `duplicate: true`, it is the card's **current** state). A key without
  `passes.read` in the card's programme gets `card: null`. `recordSale`'s
  `reversed: true` (replays only) says the sale written under that key was
  taken back since: send a new key to write the receipt again. For "can I act
  now" read `card.actions[].ready`; `rewardReady` means "reward ready" only for
  stamp and points cards (always `true` on VIP, any balance on cashback and
  gift cards).
- **Recent operations.** `listPassOperations` lists a card's ledger operations,
  newest first and paged, for a till's "last operations" screen: `undoWith`
  (`'sale/reverse'` or `'actions/reverse'`), `reversible` and, for this
  credential's own operations, `saleKey` / `actionKey` to pass straight to
  `reverseSale` / `reverseAction`.
- **Rejected `occurredAt`** is a `400 VALIDATION` whose `err.details[0].reason`
  is `in_future`, `too_old`, `before_issue` or `invalid` (treat an unknown
  reason as `invalid`).
- **Idempotency keys.** `recordSale`, `passAction`, `sendCampaign` and
  `refundShopRedemption` need an `Idempotency-Key`: the API's OpenAPI document
  marks the header required for them, so `idempotencyKey` is a required
  argument and the client throws a `TypeError` before sending if it is missing.
  It never makes one up for you (a generated key would not survive a restart of
  your app). The key must be 8–64 printable ASCII characters (0x21–0x7E); a
  non-ASCII key such as `fiş-0042` is refused client-side, with a `TypeError`,
  before anything is sent. Where the header is optional (for example
  `issuePass`) the client still generates a UUID and reuses it on every retry
  of the call. A key is unique **for good per credential**: do not use the
  receipt number alone (fiscal receipt numbers restart after the Z report) but
  register + Z number + receipt number, or a UUID stored with the sale. The
  receipt number goes in `reference`.
- **Base URL.** `new Rewloy({ apiKey, baseUrl: 'https://staging.example.com' })`
  or `baseUrl: 'https://staging.example.com/v1'`: with or without a trailing
  `/v1` (and trailing slashes), the client appends `/v1/...` itself. Default
  `https://app.rewloy.com`.
- **Test mode.** Open the test environment (panel → Developer, or
  `POST /v1/test/environment`) and use its `rwk_test_` key at the same address:
  a separate test business that sends nothing and never reaches real
  customers. Webhooks are delivered with `Rewloy-Test: 1`.
- **Arguments.** Each method takes one object: `params`, `query` and `body` as
  the operation needs, plus `merchant`, `idempotencyKey`, `signal`, `timeoutMs`
  and `maxRetries`.
- **Results.** It resolves to the answer's `data`: `{ data, meta }` for paged
  lists, `undefined` for 204, a `Blob` for files.
- **The whole answer.** `rewloy.request(id, args)` returns `status`,
  `headers`, `requestId`, `rateLimit` (`{ limit, remaining, reset }` from the
  `RateLimit-*` headers, `null` when absent), `mode` (the `Rewloy-Mode` header: `live` or `test`) and `replayed` (`Idempotent-Replayed`).
  A `RewloyError` carries `rateLimit` too; a `RateLimitError` also has `retryAfter`.
- **Pagination.** `rewloy.paginate('listCustomers', args)` iterates the items
  of every page.
- **Streams.** `rewloy.liveFeed({ signal })` (or `rewloy.stream('liveFeed',
  args)`) iterates server-sent events (`event`, `data`, `id`). It reconnects
  with `Last-Event-ID` unless `reconnect: false`.

### Webhooks

Verify the **raw** body (for example `express.raw({ type: 'application/json' })`)
with the secret shown when the webhook was created:

```ts
const event = verifyWebhook({ payload: req.body, header: req.get('Rewloy-Signature'), secret });
```

- **Check.** `Rewloy-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret,
  "<t>.<raw body>")>` is compared in constant time, and `t` must be within
  300 seconds.
- **Refusal.** On failure it throws `WebhookSignatureError`: answer 400.
- **Headers.** `Rewloy-Event` is the event type. `Rewloy-Delivery` is the
  same on every retry of a delivery: deduplicate on it. Delivery is at least
  once.

`rotateWebhookSecret` gives a webhook a new secret (returned only in that
answer); the old one keeps signing for 24 hours, so `Rewloy-Signature` carries
two `v1` values and the delivery has `Rewloy-Signature-Rotating: 1`.
`verifyWebhook` tries every `v1` and every secret you pass:
`secret: [newSecret, oldSecret]`. `deleteWebhook` removes a webhook and its
delivery history for good.

Also in Rewloy 1.2.0 (library 0.2.4): `createApiKey({ body: { kind: 'pos', locationId, register, password } })`
(a till key bound to one branch); `resetTestEnvironment({ body: { revokeKeys: true } })`
(keeps the test business, programmes and keys; revokes keys only when asked);
`listAllBatches` (every gift-card, coupon and discount code of the business,
with the `archived` state); `409 PROGRAM_ARCHIVED` when creating a code for an
archived programme.

### Errors, retries, deprecations

- **Errors.** Failures throw `RewloyError` with `status`, `code` (the API's
  stable code), `title`, `detail`, `details`, `requestId` and `body`.
  Subclasses: `RateLimitError` (`retryAfter`), `RewloyConnectionError` and
  `RewloyTimeoutError`.
- **What is retried.** Network errors, timeouts, 429, 502–504 and
  Cloudflare's 520–524, up to `maxRetries` (default 2), with exponential
  backoff and jitter, honouring `Retry-After`.
- **Only when safe.** Only GET, PUT, DELETE, and POST with an
  `Idempotency-Key`, are retried.
- **Deprecations.** A deprecated operation's answers carry `Deprecation`,
  `Sunset` and `Link`. The client emits one `DeprecationWarning`
  (`REWLOY_DEPRECATED`) per operation, and the generated method is marked
  `@deprecated`.

### Security and licence

Report vulnerabilities privately, as [SECURITY.md](SECURITY.md) says.
[MIT](LICENSE) licensed.

## Yeni sürüm yayımlamak / Releasing

`package.json`'daki sürümü ve CHANGELOG'u güncelleyin, commit'leyin, `v<sürüm>` etiketini gönderin (`git tag v0.2.0 && git push origin v0.2.0`). `release.yml` npm'e güvenilir yayıncı (trusted publishing) yoluyla, jetonsuz ve kaynak kanıtıyla (provenance) yayımlar.

Bump the version in `package.json` and the changelog, commit, and push a `v<version>` tag. `release.yml` publishes to npm through trusted publishing: no token, with provenance.
