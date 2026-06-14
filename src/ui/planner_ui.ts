import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { i18n } from '../core/i18n';

export interface InstallStep {
    order: number;
    action: any;
    description: string;
    command: string | null;
    requires_root: boolean;
    is_interactive: boolean;
}

export interface InstallPlan {
    file_info: any;
    steps: InstallStep[];
    summary: string;
    can_uninstall: boolean;
    warnings: string[];
}

interface PackageAnalysis {
    path: string;
    name: string;
    version: string;
    architecture: string;
    publisher: string;
    size_bytes: number;
    installed_size: string;
    files: string[];
    file_count: number;
    risk_level: 'low' | 'medium' | 'high';
    risk_codes: string[];
}

export class PlannerUI {
    private container: HTMLElement;
    private currentPlan: InstallPlan | null = null;
    private onExecute: (plan: InstallPlan) => void;
    private archiveDestination: string | null = null;
    private scriptContent: string | null = null;
    private scriptTruncated = false;
    private packageAnalysis: PackageAnalysis | null = null;

    constructor(containerId: string, onExecute: (plan: InstallPlan) => void) {
        const el = document.getElementById(containerId);
        if (!el) throw new Error(`Container ${containerId} not found`);
        this.container = el;
        this.onExecute = onExecute;
        this.hide();
    }

    public async createPlan(filePath: string): Promise<InstallPlan> {
        const [plan, analysis] = await Promise.all([
            invoke<InstallPlan>('create_plan', { path: filePath }),
            invoke<PackageAnalysis>('analyze_installer', { path: filePath }).catch(error => {
                console.error('Package analysis failed:', error);
                return null;
            }),
        ]);
        this.currentPlan = plan;
        this.packageAnalysis = analysis;
        this.archiveDestination = null;
        this.scriptContent = null;
        this.scriptTruncated = false;
        this.render();
        return plan;
    }

    public show() {
        this.container.style.display = 'block';
    }

    public hide() {
        this.container.style.display = 'none';
    }

