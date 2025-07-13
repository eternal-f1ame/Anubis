import * as vscode from 'vscode';
import * as path from 'path';
import { selectAnnotationType, AnnotationType } from './annotationTypes';
import { handleObjectDetection, COLOR_PALETTE, readProjectLabels } from './objectDetection';
import { handleImageClassification } from './imageClassification';

const PROJECT_KEY = 'annovis.currentProject';

function getWorkspaceRoot(): vscode.Uri | undefined {
	const ws = vscode.workspace.workspaceFolders;
	return ws && ws.length ? ws[0].uri : undefined;
}

interface ProjectInfo {
	name: string;
	type: AnnotationType;
}

async function selectProjectType(): Promise<AnnotationType | undefined> {
	const options = [
		{
			label: 'Object Detection',
			description: 'Project for drawing bounding boxes around objects',
			id: 'object-detection' as const
		},
		{
			label: 'Image Classification',
			description: 'Project for classifying entire images with labels',
			id: 'image-classification' as const
		}
	];
	
	const picked = await vscode.window.showQuickPick(options, {
		placeHolder: 'Select project type',
		matchOnDescription: true
	});
	
	return picked?.id;
}

async function selectProject(context: vscode.ExtensionContext): Promise<ProjectInfo | undefined> {
	const root = getWorkspaceRoot();
	if (!root) {
		vscode.window.showErrorMessage('Open a workspace folder first');
		return;
	}
	const projectsRoot = vscode.Uri.joinPath(root, '/.annovis/projects');
	await vscode.workspace.fs.createDirectory(projectsRoot);
	const entries = await vscode.workspace.fs.readDirectory(projectsRoot);
	const projectNames = entries.filter(([name, type]) => type === vscode.FileType.Directory).map(([n]) => n);
	
	// Get project types for existing projects
	const existingProjects: ProjectInfo[] = [];
	const legacyProjects: string[] = [];
	
	for (const name of projectNames) {
		const type = await getProjectType(name);
		if (type) {
			existingProjects.push({ name, type });
		} else {
			legacyProjects.push(name);
		}
	}
	
	// Handle legacy projects by asking user to specify their type
	for (const legacyName of legacyProjects) {
		const choice = await vscode.window.showWarningMessage(
			`Project "${legacyName}" needs to be configured. What type of project is it?`,
			'Object Detection',
			'Image Classification',
			'Skip'
		);
		
		if (choice === 'Object Detection') {
			existingProjects.push({ name: legacyName, type: 'object-detection' });
		} else if (choice === 'Image Classification') {
			existingProjects.push({ name: legacyName, type: 'image-classification' });
		}
		// If they choose 'Skip', the project won't be included in the list
	}
	
	const projectOptions = [
		{ label: '+ New Project', description: 'Create a new annotation project', id: 'new' },
		...existingProjects.map(p => ({ 
			label: p.name, 
			description: `${p.type === 'object-detection' ? 'Object Detection' : 'Image Classification'} project`,
			id: p.name,
			projectInfo: p
		}))
	];
	
	const pick = await vscode.window.showQuickPick(projectOptions, { 
		placeHolder: 'Select or create project',
		matchOnDescription: true 
	});
	
	if (!pick) return;
	
	if (pick.id === 'new') {
		// Create new project workflow
		const projectType = await selectProjectType();
		if (!projectType) return;
		
		const projectName = await vscode.window.showInputBox({ 
			prompt: `Enter name for ${projectType === 'object-detection' ? 'Object Detection' : 'Image Classification'} project` 
		});
		if (!projectName) return;
		
		const projectInfo: ProjectInfo = { name: projectName, type: projectType };
		context.globalState.update(PROJECT_KEY, projectInfo);
		return projectInfo;
	} else {
		// Existing project
		const projectInfo = (pick as any).projectInfo as ProjectInfo;
		context.globalState.update(PROJECT_KEY, projectInfo);
		return projectInfo;
	}
}

async function ensureProjectSetup(projectInfo: ProjectInfo) {
	const root = getWorkspaceRoot();
	if (!root) return;
	const projDir = vscode.Uri.joinPath(root, '/.annovis/projects', projectInfo.name);
	await vscode.workspace.fs.createDirectory(projDir);
	const projFile = vscode.Uri.joinPath(projDir, 'project.json');
	
	try {
		// Check if project file exists
		await vscode.workspace.fs.stat(projFile);
		
		// File exists, check if it has the type field and update if necessary
		const bytes = await vscode.workspace.fs.readFile(projFile);
		const existingData = JSON.parse(Buffer.from(bytes).toString());
		
		// If the existing project doesn't have a type field, or the type doesn't match, update it
		if (!existingData.type || existingData.type !== projectInfo.type) {
			existingData.type = projectInfo.type;
			existingData.name = projectInfo.name; // Ensure name is also correct
			// Preserve existing labels and other data
			await vscode.workspace.fs.writeFile(projFile, Buffer.from(JSON.stringify(existingData, null, 2)));
		}
	} catch {
		// File doesn't exist, create it
		const initial = {
			name: projectInfo.name,
			type: projectInfo.type,
			labels: [{ name: 'Object', color: COLOR_PALETTE[0] }],
			created: new Date().toISOString()
		};
		await vscode.workspace.fs.writeFile(projFile, Buffer.from(JSON.stringify(initial, null, 2)));
	}
}

