import * as vscode from 'vscode';
import * as path from 'path';
import { handleAnnotation, getWorkspaceRoot } from './utils';

export async function handleKeypointDetection(
	context: vscode.ExtensionContext,
	target: vscode.Uri,
	project: string
) {
	const root = getWorkspaceRoot();
	if (!root) {
		vscode.window.showErrorMessage('Cannot get workspace root.');
		return;
	}

	// Each image gets its own cache directory
	const cacheDir = vscode.Uri.joinPath(root, '.annovis', 'keypoints', project, '.cache', path.basename(target.fsPath));
	await vscode.workspace.fs.createDirectory(cacheDir);

	// Custom message handlers for keypoint-specific functionality
	const customMessageHandlers = async (msg: any, panel: vscode.WebviewPanel, project: string, target: vscode.Uri): Promise<boolean> => {
		switch (msg.type) {
			case 'writeCacheFile': {
				const filePath = vscode.Uri.joinPath(cacheDir, msg.file);
				try {
					await vscode.workspace.fs.writeFile(filePath, Buffer.from(JSON.stringify(msg.data, null, 2)));
				} catch (e) {
					vscode.window.showErrorMessage(`Failed to write cache file: ${e}`);
				}
				return true; // Handled
			}
			case 'moveCacheFile': {
				const fromPath = vscode.Uri.joinPath(cacheDir, msg.from);
				const toPath = vscode.Uri.joinPath(cacheDir, msg.to);
				try {
					await vscode.workspace.fs.rename(fromPath, toPath, { overwrite: true });
				} catch (e) {
					// Fails if source doesn't exist, which is fine.
				}
				return true; // Handled
			}
			case 'readCacheFile': {
				const filePath = vscode.Uri.joinPath(cacheDir, msg.file);
				try {
					const data = await vscode.workspace.fs.readFile(filePath);
					panel.webview.postMessage({ type: 'cacheFileData', file: msg.file, data: JSON.parse(data.toString()) });
				} catch (e) {
					panel.webview.postMessage({ type: 'cacheFileData', file: msg.file, data: null, error: `File not found` });
				}
				return true; // Handled
			}
		}
		return false; // Not handled, let default handler process it
	};

	await handleAnnotation(context, target, project, {
		directory: 'keypoints',
		panelId: 'annovisKeypointDetection',
		title: 'Keypoint Detection',
		projectType: 'keypoint-detection',
		saveMessageType: 'saveAnnotation',
		saveDataProperty: 'annotation',
		saveSuccessMessage: 'Keypoint annotations saved',
		includeFabric: true,
		dataProperty: 'initialAnnotations',
		customMessageHandlers
	});

	// Note: Cleanup would need to be handled by the unified handler
	// For now, we'll handle it here but this could be improved
}