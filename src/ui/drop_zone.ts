import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { i18n } from '../core/i18n';

export interface DetectionResult {
    path: string;
    filename: string;
    installer_type: string;
    size_bytes: number;
    is_executable: boolean;
    requires_root: boolean;
    warning: string | null;
}

export class DropZone {
    private container: HTMLElement;
    private onFileDetected: (result: DetectionResult) => void;

    constructor(containerId: string, onFileDetected: (result: DetectionResult) => void) {
        const el = document.getElementById(containerId);
        if (!el) throw new Error(`Container ${containerId} not found`);
        this.container = el;
        this.onFileDetected = onFileDetected;
        this.init();
    }

    private init() {
        // Prevent default drag behaviors
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            this.container.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        // Highlight drop zone when dragging over
        ['dragenter', 'dragover'].forEach(eventName => {
            this.container.addEventListener(eventName, () => {
                this.container.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            this.container.addEventListener(eventName, () => {
                this.container.classList.remove('drag-over');
            });
        });

        // Handle drop in webview (fallback message)
        this.container.addEventListener('drop', () => {
            this.showMessage(i18n.t('dropzone.use_dialog') || 'Dosya seçmek için butona tıklayın', 'info');
        });

        // Click to open file dialog
        this.container.addEventListener('click', (e) => {
            // Don't trigger if clicking the button (button has its own handler)
            if ((e.target as HTMLElement).classList.contains('drop-button')) return;
            this.openFileDialog();
        });

        this.render();

        // Tauri drag-drop event provides full paths
        listen('tauri://drag-drop', (event: any) => {
            const payload = event?.payload as { paths?: string[] } | undefined;
            const path = payload?.paths?.[0];
            if (!path) {
                return;
            }
            this.detectFile(path).catch(err => {
                console.error('Detection error:', err);
                this.showMessage(`Hata: ${err}`, 'error');
            });
        }).catch(console.error);
    }

    private render() {
        this.container.innerHTML = `
            <div class="drop-content">
                <div class="drop-icon">📦</div>
                <p class="drop-title">${i18n.t('dropzone.title') || 'Kurulum dosyalarını buraya sürükleyin'}</p>
                <p class="drop-subtitle">${i18n.t('dropzone.subtitle') || '.deb, .rpm, .AppImage, .sh, .tar.gz'}</p>
                <button class="drop-button">${i18n.t('dropzone.browse') || 'Dosya Seç'}</button>
            </div>
        `;

        // Add click handler for button
        const button = this.container.querySelector('.drop-button');
        button?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openFileDialog();
        });
    }

    private async openFileDialog() {
        try {
            // Use Tauri's native file dialog
            const selected = await open({
                multiple: false,
                filters: [{
                    name: 'Installer Files',
                    extensions: ['deb', 'rpm', 'AppImage', 'appimage', 'sh', 'tar.gz', 'tar.xz', 'tar.bz2', 'tgz', 'zip', 'pkg.tar.zst', 'pkg.tar.xz']
                }]
            });

            if (selected && typeof selected === 'string') {
                // Single file selected
                await this.detectFile(selected);
            }
        } catch (err) {
            console.error('File dialog error:', err);
            this.showMessage(`Hata: ${err}`, 'error');
        }
    }

    public async detectFile(filePath: string): Promise<void> {
        try {
            this.showMessage(i18n.t('dropzone.detecting') || 'Dosya algılanıyor...', 'info');

            const result = await invoke<DetectionResult>('detect_file', { path: filePath });

            this.showDetectionResult(result);
            this.onFileDetected(result);
        } catch (err) {
            console.error('Detection error:', err);
            this.showMessage(`Hata: ${err}`, 'error');
        }
    }

    private showDetectionResult(result: DetectionResult) {
        const typeLabels: Record<string, string> = {
            'AppImage': 'AppImage',
            'Deb': 'Debian Paketi (.deb)',
            'Rpm': 'RPM Paketi (.rpm)',
            'ArchPkg': 'Arch Linux Paketi (.pkg.tar.zst)',
            'Script': 'Shell Script (.sh)',
            'TarGz': 'Sıkıştırılmış Arşiv (.tar.gz)',
            'TarXz': 'Sıkıştırılmış Arşiv (.tar.xz)',
            'TarBz2': 'Sıkıştırılmış Arşiv (.tar.bz2)',
            'TarZst': 'Sıkıştırılmış Arşiv (.tar.zst)',
            'Zip': 'Zip Arşivi (.zip)',
            'Unknown': 'Bilinmeyen'
        };

        const sizeFormatted = this.formatBytes(result.size_bytes);
        const typeLabel = typeLabels[result.installer_type] || result.installer_type;

        const html = `
            <div class="detection-result">
                <div class="file-icon">${this.getIconForType(result.installer_type)}</div>
                <div class="file-info">
                    <h3>${result.filename}</h3>
                    <p><strong>Tür:</strong> ${typeLabel}</p>
                    <p><strong>Boyut:</strong> ${sizeFormatted}</p>
                    ${result.requires_root ? '<p class="warning">⚠️ Root yetkisi gerektirir</p>' : ''}
                    ${result.warning ? `<p class="warning">⚠️ ${result.warning}</p>` : ''}
                </div>
            </div>
            <button class="drop-button reset-btn" style="margin-top: 16px;">${i18n.t('dropzone.browse') || 'Başka Dosya Seç'}</button>
        `;

        this.container.innerHTML = html;

        // Re-attach button handler
        const button = this.container.querySelector('.reset-btn');
        button?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.render();
            this.openFileDialog();
        });
    }

    private getIconForType(type: string): string {
        const icons: Record<string, string> = {
            'AppImage': '📦',
            'Deb': '🔷',
            'Rpm': '🔶',
            'ArchPkg': '🏔️',
            'Script': '📜',
            'TarGz': '🗜️',
            'TarXz': '🗜️',
            'TarBz2': '🗜️',
            'TarZst': '🗜️',
            'Zip': '🗜️',
            'Unknown': '❓'
        };
        return icons[type] || '📦';
    }

    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    private showMessage(message: string, type: 'info' | 'error' = 'info') {
        // Remove existing messages
        this.container.querySelectorAll('.drop-message').forEach(el => el.remove());

        const msgEl = document.createElement('div');
        msgEl.className = `drop-message ${type}`;
        msgEl.textContent = message;
        this.container.appendChild(msgEl);

        setTimeout(() => msgEl.remove(), 3000);
    }
}
