export type Language = 'tr' | 'en' | 'es' | 'de' | 'it' | 'pt' | 'fr';

export interface Translations {
    [key: string]: string | Translations;
}

export class I18nService {
    private currentLang: Language = 'tr';
    private translations: Record<Language, Translations> = {
        tr: {},
        en: {},
        es: {},
        de: {},
        it: {},
        pt: {},
        fr: {}
    };

    constructor() { }

    async loadTranslations(): Promise<void> {
        const langs: Language[] = ['tr', 'en', 'es', 'de', 'it', 'pt', 'fr'];
        for (const lang of langs) {
            try {
                // In a real app, you might fetch these or import them dynamically.
                // For this simple setup, we'll rely on the global build or fetch invalidation?
                // Actually, with Vite, we can import them directly if we know the paths.
                // But let's assume we fetch them or import them.
                // Using dynamic import for better splitting if needed, but synchronous import is easier for now.
                // We will populate this later.
            } catch (e) {
                console.error(`Failed to load translations for ${lang}`, e);
            }
        }
    }

    setLanguage(lang: Language) {
        this.currentLang = lang;
        document.documentElement.lang = lang;
        document.dispatchEvent(new CustomEvent('language-changed', { detail: lang }));
    }

    getCurrentLanguage(): Language {
        return this.currentLang;
    }

    t(key: string): string {
        return this.resolve(key, this.currentLang)
            ?? this.resolve(key, 'en')
            ?? key;
    }

    private resolve(key: string, lang: Language): string | null {
        let value: any = this.translations[lang];
        for (const part of key.split('.')) {
            if (!value || typeof value !== 'object' || !(part in value)) {
                return null;
            }
            value = value[part];
        }
        return typeof value === 'string' ? value : null;
    }

    // Helper to load a specific language dictionary (called from main)
    addTranslation(lang: Language, data: Translations) {
        this.translations[lang] = data;
    }
}

export const i18n = new I18nService();
