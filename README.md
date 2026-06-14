<div align="center">
  <img src="iconlar/icon-128.png" alt="Linux Install Manager logosu" width="112">
  <h1>Linux Install Manager</h1>
  <p>Linux kurulum dosyalarını analiz eden, kurulumu görünür bir terminalde çalıştıran ve işlemleri kaydeden masaüstü uygulaması.</p>

  ![Sürüm](https://img.shields.io/badge/version-1.0.0-2563eb)
  ![Platform](https://img.shields.io/badge/platform-Linux-f59e0b)
  ![Tauri](https://img.shields.io/badge/Tauri-2-24c8db)
  ![Rust](https://img.shields.io/badge/backend-Rust-b7410e)
</div>

## Genel Bakış

Linux Install Manager; farklı Linux dağıtımlarındaki kurulum dosyalarını tek bir arayüzden yönetmek için geliştirilmiştir. Kurulum komutunu çalıştırmadan önce paket bilgilerini ve uygulanacak adımları gösterir. Parola soruları ve paket yöneticisi çıktıları gömülü terminal üzerinden takip edilebilir.

## Özellikler

- Dosya seçme veya sürükleyip bırakma ile kurulum
- `.deb`, `.rpm`, Arch paketleri ve AppImage desteği
- Kurulum öncesinde paket adı, sürüm, mimari, yayıncı, boyut ve dosya listesi
- Riskli shell komutları için güvenlik analizi ve uyarılar
- Kurulum planını ve çalıştırılacak komutu önceden görüntüleme
- `sudo` parola girişini destekleyen etkileşimli terminal
- Terminal işlem kuyruğu, iptal, yeniden deneme, temizleme ve çıktı kopyalama
- Kurulum/kaldırma başladığında ve tamamlandığında masaüstü bildirimi
- Kurulum sonrasında programı açma ve konumunu gösterme
- Kurulu program kayıtları, gerçek sistem durumunu yeniden tarama ve kaldırma
- Kurulum, kaldırma, onarım ve terminal işlem geçmişi
- Dağıtım, masaüstü, çekirdek, paket yöneticisi, disk ve güncelleme bilgileri
- APT, DNF, Pacman ve Zypper için sistem bakım araçları
- Açık/koyu/sistem teması
- Türkçe, İngilizce, Almanca, İspanyolca, Fransızca, İtalyanca ve Portekizce
- Desteklenen kurulum dosyalarını çift tıklamayla açmak için dosya ilişkilendirmeleri

## Desteklenen Dosyalar

| Dosya türü | İşlem |
| --- | --- |
| `.deb` | `apt` üzerinden kurulum |
| `.rpm` | `dnf` üzerinden kurulum |
| `.pkg.tar.zst`, `.pkg.tar.xz` | `pacman` üzerinden kurulum |
| `.AppImage` | `~/Applications` dizinine kurulum ve masaüstü kısayolu |
| `.sh` | İçerik ve risk analizi, kullanıcı onayıyla terminalde çalıştırma |
| `.tar.gz`, `.tgz`, `.tar.xz`, `.tar.bz2`, `.tar.zst`, `.zip` | Kullanıcının seçtiği dizine arşiv çıkarma |

> Paketler kendi dağıtımlarının paket yöneticisini gerektirir. Örneğin `.deb` kurulumu Debian/Ubuntu tabanlı, `.rpm` kurulumu Fedora/RHEL tabanlı sistemlerde kullanılmalıdır.

## Hazır Paketlerle Kurulum

En güncel paketleri [GitHub Releases](https://github.com/xinzore/Linux-Install-Manager/releases) sayfasından veya bu deponun [`release`](release/) dizininden indirebilirsiniz.

### Debian / Ubuntu / Linux Mint

```bash
sudo apt install ./linux-install-manager_1.0.0_amd64.deb
```

### Fedora / RHEL Tabanlı Dağıtımlar

```bash
sudo dnf install ./linux-install-manager-1.0.0-1.x86_64.rpm
```

### Arch Linux / Manjaro

```bash
sudo pacman -U ./linux-install-manager-1.0.0-1-x86_64.pkg.tar.zst
```

## Kaynaktan Çalıştırma

Gereksinimler:

- Node.js 18 veya üzeri
- npm
- Güncel kararlı Rust araç zinciri
- Tauri 2 için WebKitGTK ve sistem geliştirme paketleri

Depoyu klonlayın ve bağımlılıkları kurun:

```bash
git clone https://github.com/xinzore/Linux-Install-Manager.git
cd Linux-Install-Manager
npm install
npm run tauri dev
```

Sadece web arayüzünü geliştirme modunda çalıştırmak için:

```bash
npm run dev
```

## Paket Oluşturma

TypeScript üretim derlemesi:

```bash
npm run build
```

DEB ve RPM paketleri:

```bash
npm run tauri build -- --bundles deb,rpm
```

Arch Linux paketi:

```bash
./packaging/arch/build-arch-pkg.sh
```

Arch paketleme betiği `makepkg` kullanır ve eksik derleme bağımlılıklarını sistem paket yöneticisi üzerinden kurabilir.

## Test ve Doğrulama

```bash
npm run build
cd src-tauri
cargo check
cargo fmt --check
cargo test
```

## Mimari

```text
Vanilla TypeScript + HTML/CSS
            │
            │ Tauri invoke ve event API
            ▼
       Rust / Tauri 2
            │
            │ portable-pty
            ▼
 Etkileşimli Bash terminali
```

Temel teknolojiler: Tauri 2, Rust, TypeScript, Vite, xterm.js ve portable-pty.

## Güvenlik

Uygulama çalıştırılacak komutu kurulumdan önce gösterir ve terminal çıktısını gizlemez. Shell scriptlerinde geniş kapsamlı silme, ağdan kod indirme, yönetici yetkisi kullanma, sistem dizinlerine yazma ve düşük seviyeli disk işlemleri gibi kalıpları işaretler.

Bu kontroller kesin bir güvenlik garantisi değildir. Kaynağına güvenmediğiniz paketleri veya scriptleri çalıştırmadan önce içeriğini ayrıca inceleyin.

## Proje Yapısı

```text
src/                 TypeScript kullanıcı arayüzü
src-tauri/           Rust backend ve Tauri yapılandırması
src/i18n/            Dil dosyaları
packaging/arch/      Arch Linux paketleme dosyaları
release/             Hazır DEB, RPM ve Arch paketleri
iconlar/             Uygulama simgeleri
```

## Katkıda Bulunma

Hata bildirimi ve geliştirme önerileri için GitHub Issues kullanılabilir. Kod değişikliği göndermeden önce üretim derlemesini ve Rust testlerini çalıştırın.

## Lisans

Bu depoda henüz bir lisans dosyası bulunmamaktadır. Lisans belirlenene kadar kaynak kodun kullanım ve dağıtım koşulları açık kaynak lisansıyla güvence altına alınmış sayılmaz.
