import { TerminalPanel } from './terminal_panel';
import { SettingsUI } from './settings';
import { DropZone, DetectionResult } from './drop_zone';
import { PlannerUI, InstallPlan } from './planner_ui';
import { ExecutorUI, ExecutionResult } from './executor_ui';
import { ReceiptsUI, Receipt } from './receipts_ui';
import { HistoryUI } from './history_ui';
import { SystemUI } from './system_ui';
import { AboutUI } from './about';
import { FirstRunWizard } from './wizard';
import { i18n } from '../core/i18n';
import { storageService } from '../core/storage';
import { notifyUser } from '../core/notifications';
import { recordHistory } from '../core/history';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import en from '../i18n/en.json';
import tr from '../i18n/tr.json';
import es from '../i18n/es.json';
import de from '../i18n/de.json';
import it from '../i18n/it.json';
import pt from '../i18n/pt.json';
import fr from '../i18n/fr.json';

// ... imports ...

export class App {
    private terminalPanel: TerminalPanel;
    private settingsUI: SettingsUI;
    private aboutUI: AboutUI;
    private wizard: FirstRunWizard;
    private dropZone: DropZone;
    private plannerUI: PlannerUI;
    private executorUI: ExecutorUI;
    private receiptsUI: ReceiptsUI;
    private historyUI: HistoryUI;
    private systemUI: SystemUI;
    private currentDetection: DetectionResult | null = null;

    constructor() {
        this.initTranslations();

        // Initialize UI components
        this.terminalPanel = new TerminalPanel('terminal-container');
        this.settingsUI = new SettingsUI();
        this.aboutUI = new AboutUI();
        this.wizard = new FirstRunWizard();
        this.dropZone = new DropZone('drop-zone', this.handleFileDetected.bind(this));
        this.plannerUI = new PlannerUI('plan-panel', this.handleExecutePlan.bind(this));
        this.receiptsUI = new ReceiptsUI('receipts-list');
        this.historyUI = new HistoryUI('history-list');
        this.systemUI = new SystemUI('system-panel');

        // Initialize executor with terminal write function
        this.executorUI = new ExecutorUI(
            this.terminalPanel.runCommand.bind(this.terminalPanel),
            this.handleExecutionComplete.bind(this)
        );

        this.setupEventListeners();
        this.receiptsUI.loadReceipts();
        this.applyTranslations();
        this.wizard.showIfNeeded();
        this.showAssociationsPrompt();
        this.loadPendingOpenFiles();
        this.keepAlive();

        console.log('App initialized');
    }

