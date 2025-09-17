import * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * Color palette for annotation labels
 */
export const COLOR_PALETTE = [
	'#e6194b','#3cb44b','#ffe119','#4363d8','#f58231','#911eb4','#46f0f0','#f032e6',
	'#bcf60c','#fabebe','#008080','#e6beff','#9a6324','#fffac8','#800000','#aaffc3','#808000'
];

/**
 * Gets the root URI of the current workspace
 * @returns The workspace root URI, or undefined if no workspace is open
 */
export function getWorkspaceRoot(): vscode.Uri | undefined {
	const ws = vscode.workspace.workspaceFolders;
	return ws && ws.length ? ws[0].uri : undefined;
}

/**
 * Generates a random nonce string for Content Security Policy
 * @returns A 32-character random string containing letters and numbers
 */
export function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

/**
 * Configuration for webview content generation
 */
export interface WebviewConfig {
	/** The annotation type (used for file paths) */
	annotationType: string;
	/** Whether to include Fabric.js CDN */
	includeFabric?: boolean;
	/** The data property name for injection (e.g., 'initialAnnotations' or 'initialClassification') */
	dataProperty?: string;
}

/**
 * Generates webview HTML content for annotation types
 * @param webview The VS Code webview instance
 * @param extensionUri The extension's URI
 * @param imageUrl The image URL to display
 * @param nonce The CSP nonce
 * @param labels Array of label objects with name and color
 * @param data Optional data to inject (annotations or classification)
 * @param config Configuration for the specific annotation type
 * @returns The complete HTML string for the webview
 */
export function generateWebviewContent(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	imageUrl: string,
	nonce: string,
	labels: { name: string; color: string }[],
	data?: any,
	config: WebviewConfig = { annotationType: 'object-detection', includeFabric: true, dataProperty: 'initialAnnotations' }
): string {
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'logic', `${config.annotationType}.js`));
	const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'styles', `${config.annotationType}.css`));
	const htmlPath = vscode.Uri.joinPath(extensionUri, 'media', 'html', `${config.annotationType}.html`);
	let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

	const cspSource = webview.cspSource;
	let csp = `default-src 'none'; img-src ${cspSource} data: https:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'`;
	
	// Add Fabric.js CDN to CSP if needed
	if (config.includeFabric) {
		csp += ' https://cdn.jsdelivr.net';
	}
	csp += ';';

	// Replace placeholders in HTML
	html = html.replace(/\${csp}/g, csp);
	html = html.replace(/\${nonce}/g, nonce);
	html = html.replace(/\${webviewScript}/g, scriptUri.toString());
	html = html.replace(/\${webviewStylesheet}/g, styleUri.toString());

	// Add Fabric.js CDN if needed
	if (config.includeFabric) {
		const fabricCdn = 'https://cdn.jsdelivr.net/npm/fabric@5.3.0/dist/fabric.min.js';
		html = html.replace(/\${fabricCdn}/g, fabricCdn);
	}

	// Inject data into the webview
	const dataPropertyName = config.dataProperty || 'initialAnnotations';
	html = html.replace(
		'</head>',
		`<script nonce="${nonce}">
			window.imageUrl = "${imageUrl}";
			window.labels = ${JSON.stringify(labels)};
			window.${dataPropertyName} = ${JSON.stringify(data || null)};
		</script></head>`
	);

	return html;
}

/**
 * Reads project labels from the project configuration file
 * @param project The project name
 * @returns Array of label objects with name and color properties
 */
export async function readProjectLabels(project: string): Promise<{name: string, color: string}[]> {
	const root = getWorkspaceRoot();
	if (!root) {return [];}
	const file = vscode.Uri.joinPath(root, '/.annovis/projects', project, 'project.json');
	try {
		const bytes = await vscode.workspace.fs.readFile(file);
		return JSON.parse(Buffer.from(bytes).toString()).labels;
	} catch {
		return [];
	}
}

/**
 * Adds a new label to a project
 * @param project The project name
 * @param labelName The name of the new label
 * @returns Object with the new label's name, color, and whether default was removed
 */
export async function addLabelToProject(project: string, labelName: string): Promise<{name: string, color: string, removedDefault: boolean}> {
	const labels = await readProjectLabels(project);
	const usedColors = labels.map(l => l.color);
	let removedDefault = false;
	if (labels.length === 1 && labels[0].name === 'Object') {
		labels.length = 0;
		removedDefault = true;
	}
	const nextColor = COLOR_PALETTE.find(c => !usedColors.includes(c)) || '#' + Math.floor(Math.random() * 16777215).toString(16);
	labels.push({name: labelName, color: nextColor});
	const root = getWorkspaceRoot();
	if (root) {
		const file = vscode.Uri.joinPath(root, '/.annovis/projects', project, 'project.json');
		
		// Read the existing project data to preserve all fields
		const bytes = await vscode.workspace.fs.readFile(file);
		const existingData = JSON.parse(Buffer.from(bytes).toString());
		existingData.labels = labels;
		await vscode.workspace.fs.writeFile(file, Buffer.from(JSON.stringify(existingData, null, 2)));
	}
	return {name: labelName, color: nextColor, removedDefault};
}

/**
 * Renames an existing label in a project
 * @param project The project name
 * @param oldName The current label name
 * @param newName The new label name
 * @returns The updated label object or null if not found
 */
export async function renameLabelInProject(project: string, oldName: string, newName: string) {
	const labels = await readProjectLabels(project);
	const l = labels.find(l => l.name === oldName);
	if (!l) {return null;}
	l.name = newName;
	const root = getWorkspaceRoot();
	if (root) {
		const file = vscode.Uri.joinPath(root, '/.annovis/projects', project, 'project.json');
		
		// Read the existing project data to preserve all fields
		const bytes = await vscode.workspace.fs.readFile(file);
		const existingData = JSON.parse(Buffer.from(bytes).toString());
		existingData.labels = labels;
		await vscode.workspace.fs.writeFile(file, Buffer.from(JSON.stringify(existingData, null, 2)));
	}
	return l;
}

/**
 * Deletes a label from a project
 * @param project The project name
 * @param name The label name to delete
 * @returns The updated labels array
 */
export async function deleteLabelFromProject(project: string, name: string) {
	let labels = await readProjectLabels(project);
	labels = labels.filter(l => l.name !== name);
	const root = getWorkspaceRoot();
	if (root) {
		const file = vscode.Uri.joinPath(root, '/.annovis/projects', project, 'project.json');
		
		// Read the existing project data to preserve all fields
		const bytes = await vscode.workspace.fs.readFile(file);
		const existingData = JSON.parse(Buffer.from(bytes).toString());
		existingData.labels = labels;
		await vscode.workspace.fs.writeFile(file, Buffer.from(JSON.stringify(existingData, null, 2)));
	}
	return labels;
}
