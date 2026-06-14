import { invoke } from '@tauri-apps/api/core';
import { i18n } from '../core/i18n';
import { notifyUser } from '../core/notifications';
import { recordHistory } from '../core/history';

export interface Receipt {
    id: string;
    app_name: string;
    installed_at: string;
    source_path: string;
    install_path: string | null;
    installed_paths: string[];
    package_name?: string | null;
    installer_type: string;
    can_uninstall: boolean;
    uninstall_command: string | null;
    desktop_entry_path: string | null;
    system_status?: 'installed' | 'missing' | 'unknown' | null;
}

interface ReconcileResult {
    receipts: Receipt[];
    removed_stale: number;
    removed_duplicates: number;
}

export class ReceiptsUI {
    private container: HTMLElement;
    private receipts: Receipt[] = [];
    private confirmModal: HTMLElement | null = null;
    private searchQuery: string = '';
    private reconcileResult: ReconcileResult | null = null;

    constructor(containerId: string) {
        const el = document.getElementById(containerId);
        if (!el) {
            // Create container if it doesn't exist
            const newEl = document.createElement('div');
            newEl.id = containerId;
            document.body.appendChild(newEl);
            this.container = newEl;
        } else {
            this.container = el;
        }
    }

    public async loadReceipts(): Promise<void> {
        try {
            this.reconcileResult = await invoke<ReconcileResult>('reconcile_receipts');
            this.receipts = this.reconcileResult.receipts;
            this.render();
        } catch (err) {
            console.error('Failed to load receipts:', err);
        }
    }

    public async removeReceipt(id: string): Promise<void> {
        try {
            await invoke('remove_receipt', { id });
            await this.loadReceipts();
        } catch (err) {
            console.error('Failed to remove receipt:', err);
        }
    }

