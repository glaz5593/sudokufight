import type { TelemetryEventName } from '@sudoku-fight/protocol';

import type { LegalChrome } from '../render';
import type { LegalDoc, LegalDocId } from '../types';

/**
 * The legal pages in Turkish (D112): a translation of the English version (privacy.ts, terms.ts,
 * deleteAccount.ts, render.ts LEGAL_CHROME.en), with the same sections, anchors, links, marks, contact
 * placeholders and numbers (legal.test.ts `skeleton`). sen (docs/i18n/style/tr.md); terms from
 * docs/i18n/glossary.csv (maç, rakip, derece, dereceli, oda, şikayet, engelleme, sabotaj, tepki, aşama, bölüm,
 * maç tekrarı, antrenman, seviye). The page opens with TRANSLATION_NOTICE_TR: the English version prevails.
 *
 * The brand is never inflected (docs/i18n/README.md §3.3): "Sudoku Fight oyunu", "Sudoku Fight uygulaması".
 * The names of the documents are written as names ("Gizlilik Politikası", "Kullanım Koşulları"), as Turkish
 * legal pages do.
 *
 * App labels quoted here (they must equal the app's tr strings): Ayarlar (home:settings.title), Hesabı sil
 * (account:settings.deleteAccount), Engellenen oyuncular (moderation:blocked.settingsRow), Lisanslar
 * (home:settings.licenses), “Son rakiplerin” (progress:leaderboard.caption.friends), “Nasıl oynanır”
 * (levels:tutorial.title); the report reasons rahatsız edici isim, hile, diğer
 * (moderation:report.reasons.offensiveName, .cheating, .other), lowercased inside the sentence.
 */

/** "This is a translation of the English version. If they differ, the English version prevails." */
export const TRANSLATION_NOTICE_TR =
  'Bu metin, İngilizce sürümün çevirisidir. İkisi arasında farklılık olması hâlinde İngilizce sürüm geçerlidir.';

/** The words around the texts (render.ts LegalChrome). */
export const LEGAL_CHROME_TR: LegalChrome = {
  brand: 'Sudoku Fight',
  languages: 'Dil',
  contents: 'İçindekiler',
  documents: 'Belgeler',
  updated: 'Son güncelleme:',
  emailPlaceholder: 'privacy@<domain>',
  operatorPlaceholder: '[işletmecinin adı]',
  draft: 'Taslak: iletişim bilgileri sunucuda henüz ayarlanmadı (LEGAL_CONTACT_EMAIL, LEGAL_OPERATOR_NAME).',
  translationNotice: TRANSLATION_NOTICE_TR,
};

/** Each reported event and what it carries (privacy.ts EVENT_DETAILS, `tr`): [what happens, what it carries]. */
export const EVENT_DETAILS_TR: Record<TelemetryEventName, [string, string]> = {
  app_open: ['Uygulama açılır', '—'],
  screen_view: ['Bir ekran açılır', 'Ekranın adı (yol kalıbı, kimlikler olmadan)'],
  register_step: ['Kaydın bir adımı açılır', 'Adım'],
  register_complete: ['Kayıt tamamlanır', '—'],
  game_start: [
    'Bir maç başlar',
    'Mod, maç türü, oyuncu sayısı ve arkadaşlarla oynanan bir maç olup olmadığı',
  ],
  game_end: [
    'Bir maç biter',
    'Mod, sonuç, puan, hata sayısı, süre ve arkadaşlarla oynanan bir maç olup olmadığı',
  ],
  interference_sent: ['Bir sabotaj gönderirsin', 'Türü ve bedeli'],
  reaction_sent: ['Bir tepki gönderirsin', 'Hangi emoji olduğu'],
  matchmaking_wait: ['Bir rakip araması sona erer', 'Kaç saniye beklendiği ve bir maç bulunup bulunmadığı'],
  reconnect: ['Bağlantı koptuktan sonra yeniden bağlanma', 'Ne kadar sürdüğü ve başarılı olup olmadığı'],
  latency_sample: ['Bir bağlantı kalitesi ölçümü', 'Ağın yanıt süreleri, milisaniye cinsinden'],
  replay_open: ['Bir maç tekrarı açılır', 'Maçın modu'],
  account_delete: ['Hesap silinir', '—'],
  report_sent: [
    'Bir oyuncuyu şikayet edersin',
    'Yalnızca sebep (kimin şikayet edildiği ya da hangi maç olduğu değil)',
  ],
  level_map_open: ['Aşamalı antrenman haritası açılır', 'Mevcut aşama ve toplam yıldızların'],
  level_start: [
    'Bir aşama başlar',
    'Aşamanın numarası ve sürümü, bölümü ve türü, denemenin numarası, o ana kadarki en iyi yıldızların ve hızlı başlangıç olup olmadığı',
  ],
  level_end: [
    'Bir aşama biter',
    'Aşamanın numarası, sürümü ve türü, yıldızlar, ondan önceki en iyi yıldızların, süresi, nasıl bittiği, hata sayısı, sonuç (süre, yerler, fark ya da puan), botun seviyesi ve denemenin numarası',
  ],
  level_quit: [
    'Bir aşamadan yarıda çıkılır (örneğin uygulama kapatıldığında)',
    'Aşamanın numarası ve sürümü ve ne kadar süredir devam ettiği',
  ],
  chapter_gate: [
    'Bir sonraki bölümün kapısını geçme denemesi',
    'Kapının ardındaki bölüm, bölümdeki yıldızlar ve kapının açılıp açılmadığı',
  ],
  level_tutorial: ['Bir aşama türünün “Nasıl oynanır” anlatımı gösterilir', 'Tür ve onu atlayıp atlamadığın'],
  friends_room_open: ['Arkadaşlarla oynamak için bir oda açılır', 'Maç türü ve odanın nasıl açıldığı'],
  friends_room_join: [
    'Bir arkadaş odasına katılma denemesi',
    'Nasıl (kodla ya da bağlantıyla) ve nasıl sonuçlandığı (başarı ya da neden başarısız olduğu)',
  ],
  friends_invite_share: [
    'Bir odanın bağlantısı paylaşılır',
    'Paylaşanın oda sahibi mi yoksa bir misafir mi olduğu (kod ya da kiminle paylaşıldığı değil)',
  ],
  friends_link_open: ['Bir oda bağlantısı uygulamayı açar', 'Giriş yapmış olup olmadığın'],
  friends_room_start: ['Arkadaşlarla bir maç başlar', 'Oyuncu sayısı ve odada kaç saniye beklediğin'],
  friends_room_close: [
    'Maçı başlamadan önce bir odanın dışında kalırsın',
    'Sebep, odada kaç oyuncu olduğu ve kaç saniye beklediğin',
  ],
};

