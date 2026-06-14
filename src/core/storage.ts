import { Language } from './i18n';
import { Theme } from './theme';

const STORAGE_KEYS = {
    LANGUAGE: 'app_language',
    THEME: 'app_theme',
    ASSOCIATIONS_PROMPTED: 'associations_prompted',
    ASSOCIATIONS_INSTALLED: 'associations_installed',
    WIZARD_DONE: 'wizard_done',
};

export class StorageService {
    constructor() { }

    getLanguage(): Language | null {
        return localStorage.getItem(STORAGE_KEYS.LANGUAGE) as Language | null;
    }

    setLanguage(lang: Language) {
        localStorage.setItem(STORAGE_KEYS.LANGUAGE, lang);
    }

    getTheme(): Theme | null {
        return localStorage.getItem(STORAGE_KEYS.THEME) as Theme | null;
    }

    setTheme(theme: Theme) {
        localStorage.setItem(STORAGE_KEYS.THEME, theme);
    }

    getAssociationsPrompted(): boolean {
        return localStorage.getItem(STORAGE_KEYS.ASSOCIATIONS_PROMPTED) === 'true';
    }

    setAssociationsPrompted(value: boolean) {
        localStorage.setItem(STORAGE_KEYS.ASSOCIATIONS_PROMPTED, String(value));
    }

    getAssociationsInstalled(): boolean {
        return localStorage.getItem(STORAGE_KEYS.ASSOCIATIONS_INSTALLED) === 'true';
    }

    setAssociationsInstalled(value: boolean) {
        localStorage.setItem(STORAGE_KEYS.ASSOCIATIONS_INSTALLED, String(value));
    }

    getWizardDone(): boolean {
        return localStorage.getItem(STORAGE_KEYS.WIZARD_DONE) === 'true';
    }

    setWizardDone(value: boolean) {
        localStorage.setItem(STORAGE_KEYS.WIZARD_DONE, String(value));
    }
}

export const storageService = new StorageService();
