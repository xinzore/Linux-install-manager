import { i18n, Language } from '../core/i18n';
import { themeService, Theme } from '../core/theme';
import { storageService } from '../core/storage';
import { invoke } from '@tauri-apps/api/core';

export class SettingsUI {
    private modal: HTMLElement | null;
    private btnOpen: HTMLElement | null;
    private btnClose: HTMLElement | null;
    private langSelect: HTMLSelectElement | null;
    private themeSelect: HTMLSelectElement | null;
    private btnInstallAssociations: HTMLButtonElement | null;
    private associationsStatus: HTMLElement | null;

    constructor() {
        this.modal = document.getElementById('settings-modal');
        this.btnOpen = document.getElementById('btn-settings');
        this.btnClose = document.getElementById('btn-close-settings');
        this.langSelect = document.getElementById('lang-select') as HTMLSelectElement;
        this.themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
        this.btnInstallAssociations = document.getElementById('btn-install-associations') as HTMLButtonElement | null;
        this.associationsStatus = document.getElementById('settings-associations-status');

        this.init();
    }

    private init() {
        // Open/Close logic
        this.btnOpen?.addEventListener('click', () => this.open());
        this.btnClose?.addEventListener('click', () => this.close());

        // Initial State
        const savedLang = storageService.getLanguage() || 'tr';
        const savedTheme = storageService.getTheme() || 'system';

        if (this.langSelect) {
            this.langSelect.value = savedLang;
            i18n.setLanguage(savedLang);
            this.langSelect.addEventListener('change', (e) => {
                const lang = (e.target as HTMLSelectElement).value as Language;
                i18n.setLanguage(lang);
                storageService.setLanguage(lang);
                this.updateTexts();
            });
        }

        if (this.themeSelect) {
            this.themeSelect.value = savedTheme;
            themeService.setTheme(savedTheme);
            this.themeSelect.addEventListener('change', (e) => {
                const theme = (e.target as HTMLSelectElement).value as Theme;
                themeService.setTheme(theme);
                storageService.setTheme(theme);
            });
        }

        this.btnInstallAssociations?.addEventListener('click', async () => {
            if (this.associationsStatus) {
                this.associationsStatus.textContent = i18n.t('settings.associations_installing') || 'Kuruluyor...';
            }
            try {
                await invoke('install_file_associations');
                storageService.setAssociationsInstalled(true);
                if (this.associationsStatus) {
                    this.associationsStatus.textContent = i18n.t('settings.associations_installed') || 'Dosya ilişkilendirmeleri kuruldu.';
                }
            } catch (err) {
                if (this.associationsStatus) {
                    this.associationsStatus.textContent = i18n.t('settings.associations_failed') || 'Kurulum başarısız.';
                }
                console.error(err);
            }
        });

        this.updateTexts();
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

        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key && el instanceof HTMLInputElement) {
                el.placeholder = i18n.t(key);
            }
        });
    }

    open() {
        this.modal?.classList.remove('hidden');
    }

    close() {
        this.modal?.classList.add('hidden');
    }
}