    private setupEventListeners() {
        // Tab switching
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const tab = target.dataset.tab;

                // Update buttons
                document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
                target.classList.add('active');

                // Update tabs
                document.querySelectorAll('.tab-content').forEach(t => {
                    (t as HTMLElement).style.display = 'none';
                });
                const tabContent = document.getElementById(`tab-${tab}`);
                if (tabContent) {
                    tabContent.style.display = 'block';
                }

                // Refresh receipts when opening tab
                if (tab === 'receipts') {
                    this.receiptsUI.loadReceipts();
                }
                if (tab === 'history') {
                    this.historyUI.load();
                }
                if (tab === 'system') {
                    this.systemUI.load();
                }
            });
        });

        window.addEventListener('linux-install-manager:uninstall-command', async (e: Event) => {
            const detail = (e as CustomEvent).detail;
            const appName = detail.appName || detail.packageName || i18n.t('common.uninstall');
            const startedAt = new Date().toISOString();

            // Switch to install tab (where terminal is)
            const installTabBtn = document.querySelector('.nav-btn[data-tab="install"]');
            if (installTabBtn) {
                (installTabBtn as HTMLElement).click();
            }

            try {
                const result = await this.terminalPanel.runCommand(detail.command, {
                    label: appName,
                    description: i18n.t('terminal.uninstalling'),
                });
                if (result.exitCode !== 0) {
                    throw new Error(`Exit code ${result.exitCode}`);
                }
                await invoke('remove_receipt', { id: detail.receiptId });
                await this.receiptsUI.loadReceipts();
                await recordHistory({
                    operation: 'uninstall',
                    app_name: appName,
                    command: detail.command,
                    started_at: startedAt,
                    finished_at: new Date().toISOString(),
                    status: 'success',
                    exit_code: result.exitCode,
                    output: result.output,
                });
                await notifyUser(
                    i18n.t('notifications.uninstall_success_title'),
                    i18n.t('notifications.uninstall_success_body').replace('{app}', appName)
                );
            } catch (error) {
                console.error('Uninstall failed:', error);
                await recordHistory({
                    operation: 'uninstall',
                    app_name: appName,
                    command: detail.command,
                    started_at: startedAt,
                    finished_at: new Date().toISOString(),
                    status: 'failed',
                    exit_code: 1,
                    output: String(error),
                });
                await notifyUser(
                    i18n.t('notifications.uninstall_failed_title'),
                    i18n.t('notifications.uninstall_failed_body').replace('{app}', appName)
                );
                await this.showInfoModal(
                    i18n.t('common.uninstall'),
                    `${i18n.t('receipts.uninstall_error')}${error}`
                );
            }
        });

        window.addEventListener('linux-install-manager:run-terminal-command', async (e: Event) => {
            const detail = (e as CustomEvent).detail;
            const startedAt = new Date().toISOString();
            try {
                const result = await this.terminalPanel.runCommand(detail.command, {
                    label: detail.label || detail.command,
                    description: detail.description,
                });
                await recordHistory({
                    operation: detail.operation || 'manual',
                    app_name: detail.label || detail.command,
                    command: detail.command,
                    started_at: startedAt,
                    finished_at: new Date().toISOString(),
                    status: result.exitCode === 0 ? 'success' : 'failed',
                    exit_code: result.exitCode,
                    output: result.output,
                });
            } catch (error) {
                console.error('Terminal command failed:', error);
                await recordHistory({
                    operation: detail.operation || 'manual',
                    app_name: detail.label || detail.command,
                    command: detail.command,
                    started_at: startedAt,
                    finished_at: new Date().toISOString(),
                    status: 'failed',
                    exit_code: 1,
                    output: String(error),
                });
            }
        });

        document.addEventListener('language-changed', () => {
            this.applyTranslations();
        });

        listen<string>('open-file', (event) => {
            const path = event.payload;
            if (!path) {
                return;
            }
            const installTabBtn = document.querySelector('.nav-btn[data-tab="install"]');
            if (installTabBtn) {
                (installTabBtn as HTMLElement).click();
            }
            this.dropZone.detectFile(path).catch(console.error);
        }).catch(console.error);

        listen<{ step_order: number; line: string }>('plan-log', (event) => {
            const payload = event.payload;
            if (!payload?.line) {
                return;
            }
            this.terminalPanel.writeOutput(payload.line + '\r\n');
        }).catch(console.error);

    }

    private async loadPendingOpenFiles() {
        try {
            const files = await invoke<string[]>('take_pending_open_files');
            if (!files || files.length === 0) {
                return;
            }
            const installTabBtn = document.querySelector('.nav-btn[data-tab="install"]');
            if (installTabBtn) {
                (installTabBtn as HTMLElement).click();
            }
            for (const file of files) {
                if (file) {
                    await this.dropZone.detectFile(file);
                }
            }
        } catch (err) {
            console.error('Failed to load pending open files:', err);
        }
    }

    private async handleFileDetected(result: DetectionResult) {
        this.currentDetection = result;
        console.log('File detected:', result);

        // Create and show install plan
        try {
            await this.plannerUI.createPlan(result.path);
        } catch (err) {
            console.error('Failed to create plan:', err);
        }
    }

    private async handleExecutePlan(plan: InstallPlan) {
        console.log('Executing plan:', plan);
        this.terminalPanel.setOperationStatus('running', plan.file_info.filename);
        document.getElementById('post-install-actions')?.classList.add('hidden');

        // Hide plan panel
        this.plannerUI.hide();

        // Execute via ExecutorUI
        await this.executorUI.execute(plan);
    }

    private async handleExecutionComplete(result: ExecutionResult) {
        console.log('Execution complete:', result);
        this.terminalPanel.setOperationStatus(
            result.overall_status === 'Success' ? 'success' : 'failed',
            result.installed_app_name || ''
        );

        this.receiptsUI.loadReceipts();
        if (result.overall_status === 'Success') {
            const receipts = await invoke<Receipt[]>('get_receipts');
            const receipt = receipts.find(item => item.id === result.plan_id);
            if (receipt) {
                this.renderPostInstallActions(receipt, result.terminal_output || '');
            }
        }
        // Reset drop zone for new file
        // The user can now see the terminal output and proceed
    }

    private keepAlive() {
        void this.terminalPanel;
        void this.settingsUI;
        void this.aboutUI;
        void this.wizard;
        void this.dropZone;
        void this.plannerUI;
        void this.executorUI;
        void this.receiptsUI;
        void this.historyUI;
        void this.systemUI;
        void this.currentDetection;
    }

    private renderPostInstallActions(receipt: Receipt, terminalOutput: string) {
        const container = document.getElementById('post-install-actions');
        if (!container) return;
        container.innerHTML = `
            <div>
                <strong>${i18n.t('post_install.title')}</strong>
                <span>${this.escapeHtml(receipt.app_name)}</span>
            </div>
            <div class="post-install-buttons">
                <button id="post-launch" class="btn-primary">▶ ${i18n.t('post_install.launch')}</button>
                <button id="post-location" class="btn-secondary">📁 ${i18n.t('post_install.show_location')}</button>
                <button id="post-copy-output" class="btn-secondary">📋 ${i18n.t('post_install.copy_output')}</button>
            </div>
        `;
        container.classList.remove('hidden');
        container.querySelector('#post-launch')?.addEventListener('click', () => {
            invoke('launch_receipt', { receipt }).catch(error => this.showInfoModal(i18n.t('post_install.launch'), String(error)));
        });
        container.querySelector('#post-location')?.addEventListener('click', () => {
            invoke('show_receipt_location', { receipt }).catch(error => this.showInfoModal(i18n.t('post_install.show_location'), String(error)));
        });
        container.querySelector('#post-copy-output')?.addEventListener('click', () => {
            navigator.clipboard.writeText(terminalOutput).catch(console.error);
        });
    }

    private escapeHtml(value: string): string {
        return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    private showAssociationsPrompt() {
        if (storageService.getAssociationsPrompted()) {
            return;
        }

        const modal = document.getElementById('associations-modal');
        const btnLater = document.getElementById('associations-later') as HTMLButtonElement | null;
        const btnInstall = document.getElementById('associations-install') as HTMLButtonElement | null;
        if (!modal || !btnLater || !btnInstall) {
            return;
        }

        const message = modal.querySelector('.confirm-message') as HTMLElement | null;
        modal.classList.remove('hidden');

        const close = () => {
            modal.classList.add('hidden');
            btnLater.disabled = false;
            btnInstall.disabled = false;
        };

        btnLater.onclick = () => {
            storageService.setAssociationsPrompted(true);
            close();
        };

        btnInstall.onclick = async () => {
            btnLater.disabled = true;
            btnInstall.disabled = true;
            if (message) {
                message.textContent = i18n.t('settings.associations_installing') || 'Kuruluyor...';
            }
            try {
                await invoke('install_file_associations');
                storageService.setAssociationsInstalled(true);
                storageService.setAssociationsPrompted(true);
                if (message) {
                    message.textContent = i18n.t('settings.associations_installed') || 'Dosya ilişkilendirmeleri kuruldu.';
                }
                setTimeout(close, 900);
            } catch (err) {
                if (message) {
                    message.textContent = i18n.t('settings.associations_failed') || 'Kurulum başarısız.';
                }
                btnLater.disabled = false;
                btnInstall.disabled = false;
                console.error(err);
            }
        };
    }

    private ensureConfirmModal(): HTMLElement {
        const existing = document.getElementById('confirm-modal');
        if (existing) {
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
        return modal;
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

    private initTranslations() {
        i18n.addTranslation('en', en as any);
        i18n.addTranslation('tr', tr as any);
        i18n.addTranslation('es', es as any);
        i18n.addTranslation('de', de as any);
        i18n.addTranslation('it', it as any);
        i18n.addTranslation('pt', pt as any);
        i18n.addTranslation('fr', fr as any);
    }

    private applyTranslations() {
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
}
