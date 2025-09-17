import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getWorkspaceRoot, getNonce, generateWebviewContent, COLOR_PALETTE, readProjectLabels, addLabelToProject, renameLabelInProject, deleteLabelFromProject } from './utils';

export async function handleObjectDetection(
	context: vscode.ExtensionContext,
	target: vscode.Uri,
	project: string
) {
	const labels = await readProjectLabels(project);
	// Attempt to load existing annotations
	let existingAnnotations: any[] | undefined = undefined;
	try {
		const root = getWorkspaceRoot();
		if (root) {
			const annPath = vscode.Uri.joinPath(root, '/.annovis/annotations', project, path.basename(target.fsPath) + '.json');
			const bytes = await vscode.workspace.fs.readFile(annPath);
			const data = JSON.parse(Buffer.from(bytes).toString());
			
			// Handle both new metadata format and legacy format
			if (data.metadata && data.annotations) {
				existingAnnotations = data.annotations;
			} else if (Array.isArray(data)) {
				// Legacy format - direct array of annotations
				existingAnnotations = data;
			}
		}
	} catch {/* file may not exist – that is fine */}

	const panel = vscode.window.createWebviewPanel(
		'annovisObjectDetection',
		`Object Detection - ${path.basename(target.fsPath)} (${project})`,
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
		{ annotationType: 'object-detection', includeFabric: true, dataProperty: 'initialAnnotations' }
	);

	// Message handler for webview interactions
	panel.webview.onDidReceiveMessage(async (msg) => {
		switch (msg.type) {
			case 'requestAddLabel': {
				const labelName = await vscode.window.showInputBox({ prompt: 'New label name' });
				if (!labelName) { return; }
				const { name, color, removedDefault } = await addLabelToProject(project, labelName);
				panel.webview.postMessage({ type: 'labelAdded', label: { name, color, removedDefault } });
				break;
			}
			case 'requestRenameLabel': {
				const current: string = msg.current;
				const newName = await vscode.window.showInputBox({ prompt: `Rename label '${current}' to:` });
				if (!newName || newName === current) { return; }
				const res = await renameLabelInProject(project, current, newName);
				if (res) {
					panel.webview.postMessage({ type: 'labelRenamed', oldName: current, newName });
				}
				break;
			}
			case 'requestDeleteLabel': {
				const name: string = msg.name;
				const confirm = await vscode.window.showWarningMessage(`Delete label '${name}' and its annotations?`, { modal: true }, 'Delete');
				if (confirm !== 'Delete') { return; }
				await deleteLabelFromProject(project, name);
				panel.webview.postMessage({ type: 'labelDeleted', name });
				break;
			}
			case 'saveAnnotation': {
				const annotations = msg.annotation;
				const root = getWorkspaceRoot();
				if (!root) { return; }
				const annDir = vscode.Uri.joinPath(root, '/.annovis/annotations', project);
				await vscode.workspace.fs.createDirectory(annDir);
				const annFile = vscode.Uri.joinPath(annDir, path.basename(target.fsPath) + '.json');
				
				// Add metadata to annotations
				const annotationData = {
					metadata: {
						projectName: project,
						projectType: 'object-detection' as const,
						imageName: path.basename(target.fsPath),
						created: new Date().toISOString(),
						version: '1.0'
					},
					annotations: annotations
				};
				
				await vscode.workspace.fs.writeFile(annFile, Buffer.from(JSON.stringify(annotationData, null, 2)));
				vscode.window.showInformationMessage('Annotations saved');
				break;
			}
		}
	});
} 