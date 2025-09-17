import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getWorkspaceRoot, getNonce, generateWebviewContent, COLOR_PALETTE, readProjectLabels, addLabelToProject, renameLabelInProject, deleteLabelFromProject } from './utils';

export async function handleKeypointDetection(
	context: vscode.ExtensionContext,
	target: vscode.Uri,
	project: string
) {
	const labels = await readProjectLabels(project);
	// Attempt to load existing annotations
	let existingAnnotations: any | undefined = undefined;
	try {
		const root = getWorkspaceRoot();
		if (root) {
			const annPath = vscode.Uri.joinPath(root, '/.annovis/keypoints', project, path.basename(target.fsPath) + '.json');
			const bytes = await vscode.workspace.fs.readFile(annPath);
			const data = JSON.parse(Buffer.from(bytes).toString());
			
			// Handle both new metadata format and legacy format
			if (data.metadata && (data.annotations || data.connections)) {
				existingAnnotations = data; // Pass the whole object
			} else if (Array.isArray(data)) {
				// Legacy format - direct array of annotations
				existingAnnotations = { annotations: { annotations: data, connections: [] } };
			}
		}
	} catch {/* file may not exist – that is fine */}

	const panel = vscode.window.createWebviewPanel(
		'annovisKeypointDetection',
		`Keypoint Detection - ${path.basename(target.fsPath)} (${project})`,
		vscode.ViewColumn.One, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [
				vscode.Uri.file(path.dirname(target.fsPath)),
				vscode.Uri.joinPath(context.extensionUri, 'media')
			]
		}
	);
	const imageUri = panel.webview.asWebviewUri(target);
	const nonce = getNonce();

	panel.webview.html = generateWebviewContent(
		panel.webview,
		context.extensionUri,
		imageUri.toString(),
		nonce,
		labels,
		existingAnnotations,
		{ annotationType: 'keypoint-detection', includeFabric: true, dataProperty: 'initialAnnotations' }
	);

    const root = getWorkspaceRoot();
    if (!root) {
        vscode.window.showErrorMessage('Cannot get workspace root.');
        return;
    }
    // Each image gets its own cache directory
    const cacheDir = vscode.Uri.joinPath(root, '.annovis', 'keypoints', project, '.cache', path.basename(target.fsPath));
    await vscode.workspace.fs.createDirectory(cacheDir);

	// Cleanup when panel is disposed
	panel.onDidDispose(async () => {
		try {
            await vscode.workspace.fs.delete(cacheDir, { recursive: true });
        } catch (e) {
            console.error('Failed to clean up cache directory:', e);
        }
	});

	// Message handler for webview interactions
	panel.webview.onDidReceiveMessage(async (msg) => {
		switch (msg.type) {
            case 'writeCacheFile': {
                const filePath = vscode.Uri.joinPath(cacheDir, msg.file);
                try {
                    await vscode.workspace.fs.writeFile(filePath, Buffer.from(JSON.stringify(msg.data, null, 2)));
                } catch (e) {
                    vscode.window.showErrorMessage(`Failed to write cache file: ${e}`);
                }
                break;
            }
            case 'moveCacheFile': {
                const fromPath = vscode.Uri.joinPath(cacheDir, msg.from);
                const toPath = vscode.Uri.joinPath(cacheDir, msg.to);
                try {
                    await vscode.workspace.fs.rename(fromPath, toPath, { overwrite: true });
                } catch (e) {
                    // Fails if source doesn't exist, which is fine.
                }
                break;
            }
            case 'readCacheFile': {
                const filePath = vscode.Uri.joinPath(cacheDir, msg.file);
                try {
                    const data = await vscode.workspace.fs.readFile(filePath);
                    panel.webview.postMessage({ type: 'cacheFileData', file: msg.file, data: JSON.parse(data.toString()) });
                } catch (e) {
                    panel.webview.postMessage({ type: 'cacheFileData', file: msg.file, data: null, error: `File not found` });
                }
                break;
            }
			case 'requestAddLabel': {
				const labelName = await vscode.window.showInputBox({ prompt: 'New keypoint label name' });
				if (!labelName) { return; }
				const { name, color, removedDefault } = await addLabelToProject(project, labelName);
				panel.webview.postMessage({ type: 'labelAdded', label: { name, color, removedDefault } });
				break;
			}
			case 'requestRenameLabel': {
				const current: string = msg.current;
				const newName = await vscode.window.showInputBox({ prompt: `Rename keypoint label '${current}' to:` });
				if (!newName || newName === current) { return; }
				const res = await renameLabelInProject(project, current, newName);
				if (res) {
					panel.webview.postMessage({ type: 'labelRenamed', oldName: current, newName });
				}
				break;
			}
			case 'requestDeleteLabel': {
				const name: string = msg.name;
				const confirm = await vscode.window.showWarningMessage(`Delete keypoint label '${name}' and its annotations?`, { modal: true }, 'Delete');
				if (confirm !== 'Delete') { return; }
				await deleteLabelFromProject(project, name);
				panel.webview.postMessage({ type: 'labelDeleted', name });
				break;
			}
			case 'saveAnnotation': {
				const annotationObject = msg.annotation;
				const root = getWorkspaceRoot();
				if (!root) { return; }
				
				const annDir = vscode.Uri.joinPath(root, '/.annovis/keypoints', project);
				await vscode.workspace.fs.createDirectory(annDir);
				const annFile = vscode.Uri.joinPath(annDir, path.basename(target.fsPath) + '.json');
				
				// Add metadata to annotations
				const annotationData = {
					metadata: {
						projectName: project,
						projectType: 'keypoint-detection' as const,
						imageName: path.basename(target.fsPath),
						created: new Date().toISOString(),
						version: '1.0'
					},
					annotations: annotationObject.annotations,
					connections: annotationObject.connections
				};
				
				await vscode.workspace.fs.writeFile(annFile, Buffer.from(JSON.stringify(annotationData, null, 2)));
				vscode.window.showInformationMessage('Keypoint annotations saved');
				break;
			}
			case 'showError': {
				const message: string = msg.message;
				vscode.window.showErrorMessage(message);
				break;
			}
		}
	});
}