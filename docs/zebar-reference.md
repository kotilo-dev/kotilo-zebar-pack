# Zebar widget pack geliştirme rehberi (kotilo-zebar-pack)

Son güncelleme: 2026-11-22. Kurulu sürüm: **Zebar 3.1.1** (`C:\Program Files\glzr.io\Zebar\zebar.exe`).
GitHub'daki son sürüm: **3.3.1**. Bu belgedeki bilgilerin kaynağı aşağıdaki "Kaynaklar" bölümünde.

## 1. Temel kavramlar

| Kavram | Anlamı |
|---|---|
| Zebar | GlazeWM ekibinin (glzr.io) masaüstü widget motoru. Her widget, Tauri ile açılan şeffaf bir WebView2 penceresidir. Yani widget = HTML + CSS + JS. |
| GlazeWM | Döşemeli (tiling) pencere yöneticisi. Zebar'ı `startup_commands` ile başlatır. |
| Pack (paket) | Bir veya daha çok widget'ı içeren klasör. Kökünde `zpack.json` bulunur. |
| Widget | Paket içindeki bir HTML dosyası ve onun pencere ayarları (`zpack.json` içindeki `widgets[]` girdisi). |
| Preset | Bir widget'ın ekrandaki konumu, boyutu ve hangi monitörde açılacağı. Bir widget'ın birden çok preset'i olabilir. |
| Provider | Zebar'ın JS kütüphanesindeki veri kaynakları (CPU, pil, GlazeWM durumu vb.). Widget bunlara abone olur. |

## 2. Dosya konumları (bu makinede doğrulandı)

