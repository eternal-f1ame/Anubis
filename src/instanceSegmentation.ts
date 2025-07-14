import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { COLOR_PALETTE, readProjectLabels, addLabelToProject, renameLabelInProject, deleteLabelFromProject } from './objectDetection';

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

function getInstanceWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    imageUrl: string,
    nonce: string,
    labels: { name: string; color: string }[],
    annotations?: any[]
): string {
    const fabricCdn = 'https://cdn.jsdelivr.net/npm/fabric@5.3.0/dist/fabric.min.js';
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'logic', 'instance.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'styles', 'instance.css'));
    const htmlPath = vscode.Uri.joinPath(extensionUri, 'media', 'html', 'instance.html');
    let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

    const cspSource = webview.cspSource;
    const csp = `default-src 'none'; img-src ${cspSource} data: https:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net;`;

    html = html.replace(/\${csp}/g, csp);
    html = html.replace(/\${nonce}/g, nonce);
    html = html.replace(/\${fabricCdn}/g, fabricCdn);
    html = html.replace(/\${webviewScript}/g, scriptUri.toString());
    html = html.replace(/\${webviewStylesheet}/g, styleUri.toString());

    // Inject data into the webview
    html = html.replace(
        '</head>',
        `<script nonce="${nonce}">
            window.imageUrl = "${imageUrl}";
            window.labels = ${JSON.stringify(labels)};
            window.initialAnnotations = ${JSON.stringify(annotations || null)};
        </script></head>`
    );

    return html;
}

function getWorkspaceRoot(): vscode.Uri | undefined {
	const ws = vscode.workspace.workspaceFolders;
	return ws && ws.length ? ws[0].uri : undefined;
}

export async function handleInstanceSegmentation(
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
			const annPath = vscode.Uri.joinPath(root, '/.annovis/instances', project, path.basename(target.fsPath) + '.json');
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
		'annovisInstanceSegmentation',
		`Instance Segmentation - ${path.basename(target.fsPath)} (${project})`,
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

	panel.webview.html = getInstanceWebviewContent(
		panel.webview,
		context.extensionUri,
		imageUri.toString(),
		nonce,
		labels,
		existingAnnotations
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
				const annDir = vscode.Uri.joinPath(root, '/.annovis/instances', project);
				await vscode.workspace.fs.createDirectory(annDir);
				const annFile = vscode.Uri.joinPath(annDir, path.basename(target.fsPath) + '.json');
				
				// Add metadata to annotations
				const annotationData = {
					metadata: {
						projectName: project,
						projectType: 'instance-segmentation' as const,
						imageName: path.basename(target.fsPath),
						created: new Date().toISOString(),
						version: '1.0'
					},
					annotations: annotations
				};
				
				await vscode.workspace.fs.writeFile(annFile, Buffer.from(JSON.stringify(annotationData, null, 2)));
				vscode.window.showInformationMessage('Instance annotations saved');
				break;
			}
		}
	});
} 