async function getProjectType(projectName: string): Promise<AnnotationType | undefined> {
	const root = getWorkspaceRoot();
	if (!root) return undefined;
	
	const projFile = vscode.Uri.joinPath(root, '/.annovis/projects', projectName, 'project.json');
	try {
		const bytes = await vscode.workspace.fs.readFile(projFile);
		const projectData = JSON.parse(Buffer.from(bytes).toString());
		return projectData.type; // Return the actual type or undefined if not found
	} catch {
		return undefined;
	}
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
	const setProjCmd = vscode.commands.registerCommand('annovis.setProject', async () => {
		const projectInfo = await selectProject(context);
		if (projectInfo) {
			await ensureProjectSetup(projectInfo);
			vscode.window.showInformationMessage(`Current AnnoVis project: ${projectInfo.name} (${projectInfo.type === 'object-detection' ? 'Object Detection' : 'Image Classification'})`);
		}
	});
	context.subscriptions.push(setProjCmd);

	async function getCurrentProject(): Promise<ProjectInfo | undefined> {
		let projectInfo = context.globalState.get<ProjectInfo>(PROJECT_KEY);
		if (!projectInfo) {
			projectInfo = await selectProject(context);
		}
		if (projectInfo) {
			await ensureProjectSetup(projectInfo);
		}
		return projectInfo;
	}

	// Main annotate command with smart project selection
	const annotateCmd = vscode.commands.registerCommand('annovis.annotateImage', async (resource?: vscode.Uri) => {
		// First try to use current project, fall back to selection if needed
		let projectInfo = await getCurrentProject();
		
		// If we don't have a valid current project, show project selection
		if (!projectInfo) {
			projectInfo = await selectProject(context);
			if (!projectInfo) return;
		}
		
		let target: vscode.Uri | undefined = resource;
		if (!target && vscode.window.activeTextEditor) {
			target = vscode.window.activeTextEditor.document.uri;
		}
		if (!target) {
			vscode.window.showErrorMessage('No image selected for annotation');
			return;
		}

		// Route to appropriate handler based on project type
		switch (projectInfo.type) {
			case 'object-detection':
				await handleObjectDetection(context, target, projectInfo.name);
				break;
			case 'image-classification':
				await handleImageClassification(context, target, projectInfo.name);
				break;
		}
	});
	context.subscriptions.push(annotateCmd);

	// Annotate command with forced project selection
	const annotateWithSelectionCmd = vscode.commands.registerCommand('annovis.annotateImageWithProjectSelection', async (resource?: vscode.Uri) => {
		// Always show project selection for this command
		const projectInfo = await selectProject(context);
		if (!projectInfo) return;
		
		let target: vscode.Uri | undefined = resource;
		if (!target && vscode.window.activeTextEditor) {
			target = vscode.window.activeTextEditor.document.uri;
		}
		if (!target) {
			vscode.window.showErrorMessage('No image selected for annotation');
			return;
		}

		// Route to appropriate handler based on project type
		switch (projectInfo.type) {
			case 'object-detection':
				await handleObjectDetection(context, target, projectInfo.name);
				break;
			case 'image-classification':
				await handleImageClassification(context, target, projectInfo.name);
				break;
		}
	});
	context.subscriptions.push(annotateWithSelectionCmd);

	// Visualize existing annotation file
	const vizCmd = vscode.commands.registerCommand('annovis.visualizeAnnotation', async (resource: vscode.Uri) => {
		if (!resource) return;

		const root = getWorkspaceRoot();
		if (!root) return;

		try {
			// Read the JSON file to get metadata
			const bytes = await vscode.workspace.fs.readFile(resource);
			const data = JSON.parse(Buffer.from(bytes).toString());
			
			let projectName: string | undefined;
			let projectType: AnnotationType | undefined;
			let imageName: string | undefined;
			
			// Try to get metadata from the file
			if (data.metadata) {
				projectName = data.metadata.projectName;
				projectType = data.metadata.projectType;
				imageName = data.metadata.imageName;
			} else {
				// Fallback to path parsing for legacy files
				const parts = resource.fsPath.split(path.sep);
				const projIdx = parts.indexOf('.annovis');
				
				if (projIdx >= 0 && parts.length > projIdx + 2) {
					if (parts[projIdx + 1] === 'annotations') {
						projectName = parts[projIdx + 2];
						projectType = 'object-detection';
					} else if (parts[projIdx + 1] === 'classifications') {
						projectName = parts[projIdx + 2];
						projectType = 'image-classification';
					}
				}
				
				if (!projectName || !projectType) {
					vscode.window.showErrorMessage('Cannot determine project information from file');
					return;
				}
				
				// For legacy files, try to get image name from the file name
				imageName = path.basename(resource.fsPath, '.json');
			}
			
			if (!projectName || !projectType || !imageName) {
				vscode.window.showErrorMessage('Incomplete project information in file');
				return;
			}

			// Search for image in workspace
			const files = await vscode.workspace.findFiles(`**/${imageName}`, '**/node_modules/**', 5);
			if (files.length === 0) {
				vscode.window.showErrorMessage(`Original image '${imageName}' not found in workspace`);
				return;
			}
			const imageUri = files[0];
			
			// Open appropriate annotation window based on project type
			// NOTE: This opens the file in its original project context without changing the user's current active project
			switch (projectType) {
				case 'object-detection':
					await handleObjectDetection(context, imageUri, projectName);
					break;
				case 'image-classification':
					await handleImageClassification(context, imageUri, projectName);
					break;
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Error reading annotation file: ${error}`);
		}
	});
	context.subscriptions.push(vizCmd);
}

export function deactivate() {}