const eventRows = () =>
  (Object.keys(EVENT_DETAILS_TR) as TelemetryEventName[]).map((name) => [
    `\`${name}\``,
    ...EVENT_DETAILS_TR[name],
  ]);

export const PRIVACY_TR: LegalDoc = {
  title: 'Gizlilik Politikası',
  lead: 'Sudoku Fight oyununun neleri ve neden topladığı, bunları kimlerin gördüğü, ne kadar süre saklandığı ve nasıl silebileceğin.',
  sections: [
    {
      id: 'who',
      title: 'Biz kimiz',
      blocks: [
        'Sudoku Fight (“oyun”, “biz”), {operator} tarafından işletilen, gerçek zamanlı ve rekabetçi bir sudoku oyunudur.',
        'Gizlilik ve verilerinle ilgili her türlü soru için bize {email} adresinden yaz.',
      ],
    },
    {
      id: 'summary',
      title: 'Kısaca',
      blocks: [
        {
          list: [
            'Yalnızca oyunu çalıştırmak için gerekenleri topluyoruz: hesap bilgilerin, maçların ve oyunun nasıl oynandığını anlamamıza ve sorunları gidermemize yardımcı olan kullanım verileri.',
            '**Reklam yok ve veri satmıyoruz.** Seni başka uygulamalarda ya da web sitelerinde takip etmiyoruz.',
            'Görünen adın, avatarın, ülken, derecelerin ve istatistiklerin diğer oyunculara görünür. E-posta adresin diğer oyunculara asla gösterilmez.',
            'Hesabını uygulamada istediğin zaman silebilirsin: Ayarlar → Hesabı sil. [Hesap silme sayfasına](delete-account) bak.',
          ],
        },
      ],
    },
    {
      id: 'account',
      title: 'Hesap bilgileri',
      blocks: [
        'Kaydolduğunda şunları saklarız:',
        {
          list: [
            '**E-posta:** giriş yapmak, adresi doğrulamak, şifreni sıfırlamak ve hesapla ilgili mesajlar göndermek için. Pazarlama e-postası göndermeyiz.',
            '**Şifre** (e-posta ve şifreyle kaydolduğunda): Google’ın Firebase Authentication hizmeti tarafından işlenir. Sunucularımıza hiçbir zaman ulaşmaz ve biz onu göremeyiz.',
            '**Google ile giriş (isteğe bağlı):** e-posta ve şifre yerine Google hesabınla kaydolup giriş yapabilirsin. Bu durumda Firebase Authentication, Google’dan Google hesabının e-posta adresini (Google tarafından doğrulanmış) ve Google kimliğini alır ve bunları giriş kaydınla birlikte saklar; e-posta adresini biz de her hesapta olduğu gibi saklarız. Google ayrıca Firebase’e Google’daki adını ve profil fotoğrafını verir; Firebase bunları giriş kaydınla birlikte saklar. Sunucumuz bunları saklamaz ve göstermez: arenada yalnızca senin seçtiğin ad ve avatar görünür. Google şifreni hiçbir zaman almayız; Google hesabındaki başka hiçbir şeye (kişiler, e-postalar, dosyalar) de erişimimiz olmaz. İstersen e-posta ve şifreyle kaydol.',
            '**Görünen ad, ülke ve avatar:** bunları sen seçersin ve diğer oyunculara gösterilirler. Ülkeni kendin seçersin (varsayılan değer, cihazının dil ve bölge ayarlarından gelir). Cihazının konumunu kullanmayız.',
            '**Hesabın ne zaman oluşturulduğu ve adın en son ne zaman değiştiği** (ad 30 günde bir kez değiştirilebilir).',
            '**Bizim verdiğimiz hesap kimliği** ve Firebase giriş kimliğin (Google ile girişte Firebase, Google hesap kimliğini de saklar).',
          ],
        },
      ],
    },
    {
      id: 'games',
      title: 'Maçlar ve ilerleme',
      blocks: [
        {
          list: [
            '**Dereceli maçlar** (sunucuda saklanır): tablo, zamanlamasıyla birlikte her hamle, gönderdiğin sabotajlar ve tepkiler, puanın, hataların, kaçıncı olduğun, maçtan önceki ve sonraki derecen ve maçın nasıl bittiği. Bunlar geçmişini, maç tekrarlarını ve istatistiklerini oluşturur.',
            '**Arkadaşlarla maçlar** (kodlu bir odada; sunucuda dereceli bir maç gibi saklanır, ama derece olmadan): derece dışında aynı bilgiler. Bunlar geçmişinde ve maç tekrarlarında görünür; birlikte oynadığın oyuncular da “Son rakiplerin” altında görünür. Odanın kodu, odada kimlerin olduğu ve odadan kimlerin çıkarıldığı yalnızca sunucunun belleğinde, oda kapanana kadar tutulur.',
            '**Dereceler, XP, seviye ve başarımlar.**',
            '**Hangi bulmacaları kimlere karşı oynadığın:** böylece aynı bulmaca ya da aynı rakip tekrar tekrar karşına çıkmaz.',
            '**Oynama hızın:** her dereceli maçın sonunda, hamlelerinden hamle başına ortalama süreni (her hücrenin ne kadar zor olduğunu hesaba katarak) hesaplar ve bunu, ölçüldüğü hamle sayısıyla birlikte maçla saklarız. Bundan, hata oranından ve bilgisayar kontrollü rakiplere karşı sonuçlarından yola çıkarak, müsait oyuncu olmadığında bilgisayar kontrollü bir rakibin hızını belirleriz ([Kullanım Koşulları](terms) sayfasına bak). Oynama hızın diğer oyunculara gösterilmez.',
            '**Antrenman sonuçları** (tek başına ya da bota karşı), uygulama bunları XP için bildirdiğinde: mod, maç türü, sonuç, doğru hamle sayısı, ne zaman bittiği ve kazandırdığı XP.',
            '**Aşamalı antrenman:** uygulama ilerlemeni hesabınla eşitlediğinde (böylece yeni bir telefonda da geri gelir): her aşamadaki en iyi yıldızların, her aşamayı kaç kez oynadığın ve bunun ne zaman değiştiği ve aşamaların her gün verdiği XP.',
            '**Adil oyun:** dereceli bir maçta hamlelerin hızı alışılmadık derecede yüksek olduğunda, bir kişinin incelemesi için bir kayıt tutulur. Bu kayıt yüzünden otomatik olarak hiçbir şey olmaz.',
            '**Şikayetler ve engellemeler:** aşağıdaki “Şikayetler ve engellemeler” bölümüne bak.',
          ],
        },
      ],
    },
    {
      id: 'usage',
      title: 'Kullanım verileri',
      blocks: [
        'Oyunun nasıl kullanıldığını anlamak için uygulama, sunucumuza olaylar bildirir. Her olayın kendine ait rastgele bir kimliği ve telefonundaki saate göre bir zamanı vardır; sunucu, olayı aldığı zamanı ekler.',
        'Her bildirim ayrıca bir **kurulum kimliği** taşır: ilk açılışta oluşturulan ve uygulamada saklanan rastgele bir sayı. Cihazının bilgilerine dayanmaz ve uygulamayı kaldırdığında yok olur. Onunla birlikte sistem (iOS ya da Android) ve uygulamanın sürümü de gönderilir.',
        'Giriş yapmış olduğun sürece olaylar ve kurulum hesabınla ilişkilendirilir. Bağlantı yokken olaylar telefonunda bekler ve daha sonra gönderilir.',
        'Olaylar:',
        { table: { head: ['Olay', 'Ne zaman', 'Ne içerir'], rows: eventRows() } },
        'Aynı olaylar **Google Analytics for Firebase** hizmetine de gider; bu hizmet bir uygulama kurulum kimliği, cihaz ve sistem bilgileri, kullanım verileri (oturum süresi gibi) ve Google’ın IP adresinden çıkardığı yaklaşık bir konum (ülke ve bölge) ekler. Bu hizmeti reklam özellikleri olmadan yapılandırdık: reklam kimliği yok ve reklam kişiselleştirmesi yok.',
      ],
    },
    {
      id: 'crashes',
      title: 'Çökme ve hata raporları',
      blocks: [
        {
          list: [
            '**Uygulamada, Google’ın Firebase Crashlytics hizmeti:** uygulama çöktüğünde ya da bir hatayla karşılaştığında; hatanın ayrıntılarını, cihaz modelini, sistem ve uygulama sürümlerini, bir Crashlytics kurulum kimliğini ve giriş yapmış olduğun sürece bizim verdiğimiz hesap kimliğini içeren bir rapor gönderilir. E-posta adresin ya da adın gönderilmez.',
            '**Sunucuda, Sentry:** sunucu bir hatayla karşılaştığında, bununla ilgili teknik bir rapor gönderilir; bazen ilgili hesabın kimliğiyle birlikte. E-posta adresi ve şifre gönderilmez.',
          ],
        },
      ],
    },
    {
      id: 'ip',
      title: 'IP adresi',
      blocks: [
        'Uygulama bağlandığında sunucumuz IP adresini görür. Bunu **yalnızca sunucunun belleğinde**, istek sıklığını sınırlamak ve aşırı istek yağmuruna karşı korunmak için kullanırız ve veritabanımızda saklamayız.',
        'Barındırma sağlayıcımız olağan erişim kayıtlarını kısa bir süre tutabilir.',
      ],
    },
    {
      id: 'device',
      title: 'Yalnızca telefonunda kalanlar',
      blocks: [
        {
          list: [
            'Antrenman maçların ve geçmişleri.',
            'Aşamalı antrenmandaki ilerlemen: yıldızlar, denemeler ve açtığın kapılar (bir kopyası sunucuda da tutulur: “Maçlar ve ilerleme” bölümüne bak).',
            'Ayarların: ses, titreşim, azaltılmış hareket ve dil.',
            'Uygulamanın bağlantı olmadan açılabilmesi için profilinin bir kopyası.',
            'Henüz gönderilmemiş olay ve antrenman sonucu kuyrukları ve kurulum kimliği.',
            'Girişin (Firebase tarafından saklanır) ve Google ile girişte seçtiğin hesap (çıkış yapana kadar Google Play hizmetleri tarafından saklanır).',
          ],
        },
        'Bunların hepsi uygulamayı kaldırdığında silinir. Çıkış yapmak profil kopyasını siler. Hesabını silmek, telefonundaki antrenman maçlarını ve aşamalı antrenman ilerlemesini silmez: bunları da silmek için uygulamayı kaldır.',
      ],
    },
    {
      id: 'not-collected',
      title: 'Toplamadıklarımız',
      blocks: [
        'Kişiler, fotoğraflar, mikrofon, kamera, hassas konum, reklam kimlikleri ve ödeme bilgileri. Oyunda sohbet yoktur: tepkiler, sabit bir listedeki emojilerdir.',
      ],
    },
    {
      id: 'public',
      title: 'Diğer oyuncuların gördükleri',
      blocks: [
        {
          list: [
            'Görünen adın, avatarın, ülken (bayrak olarak), derecelerin, seviyen ve başarımların.',
            'Oyuncu kartında ve sıralama tablolarında: maç sayısı, galibiyet oranı, seriler, en iyi hamle, ortalama hata, son sonuçlar, en sık gönderdiğin sabotaj ve ne zaman katıldığın (ay ve yıl).',
            'Bir maç sırasında: puanın, hataların, sabotajların ve tepkilerin ve çevrimiçi olup olmadığın.',
            'Arkadaşlarla oynamak için açılan bir odada: kodu ya da bağlantısı olup odaya giren herkes, odadaki herkesin adını, avatarını, bayrağını ve genel derecesini ve şu an odada olup olmadıklarını görür. Kodun ve bağlantının kendisi hiçbir kişisel bilgi taşımaz.',
            'Maç tekrarları ve maç ayrıntıları: yalnızca o maçın oyuncuları.',
          ],
        },
      ],
    },
    {
      id: 'reports',
      title: 'Şikayetler ve engellemeler',
      blocks: [
        {
          list: [
            '**Bir oyuncuyu şikayet etmek:** birini şikayet ettiğinde; kimin şikayet ettiğini, kimin şikayet edildiğini, sebebi (rahatsız edici isim, hile ya da diğer), şikayet dereceli bir maçtan geldiyse o maçı ve ne zaman olduğunu saklarız. Şikayette serbest metin yoktur. Şikayet edilen oyuncuya, onu kimin şikayet ettiği söylenmez.',
            '**Engelleme:** engellediğin oyuncuları ve onları ne zaman engellediğini saklarız. Bu sayede onlarla aynı maça konmazsın ve onların tepkileri sana gösterilmez. Kimseye engellendiği söylenmez ve engelleme kimseyi sıralama tablolarından gizlemez.',
            '**Şikayetlerin ele alınması:** oyunun işletmecisi her şikayeti 48 saat içinde inceler. İşletmeci rahatsız edici bir adı geçici bir adla değiştirebilir (oyuncudan bu durumda yeni bir ad seçmesi istenir) ya da bir hesabı dereceli maçlardan ve hesap değişikliklerinden men ederek askıya alabilir. Bu tür her işlem, onu yapan yöneticinin adresiyle ve bir ad değiştirildiyse eski ve yeni adla birlikte bir iç kayda girer. Bu şekilde değiştirilen bir ad, kimsenin yeniden seçemeyeceği adlar listesine girer (yalnızca ad, hiçbir oyuncuyla ilişkilendirilmeden).',
            '**Silinen askıya alınmış bir hesap:** bir hesabı silmek askıya almayı kaldırmaz. Askıya alınmış bir hesap silindiğinde, giriş kimliğinin ve doğrulanmış e-posta adresinin tek yönlü bir parmak izini (bir hash) saklarız; kimliğin ya da adresin kendisini değil. Aynı girişle açılan yeni bir hesap, bir yönetici onu inceleyene kadar askıya alınmış olarak başlar ve parmak izi bunun ardından silinir. Bu, adil oyun konusunda bizim ve her oyuncunun meşru menfaatidir.',
          ],
        },
      ],
    },
    {
      id: 'use',
      title: 'Verileri neden kullanıyoruz',
      blocks: [
        {
          list: [
            '**Oyunu çalıştırmak için:** hesabın, maçların, derecelerin, eşleştirme, geçmiş ve sıralama tabloları. Bu, seninle aramızdaki sözleşme (Kullanım Koşulları) için gereklidir.',
            '**Güvenlik ve adil oyun:** istek sınırları, anormallikleri tespit etmek, hileyi önlemek ve şikayetleri ve engellemeleri ele almak. Bu, bizim ve her oyuncunun meşru menfaatidir.',
            '**Oyunu geliştirmek için:** hangi ekranların ve modların oynandığını öğrenmek, sorunları bulmak ve çökmeleri düzeltmek. Bu da reklam ve pazarlama profili olmadan, meşru bir menfaattir.',
            '**Hizmet e-postası:** yalnızca adres doğrulama ve şifre sıfırlama.',
          ],
        },
      ],
    },
    {
      id: 'sharing',
      title: 'Kimlerle paylaşıyoruz',
      blocks: [
        'Verileri **satmıyoruz** ve reklamverenlere ya da veri simsarlarına aktarmıyoruz. Hizmet sağlayıcılarımız bunları yalnızca bizim adımıza işler:',
        {
          list: [
            '**Google (Firebase):** giriş (Google ile giriş dahil, Authentication), çökme raporları (Crashlytics) ve kullanım verileri (Analytics).',
            '**Fly.io:** sunucunun barındırılması.',
            '**Neon:** veritabanı (PostgreSQL).',
            '**Sentry:** sunucu hatalarının raporları.',
          ],
        },
        'Ayrıca, yasa gerektirdiğinde ya da oyunu ve oyuncularını korumak için verileri açıklarız. Oyun başka bir sahibe geçerse veriler de onunla birlikte geçer ve bu politika bunlara uygulanmaya devam eder.',
      ],
    },
    {
      id: 'transfers',
      title: 'Veriler nerede',
      blocks: [
        'Sunucu ve veritabanı şu anda Avrupa Birliği’ndedir (Frankfurt, Almanya). Google ve Sentry verileri, veri aktarımına ilişkin kendi güvenceleri (AB Standart Sözleşme Maddeleri gibi) kapsamında Amerika Birleşik Devletleri’nde ve diğer ülkelerde de işleyebilir.',
      ],
    },
    {
      id: 'retention',
      title: 'Ne kadar süre saklıyoruz',
      blocks: [
        {
          list: [
            '**Hesap bilgileri:** hesap var olduğu sürece.',
            '**Hesabını sildiğinde:** e-posta adresin, ülken, avatarın ve giriş bağlantın hemen silinir ve görünen adın anonim bir kimlikle değiştirilir (eski ad hemen yeniden seçilebilir hâle gelir). Firebase’deki girişin de, Google’dan sakladıklarıyla birlikte silinir. Google ile giriş yaptıysan uygulama, Google hesabına verilen erişimi de geri alır.',
            '**Aşamalı antrenman ilerlemesi:** sunucudaki kopya (her aşamadaki yıldızların ve aşamaların her gün verdiği XP) hesapla birlikte silinir. Telefonundaki kopya, uygulamayı kaldırana kadar kalır.',
            '**Silmeden sonra anonim olarak kalanlar:** dereceli maçlar, dereceler, XP, antrenman sonuçları, adil oyun kayıtları, gönderdiğin şikayetler ve kullanım verileri. Bunlar artık seninle ilişkili değildir, ama diğer oyuncuların maçları, maç tekrarları ve sıralama tabloları eksiksiz kalır.',
            '**Şikayetler, engellemeler ve yönetici kaydı:** bir engelleme, sen onu kaldırana ya da hesabını silene kadar tutulur (o zaman hesabın tüm engellemeleri, her iki yönde de silinir). Şikayetler ve yönetici işlemlerinin kaydı, şikayetleri ele almak ve oyunu güvenli ve adil tutmak için gerekli olduğu sürece saklanır; bunları zaman zaman inceler ve eskilerini sileriz. Bir hesap silindiğinde, onunla ilgili açık şikayetler kapatılır ve adları yönetici kaydından çıkarılır. Hesap askıya alınmışsa yalnızca yukarıda açıklanan tek yönlü parmak izi kalır; aynı girişle yeni bir hesap açılana ya da biz onu dönemsel bir incelemede silene kadar.',
            '**Kullanım verileri:** oyunun nasıl kullanıldığını anlamamıza yardımcı olduğu sürece saklanır. Bunları zaman zaman inceler ve eski verileri sileriz.',
            '**Crashlytics:** Google çökme raporlarını 90 güne kadar saklar. **Analytics:** Firebase’de belirlediğimiz saklama süresi boyunca.',
          ],
        },
      ],
    },
    {
      id: 'rights',
      title: 'Hakların',
      blocks: [
        'Verilerini görmeyi, düzeltmeyi (adını, avatarını ve ülkeni uygulamada değiştirebilirsin), silmeyi (hesabını uygulamada sil) ya da kullanılmasına itiraz etmeyi talep edebilirsin. Bize {email} adresinden yaz; 30 gün içinde yanıt veririz.',
        'Ayrıca İsrail’in Gizlilik Koruma Otoritesi’ne ya da ülkendeki veri koruma otoritesine şikayette bulunabilirsin.',
      ],
    },
    {
      id: 'children',
      title: 'Çocuklar',
      blocks: [
        'Oyun 13 yaşından küçük çocuklar için tasarlanmamıştır ve onlar hakkında bilerek veri toplamayız. 13 yaşından küçük bir çocuğun hesap açtığını öğrenirsek hesabı sileriz. Asgari yaşın daha yüksek olduğu yerlerde, o yaşa kadar ebeveyn izni gerekir.',
      ],
    },
    {
      id: 'security',
      title: 'Güvenlik',
      blocks: [
        'Uygulama ile sunucu arasındaki trafik şifrelenir (HTTPS ve WSS). Şifreler Firebase tarafından işlenir ve bizim tarafımızdan saklanmaz. Sunucudaki verilere erişim, oyunun işletmecisiyle sınırlıdır. Hiçbir sistem kusursuz biçimde güvenli değildir, ama verilerini korumak için makul çaba gösteririz.',
      ],
    },
    {
      id: 'changes',
      title: 'Bu politikadaki değişiklikler',
      blocks: [
        'Bu politika değiştiğinde buradaki tarihi güncelleriz. Önemli değişiklikleri uygulamada da duyururuz.',
      ],
    },
    {
      id: 'contact',
      title: 'İletişim',
      blocks: ['{operator} · {email}', 'Ayrıca [Kullanım Koşulları](terms) sayfasına bak.'],
    },
  ],
};