    private render() {
        if (!this.currentPlan) {
            this.container.innerHTML = '';
            return;
        }

        const plan = this.currentPlan;

        let stepsHtml = plan.steps.map(step => `
            <div class="plan-step ${step.requires_root ? 'requires-root' : ''}">
                <div class="step-number">${step.order}</div>
                <div class="step-content">
                    <div class="step-title">
                        <span class="step-dot"></span>
                        <p class="step-description">${step.description}</p>
                    </div>
                    ${step.command ? `<code class="step-command">${step.command}</code>` : ''}
                    <div class="step-badges">
                        ${step.requires_root ? '<span class="badge root">Root</span>' : ''}
                        ${step.is_interactive ? '<span class="badge interactive">İnteraktif</span>' : ''}
                    </div>
                </div>
            </div>
        `).join('');

        let warningsHtml = plan.warnings.length > 0 ? `
            <div class="plan-warnings">
                ${plan.warnings.map(w => `<p class="warning">⚠️ ${w}</p>`).join('')}
            </div>
        ` : '';

        const isScriptPlan = this.isScriptPlan(plan);
        const isArchivePlan = this.isArchivePlan(plan);
        const showNoConfirm = this.isPackagePlan(plan);
        const noConfirmButton = showNoConfirm ? `
            <button class="btn-warning" id="plan-execute-noconfirm">
                <span class="btn-icon">⚡</span>
                ${i18n.t('planner.execute_noconfirm') || 'Soru Sormadan Kur'}
            </button>
        ` : '';

        const scriptPreviewHtml = isScriptPlan ? `
            <div class="script-preview">
                <div class="script-header">
                    <div class="script-header-left">
                        <h3>${i18n.t('script.preview_title') || 'Script Önizleme'}</h3>
                        <span class="script-note">${i18n.t('script.preview_note') || 'Otomatik çalıştırılmaz.'}</span>
                    </div>
                    <div class="script-actions">
                        <button class="btn-secondary btn-small" id="script-copy">
                            <span class="btn-icon">📋</span>
                            ${i18n.t('script.copy_content') || 'İçeriği Kopyala'}
                        </button>
                        <button class="btn-secondary btn-small" id="script-show-full" style="display:none;">
                            <span class="btn-icon">👁</span>
                            ${i18n.t('script.show_full') || 'Tamamını Göster'}
                        </button>
                    </div>
                </div>
                <pre id="script-preview" class="script-content">${i18n.t('script.loading') || 'Yükleniyor...'}</pre>
            </div>
        ` : '';

        const runScriptButton = isScriptPlan ? `
            <button class="btn-warning" id="plan-run-script">
                <span class="btn-icon">▶</span>
                ${i18n.t('script.run_in_terminal') || 'Scripti Terminalde Çalıştır'}
            </button>
        ` : '';

        const archivePanel = isArchivePlan ? `
            <div class="script-preview">
                <div class="script-header">
                    <h3>${i18n.t('archive.title') || 'Hedef Klasör'}</h3>
                    <span class="script-note">${i18n.t('archive.note') || 'Arşiv buraya açılacak.'}</span>
                </div>
                <div class="archive-row">
                    <span class="archive-path">${this.archiveDestination || (i18n.t('archive.not_selected') || 'Seçilmedi')}</span>
                    <button class="btn-secondary" id="archive-choose">
                        <span class="btn-icon">📁</span>
                        ${i18n.t('archive.choose') || 'Klasör Seç'}
                    </button>
                </div>
            </div>
        ` : '';
        const packageInfoHtml = this.renderPackageAnalysis();

        this.container.innerHTML = `
            <div class="plan-header">
                <div class="plan-title">
                    <div class="plan-title-icon">🧾</div>
                    <div>
                        <h2>${i18n.t('planner.title') || 'Kurulum Planı'}</h2>
                        <p class="plan-summary">${plan.summary}</p>
                    </div>
                </div>
                <div class="plan-summary-line">
                    ${this.renderPlanChips(plan)}
                </div>
            </div>

            ${warningsHtml}

            ${packageInfoHtml}

            <div class="plan-steps">
                <h3>${i18n.t('planner.steps') || 'Adımlar'}</h3>
                ${stepsHtml}
            </div>

            ${scriptPreviewHtml}
            ${archivePanel}

            <div class="plan-actions">
                <button class="btn-secondary" id="plan-cancel">
                    <span class="btn-icon">✖</span>
                    ${i18n.t('common.cancel') || 'İptal'}
                </button>
                ${isScriptPlan ? '' : noConfirmButton}
                ${runScriptButton}
                ${isScriptPlan ? '' : `
                    <button class="btn-primary" id="plan-execute" ${isArchivePlan && !this.archiveDestination ? 'disabled' : ''}>
                        <span class="btn-icon">▶</span>
                        ${i18n.t('planner.execute') || 'Kurulumu Başlat'}
                    </button>
                `}
            </div>
        `;

        // Attach event handlers
        this.container.querySelector('#plan-cancel')?.addEventListener('click', () => {
            this.hide();
            this.currentPlan = null;
        });

        this.container.querySelector('#plan-execute')?.addEventListener('click', () => {
            if (this.currentPlan) {
                this.onExecute(this.currentPlan);
            }
        });

        this.container.querySelector('#plan-execute-noconfirm')?.addEventListener('click', () => {
            if (this.currentPlan) {
                const noConfirmPlan = this.buildNoConfirmPlan(this.currentPlan);
                this.onExecute(noConfirmPlan);
            }
        });

        this.container.querySelector('#plan-run-script')?.addEventListener('click', async () => {
            if (!this.currentPlan) return;
            const cmd = this.getScriptRunCommand(this.currentPlan.file_info.path);
            window.dispatchEvent(new CustomEvent('linux-install-manager:run-terminal-command', {
                detail: {
                    command: cmd,
                    label: this.currentPlan.file_info.filename,
                    description: i18n.t('script.run_header'),
                }
            }));
        });

        this.container.querySelector('#script-copy')?.addEventListener('click', async () => {
            const previewEl = this.container.querySelector('#script-preview') as HTMLElement | null;
            const content = this.scriptContent || previewEl?.textContent || '';
            if (!content.trim()) return;
            try {
                await navigator.clipboard.writeText(content);
                const btn = this.container.querySelector('#script-copy') as HTMLButtonElement | null;
                if (btn) {
                    const original = btn.textContent || '';
                    btn.textContent = i18n.t('script.copied') || 'Kopyalandı';
                    setTimeout(() => {
                        btn.textContent = original;
                    }, 1000);
                }
            } catch (err) {
                console.error('Failed to copy script:', err);
            }
        });

        this.container.querySelector('#script-show-full')?.addEventListener('click', async () => {
            if (!this.currentPlan) return;
            await this.loadScriptPreview(this.currentPlan.file_info.path, true);
        });

        this.container.querySelector('#archive-choose')?.addEventListener('click', async () => {
            if (!this.currentPlan) return;
            const selected = await open({ directory: true, multiple: false });
            if (selected && typeof selected === 'string') {
                this.archiveDestination = selected;
                this.applyArchiveSelection(this.currentPlan, selected);
                this.render();
            }
        });

        if (isScriptPlan) {
            this.loadScriptPreview(plan.file_info.path, false);
        }

        this.show();
    }