    private render(preserveSearchFocus = false) {
        const focusState = preserveSearchFocus ? this.captureSearchFocus() : null;

        if (this.receipts.length === 0) {
            this.container.innerHTML = `
                <div class="receipts-list">
                    ${this.renderHeader()}
                    ${this.renderReconcileNotice()}
                    <div class="receipts-empty">
                        <p>${i18n.t('receipts.empty')}</p>
                    </div>
                </div>
            `;
            this.bindSearch();
            this.bindHistoryAction();
            return;
        }

        const filtered = this.filterReceipts(this.receipts, this.searchQuery);
        if (filtered.length === 0) {
            this.container.innerHTML = `
                <div class="receipts-list">
                    ${this.renderHeader()}
                    ${this.renderReconcileNotice()}
                    <div class="receipts-empty">
                        <p>${i18n.t('receipts.no_results')}</p>
                    </div>
                </div>
            `;
            this.bindSearch();
            this.bindHistoryAction();
            this.restoreSearchFocus(focusState);
            return;
        }

        const receiptsHtml = filtered.map(r => `
            <div class="receipt-item" data-id="${r.id}">
                <div class="receipt-icon">${this.getIconForType(r.installer_type)}</div>
                <div class="receipt-info">
                    <h4>${this.escapeHtml(r.app_name)}</h4>
                    <p class="receipt-type">${this.escapeHtml(r.installer_type)}</p>
                    <span class="receipt-system-status ${r.system_status || 'unknown'}">${i18n.t(`receipts.status_${r.system_status || 'unknown'}`)}</span>
                    <p class="receipt-date">${this.formatDate(r.installed_at)}</p>
                    <p class="receipt-meta">${i18n.t('receipts.source')}: ${this.escapeHtml(this.formatSource(r.source_path))}</p>
                </div>
                ${r.can_uninstall ? `
                    <button class="btn-uninstall" data-id="${r.id}" title="${i18n.t('receipts.uninstall_program')}">
                        <span class="btn-icon">⊘</span>
                        <span>${i18n.t('receipts.uninstall_program')}</span>
                    </button>
                ` : `<span class="receipt-record-only">${i18n.t('receipts.record_only')}</span>`}
            </div>
        `).join('');

        this.container.innerHTML = `
            <div class="receipts-list">
                ${this.renderHeader()}
                ${this.renderReconcileNotice()}
                ${receiptsHtml}
            </div>
        `;

        this.bindSearch();
        this.restoreSearchFocus(focusState);

        // Add event listeners for uninstall buttons
        this.container.querySelectorAll('.btn-uninstall').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const target = e.currentTarget as HTMLElement;
                const id = target.dataset.id;
                const receipt = this.receipts.find(r => r.id === id);
                if (!receipt) return;
                const confirmed = await this.confirmUninstall(receipt.app_name);
                if (confirmed) {
                    await this.uninstallApp(receipt);
                }
            });
        });

        this.bindHistoryAction();
    }

    public async uninstallApp(receipt: Receipt): Promise<void> {
        const startedAt = new Date().toISOString();
        try {
            await notifyUser(
                i18n.t('notifications.uninstall_started_title'),
                i18n.t('notifications.uninstall_started_body').replace('{app}', receipt.app_name)
            );
            const command = await invoke<string | null>('uninstall_app', { receipt });
            if (command) {
                // Command required (e.g. sudo apt remove ...) - trigger terminal
                const event = new CustomEvent('linux-install-manager:uninstall-command', {
                    detail: {
                        command,
                        receiptId: receipt.id,
                        installerType: receipt.installer_type,
                        packageName: receipt.package_name || null,
                        appName: receipt.app_name
                    }
                });
                window.dispatchEvent(event);
            } else {
                // Auto-removed (AppImage)
                await this.removeReceipt(receipt.id);
                await recordHistory({
                    operation: 'uninstall',
                    app_name: receipt.app_name,
                    command: i18n.t('history.direct_file_removal'),
                    started_at: startedAt,
                    finished_at: new Date().toISOString(),
                    status: 'success',
                    exit_code: 0,
                    output: receipt.installed_paths.join('\n'),
                });
                await notifyUser(
                    i18n.t('notifications.uninstall_success_title'),
                    i18n.t('notifications.uninstall_success_body').replace('{app}', receipt.app_name)
                );
            }
        } catch (err) {
            console.error('Uninstall failed:', err);
            this.showInfoModal(
                i18n.t('common.uninstall') || 'Kaldır',
                (i18n.t('receipts.uninstall_error') || 'Kaldırma başarısız: ') + err
            );
        }
    }

    private getIconForType(type: string): string {
        const icons: Record<string, string> = {
            'AppImage': '📦',
            'Deb': '🔷',
            'Rpm': '🔶',
            'ArchPkg': '🏔️',
            'Script': '📜',
            'Unknown': '❓'
        };
        // Normalize type to match keys if needed, or use default
        return icons[type] || icons['Unknown'];
    }

    private formatDate(dateStr: string): string {
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString('tr-TR', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return dateStr;
        }
    }

    private formatSource(source: string): string {
        if (!source) return '-';
        const parts = source.split('/');
        return parts[parts.length - 1] || source;
    }

    private bindSearch() {
        const input = this.container.querySelector('#receipts-search') as HTMLInputElement | null;
        if (!input) return;
        input.addEventListener('input', (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value;
            this.render(true);
        });
    }

    private bindHistoryAction() {
        this.container.querySelector('#receipts-rescan')?.addEventListener('click', () => void this.loadReceipts());
        this.container.querySelector('#receipts-clear-history')?.addEventListener('click', async () => {
            const confirmed = await this.confirmAction(
                i18n.t('receipts.clear_history'),
                i18n.t('receipts.confirm_clear_history'),
                i18n.t('receipts.clear_records')
            );
            if (!confirmed) return;
            await invoke('clear_receipts');
            await this.loadReceipts();
        });
    }

    private renderHeader(): string {
        return `
            <div class="receipts-header">
                <div class="receipts-heading">
                    <h3>${i18n.t('receipts.title')}</h3>
                    <p>${i18n.t('receipts.explanation')}</p>
                </div>
                <div class="receipts-actions">
                    <input id="receipts-search" class="receipts-search" type="text" placeholder="${i18n.t('receipts.search_placeholder')}" value="${this.escapeAttr(this.searchQuery)}">
                    <button class="btn-secondary" id="receipts-rescan">
                        <span class="btn-icon">↻</span>
                        ${i18n.t('receipts.rescan')}
                    </button>
                    <button class="btn-secondary btn-clear-history" id="receipts-clear-history" title="${i18n.t('receipts.clear_history_hint')}">
                        <span class="btn-icon">🧾</span>
                        ${i18n.t('receipts.clear_history')}
                    </button>
                </div>
            </div>
        `;
    }

    private renderReconcileNotice(): string {
        const result = this.reconcileResult;
        if (!result || (result.removed_stale === 0 && result.removed_duplicates === 0)) return '';
        return `<div class="reconcile-notice">${i18n.t('receipts.reconcile_result')
            .replace('{stale}', String(result.removed_stale))
            .replace('{duplicates}', String(result.removed_duplicates))}</div>`;
    }

    private filterReceipts(receipts: Receipt[], query: string): Receipt[] {
        const q = query.trim().toLowerCase();
        if (!q) return receipts;
        return receipts.filter(r => {
            return r.app_name.toLowerCase().includes(q)
                || (r.package_name || '').toLowerCase().includes(q)
                || (r.installer_type || '').toLowerCase().includes(q)
                || this.formatSource(r.source_path).toLowerCase().includes(q);
        });
    }

    private escapeAttr(value: string): string {
        return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    }

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private captureSearchFocus() {
        const active = document.activeElement as HTMLInputElement | null;
        if (!active || active.id !== 'receipts-search') {
            return null;
        }
        return {
            selectionStart: active.selectionStart ?? active.value.length,
            selectionEnd: active.selectionEnd ?? active.value.length,
        };
    }

    private restoreSearchFocus(state: { selectionStart: number; selectionEnd: number } | null) {
        if (!state) return;
        const input = this.container.querySelector('#receipts-search') as HTMLInputElement | null;
        if (!input) return;
        input.focus();
        input.setSelectionRange(state.selectionStart, state.selectionEnd);
    }

    private ensureConfirmModal(): HTMLElement {
        if (this.confirmModal) {
            return this.confirmModal;
        }

        const existing = document.getElementById('confirm-modal');
        if (existing) {
            this.confirmModal = existing;
            return existing;
        }

        const modal = document.createElement('div');
        modal.id = 'confirm-modal';
        modal.classList.add('hidden');
        modal.innerHTML = `
            <div class="confirm-card" role="dialog" aria-modal="true">
                <h2 class="confirm-title"></h2>
                <p class="confirm-message"></p>
                <p class="confirm-app"></p>
                <div class="confirm-actions">
                    <button class="btn-cancel"></button>
                    <button class="btn-confirm"></button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        this.confirmModal = modal;
        return modal;
    }

    private async confirmUninstall(appName: string): Promise<boolean> {
        return this.confirmAction(
            i18n.t('common.uninstall') || 'Kaldır',
            (i18n.t('receipts.confirm_uninstall') || 'Bu uygulamayı kaldırmak istiyor musunuz?') + `\n\n${appName}`,
            i18n.t('common.uninstall') || 'Kaldır'
        );
    }

    private async confirmAction(titleText: string, messageText: string, confirmText?: string): Promise<boolean> {
        const modal = this.ensureConfirmModal();
        const title = modal.querySelector('.confirm-title') as HTMLElement;
        const message = modal.querySelector('.confirm-message') as HTMLElement;
        const app = modal.querySelector('.confirm-app') as HTMLElement;
        const btnCancel = modal.querySelector('.btn-cancel') as HTMLButtonElement;
        const btnConfirm = modal.querySelector('.btn-confirm') as HTMLButtonElement;

        title.textContent = titleText;
        message.textContent = messageText;
        app.textContent = '';
        btnCancel.textContent = i18n.t('common.cancel') || 'İptal';
        btnConfirm.textContent = confirmText || (i18n.t('common.uninstall') || 'Kaldır');
        btnCancel.style.display = '';

        modal.classList.remove('hidden');

        return new Promise(resolve => {
            const cleanup = (result: boolean) => {
                modal.classList.add('hidden');
                btnCancel.onclick = null;
                btnConfirm.onclick = null;
                modal.onclick = null;
                resolve(result);
            };

            btnCancel.onclick = () => cleanup(false);
            btnConfirm.onclick = () => cleanup(true);
            modal.onclick = (e) => {
                if (e.target === modal) {
                    cleanup(false);
                }
            };
        });
    }

    private async showInfoModal(titleText: string, messageText: string): Promise<void> {
        const modal = this.ensureConfirmModal();
        const title = modal.querySelector('.confirm-title') as HTMLElement;
        const message = modal.querySelector('.confirm-message') as HTMLElement;
        const app = modal.querySelector('.confirm-app') as HTMLElement;
        const btnCancel = modal.querySelector('.btn-cancel') as HTMLButtonElement;
        const btnConfirm = modal.querySelector('.btn-confirm') as HTMLButtonElement;

        title.textContent = titleText;
        message.textContent = messageText;
        app.textContent = '';
        btnCancel.style.display = 'none';
        btnConfirm.textContent = i18n.t('common.close') || 'Kapat';

        modal.classList.remove('hidden');

        return new Promise(resolve => {
            const cleanup = () => {
                modal.classList.add('hidden');
                btnCancel.onclick = null;
                btnConfirm.onclick = null;
                modal.onclick = null;
                resolve();
            };

            btnConfirm.onclick = () => cleanup();
            modal.onclick = (e) => {
                if (e.target === modal) {
                    cleanup();
                }
            };
        });
    }
}
