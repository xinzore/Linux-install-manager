import { invoke } from '@tauri-apps/api/core';
import { i18n } from '../core/i18n';

interface RepairAction {
    id: string;
    title: string;
    description: string;
    command: string;
}

interface SystemInfo {
    distribution: string;
    version: string;
    desktop: string;
    kernel: string;
    architecture: string;
    package_manager: string;
    disk_total: string;
    disk_used: string;
    disk_available: string;
    disk_percent: string;
    updates_available: number | null;
    repair_actions: RepairAction[];
}

export class SystemUI {
    private container: HTMLElement;

    constructor(containerId: string) {
        const element = document.getElementById(containerId);
        if (!element) throw new Error(`Container ${containerId} not found`);
        this.container = element;
    }

    public async load(): Promise<void> {
        this.container.innerHTML = `<div class="panel-loading">${i18n.t('system.loading')}</div>`;
        try {
            const info = await invoke<SystemInfo>('get_system_info');
            this.render(info);
        } catch (error) {
            this.container.innerHTML = `<div class="panel-error">${String(error)}</div>`;
        }
    }

    private render(info: SystemInfo) {
        const facts = [
            ['distribution', `${info.distribution} ${info.version}`],
            ['desktop', info.desktop],
            ['kernel', `${info.kernel} (${info.architecture})`],
            ['package_manager', info.package_manager],
            ['disk', `${info.disk_used} / ${info.disk_total} (${info.disk_percent})`],
            ['disk_available', info.disk_available],
            ['updates', info.updates_available === null ? i18n.t('system.unknown') : String(info.updates_available)],
        ];
        const repairs = info.repair_actions.map(action => `
            <article class="repair-card">
                <div>
                    <h4>${this.escape(this.repairTitle(action))}</h4>
                    <p>${this.escape(this.repairDescription(action))}</p>
                    <code>${this.escape(action.command)}</code>
                </div>
                <button class="btn-warning repair-run" data-command="${this.escapeAttr(action.command)}" data-title="${this.escapeAttr(this.repairTitle(action))}">${i18n.t('system.run_repair')}</button>
            </article>
        `).join('');

        this.container.innerHTML = `
            <section class="page-panel">
                <div class="page-header">
                    <div>
                        <h2>${i18n.t('system.title')}</h2>
                        <p>${i18n.t('system.description')}</p>
                    </div>
                    <button id="system-refresh" class="btn-secondary">↻ ${i18n.t('system.refresh')}</button>
                </div>
                <div class="system-grid">
                    ${facts.map(([key, value]) => `<div class="system-fact"><span>${i18n.t(`system.${key}`)}</span><strong>${this.escape(value)}</strong></div>`).join('')}
                </div>
                <div class="repair-section">
                    <h3>${i18n.t('system.repair_title')}</h3>
                    <p>${i18n.t('system.repair_description')}</p>
                    <div class="repair-list">${repairs || `<p>${i18n.t('system.no_repairs')}</p>`}</div>
                </div>
            </section>
        `;

        this.container.querySelector('#system-refresh')?.addEventListener('click', () => void this.load());
        this.container.querySelectorAll('.repair-run').forEach(button => {
            button.addEventListener('click', () => {
                const target = button as HTMLButtonElement;
                window.dispatchEvent(new CustomEvent('linux-install-manager:run-terminal-command', {
                    detail: {
                        command: target.dataset.command,
                        label: target.dataset.title,
                        description: i18n.t('system.repair_running'),
                        operation: 'repair',
                    }
                }));
                document.querySelector<HTMLElement>('.nav-btn[data-tab="install"]')?.click();
            });
        });
    }

    private repairTitle(action: RepairAction): string {
        const translated = i18n.t(`system.repair_${action.id}_title`);
        return translated.startsWith('system.') ? action.title : translated;
    }

    private repairDescription(action: RepairAction): string {
        const translated = i18n.t(`system.repair_${action.id}_description`);
        return translated.startsWith('system.') ? action.description : translated;
    }

    private escape(value: string): string {
        return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    private escapeAttr(value: string): string {
        return this.escape(value).replace(/\n/g, '&#10;');
    }
}
