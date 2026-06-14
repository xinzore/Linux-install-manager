export type Theme = 'light' | 'dark' | 'system';

export class ThemeService {
    private currentTheme: Theme = 'system';

    constructor() {
        this.init();
    }

    private init() {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addEventListener('change', () => {
            if (this.currentTheme === 'system') {
                this.applyTheme('system');
            }
        });
    }

    setTheme(theme: Theme) {
        this.currentTheme = theme;
        this.applyTheme(theme);
        document.dispatchEvent(new CustomEvent('theme-changed', { detail: theme }));
    }

    getTheme(): Theme {
        return this.currentTheme;
    }

    private applyTheme(theme: Theme) {
        const root = document.documentElement;
        const isDark =
            theme === 'dark' ||
            (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

        if (isDark) {
            root.classList.add('dark');
            root.classList.remove('light');
        } else {
            root.classList.add('light');
            root.classList.remove('dark');
        }
    }
}

export const themeService = new ThemeService();
