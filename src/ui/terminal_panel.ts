import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { themeService } from '../core/theme';
import { i18n } from '../core/i18n';
import 'xterm/css/xterm.css';

export type TerminalOperationStatus = 'ready' | 'running' | 'success' | 'failed';

export interface TerminalCommandResult {
    exitCode: number;
    output: string;
    command: string;
}

export interface TerminalCommandOptions {
    label?: string;
    description?: string;
}

export class TerminalPanel {
    private term: Terminal;
    private fitAddon: FitAddon;
    private container: HTMLElement;
    private btnCopy: HTMLButtonElement | null = null;
    private btnClear: HTMLButtonElement | null = null;
    private btnCancel: HTMLButtonElement | null = null;
    private btnRetry: HTMLButtonElement | null = null;
    private statusEl: HTMLElement | null = null;
    private commandEl: HTMLElement | null = null;
    private queueEl: HTMLElement | null = null;
    private markerBuffer = '';
    private activeCommand: {
        token: string;
        command: string;
        options: TerminalCommandOptions;
        output: string;
        resolve: (result: TerminalCommandResult) => void;
        reject: (error: Error) => void;
    } | null = null;
    private queuedCommands: Array<{
        command: string;
        options: TerminalCommandOptions;
        resolve: (result: TerminalCommandResult) => void;
        reject: (error: Error) => void;
    }> = [];
    private lastCommand: { command: string; options: TerminalCommandOptions } | null = null;
    private operationStatus: TerminalOperationStatus = 'ready';
    private operationLabel = '';

    constructor(containerId: string) {
        const el = document.getElementById(containerId);
        if (!el) throw new Error(`Container ${containerId} not found`);
        this.container = el;
        this.btnCopy = document.getElementById('terminal-copy') as HTMLButtonElement | null;
        this.btnClear = document.getElementById('terminal-clear') as HTMLButtonElement | null;
        this.btnCancel = document.getElementById('terminal-cancel') as HTMLButtonElement | null;
        this.btnRetry = document.getElementById('terminal-retry') as HTMLButtonElement | null;
        this.statusEl = document.getElementById('terminal-status');
        this.commandEl = document.getElementById('terminal-command');
        this.queueEl = document.getElementById('terminal-queue');

        this.term = new Terminal({
            cursorBlink: true,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            fontSize: 14,
            theme: this.getThemeColors(),
            allowProposedApi: true
        });

        this.fitAddon = new FitAddon();
        this.term.loadAddon(this.fitAddon);

        this.init();
    }

