import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

function getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    imageUrl: string,
    nonce: string,
    labels: { name: string; color: string }[],
    annotations?: any[]
): string {
    const fabricCdn = 'https://cdn.jsdelivr.net/npm/fabric@5.3.0/dist/fabric.min.js';
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.css'));
    const htmlPath = vscode.Uri.joinPath(extensionUri, 'media', 'webview.html');
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

const PROJECT_KEY = 'annovis.currentProject';
const COLOR_PALETTE = [
	'#e6194b','#3cb44b','#ffe119','#4363d8','#f58231','#911eb4','#46f0f0','#f032e6',
	'#bcf60c','#fabebe','#008080','#e6beff','#9a6324','#fffac8','#800000','#aaffc3','#808000'
];

function getWorkspaceRoot(): vscode.Uri | undefined {
	const ws = vscode.workspace.workspaceFolders;
	return ws && ws.length ? ws[0].uri : undefined;
}

async function selectProject(context:vscode.ExtensionContext):Promise<string|undefined>{
	const root = getWorkspaceRoot();
	if(!root){ vscode.window.showErrorMessage('Open a workspace folder first'); return; }
	const projectsRoot = vscode.Uri.joinPath(root,'/.annovis/projects');
	await vscode.workspace.fs.createDirectory(projectsRoot);
	const entries = await vscode.workspace.fs.readDirectory(projectsRoot);
	const names = entries.filter(([name,type])=>type===vscode.FileType.Directory).map(([n])=>n);
	const pick = await vscode.window.showQuickPick(['+ New Project',...names],{placeHolder:'Select project'});
	if(!pick) return;
	let projectName = pick;
	if(pick==='+ New Project'){
		const input = await vscode.window.showInputBox({prompt:'Project name'});
		if(!input) return; projectName=input;
	}
	context.globalState.update(PROJECT_KEY, projectName);
	return projectName;
}

async function ensureProjectSetup(project:string){
	const root = getWorkspaceRoot(); if(!root) return;
	const projDir = vscode.Uri.joinPath(root,'/.annovis/projects',project);
	await vscode.workspace.fs.createDirectory(projDir);
	const projFile = vscode.Uri.joinPath(projDir,'project.json');
	try{ await vscode.workspace.fs.stat(projFile);}catch{
		const initial = Buffer.from(JSON.stringify({labels:[{name:'Object',color:COLOR_PALETTE[0]}]},null,2));
		await vscode.workspace.fs.writeFile(projFile,initial);
	}
}

async function readProjectLabels(project:string):Promise<{name:string,color:string}[]>{
	const root=getWorkspaceRoot(); if(!root) return[];
	const file=vscode.Uri.joinPath(root,'/.annovis/projects',project,'project.json');
	const bytes = await vscode.workspace.fs.readFile(file);
	return JSON.parse(Buffer.from(bytes).toString()).labels;
}

async function addLabelToProject(project:string,labelName:string):Promise<{name:string,color:string, removedDefault:boolean}>{
	const labels = await readProjectLabels(project);
	const usedColors = labels.map(l=>l.color);
	let removedDefault=false;
	if(labels.length===1 && labels[0].name==='Object'){ labels.length=0; removedDefault=true; }
	const nextColor = COLOR_PALETTE.find(c=>!usedColors.includes(c))||'#'+Math.floor(Math.random()*16777215).toString(16);
	labels.push({name:labelName,color:nextColor});
	const root=getWorkspaceRoot(); if(root){
		const file=vscode.Uri.joinPath(root,'/.annovis/projects',project,'project.json');
		await vscode.workspace.fs.writeFile(file,Buffer.from(JSON.stringify({labels},null,2)));
	}
	return {name:labelName,color:nextColor, removedDefault};
}

async function renameLabelInProject(project:string,oldName:string,newName:string){
	const labels=await readProjectLabels(project);
	const l=labels.find(l=>l.name===oldName); if(!l) return null;
	l.name=newName;
	const root=getWorkspaceRoot(); if(root){
		const file=vscode.Uri.joinPath(root,'/.annovis/projects',project,'project.json');
		await vscode.workspace.fs.writeFile(file,Buffer.from(JSON.stringify({labels},null,2)));
	}
	return l;
}

async function deleteLabelFromProject(project:string,name:string){
	let labels=await readProjectLabels(project);
	labels=labels.filter(l=>l.name!==name);
	const root=getWorkspaceRoot(); if(root){
		const file=vscode.Uri.joinPath(root,'/.annovis/projects',project,'project.json');
		await vscode.workspace.fs.writeFile(file,Buffer.from(JSON.stringify({labels},null,2)));
	}
	return labels;
}

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
	console.log('AnnoVis extension activated');

	// Simple hello command (can be removed later)
	const helloCmd = vscode.commands.registerCommand('annovis.helloWorld', () => {
		vscode.window.showInformationMessage('Hello from AnnoVis!');
	});
	context.subscriptions.push(helloCmd);

	// Project command
	const setProjCmd = vscode.commands.registerCommand('annovis.setProject', async ()=>{
		const p = await selectProject(context);
		if(p){ await ensureProjectSetup(p); vscode.window.showInformationMessage('Current AnnoVis project: '+p); }
	});
	context.subscriptions.push(setProjCmd);

	async function getCurrentProject():Promise<string|undefined>{
		let proj = context.globalState.get<string>(PROJECT_KEY);
		if(!proj){ proj = await selectProject(context); }
		if(proj){ await ensureProjectSetup(proj); }
		return proj;
	}

	// Modify annotate command logic
	const annotateCmd = vscode.commands.registerCommand('annovis.annotateImage', async (resource?: vscode.Uri) => {
        const project = await getCurrentProject();
        if (!project) return;
        let target: vscode.Uri | undefined = resource;
        if (!target && vscode.window.activeTextEditor) target = vscode.window.activeTextEditor.document.uri;
        if (!target) {
            vscode.window.showErrorMessage('No image selected for annotation');
            return;
        }

        const labels = await readProjectLabels(project);
        // Attempt to load existing annotations
        let existingAnnotations: any[] | undefined = undefined;
        try {
            const root = getWorkspaceRoot();
            if (root) {
                const annPath = vscode.Uri.joinPath(root, '/.annovis/annotations', project, path.basename(target.fsPath) + '.json');
                const bytes = await vscode.workspace.fs.readFile(annPath);
                existingAnnotations = JSON.parse(Buffer.from(bytes).toString());
            }
        } catch {/* file may not exist – that is fine */}

        const panel = vscode.window.createWebviewPanel(
            'annovisAnnotation',
            `Annotate ${path.basename(target.fsPath)}`,
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

        panel.webview.html = getWebviewContent(
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
                    await vscode.workspace.fs.writeFile(annFile, Buffer.from(JSON.stringify(annotations, null, 2)));
                    vscode.window.showInformationMessage('Annotations saved');
                    break;
                }
            }
        });
    });
    context.subscriptions.push(annotateCmd);

    // Visualize existing annotation file
    const vizCmd = vscode.commands.registerCommand('annovis.visualizeAnnotation', async (resource: vscode.Uri) => {
        if (!resource) { return; }

        const root = getWorkspaceRoot();
        if (!root) { return; }

        // Determine project from path .annovis/annotations/<project>/file.json
        const parts = resource.fsPath.split(path.sep);
        const projIdx = parts.indexOf('.annovis');
        let project:string|undefined;
        if(projIdx>=0 && parts.length>projIdx+2 && parts[projIdx+1]==='annotations'){
            project = parts[projIdx+2];
        }
        if(!project){ vscode.window.showErrorMessage('Cannot deduce project from annotation path'); return; }

        // Determine image base name
        const baseNameWithExt = path.basename(resource.fsPath, '.json'); // e.g. 001.jpg
        // Search for image in workspace
        const files = await vscode.workspace.findFiles(`**/${baseNameWithExt}` , '**/node_modules/**', 5);
        if (files.length === 0) {
            vscode.window.showErrorMessage('Original image not found in workspace');
            return;
        }
        const imageUri = files[0];
        // Open standard annotate window
        await vscode.commands.executeCommand('annovis.annotateImage', imageUri);
    });
    context.subscriptions.push(vizCmd);
}

export function deactivate() {}
