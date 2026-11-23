# Geliştirme ve test araçları

Bu araçlar paketin parçası değil (`includeFiles` dışında kalıyorlar). Island'ı elle test etmek ve hata ayıklamak için kullanılıyor.

| Dosya | Ne işe yarar | Kullanım |
|---|---|---|
| `ui.ps1` | Ekran görüntüsü (`Save-Shot`), tuş (`Send-Keys`, `Send-Text`), tıklama (`Invoke-Click`) ve öndeki pencerenin başlığı (`Get-ForegroundTitle`). Fiziksel piksellerle çalışır. Görüntüler `%TEMP%\kotilo-shots` altına kaydedilir. | `. .\tools\dev\ui.ps1` |
| `cdp-trace.mjs` | Island sayfasına Chrome DevTools Protokolü ile bağlanır. Odak, blur, tuş, tıklama ve görünüm değişimlerini konsol çıktısıyla birlikte kaydeder. | `node tools/dev/cdp-trace.mjs <ws-url> 6000` |
| `cdp-eval.mjs` | Island sayfasında tek bir JS ifadesi çalıştırıp sonucu yazar. | `node tools/dev/cdp-eval.mjs <ws-url> "<ifade>"` |
| `test_privileges.py` | `zpack.json` içindeki island komut izinlerini (regex) izinli ve yasak çağrılarla test eder. | `python -I tools/dev/test_privileges.py zpack.json` |

## DevTools'a bağlanmak

1. Zebar'ı hata ayıklama portuyla başlat:
   ```powershell
   Stop-Process -Name zebar -Force
   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9333 --remote-allow-origins=http://127.0.0.1'
   Start-Process "C:\Program Files\glzr.io\Zebar\zebar.exe"; Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
   ```
2. `http://127.0.0.1:9333/json` adresinden `kotilo island` sayfasının `webSocketDebuggerUrl` değerini al.
3. İş bitince Zebar'ı portsuz, normal şekilde yeniden başlat.

## Test kuralları (bkz. `tasks/lessons.md`)

- Metin veya Enter göndermeden önce öndeki pencerenin `Zebar - kotilo-zebar-pack / island` olduğunu kontrol et.
- Test metni hiçbir şeyle eşleşmesin ("zz"). Güç düğmelerine ve geçmişi silen komutlara test sırasında basma.
- Kullanıcı bilgisayarı kullanırken uzun testlerden kaçın, testten önce haber ver.
