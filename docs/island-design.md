# Dinamik island tasarımı (kotilo-zebar-pack)

Son güncelleme: 2026-11-22. Durum: **onaylandı, ilk sürüm uygulandı.** Yerleşim: island + iki yanda ince bar. Arayüz dili İngilizce.

## 1. Referans: Vyntaris'te island nasıl çalışıyor

Kaynak: https://github.com/vyntaris/vyntaris (Arch Linux, Hyprland ve Quickshell/QML ile yazılmış bir masaüstü
kabuğu). Lisansı **GPL-3.0**, bu yüzden koddan kopya almıyoruz. Yalnızca fikri ve davranışı kendi React
kodumuzla yeniden kuruyoruz.

İncelenen dosyalar: `config/quickshell/modules/bar/Bar.qml`, `services/Panels.qml`, `services/Activities.qml`,
`services/Osd.qml`, `config/Theme.qml`, `config/Motion.js`, `config/Palettes.js`, README ve ekran görüntüleri.

| Fikir | Vyntaris'teki karşılığı | Bizdeki karşılığı |
|---|---|---|
| Ekranın üst ortasında duran tek bir "ada". Dinlenirken saati gösterir. | Bar'ın ortasındaki island, `ClockView` | Ayrı bir Zebar widget'ı: `island` |
| Ada, açılan panele göre büyür, panel kapanınca saate geri döner. | `islandWidth` / `islandHang` değerleri aktif görünümden gelir ve animasyonla değişir | Her görünüm kendi genişlik/yüksekliğini bildirir. Kabuk (shell) şekli CSS ile, pencereyi Tauri ile boyutlandırır |
| Aynı anda tek panel açık. Esc veya dışarı tıklama kapatır. | `Panels.only(name)` diğer bütün panelleri kapatır | Tek bir `openPanel` durumu. Pencere odağı kaybedince kapanır |
| Öncelik sırası | `mode` = geri sayım > ekran görüntüsü > açık panel > canlı aktivite > OSD > bildirim > oyun > saat | Aynı mantıkta tek bir `resolveMode()` fonksiyonu |
| Canlı aktiviteler | İndirme hızı, sayaç, paket kurulumu saatin yanında küçük şerit olarak görünür | Medya çalarken şarkı, sayaç/kronometre, yüksek CPU uyarısı |
| OSD (ekran göstergesi) | Ses, parlaklık, klavye düzeni değişince ada 1,6 sn kısa gösterge olur | Ses seviyesi, sessize alma, klavye düzeni, medya parça değişimi |
| Banner | `Activities.banner(icon, title, sub, progress, color, ms)` birkaç saniye görünür | Aynı imzada `banner()` fonksiyonu |
| Hareket | Panel açılışı 500 ms, kapanışı 260 ms. İçerik 90 ms gecikmeyle gelir, kapanırken 80 ms'de gider. Büyürken önce şekil, küçülürken önce içerik | Aynı süre ve eğriler (CSS `cubic-bezier`) |
| Görünüm | Koyu zemin, mor vurgu rengi (Catppuccin "mauve" `#cba6f7`), ince açık mor kenar, yuvarlak köşeli kartlar, noktalı göstergeler | Aynı dil. Catppuccin MIT lisanslı, renkleri kullanabiliriz |
| Ada şekilleri | Notch (omuzları yuvarlak), trapez, düz | İlk sürümde notch. Diğerleri sonra ayar olarak eklenebilir |

## 2. Zebar'da nasıl mümkün oluyor (doğrulandı)

Zebar'da her widget ayrı bir pencere. Pencerenin şeffaf kısmı da tıklamaları yakalar, yani alttaki pencerelere
tıklanamaz. Bu yüzden "büyük şeffaf pencere içinde küçük ada" yaklaşımı kullanılamaz. Pencerenin adayla birlikte
büyüyüp küçülmesi gerekir.