| Yol | İçerik |
|---|---|
| `~/.glzr/zebar/` | Zebar'ın paketleri aradığı klasör. Yalnızca **bir seviye** derine bakar: `~/.glzr/zebar/<pack>/zpack.json`. |
| `~/.glzr/zebar/kotilo-zebar-pack/` | GUI ile açtığın paket. İçinde `zpack.json` (widget listesi boş), `README.md`, `.gitignore`, `resources/preview-image-1.png` ve boş bir git deposu var. |
| `~/.glzr/zebar/settings.json` | Açılışta hangi widget'ın hangi preset'le başlayacağı (`startupConfigs`). Şu an `glzr-io.starter / with-glazewm / default`. |
| `%AppData%\zebar\downloads\` | Marketplace'ten indirilen paketler. Değiştirilecekse `~/.glzr/zebar/` altına kopyalanmalı. |
| `C:\Program Files\glzr.io\Zebar\_up_\_up_\resources\` | Kurulumla gelen `zpack-schema.json`, `settings-schema.json`, `starter` paketi ve şablonlar (`react-buildless`, `solid-ts`). |
| `~/.glzr/glazewm/config.yaml` | GlazeWM ayarı. Zebar'ı başlatır/kapatır, üst boşluk (`outer_gap.top: 45px`) bar için ayrılmış. |

## 3. `zpack.json` yapısı

Pakette zorunlu alanlar: `name`, `version`, `widgets`. İsteğe bağlı: `description`, `tags[]`, `previewImages[]`, `repositoryUrl`.

Widget girdisi (zorunlu alanlar kalın):

| Alan | Değer | Açıklama |
|---|---|---|
| **name** | string | Widget adı, tray menüsünde görünür. |
| **htmlPath** | `./bar/index.html` | Paket köküne göre HTML yolu. Build kullanan widget'ta `./<widget>/dist/index.html`. |
| **zOrder** | `top_most` / `normal` / `bottom_most` | Pencere katmanı. Bar için `normal` veya `top_most`, masaüstü widget'ı için `bottom_most`. |
| **shownInTaskbar** | bool | Görev çubuğunda görünsün mü. Genelde `false`. |
| **focused** | bool | Açılışta odak alsın mı. Genelde `false`. |
| **resizable** | bool | Kullanıcı boyutlandırabilsin mi. |
| **transparent** | bool | Arka plan şeffaf mı. Yuvarlak köşe ve blur efektleri için `true`. |
| includeFiles | `["*.html","*.css"]` | Yayınlarken pakete dahil edilecek dosyalar (glob). |
| caching | `{ defaultDuration: 604800, rules: [{urlRegex, duration}] }` | Uzak kaynakların (CDN, font) önbellek süresi, saniye. |
| privileges.shellCommands | `[{ program: "powershell", argsRegex: ".*" }]` | Widget'ın `shellExec`/`shellSpawn` ile çalıştırabileceği programlar. Burada izin verilmeyen komut çalışmaz. |
| **presets** | dizi | Aşağıdaki tablo. |

Preset alanları:

| Alan | Değer |
|---|---|
| name | `default`, `secondary-monitor` gibi |
| anchor | `top_left`, `top_center`, `top_right`, `center_left`, `center`, `center_right`, `bottom_left`, `bottom_center`, `bottom_right` |
| offsetX / offsetY / width / height | CSS benzeri string: `"0px"`, `"100%"`, `"40px"` |
| monitorSelection | `{type:"all"}`, `{type:"primary"}`, `{type:"secondary"}`, `{type:"index", match:0}`, `{type:"name", match:"\\\\.\\DISPLAY1"}` |
| dockToEdge | `{ enabled, edge: "top"/"right"/"bottom"/"left"/null, windowMargin: "0px" }`. Etkinse Windows çalışma alanını widget kadar daraltır, böylece pencereler barın altına girmez. |

## 4. JS API (`zebar` npm paketi)

İki kullanım biçimi var:

- **Buildless (derlemesiz):** HTML içinde `import * as zebar from 'https://esm.sh/zebar@3.0'`. Starter paket React'ı bu yolla ve tarayıcıda Babel ile çalıştırıyor. Kurulum gerektirmez ama ilk açılış yavaştır ve internet ister (önbelleğe alınır).
- **Build'li:** `npm i zebar`, Vite ile `dist/` üretilir, `htmlPath` `dist/index.html`'i gösterir. `solid-ts` şablonu bu yolu kullanıyor (`vite build --watch` ile geliştirme). Vite ayarında `base: './'` zorunlu, çünkü dosyalar göreli yoldan yüklenir.

Temel fonksiyonlar:

| Fonksiyon | Ne yapar |
|---|---|
| `createProviderGroup({ ad: { type, ...ayar } })` | Birden çok provider'ı tek nesnede toplar. `outputMap`, `errorMap`, `onOutput(cb)`, `onError(cb)`, `restartAll()`, `stopAll()` verir. |
| `createProvider({ type, ...ayar })` | Tek provider. `output`, `onOutput`, `onError`. |
| `currentWidget()` | `{ id, name, packId, configPath, htmlPath, tauriWindow, isPreview, setZOrder(), close() }`. `tauriWindow` Tauri'nin pencere nesnesi (`zebar@3.1.1` tip tanımından doğrulandı). |
| `startWidget(name, placement, {packId?})`, `startWidgetPreset(name, presetName, {packId?})` | Başka bir widget'ı açar (tip tanımından doğrulandı). |
| `shellExec(program, args?, options?)` / `shellSpawn(...)` | Komut çalıştırır; `shellSpawn` `onStdout`, `onExit`, `kill`, `write` veren bir süreç döndürür. `privileges.shellCommands` izni yoksa hata fırlatır. |

Widget penceresinin Tauri yetkileri (Zebar v3.1.1, `packages/desktop/capabilities/widget.json`): `center`, `close`,
`hide`, `show`, `maximize`, `minimize`, `set-skip-taskbar`, `set-always-on-bottom`, `set-always-on-top`,
`set-resizable`, **`set-position`**, **`set-size`**, `set-title`. `set-ignore-cursor-events` yok, yani şeffaf alan da
tıklamayı yakalar.

## 5. Provider listesi

| type | Ayar (varsayılan) | Önemli çıktılar | Fonksiyonlar |
|---|---|---|---|
| glazewm | yok | `currentWorkspaces`, `focusedWorkspace`, `displayedWorkspace`, `allWorkspaces`, `allMonitors`, `currentMonitor`, `focusedContainer`, `tilingDirection`, `bindingModes`, `isPaused`, `allWindows` | `runCommand("focus --workspace 1")` |
| komorebi | yok | Çalışma alanı ve monitör bilgisi | – |
| cpu | `refreshInterval` 5000 ms | `usage`, `frequency`, `logicalCoreCount`, `physicalCoreCount`, `vendor` | – |
| memory | `refreshInterval` 5000 | `usage`, `usedMemory`, `totalMemory`, `freeMemory`, swap alanları | – |
| battery | `refreshInterval` 5000 | `chargePercent`, `isCharging`, `state`, `timeTillEmpty`, `timeTillFull`, `healthPercent`, `powerConsumption` | – |
| date | `formatting` (`EEE d MMM t`, Luxon), `timezone`, `locale` (ör. `tr`), `refreshInterval` 1000 | `formatted`, `new`, `now`, `iso` | – |
| disk | `refreshInterval` 60000 | `disks[]`: `name`, `mountPoint`, `totalSpace`, `availableSpace` (bytes, siValue, siUnit…) | – |
| network | `refreshInterval` 5000 | `defaultInterface` (`type`: ethernet/wifi/…), `defaultGateway` (`ssid`, `signalStrength`), trafik | – |
| ip | `refreshInterval` 1 saat | `address`, `approxCity`, `approxCountry` | – |
| weather | `latitude`, `longitude` (yoksa IP'den), `refreshInterval` | `status` (12 değer: `clear_day` … `thunder_night`), `celsiusTemp`, `windSpeed`, `isDaytime` | – |
| host | `refreshInterval` 60000 | `hostname`, `osName`, `friendlyOsVersion`, `uptime` | – |
| keyboard | `refreshInterval` 5000 | `layout` (ör. `tr-TR`) | – |
| audio | yok | `defaultPlaybackDevice` (`name`, `volume`), cihaz listeleri | `setVolume(0-100, {deviceId?})` |
| media | yok | `currentSession` (`title`, `artist`, `isPlaying`, `position`…), `allSessions` | `play`, `pause`, `togglePlayPause`, `next`, `previous` |
| systray | yok | `icons[]`: `id`, `iconUrl`, `tooltip` | `onLeftClick(id)`, `onRightClick(id)`, `onLeftDoubleClick`, `onMiddleClick`, hover olayları |

Not: Kurulu sürüm 3.1.1. `audio`, `media`, `systray` gibi bazı provider'ların 3.1.1'de tam olarak hangi alanlara sahip olduğu doğrudan doğrulanmadı. İlk widget'ta `console.log(output)` ile gerçek çıktıya bakılacak.

## 6. Geliştirme döngüsü

1. Paket klasöründe widget dosyalarını oluştur ve `zpack.json` `widgets[]` dizisine ekle.
2. Zebar tray simgesine sağ tık, `Widget packs > kotilo-zebar-pack > <widget> > <preset>` ile widget'ı aç. Aynı menüde `Run on startup` açılışta başlatmayı `settings.json`'a yazar.
3. Değişiklikten sonra widget'ı tray menüsünden yeniden başlat ya da Zebar'ı yeniden aç. Otomatik yeniden yükleme (hot reload) davranışı doğrulanmadı. Build'li widget'ta önce `npm run build` (veya `dev` ile watch) gerekir.
4. Hata ayıklama: WebView2 DevTools (widget penceresinde sağ tık veya F12; 3.1.1'de doğrulanacak) ve `~/.glzr/zebar/errors.log`.

## 7. GlazeWM ile entegrasyon

- `config.yaml`'da `startup_commands: ['shell-exec zebar']` ve `shutdown_commands: ['shell-exec taskkill /IM zebar.exe /F']` zaten var.
- `window_rules` içinde `window_process: { equals: 'zebar' }` kuralı Zebar pencerelerini döşemeden hariç tutuyor.
- `outer_gap.top: '45px'`, 40 px yüksekliğindeki bar için yer bırakıyor. Bar yüksekliği değişirse bu değer de değişmeli (ya da `dockToEdge` kullanılmalı).

## 8. İkonlar ve font

- Starter paket Nerd Font ikonlarını CSS'ten yüklüyor: `@import 'https://www.nerdfonts.com/assets/css/webfont.css';`, sınıflar `nf nf-md-wifi_strength_4` gibi. Liste: https://www.nerdfonts.com/cheat-sheet
- Bu makinede yerel Nerd Font kurulu görünmüyor, bu yüzden web fontu yolu çalışır. Çevrimdışı çalışmak istenirse font dosyası pakete gömülebilir.

## 9. Yayınlama (marketplace)

- https://glzr.io/api-token adresinden token alınır.
- Paket kökünde: `zebar publish --token <TOKEN>` (veya `ZEBAR_PUBLISH_TOKEN` ortam değişkeni).
- Seçenekler: `--pack-config`, `--version-override <semver>`, `--commit-sha`, `--release-notes`, `--release-url`.
- `includeFiles` yalnızca yayınlanacak dosyaları seçer; `node_modules` ve kaynak dosyalar dahil edilmemeli.

## Kaynaklar

- Yerelde okunanlar (doğrulanmış): kurulu `zpack-schema.json`, starter paket (`zpack.json`, `with-glazewm.html`, `styles.css`), şablonlar (`react-buildless`, `solid-ts`), `~/.glzr/zebar/*`, `~/.glzr/glazewm/config.yaml`.
- Web (alt ajan ile okundu): https://github.com/glzr-io/zebar (README), `packages/client-api/src/index.ts`, `create-provider.ts`, `create-provider-group.ts`, systray ve weather tip dosyaları, `MARKETPLACE.md`, releases.
- Doğrulanmayanlar: `currentWidget`/`shellExec`/`startWidget` imzaları, hot reload, DevTools kısayolu, bazı provider alanlarının 3.1.1'deki tam hali.

## 10. Zebar 3.1.1 tuzakları (bu projede bulundu, 2026-11-22)

| Tuzak | Belirti | Çözüm |
|---|---|---|
| `currentWidget().configPath` tanımsız | Tip tanımında var, ama masaüstü tarafı (`WidgetState`) bu alanı göndermiyor | Paket klasörü `htmlPath`'ten türetilir (`<pack>\dist\island.html` → iki üst klasör) |
| Widget durumundaki `windowHandle` görünür pencereye ait değil | Bu tutamaçla `SetForegroundWindow` görünmez "Tauri App" penceresini öne alıyor | Görünür pencere başlığından bulunur: `Zebar - <pack> / <widget>` |
| `shellSpawn(...).write()` hiç çalışmıyor | İstemci `shell_write` komutunu `{ processId }` ile çağırıyor, Rust komutu ise `pid` bekliyor | `invoke('shell_write', { pid, buffer })` doğrudan çağrılır (`src/island/system.ts`) |
| Widget'a `set-focus` izni yok | Kısayolla açılan panele yazı yazılamıyor, Esc çalışmıyor | `scripts/focus.ps1` kalıcı yardımcı: Alt hilesiyle `SetForegroundWindow` ve WebView'e sentetik tıklama mesajı |
| `overflow: hidden` sayfayı korumuyor | Pencere küçülürken odaktaki alan görünür kalsın diye sayfa kayıyor, ada yukarı kaymış çiziliyor | `overflow: clip` ve `focus({ preventScroll: true })` |
| `privileges.shellCommands` regex'i sabitlenmezse her şeye izin verir | Rust `Regex::is_match` kısmi eşleşmeyi kabul ediyor | Her kural `^...$` ile yazılır. Argümanlar boşlukla birleştirilip eşleştirilir |
| `zpack.json` değişikliği çalışan Zebar'a yansımıyor | `No widget named ... found` | Zebar yeniden başlatılır. Yalnızca `dist/` veya `scripts/` değiştiyse widget'ı yeniden açmak yeter |
| Sentetik Alt ile odak alma pencereyi menü moduna sokuyor | Konum çağrıları bir sonraki tuşa kadar gecikiyor, ada yanlış yerde açılıyor, odak düşüyor | Alt yerine sıfır mesafeli `mouse_event(MOVE, 0, 0)` |
| Tauri `onFocusChanged(false)` odağın WebView alt penceresine geçişinde de geliyor | Panel odak alır almaz kapanıyor | "Dışarı tıklama" için DOM `window` `blur` olayı |
| DOM `blur` de birkaç ms'lik odak sıçramalarında tetikleniyor | Odak yardımcısının tıklamasından sonra panel kapanıyor | Odak kaybını 150 ms sonra `document.hasFocus()` ile doğrula |
| Hata ayıklama | Widget konsolu görünmüyor | Zebar'ı `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` ile başlat, `http://127.0.0.1:9333/json` üzerinden CDP ile bağlan; iş bitince normal yeniden başlat |
| Windows PowerShell 5.1'de WinRT akışları genel COM nesnesi olarak geliyor | `AsStreamForRead` için "Cannot find an overload" hatası, görsel okunamıyor | Metodu yansımayla, parametre tipini (`IInputStream`) belirterek çağır |
| PowerShell'de `[Math]::Min(1, 0.33)` sonucu 0 | Tamsayı ilk argüman `Min(int, int)` aşırı yüklemesini seçtiriyor, önizleme 1×1 piksel çıkıyor | Sayıları ondalıklı yaz: `[Math]::Min(1.0, 160.0 / ...)` |
| Widget'ın `htmlPath`'i junction'ı değil hedefini gösteriyor | Betikler `~\.glzr\zebar\kotilo-zebar-pack\...` değil `C:\Users\<kullanıcı>\dev\kotilo-zebar-pack\...` yolundan çağrılıyor; izin kuralını `.glzr` yoluna sabitlemek bütün betikleri engeller | Kuralı paket klasörünün adına sabitle, yolda boşluk ve tırnağı yasakla (araya ikinci betik sokulamasın). Gerçek yolu çalışan yardımcıların komut satırından gör: `Get-CimInstance Win32_Process -Filter "Name='powershell.exe'"` |
| Zebar'ın regex motoru (Rust `regex`) lookahead desteklemiyor | `(?!...)` içeren kural geçersiz | "Şu hariç" kuralları karakter sınıflarıyla yaz (ör. `[^\\/" ]+`) |
| PowerShell'de .NET'e `$null` metin parametresi | `[IO.File]::Replace($tmp, $dest, $null)` "The path is not of a legal form" hatası veriyor: PowerShell `$null`'ı boş metne çeviriyor | `[NullString]::Value` geç |
| Bar ve ada aynı kaynakta (`http://127.0.0.1:6124`) | `localStorage` ortak; bir pencerede yazılan değer diğerinde `storage` olayıyla görünüyor | Tema seçimi `localStorage` + `storage` olayı (ve yedek olarak Tauri olayı) ile iki pencereye dağıtılıyor |
| Pencereyi taşıyıp boyutlandırmak iki ayrı çağrı (`setSize`, `setPosition`); Tauri 2.0.2'de `setBounds` yok | Panel kapanışının sonunda bir kare boyunca ada kesik/kaybolmuş görünüyor (titreme): pencere yeni dar boyutta ama hâlâ eski sol kenarında | Pencerenin sol kenarını sabitle, yalnızca boyutu değiştir (`LAYOUT_W`, `placeWindow(..., { centerAt })`); ada pencere içinde hep aynı noktada. Ölçüm: ekranın üst ortasından ~18 ms aralıkla kare kaydı, adanın genişliği kare kare |
| Bluetooth ses cihazında `BluetoothSetServiceState` ile "bağlantıyı kesme" | Ses aygıtı kayboluyor ama Bluetooth bağı (medya tuşları profili) açık kalıyor, `BluetoothGetDeviceInfo` "bağlı" demeye devam ediyor | Ses cihazında "bağlı" = bağ açık **ve** A2DP (`{0000110B-…}`) ya da Handsfree (`{0000111E-…}`) düğümü o an mevcut (`CM_Locate_DevNodeW` bayrak 0) |
| Hizmet açıkken cihaz bağlı değilse `BluetoothSetServiceState(ENABLE)` | Win32 hata 87 | Önce kapat, sonra aç; cihaz açıksa bağlanıyor |
| WinRT `DeviceInformation.FindAllAsync` ile Bluetooth "bağlı" bilgisi | Protokol başına ~30 sn; `Properties.Keys` boş görünüyor | Yoklama için kullanılmaz; kayıt defteri + bthprops + cfgmgr32 (istek başına 10-60 ms) |
| Kalıcı yardımcı cevabı ilk giren ilk çıkar eşleşmesine dayanıyor | Cevapsız kalan veya ikiye bölünen tek istek, sonraki bütün cevapları kaydırır | `lineHelper`: satır sonu içeren istek reddedilir, zaman aşımında ve yazma hatasında yardımcı öldürülüp bütün bekleyenler hata alır |