    private buildNoConfirmPlan(plan: InstallPlan): InstallPlan {
        const steps = plan.steps.map(step => {
            if (!step.command) return step;
            return { ...step, command: this.applyNoConfirm(step.command) };
        });
        return { ...plan, steps };
    }

    private applyNoConfirm(command: string): string {
        let cmd = command;
        if (/\bapt\s+install\b/.test(cmd) && !/\s-y\b/.test(cmd)) {
            cmd = cmd.replace(/\bapt\s+install\b/, 'apt install -y');
        }
        if (/\bdnf\s+install\b/.test(cmd) && !/\s-y\b/.test(cmd)) {
            cmd = cmd.replace(/\bdnf\s+install\b/, 'dnf install -y');
        }
        if (/\bpacman\s+-U\b/.test(cmd) && !/--noconfirm/.test(cmd)) {
            cmd = cmd.replace(/\bpacman\s+-U\b/, 'pacman -U --noconfirm');
        }
        return cmd;
    }

    private isPackagePlan(plan: InstallPlan): boolean {
        const raw = plan.file_info?.installer_type;
        let installerType = '';
        if (typeof raw === 'string') {
            installerType = raw;
        } else if (raw && typeof raw === 'object') {
            const keys = Object.keys(raw as any);
            installerType = keys[0] || '';
        }
        return installerType === 'Deb' || installerType === 'Rpm' || installerType === 'ArchPkg';
    }

    private isScriptPlan(plan: InstallPlan): boolean {
        const raw = plan.file_info?.installer_type;
        if (typeof raw === 'string') {
            return raw === 'Script';
        }
        if (raw && typeof raw === 'object') {
            const keys = Object.keys(raw as any);
            return keys[0] === 'Script';
        }
        return false;
    }

    private isArchivePlan(plan: InstallPlan): boolean {
        const raw = plan.file_info?.installer_type;
        let installerType = '';
        if (typeof raw === 'string') {
            installerType = raw;
        } else if (raw && typeof raw === 'object') {
            const keys = Object.keys(raw as any);
            installerType = keys[0] || '';
        }
        return ['TarGz', 'TarXz', 'TarBz2', 'TarZst', 'Zip'].includes(installerType);
    }

    private applyArchiveSelection(plan: InstallPlan, destination: string) {
        const step = plan.steps.find(s => s.action && s.action.ExtractArchive);
        if (!step) {
            return;
        }
        const command = this.getArchiveCommand(plan, destination);
        step.command = command;
        step.description = `${i18n.t('archive.extract') || 'Arşivi aç'} → ${destination}`;
        plan.summary = `${i18n.t('archive.summary') || 'Arşiv açılacak'}: ${destination}`;
    }

    private getArchiveCommand(plan: InstallPlan, destination: string): string {
        const path = plan.file_info.path;
        const type = typeof plan.file_info.installer_type === 'string'
            ? plan.file_info.installer_type
            : Object.keys(plan.file_info.installer_type || {})[0];
        const src = this.escapeShell(path);
        const dest = this.escapeShell(destination);
        switch (type) {
            case 'TarGz':
                return `tar -xvzf ${src} -C ${dest}`;
            case 'TarXz':
                return `tar -xvJf ${src} -C ${dest}`;
            case 'TarBz2':
                return `tar -xvjf ${src} -C ${dest}`;
            case 'TarZst':
                return `tar --zstd -xvf ${src} -C ${dest}`;
            case 'Zip':
                return `unzip -o ${src} -d ${dest}`;
            default:
                return `tar -xvf ${src} -C ${dest}`;
        }
    }

    private getScriptRunCommand(path: string): string {
        return `bash ${this.escapeShell(path)}`;
    }