Doğrulananlar:
- `zebar@3.1.1` paketinin tip tanımında `currentWidget().tauriWindow` var (Tauri'nin pencere nesnesi).
- Zebar 3.1.1'in widget yetki dosyası (`packages/desktop/capabilities/widget.json`, v3.1.1 etiketi)
  `core:window:allow-set-size` ve `core:window:allow-set-position` izinlerini veriyor.
- `allow-set-ignore-cursor-events` (tıklamaları alttaki pencereye geçirme) **yok**. Bu yüzden boyutlandırma şart.

Animasyon yöntemi:
- Büyürken önce pencere hedef boyuta getirilir (fazlası şeffaftır). Ardından ada şekli CSS ile büyür ve
  içerik gelir.
- Küçülürken önce içerik gider, sonra şekil küçülür. Animasyon bitince pencere küçültülür.
- Pencere her zaman ekranın üst ortasına hizalanır (`setPosition`). Bu yüzden genişlik değişince x konumu da
  yeniden hesaplanır.

Henüz doğrulanmayanlar (ilk prototipte test edilecek):
- `setSize` çağrısının ekranda titreme yapıp yapmadığı.
- Ekran ölçeklemesi (DPI) farklı olan ikinci monitörde konumun doğru çıkıp çıkmadığı.
- `focused: false` ayarlı pencereye tıklayınca odak gelip gelmediği. "Dışarı tıklayınca kapan" davranışı buna
  bağlı.

## 3. Mimari

```
kotilo-zebar-pack/              (dev klasörü, ~/.glzr/zebar/kotilo-zebar-pack buna junction ile bağlı)
├─ zpack.json                   widget listesi: island (+ ileride bar)
├─ island/                      Vite + React + TypeScript
│  ├─ src/
│  │  ├─ main.tsx
│  │  ├─ shell/                 IslandShell: şekil, animasyon, pencere boyutlandırma
│  │  ├─ state/                 store: openPanel, banner, osd; resolveMode()
│  │  ├─ providers/             zebar provider'larını React'e bağlayan hook'lar
│  │  ├─ views/                 ClockView, MediaView, ControlView, OsdView, ActivityView ...
│  │  ├─ components/            Tile, DottedMeter, Ring, MonthCalendar ...
│  │  └─ theme/                 renkler (CSS değişkenleri), süreler, eğriler
│  └─ dist/                     build çıktısı; zpack.json bunu gösterir
└─ docs/, tasks/
```

Her görünüm bir bileşen ve bir boyut bildirimi:

```ts
type IslandView = {
  id: 'clock' | 'control' | 'media' | 'osd' | ...;
  size: { width: number; height: number };   // adanın o görünümdeki boyutu (px)
  Component: React.FC;
};
```

Klavye kısayolu: Zebar'ın kendi global kısayol desteği yok. Yöntem olarak GlazeWM'in "binding mode" özelliği
kullanılabilir. GlazeWM'de `alt+space` gibi bir tuş `wm-enable-binding-mode --name island` çalıştırır, island
`glazewm` provider'ının `bindingModes` listesinde bunu görüp kontrol merkezini açar ve modu kapatır. Bu yöntem
denenmedi, ilk prototipten sonra test edilecek.

## 4. Windows'ta neyi yapabiliriz

| Görünüm | Veri kaynağı | Yapılabilir mi |
|---|---|---|
| Saat (dinlenme hali) | `date` provider | Evet |
| GlazeWM çalışma alanları | `glazewm` provider, `runCommand` | Evet |
| Medya (kapak hariç başlık, sanatçı, oynat/duraklat, ileri/geri) | `media` provider | Evet. Kapak resmi provider'da yok |
| Ses seviyesi ve OSD | `audio` provider (`setVolume`, cihaz listesi) | Evet |
| Klavye düzeni OSD'si | `keyboard` provider | Evet |
| CPU, RAM, pil, disk göstergeleri | `cpu`, `memory`, `battery`, `disk` | Evet |
| Ağ durumu | `network` provider | Gösterim evet, Wi-Fi'ye bağlanma hayır |
| Hava durumu | `weather` provider | Evet (konum IP'den veya elle) |
| Takvim | Saf JS | Evet |
| Sayaç ve kronometre | Saf JS | Evet |
| Systray simgeleri | `systray` provider | Evet |
| Güç menüsü (kilitle, uyku, yeniden başlat, kapat) | `shellExec` + `privileges.shellCommands` | Evet, izin tanımıyla |
| Uygulama başlatıcı (launcher) | `shellExec` ile Başlat menüsü kısayollarını tarama | Kısmen, sonraki aşama |
| Windows bildirimleri | Zebar'da provider yok | Hayır (şimdilik) |
| Bluetooth, parlaklık, gece ışığı | Provider yok | Hayır, ya da PowerShell ile sınırlı |

## 5. Önerilen ilk sürüm (MVP)

1. Kabuk: notch şeklindeki ada, pencere boyutlandırma, büyüme/küçülme animasyonu, öncelik sırası.
2. Saat görünümü (dinlenme hali) ve solda/sağda küçük durum noktaları (medya çalıyor, pil düşük vb.).
3. OSD: ses seviyesi ve klavye düzeni değişince kısa gösterge.
4. Kontrol merkezi (tıklayınca açılır): ses kaydırıcısı, CPU/RAM/pil halkaları, takvim ve hava durumu, medya
   kartı.
5. Medya canlı aktivitesi: müzik çalarken saatin yanında şarkı adı.
