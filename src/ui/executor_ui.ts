import { invoke } from '@tauri-apps/api/core';
import { InstallPlan } from './planner_ui';
import { TerminalCommandOptions, TerminalCommandResult } from './terminal_panel';
import { i18n } from '../core/i18n';
import { notifyUser } from '../core/notifications';
import { recordHistory } from '../core/history';

export interface ExecutionResult {
    plan_id: string;
    overall_status: any;
    step_results: StepResult[];
    installed_app_name: string | null;
    installed_app_path: string | null;
    installer_type?: string;
    package_name?: string | null;
    terminal_output?: string;
    executed_command?: string;
}

export interface StepResult {
    step_order: number;
    status: any;
    output: string | null;
    error: string | null;
}

export class ExecutorUI {
    private terminalRun: (command: string, options?: TerminalCommandOptions) => Promise<TerminalCommandResult>;
    private onComplete: (result: ExecutionResult) => void;

    constructor(
        terminalRun: (command: string, options?: TerminalCommandOptions) => Promise<TerminalCommandResult>,
        onComplete: (result: ExecutionResult) => void
    ) {
        this.terminalRun = terminalRun;
        this.onComplete = onComplete;
    }

    /**
     * Execute an installation plan
     * All command-bearing steps use the visible terminal so they share
     * queueing, cancellation, output capture and history behavior.
     */
    public async execute(plan: InstallPlan): Promise<void> {
        console.log('Executing plan:', plan);

        const appName = this.getAppName(plan.file_info.filename);
        const startedAt = new Date().toISOString();
        const commandSteps = plan.steps.filter(step => step.command);
        const stepResults: StepResult[] = [];
        let planId: string = crypto.randomUUID();
        let succeeded = true;
        let failureMessage = '';
        const executedCommands: string[] = [];
        const outputs: string[] = [];

        await notifyUser(
            i18n.t('notifications.install_started_title'),
            this.formatMessage(i18n.t('notifications.install_started_body'), appName)
        );

        try {
            if (succeeded) {
                for (const step of commandSteps) {
                    if (!step.command) continue;
                    const commandResult = await this.terminalRun(step.command, {
                        label: appName,
                        description: step.description,
                    });
                    executedCommands.push(step.command);
                    if (commandResult.output) outputs.push(commandResult.output);
                    const stepSucceeded = commandResult.exitCode === 0;
                    stepResults.push({
                        step_order: step.order,
                        status: stepSucceeded ? 'Success' : { Failed: `Exit code ${commandResult.exitCode}` },
                        output: null,
                        error: stepSucceeded ? null : `Exit code ${commandResult.exitCode}`,
                    });
                    if (!stepSucceeded) {
                        succeeded = false;
                        failureMessage = `Exit code ${commandResult.exitCode}`;
                        break;
                    }
                }
            }

            if (commandSteps.length === 0) {
                succeeded = false;
                failureMessage = i18n.t('notifications.no_command');
            }
        } catch (error) {
            succeeded = false;
            failureMessage = error instanceof Error ? error.message : String(error);
            console.error('Execution error:', error);
        }

        const result = await this.createExecutionResult(plan, planId, stepResults, succeeded, failureMessage);
        result.executed_command = executedCommands.join(' && ');
        result.terminal_output = outputs.join('\n\n');

        if (succeeded) {
            try {
                await invoke('save_receipt', { result });
                console.log('Receipt saved');
            } catch (error) {
                console.error('Failed to save receipt:', error);
            }
            await notifyUser(
                i18n.t('notifications.install_success_title'),
                this.formatMessage(i18n.t('notifications.install_success_body'), appName)
            );
        } else {
            await notifyUser(
                i18n.t('notifications.install_failed_title'),
                this.formatMessage(i18n.t('notifications.install_failed_body'), appName)
            );
        }

        await recordHistory({
            operation: 'install',
            app_name: appName,
            command: result.executed_command,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            status: succeeded ? 'success' : 'failed',
            exit_code: succeeded ? 0 : this.getExitCode(stepResults),
            output: result.terminal_output,
        });

        this.onComplete(result);
    }

    /**
     * Execute a single command in the terminal
     */
    public async executeInTerminal(command: string): Promise<void> {
        await this.terminalRun(command, { label: command });
    }

