import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { readProjectLabels, addLabelToProject, renameLabelInProject, deleteLabelFromProject } from './objectDetection';

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

function getClassificationWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    imageUrl: string,
    nonce: string,
    labels: { name: string; color: string }[],
    classification?: any
): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'classification.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'classification.css'));
    const htmlPath = vscode.Uri.joinPath(extensionUri, 'media', 'classification.html');
    let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

    const cspSource = webview.cspSource;
    const csp = `default-src 'none'; img-src ${cspSource} data: https:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;

    html = html.replace(/\${csp}/g, csp);
    html = html.replace(/\${nonce}/g, nonce);
    html = html.replace(/\${webviewScript}/g, scriptUri.toString());
    html = html.replace(/\${webviewStylesheet}/g, styleUri.toString());

    // Inject data into the webview
    html = html.replace(
        '</head>',
        `<script nonce="${nonce}">
            window.imageUrl = "${imageUrl}";
            window.labels = ${JSON.stringify(labels)};
            window.initialClassification = ${JSON.stringify(classification || null)};
        </script></head>`
    );

    return html;
}

function getWorkspaceRoot(): vscode.Uri | undefined {
	const ws = vscode.workspace.workspaceFolders;
	return ws && ws.length ? ws[0].uri : undefined;
}

export async function handleImageClassification(
	context: vscode.ExtensionContext,
	target: vscode.Uri,
	project: string
) {
	const labels = await readProjectLabels(project);
	// Attempt to load existing classification
	let existingClassification: any | undefined = undefined;
	try {
		const root = getWorkspaceRoot();
		if (root) {
			const classPath = vscode.Uri.joinPath(root, '/.annovis/classifications', project, path.basename(target.fsPath) + '.json');
			const bytes = await vscode.workspace.fs.readFile(classPath);
			const data = JSON.parse(Buffer.from(bytes).toString());
			
			// Handle both new metadata format and legacy format
			if (data.metadata && data.classification) {
				existingClassification = data.classification;
			} else if (data.labels || data.timestamp) {
				// Legacy format - direct classification object
				existingClassification = data;
			}
		}
	} catch {/* file may not exist – that is fine */}

	const panel = vscode.window.createWebviewPanel(
		'annovisImageClassification',
		`Image Classification - ${path.basename(target.fsPath)}`,
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

	panel.webview.html = getClassificationWebviewContent(
		panel.webview,
		context.extensionUri,
		imageUri.toString(),
		nonce,
		labels,
		existingClassification
	);

	// Message handler for webview interactions
	panel.webview.onDidReceiveMessage(async (msg) => {
		switch (msg.type) {
			case 'requestAddLabel': {
				const labelName = await vscode.window.showInputBox({ prompt: 'New label name' });
				if (!labelName) { return; }
				const { name, color } = await addLabelToProject(project, labelName);
				panel.webview.postMessage({ type: 'labelAdded', label: { name, color } });
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
				const confirm = await vscode.window.showWarningMessage(`Delete label '${name}' and its classifications?`, { modal: true }, 'Delete');
				if (confirm !== 'Delete') { return; }
				await deleteLabelFromProject(project, name);
				panel.webview.postMessage({ type: 'labelDeleted', name });
				break;
			}
			case 'saveClassification': {
				const classification = msg.classification;
				const root = getWorkspaceRoot();
				if (!root) { return; }
				const classDir = vscode.Uri.joinPath(root, '/.annovis/classifications', project);
				await vscode.workspace.fs.createDirectory(classDir);
				const classFile = vscode.Uri.joinPath(classDir, path.basename(target.fsPath) + '.json');
				
				// Add metadata to classification
				const classificationData = {
					metadata: {
						projectName: project,
						projectType: 'image-classification' as const,
						imageName: path.basename(target.fsPath),
						created: new Date().toISOString(),
						version: '1.0'
					},
					classification: classification
				};
				
				await vscode.workspace.fs.writeFile(classFile, Buffer.from(JSON.stringify(classificationData, null, 2)));
				vscode.window.showInformationMessage('Classification saved');
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