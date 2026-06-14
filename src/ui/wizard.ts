import { invoke } from '@tauri-apps/api/core';
import { i18n, Language } from '../core/i18n';
import { storageService } from '../core/storage';

export class FirstRunWizard {
    private modal: HTMLElement | null;
    private langSelect: HTMLSelectElement | null;
    private associationsToggle: HTMLInputElement | null;
    private btnSkip: HTMLButtonElement | null;
    private btnFinish: HTMLButtonElement | null;

    constructor() {
        this.modal = document.getElementById('wizard-modal');
        this.langSelect = document.getElementById('wizard-lang-select') as HTMLSelectElement | null;
        this.associationsToggle = document.getElementById('wizard-associations') as HTMLInputElement | null;
        this.btnSkip = document.getElementById('wizard-skip') as HTMLButtonElement | null;
        this.btnFinish = document.getElementById('wizard-finish') as HTMLButtonElement | null;

        this.init();
    }

    private init() {
        if (this.langSelect) {
            const current = storageService.getLanguage() || 'tr';
            this.langSelect.value = current;
            this.langSelect.addEventListener('change', (e) => {
                const lang = (e.target as HTMLSelectElement).value as Language;
                i18n.setLanguage(lang);
                storageService.setLanguage(lang);
                document.dispatchEvent(new CustomEvent('language-changed'));
            });
        }

        this.btnSkip?.addEventListener('click', () => {
            storageService.setWizardDone(true);
            this.close();
        });

        this.btnFinish?.addEventListener('click', async () => {
            await this.applySelections();
        });
    }

    public showIfNeeded() {
        if (storageService.getWizardDone()) {
            return;
        }
        this.open();
    }

    private async applySelections() {
        const wantsAssociations = this.associationsToggle?.checked;
        if (wantsAssociations) {
            try {
                await invoke('install_file_associations');
                storageService.setAssociationsInstalled(true);
            } catch (err) {
                console.error('Failed to install file associations:', err);
            }
        }
        storageService.setAssociationsPrompted(true);
        storageService.setWizardDone(true);
        this.close();
    }

    private open() {
        this.modal?.classList.remove('hidden');
    }

    private close() {
        this.modal?.classList.add('hidden');
    }
}