    private getThemeColors() {
        const isDark = themeService.getTheme() === 'dark' ||
            (themeService.getTheme() === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

        return {
            background: isDark ? '#1f2937' : '#ffffff', // gray-800 : white
            foreground: isDark ? '#f3f4f6' : '#111827', // gray-100 : gray-900
            cursor: isDark ? '#ffffff' : '#000000',
        };
    }

    private async init() {
        this.term.open(this.container);
        this.fitAddon.fit();

        // Listen for window resize to resize terminal
        window.addEventListener('resize', () => {
            this.fitAddon.fit();
            this.syncSize();
        });

        // Handle theme changes
        document.addEventListener('theme-changed', () => {
            this.term.options.theme = this.getThemeColors();
        });
        document.addEventListener('language-changed', () => {
            this.renderOperationStatus();
            this.renderQueue();
        });

        // Data from PTY -> Xterm
        await listen('pty-data', (event: any) => {
            // event.payload is string (assuming text)
            const data = event.payload as string;
            this.term.write(data);
            if (this.activeCommand) {
                this.activeCommand.output += data;
                if (this.activeCommand.output.length > 50_000) {
                    this.activeCommand.output = this.activeCommand.output.slice(-50_000);
                }
            }
            this.consumeCommandMarkers(data);
            window.dispatchEvent(new CustomEvent('linux-install-manager:terminal-output', {
                detail: { data }
            }));
        });

        // Data from Xterm -> PTY
        this.term.onData((data) => {
            invoke('write_shell', { data }).catch(console.error);
        });

        this.btnCopy?.addEventListener('click', () => this.copyAll());
        this.btnClear?.addEventListener('click', () => this.term.clear());
        this.btnCancel?.addEventListener('click', () => this.cancelActive());
        this.btnRetry?.addEventListener('click', () => this.retryLast());

        await this.startShell();
        this.setOperationStatus('ready');
    }

    private async startShell() {
        try {
            await invoke('start_shell');
            this.syncSize();
        } catch (e) {
            this.term.write('\r\nFailed to start shell: ' + e + '\r\n');
        }
    }

    private syncSize() {
        // Need to calculate cols/rows based on terminal size
        const cols = this.term.cols;
        const rows = this.term.rows;
        invoke('resize_shell', { cols, rows }).catch(console.error);
    }

    public writeOutput(data: string) {
        this.term.write(data);
    }

    public setOperationStatus(status: TerminalOperationStatus, label = '') {
        this.operationStatus = status;
        this.operationLabel = label;
        this.renderOperationStatus();
    }

    public async runCommand(command: string, options: TerminalCommandOptions = {}): Promise<TerminalCommandResult> {
        return new Promise<TerminalCommandResult>((resolve, reject) => {
            this.queuedCommands.push({ command, options, resolve, reject });
            this.renderQueue();
            void this.processNextCommand();
        });
    }

    public async cancelActive(): Promise<void> {
        if (!this.activeCommand) return;
        await invoke('write_shell', { data: '\u0003' });
    }

    public retryLast(): void {
        if (!this.lastCommand || this.activeCommand) return;
        window.dispatchEvent(new CustomEvent('linux-install-manager:run-terminal-command', {
            detail: {
                command: this.lastCommand.command,
                label: this.lastCommand.options.label,
                description: this.lastCommand.options.description,
                operation: 'retry',
            }
        }));
    }

    public getQueuedCount(): number {
        return this.queuedCommands.length;
    }

    private async processNextCommand(): Promise<void> {
        if (this.activeCommand) return;
        const next = this.queuedCommands.shift();
        if (!next) {
            this.renderQueue();
            return;
        }

        const token = crypto.randomUUID();
        const label = next.options.label || next.command;
        const description = next.options.description ? `\n# ${next.options.description}\n` : '\n';
        const markerCommand = `__lim_status=$?; printf '\\033]777;lim-command;${token};%s\\007' "$__lim_status"`;
<<<<<<< HEAD
        // Keep the completion marker in the same parsed shell line. Interactive
        // tools such as sudo or apt can otherwise consume a following line as
        // password or confirmation input before Bash gets a chance to run it.
        const commandLine = `{\n${next.command}\n}; ${markerCommand}`;
=======
>>>>>>> 39c985bac17e2f2f24011c5be7a338a4ef1b0bbd
        this.activeCommand = {
            token,
            command: next.command,
            options: next.options,
            output: '',
            resolve: next.resolve,
            reject: next.reject,
        };
        this.setOperationStatus('running', label);
        this.renderQueue();

        try {
<<<<<<< HEAD
            await invoke('write_shell', { data: `${description}${commandLine}\n` });
=======
            await invoke('write_shell', { data: `${description}${next.command}\n${markerCommand}\n` });
>>>>>>> 39c985bac17e2f2f24011c5be7a338a4ef1b0bbd
        } catch (error) {
            const active = this.activeCommand;
            this.activeCommand = null;
            this.setOperationStatus('failed', label);
            active?.reject(error instanceof Error ? error : new Error(String(error)));
            this.renderQueue();
            void this.processNextCommand();
        }
    }

    private consumeCommandMarkers(data: string) {
        this.markerBuffer += data;
        const markerPattern = /\x1b\]777;lim-command;([0-9a-f-]+);(\d+)\x07/g;
        let match: RegExpExecArray | null;
        let consumedUntil = 0;

        while ((match = markerPattern.exec(this.markerBuffer)) !== null) {
            consumedUntil = markerPattern.lastIndex;
            const active = this.activeCommand;
            if (!active || active.token !== match[1]) {
                continue;
            }

            const exitCode = Number.parseInt(match[2], 10);
            const label = this.operationLabel;
            const command = active.command;
            const output = this.cleanOutput(active.output);
            this.lastCommand = { command, options: active.options };
            this.activeCommand = null;
            this.setOperationStatus(exitCode === 0 ? 'success' : 'failed', label);
            active.resolve({ exitCode, output, command });
            this.renderQueue();
            void this.processNextCommand();
        }

        if (consumedUntil > 0) {
            this.markerBuffer = this.markerBuffer.slice(consumedUntil);
        }
        if (this.markerBuffer.length > 8192) {
            this.markerBuffer = this.markerBuffer.slice(-8192);
        }
    }

    private renderOperationStatus() {
        if (this.statusEl) {
            this.statusEl.className = `terminal-status ${this.operationStatus}`;
            this.statusEl.textContent = i18n.t(`terminal.status_${this.operationStatus}`);
        }
        if (this.commandEl) {
            this.commandEl.textContent = this.operationLabel;
            this.commandEl.title = this.operationLabel;
        }
    }

    private renderQueue() {
        if (this.queueEl) {
            this.queueEl.textContent = this.queuedCommands.length > 0
                ? i18n.t('terminal.queued').replace('{count}', String(this.queuedCommands.length))
                : '';
        }
        if (this.btnCancel) {
            this.btnCancel.disabled = !this.activeCommand;
        }
        if (this.btnRetry) {
            this.btnRetry.disabled = !this.lastCommand || Boolean(this.activeCommand);
        }
    }

    private cleanOutput(output: string): string {
        return output
            .replace(/\x1b\][^\x07]*\x07/g, '')
            .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
            .replace(/\r/g, '')
            .trim();
    }

    private copyAll() {
        this.term.selectAll();
        const text = this.term.getSelection();
        this.term.clearSelection();
        if (!text) {
            return;
        }
        navigator.clipboard.writeText(text).catch(console.error);
    }
}
