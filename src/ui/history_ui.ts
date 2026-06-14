import { invoke } from '@tauri-apps/api/core';
import { HistoryEntry } from '../core/history';
import { i18n } from '../core/i18n';

export class HistoryUI {
    private container: HTMLElement;
    private entries: HistoryEntry[] = [];

    constructor(containerId: string) {
        const element = document.getElementById(containerId);
        if (!element) throw new Error(`Container ${containerId} not found`);
        this.container = element;
        window.addEventListener('linux-install-manager:history-changed', () => void this.load());
    }

    public async load(): Promise<void> {
        try {
            this.entries = await invoke<HistoryEntry[]>('get_history');
            this.render();
        } catch (error) {
            this.container.innerHTML = `<div class="panel-error">${this.escape(String(error))}</div>`;
        }
    }

    private render() {
        const items = this.entries.map(entry => `
            <article class="history-item ${entry.status}">
                <div class="history-main">
                    <span class="history-status">${entry.status === 'success' ? '✓' : '!'}</span>
                    <div class="history-info">
                        <h4>${this.escape(entry.app_name)}</h4>
                        <p>${this.escape(i18n.t(`history.operation_${entry.operation}`))} · ${this.formatDate(entry.finished_at)}</p>
                        <code>${this.escape(entry.command || '-')}</code>
                    </div>
                    <div class="history-result">
                        <span>${entry.exit_code === null ? '-' : `${i18n.t('history.exit_code')}: ${entry.exit_code}`}</span>
                        ${entry.command ? `<button class="btn-secondary history-retry" data-command="${this.escapeAttr(entry.command)}" data-app="${this.escapeAttr(entry.app_name)}">↻ ${i18n.t('terminal.retry')}</button>` : ''}
                    </div>
                </div>
                ${entry.output ? `<details><summary>${i18n.t('history.output')}</summary><pre>${this.escape(entry.output)}</pre></details>` : ''}
            </article>
        `).join('');

        this.container.innerHTML = `
            <section class="page-panel">
                <div class="page-header">
                    <div>
                        <h2>${i18n.t('history.title')}</h2>
                        <p>${i18n.t('history.description')}</p>
                    </div>
                    <button id="history-clear" class="btn-secondary" ${this.entries.length === 0 ? 'disabled' : ''}>${i18n.t('history.clear')}</button>
                </div>
                <div class="history-list">
                    ${items || `<div class="receipts-empty"><p>${i18n.t('history.empty')}</p></div>`}
                </div>
            </section>
        `;

        this.container.querySelector('#history-clear')?.addEventListener('click', async () => {
            if (!window.confirm(i18n.t('history.confirm_clear'))) return;
            await invoke('clear_history');
            await this.load();
        });
        this.container.querySelectorAll('.history-retry').forEach(button => {
            button.addEventListener('click', () => {
                const target = button as HTMLButtonElement;
                window.dispatchEvent(new CustomEvent('linux-install-manager:run-terminal-command', {
                    detail: {
                        command: target.dataset.command,
                        label: target.dataset.app,
                        description: i18n.t('history.retrying'),
                        operation: 'retry',
                    }
                }));
            });
        });
    }

    private formatDate(value: string): string {
        return new Date(value).toLocaleString(i18n.getCurrentLanguage());
    }

    private escape(value: string): string {
        return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    private escapeAttr(value: string): string {
        return this.escape(value).replace(/\n/g, '&#10;');
    }
}
