import { invoke } from '@tauri-apps/api/core';

export interface HistoryEntry {
    id?: string;
    operation: string;
    app_name: string;
    command: string;
    started_at: string;
    finished_at: string;
    status: 'success' | 'failed' | 'cancelled';
    exit_code: number | null;
    output: string;
}

export async function recordHistory(entry: HistoryEntry): Promise<void> {
    try {
        await invoke('record_history', { entry });
        window.dispatchEvent(new CustomEvent('linux-install-manager:history-changed'));
    } catch (error) {
        console.error('Failed to record history:', error);
    }
}