    private escapeShell(value: string): string {
        return `'${value.replace(/'/g, `'\\''`)}'`;
    }

    private renderPlanChips(plan: InstallPlan): string {
        const stepCount = plan.steps.length;
        const requiresRoot = plan.steps.some(step => step.requires_root);
        const typeLabel = this.getTypeLabel(plan.file_info?.installer_type);
        const parts = [
            `<span class="plan-chip">${i18n.t('planner.summary_steps') || 'Adım'}: ${stepCount}</span>`,
            `<span class="plan-chip">${i18n.t('planner.summary_root') || 'Root'}: ${requiresRoot ? (i18n.t('planner.yes') || 'Evet') : (i18n.t('planner.no') || 'Hayır')}</span>`,
            `<span class="plan-chip">${i18n.t('planner.summary_type') || 'Tür'}: ${typeLabel}</span>`
        ];
        return parts.join('');
    }

    private getTypeLabel(rawType: any): string {
        let type = '';
        if (typeof rawType === 'string') {
            type = rawType;
        } else if (rawType && typeof rawType === 'object') {
            const keys = Object.keys(rawType as any);
            type = keys[0] || '';
        }
        const labels: Record<string, string> = {
            'AppImage': 'AppImage',
            'Deb': 'Debian (.deb)',
            'Rpm': 'RPM (.rpm)',
            'ArchPkg': 'Arch (.pkg.tar.zst)',
            'Script': 'Script (.sh)',
            'TarGz': 'Arşiv (.tar.gz)',
            'TarXz': 'Arşiv (.tar.xz)',
            'TarBz2': 'Arşiv (.tar.bz2)',
            'TarZst': 'Arşiv (.tar.zst)',
            'Zip': 'Arşiv (.zip)',
            'Unknown': 'Bilinmeyen'
        };
        return labels[type] || type || 'Bilinmeyen';
    }

    private renderPackageAnalysis(): string {
        const analysis = this.packageAnalysis;
        if (!analysis) return '';
        const facts = [
            ['name', analysis.name],
            ['version', analysis.version],
            ['architecture', analysis.architecture],
            ['publisher', analysis.publisher],
            ['package_size', this.formatBytes(analysis.size_bytes)],
            ['installed_size', analysis.installed_size],
        ];
        const risks = analysis.risk_codes.map(code => `
            <li>${this.escapeHtml(i18n.t(`security.${code}`))}</li>
        `).join('');
        const files = analysis.files.map(file => this.escapeHtml(file)).join('\n');

        return `
            <section class="package-analysis">
                <div class="package-analysis-header">
                    <h3>${i18n.t('package_info.title')}</h3>
                    <span class="risk-badge ${analysis.risk_level}">${i18n.t(`security.level_${analysis.risk_level}`)}</span>
                </div>
                <div class="package-facts">
                    ${facts.map(([key, value]) => `<div><span>${i18n.t(`package_info.${key}`)}</span><strong>${this.escapeHtml(value)}</strong></div>`).join('')}
                </div>
                ${risks ? `<div class="security-warnings"><strong>${i18n.t('security.title')}</strong><ul>${risks}</ul></div>` : `<p class="security-clear">${i18n.t('security.no_known_risks')}</p>`}
                ${files ? `<details class="package-files"><summary>${i18n.t('package_info.files').replace('{count}', String(analysis.file_count))}</summary><pre>${files}</pre></details>` : ''}
            </section>
        `;
    }

    private formatBytes(bytes: number): string {
        if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GiB`;
        if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MiB`;
        if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
        return `${bytes} B`;
    }

    private escapeHtml(value: string): string {
        return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    private async loadScriptPreview(path: string, full: boolean) {
        const previewEl = this.container.querySelector('#script-preview');
        if (!previewEl) return;
        try {
            const args: { path: string; max_lines?: number | null } = { path };
            if (full) {
                args.max_lines = null;
            } else {
                args.max_lines = 120;
            }
            const content = await invoke<string>('read_text_preview', args);
            this.scriptContent = content;
            this.scriptTruncated = !full && content.includes('... (kisaltildi)');
            previewEl.textContent = content;
            const showFull = this.container.querySelector('#script-show-full') as HTMLButtonElement | null;
            if (showFull) {
                showFull.style.display = this.scriptTruncated ? '' : 'none';
            }
        } catch (err) {
            previewEl.textContent = i18n.t('script.preview_error') || 'Script okunamadi.';
            console.error(err);
        }
    }
}