export const TERMS_TR: LegalDoc = {
  title: 'Kullanım Koşulları',
  lead: 'Sudoku Fight oyununu kullanma kuralları. Oyunu kullanman, bunları kabul ettiğin anlamına gelir.',
  sections: [
    {
      id: 'acceptance',
      title: 'Kabul',
      blocks: [
        'Bu koşullar, {operator} (“biz”) tarafından işletilen Sudoku Fight uygulaması ve hizmetleri (“oyun”) için geçerlidir. Kaydolarak ya da oyunu kullanarak bu koşulları ve [Gizlilik Politikasını](privacy) kabul etmiş olursun.',
      ],
    },
    {
      id: 'eligibility',
      title: 'Kimler oynayabilir',
      blocks: [
        'En az 13 yaşında olmalısın ya da ülkenin yasasının belirlediği asgari yaş daha yüksekse o yaşta olmalısın. 18 yaşından küçüksen bir ebeveynin ya da vasinin iznine ihtiyacın var.',
      ],
    },
    {
      id: 'account',
      title: 'Hesabın',
      blocks: [
        {
          list: [
            'Kişi başına bir hesap, kendi e-posta adresinle.',
            'Şifreni (ya da giriş yaptığın Google hesabını) güvende tut. Hesabınla yapılan her şeyden sen sorumlusun.',
            'Hesabını istediğin zaman uygulamada silebilirsin: Ayarlar → Hesabı sil.',
          ],
        },
      ],
    },
    {
      id: 'names',
      title: 'Görünen adlar ve davranış',
      blocks: [
        'Görünen adın, avatarın ve ülken tüm oyunculara görünür. Bir ad:',
        {
          list: [
            'rahatsız edici, ırkçı, cinsel içerikli, tehditkâr ya da hakaret niteliğinde olmamalı;',
            'başka bir kişiyi, başka bir oyuncuyu ya da oyunun ekibini taklit etmemeli;',
            'kişisel bilgiler (telefon numarası, adres), reklam ya da bağlantı içermemeli.',
          ],
        },
        'Adlar, yasaklı kelimeler listesine göre otomatik olarak kontrol edilir. Bu kuralları çiğneyen bir adı değiştirebilir, yeni bir ad isteyebilir ya da hesabı askıya alabiliriz.',
        'Oyundaki tepkiler, sabit bir listedeki emojilerdir. Bir rakibi maç sırasında kartından sessize alabilir, engelleyebilir ya da şikayet edebilirsin (sonraki bölüm).',
      ],
    },
    {
      id: 'reports',
      title: 'Şikayet ve engelleme',
      blocks: [
        'Bir oyuncuyu kartından ya da maçtan, üç sebepten biriyle şikayet edebilirsin: rahatsız edici isim, hile ya da diğer. **Her şikayeti 48 saat içinde inceleriz.**',
        'Kurallar çiğnendiyse adı geçici bir adla değiştirebilir (oyuncudan bu durumda yeni bir ad seçmesi istenir ve 30 gün kuralı bu seçim için geçerli olmaz), hesabı, askıya alma kaldırılana kadar dereceli maçlardan ve hesap değişikliklerinden men ederek askıya alabilir ya da hesabı kapatabiliriz. Bu şekilde değiştirilen bir ad yeniden seçilemez. Askıya alınmış bir hesap yine de her zaman silinebilir, ama hesabı silmek askıya almayı kaldırmaz: aynı girişle açılan yeni bir hesap, biz onu inceleyene kadar askıya alınmış olarak başlar.',
        'Bir oyuncuyu engelleyebilirsin de: onunla aynı maça konmazsın ve onun tepkileri sana gösterilmez. Engellemeyi Ayarlar → Engellenen oyuncular bölümünden kaldırabilirsin. Engelleme kimseyi sıralama tablolarından gizlemez.',
        'Sebepsiz yere şikayet etme: tekrarlanan asılsız şikayetler bu koşulları ihlal eder.',
      ],
    },
    {
      id: 'fair-play',
      title: 'Adil oyun',
      blocks: [
        'Şunları yapmamalısın:',
        {
          list: [
            'sudoku çözücüler, botlar, betikler, otomasyon ya da değiştirilmiş bir uygulama kullanmak;',
            'dereceleri etkilemek için birden fazla hesap tutmak, başka bir oyuncuyla sonuç ayarlamak ya da bilerek kaybetmek;',
            'yazılım hatalarını bildirmek yerine onlardan yararlanmak;',
            'sunucularımızı aşırı yüklemek, onlara izinsiz girmeye çalışmak ya da diğer oyuncuları rahatsız etmek.',
          ],
        },
        'Sunucu, alışılmadık maçları inceleme için işaretler. Kurallar çiğnendiyse sonuçları iptal edebilir, dereceleri sıfırlayabilir ya da hesabı askıya alıp kapatabiliriz.',
      ],
    },
    {
      id: 'virtual',
      title: 'Dereceler, XP ve başarımlar',
      blocks: [
        'Dereceler, XP, seviyeler ve başarımlar parasal bir değere sahip değildir; devredilemez ve satılamaz. Nasıl hesaplandıklarını değiştirebilir ya da onları sıfırlayabiliriz (örneğin bir sezonun başında).',
        'Oyun ücretsizdir. Bu sürümde satın alma ve reklam yoktur.',
      ],
    },
    {
      id: 'service',
      title: 'Hizmetin kullanılabilirliği',
      blocks: [
        'Dereceli maçlar internet bağlantısı gerektirir. Müsait oyuncu olmadığında, seninkine benzer bir hızda oynayan bilgisayar kontrollü bir rakiple eşleştirilebilirsin. Bu tür maçlar derecene sayılır. Oyun ayrıca bota karşı, derecesiz bir antrenman maçı sunabilir. Dereceli bir maç sırasında sunucu yeniden başlarsa o maç, derece değişmeden sona erer.',
        'Oyunun bazı kısımlarını değiştirebilir, duraklatabilir ya da durdurabiliriz; önemli değişiklikleri önceden bildirmeye çalışırız.',
      ],
    },
    {
      id: 'ip',
      title: 'Fikri mülkiyet',
      blocks: [
        'Oyun, tasarımı, kodu, sesleri ve avatarları bize ya da onları bize lisanslayanlara aittir. Sana, oyunu bu koşullar çerçevesinde kullanman için kişisel, münhasır olmayan ve ticari olmayan bir lisans veririz. Üçüncü taraf lisansları uygulamada listelenir: Ayarlar → Lisanslar.',
      ],
    },
    {
      id: 'stores',
      title: 'Uygulama mağazaları',
      blocks: [
        'Apple ve Google bu koşulların tarafı değildir ve oyundan sorumlu değildir. Oyunu App Store’dan indirdiysen Apple’ın Standart Son Kullanıcı Lisans Sözleşmesi (EULA) de geçerlidir ve Apple ile bağlı ortaklıkları, bu koşulları üçüncü taraf lehtarlar olarak uygulayabilir.',
      ],
    },
    {
      id: 'disclaimer',
      title: 'Sorumluluk reddi',
      blocks: [
        'Oyun “olduğu gibi” sunulur. Yasanın izin verdiği ölçüde, oyunun kesintisiz ya da hatasız çalışacağını garanti etmeyiz ve dolaylı zararlardan, kaybolan verilerden ya da kaybolan derecelerden sorumlu değiliz. Bu koşulların hiçbir hükmü, yasanın sana tanıdığı ve feragat edilemeyen hakları sınırlamaz.',
      ],
    },
    {
      id: 'termination',
      title: 'Sona erme',
      blocks: [
        'İstediğin zaman oynamayı bırakabilir ve hesabını silebilirsin. Bu koşulları ihlal eden bir hesabı askıya alabilir ya da kapatabiliriz.',
      ],
    },
    {
      id: 'changes',
      title: 'Bu koşullardaki değişiklikler',
      blocks: [
        'Bu koşullar değiştiğinde buradaki tarihi güncelleriz. Önemli değişiklikleri uygulamada da duyururuz. Bir değişiklikten sonra oyunu kullanman, yeni koşulları kabul ettiğin anlamına gelir.',
      ],
    },
    {
      id: 'law',
      title: 'Uygulanacak hukuk',
      blocks: [
        'Bu koşullar İsrail Devleti yasalarına tabidir ve ülkenin yasası sana feragat edilemeyen bir hak tanımadıkça, Tel Aviv bölgesinin yetkili mahkemeleri münhasır yargı yetkisine sahiptir.',
      ],
    },
    {
      id: 'contact',
      title: 'İletişim',
      blocks: ['{operator} · {email}'],
    },
  ],
};