    private async createExecutionResult(
        plan: InstallPlan,
        planId: string,
        stepResults: StepResult[],
        succeeded: boolean,
        failureMessage: string
    ): Promise<ExecutionResult> {
        const installerType = this.getInstallerType(plan);
        let packageName: string | null = null;
        if (installerType === 'Deb' || installerType === 'Rpm' || installerType === 'ArchPkg') {
            try {
                const meta = await invoke<{ installer_type: string; package_name: string | null }>(
                    'get_package_metadata',
                    { path: plan.file_info.path }
                );
                packageName = meta.package_name;
            } catch (error) {
                console.error('Failed to read package metadata:', error);
            }
            if (!packageName) {
                packageName = this.getPackageNameFromFilename(plan.file_info.filename, installerType);
            }
        }

        return {
            plan_id: planId,
            overall_status: succeeded ? 'Success' : { Failed: failureMessage || 'Command failed' },
            step_results: stepResults,
            installed_app_name: this.getAppName(plan.file_info.filename),
            installed_app_path: this.isAppImagePlan(plan)
                ? this.getAppImageDestination(plan) || plan.file_info.path
                : plan.file_info.path,
            installer_type: installerType,
            package_name: packageName,
        };
    }

    private formatMessage(message: string, appName: string): string {
        return message.replace('{app}', appName);
    }

    private getExitCode(stepResults: StepResult[]): number | null {
        const error = stepResults.find(step => step.error)?.error || '';
        const match = error.match(/Exit code (\d+)/i);
        return match ? Number.parseInt(match[1], 10) : 1;
    }

    private getAppName(filename: string): string {
        return filename
            .replace(/\.AppImage$/i, '')
            .replace(/\.deb$/i, '')
            .replace(/\.rpm$/i, '')
            .replace(/\.pkg\.tar\.zst$/i, '')
            .replace(/\.pkg\.tar\.xz$/i, '')
            .replace(/\.sh$/i, '')
            .replace(/\.tar\.gz$/i, '')
            .replace(/\.tar\.xz$/i, '')
            .replace(/\.tar\.bz2$/i, '')
            .replace(/\.tar\.zst$/i, '')
            .replace(/\.zip$/i, '');
    }

    private isAppImagePlan(plan: InstallPlan): boolean {
        if (plan.file_info?.filename?.toLowerCase().endsWith('.appimage')) {
            return true;
        }
        if (plan.file_info?.installer_type === 'AppImage') {
            return true;
        }
        if (plan.file_info?.installer_type && (plan.file_info.installer_type as any).AppImage !== undefined) {
            return true;
        }
        return plan.steps.some(step => step.action && step.action.InstallAppImage);
    }

    private getInstallerType(plan: InstallPlan): string {
        const raw = plan.file_info?.installer_type;
        if (typeof raw === 'string') {
            return raw;
        }
        if (raw && typeof raw === 'object') {
            const keys = Object.keys(raw as any);
            if (keys.length > 0) {
                return keys[0];
            }
        }
        return 'Unknown';
    }

    private getPackageNameFromFilename(filename: string, installerType: string): string | null {
        const lower = filename.toLowerCase();
        if (installerType === 'Deb') {
            const base = lower.endsWith('.deb') ? filename.slice(0, -4) : filename;
            return base.split('_')[0] || null;
        }
        if (installerType === 'Rpm') {
            const base = lower.endsWith('.rpm') ? filename.slice(0, -4) : filename;
            const withoutArch = base.replace(/\.[^.]+$/, '');
            const parts = withoutArch.split('-');
            if (parts.length >= 3) {
                return parts.slice(0, -2).join('-');
            }
            return parts[0] || null;
        }
        if (installerType === 'ArchPkg') {
            const base = lower.endsWith('.pkg.tar.zst')
                ? filename.slice(0, -12)
                : lower.endsWith('.pkg.tar.xz')
                    ? filename.slice(0, -11)
                    : filename;
            const parts = base.split('-');
            if (parts.length >= 4) {
                return parts.slice(0, -3).join('-');
            }
            return parts[0] || null;
        }
        return this.getAppName(filename);
    }

    private getAppImageDestination(plan: InstallPlan): string | null {
        const step = plan.steps.find(s => s.action && s.action.InstallAppImage);
        if (step && step.action && step.action.InstallAppImage?.destination) {
            return step.action.InstallAppImage.destination;
        }
        return `$HOME/Applications/${plan.file_info.filename}`;
    }
}
