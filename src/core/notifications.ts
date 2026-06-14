import {
    isPermissionGranted,
    requestPermission,
    sendNotification,
} from '@tauri-apps/plugin-notification';

let permissionRequest: Promise<boolean> | null = null;

async function ensurePermission(): Promise<boolean> {
    if (await isPermissionGranted()) {
        return true;
    }

    if (!permissionRequest) {
        permissionRequest = requestPermission()
            .then(permission => permission === 'granted')
            .catch(() => false);
    }

    return permissionRequest;
}

export async function notifyUser(title: string, body: string): Promise<void> {
    try {
        if (!await ensurePermission()) {
            return;
        }
        sendNotification({ title, body });
    } catch (error) {
        console.error('Failed to send notification:', error);
    }
}