export const DELETE_ACCOUNT_TR: LegalDoc = {
  title: 'Hesabını sil',
  lead: 'Sudoku Fight hesabını nasıl silebileceğin ve verilerine ne olacağı.',
  sections: [
    {
      id: 'in-app',
      title: 'Uygulamada (anında)',
      blocks: [
        {
          list: [
            'Sudoku Fight uygulamasını aç ve **Ayarlar** bölümüne git.',
            '**Hesabı sil** seçeneğine dokun ve onayla.',
            'Şifreni gir ya da Google ile giriş yapıyorsan Google hesabını yeniden seç. Hesap hemen silinir ve uygulama giriş ekranına döner.',
          ],
          ordered: true,
        },
      ],
    },
    {
      id: 'by-email',
      title: 'Uygulama olmadan',
      blocks: [
        '**Hesabının e-posta adresinden** {email} adresine, “Hesabımı sil” konusu ve görünen adınla yaz. Talebin hesabın sahibinden geldiğinden emin olur ve hesabı 30 gün içinde sileriz. İşlem tamamlandığında bunu e-postayla onaylarız.',
      ],
    },
    {
      id: 'what',
      title: 'Neler silinir, neler kalır',
      blocks: [
        {
          list: [
            '**Hemen silinir:** e-posta adresin, ülken, avatarın, girişin (Firebase’de de) ve hesabınla kurulumların arasındaki bağlantı. Görünen adın anonim bir kimlikle değiştirilir ve başkaları tarafından seçilebilir hâle gelir.',
            '**Anonim olarak saklanır:** dereceli maçlar, dereceler, XP, antrenman sonuçları, adil oyun kayıtları ve kullanım verileri. Bunlar artık seninle ilişkili değildir, ama diğer oyuncuların maçları ve sıralama tabloları eksiksiz kalır.',
            '**Telefonunda:** telefonundaki antrenman maçları, uygulamayı kaldırana kadar orada kalır.',
            '**Google’da:** çökme raporları 90 güne kadar, Analytics verileri ise belirlenen saklama süresi boyunca saklanır.',
          ],
        },
        'Daha fazlası için [Gizlilik Politikası](privacy) sayfasına bak.',
      ],
    },
  ],
};

/** The three documents, keyed as render.ts LEGAL_TEXTS is. */
export const LEGAL_TEXTS_TR: Record<LegalDocId, LegalDoc> = {
  privacy: PRIVACY_TR,
  terms: TERMS_TR,
  'delete-account': DELETE_ACCOUNT_TR,
};
