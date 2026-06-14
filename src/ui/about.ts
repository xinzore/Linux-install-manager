import { i18n } from '../core/i18n';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';

export class AboutUI {
    private modal: HTMLElement | null;
    private btnOpen: HTMLElement | null;
    private btnClose: HTMLElement | null;
    private versionEl: HTMLElement | null;
    private version = '1.0.0';

    constructor() {
        this.modal = document.getElementById('about-modal');
        this.btnOpen = document.getElementById('btn-about');
        this.btnClose = document.getElementById('btn-close-about');
        this.versionEl = document.getElementById('about-version');

        this.init();
    }

    private init() {
        this.btnOpen?.addEventListener('click', () => this.open());
        this.btnClose?.addEventListener('click', () => this.close());
        this.modal?.querySelectorAll('a[href]')?.forEach(link => {
            link.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                const anchor = link as HTMLAnchorElement;
                const href = anchor.href;
                if (!href || anchor.dataset.opening === 'true') {
                    return;
                }
                anchor.dataset.opening = 'true';
                try {
                    await open(href);
                } catch (err) {
                    console.error('Failed to open link:', err);
                } finally {
                    window.setTimeout(() => {
                        delete anchor.dataset.opening;
                    }, 300);
                }
            });
        });
        this.updateTexts();
        this.updateVersion();
    }

    private updateTexts() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key) {
                el.textContent = i18n.t(key);
            }
        });
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            if (key) {
                const value = i18n.t(key);
                (el as HTMLElement).title = value;
                (el as HTMLElement).setAttribute('aria-label', value);
            }
        });
    }

    private async updateVersion() {
        try {
            this.version = await invoke<string>('get_app_version');
        } catch (err) {
            console.error('Failed to read app version:', err);
        }
        if (this.versionEl) {
            this.versionEl.textContent = this.version;
        }
    }

    open() {
        this.modal?.classList.remove('hidden');
    }

    close() {
        this.modal?.classList.add('hidden');
    }
}
