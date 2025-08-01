import * as vscode from 'vscode';
import * as path from 'path';
import { selectAnnotationType, AnnotationType } from './annotationTypes';
import { handleObjectDetection, COLOR_PALETTE, readProjectLabels } from './objectDetection';
import { handleImageClassification } from './imageClassification';
import { handleInstanceSegmentation } from './instanceSegmentation';
import { handleKeypointDetection } from './keypointDetection';

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
		},
		{
			label: 'Instance Segmentation',
			description: 'Project for drawing precise outlines around object instances',
			id: 'instance-segmentation' as const
		},
		{
			label: 'Keypoint Detection',
			description: 'Project for marking specific points and joints on objects',
			id: 'keypoint-detection' as const
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
	const orphanedProjects: string[] = [];
	
	for (const name of projectNames) {
		const type = await getProjectType(name);
		if (type) {
			existingProjects.push({ name, type });
		} else {
			orphanedProjects.push(name);
		}
	}
	
	// Handle orphaned project directories more gracefully
	if (orphanedProjects.length > 0) {
		const orphanedList = orphanedProjects.join(', ');
		const choice = await vscode.window.showWarningMessage(
			`Found ${orphanedProjects.length} incomplete project director${orphanedProjects.length === 1 ? 'y' : 'ies'}: ${orphanedList}. These may be from interrupted project creation.`,
			'Clean up automatically',
			'Configure manually',
			'Ignore for now'
		);
		
		if (choice === 'Clean up automatically') {
			// Remove orphaned directories
			for (const orphanedName of orphanedProjects) {
				try {
					const orphanedDir = vscode.Uri.joinPath(projectsRoot, orphanedName);
					await vscode.workspace.fs.delete(orphanedDir, { recursive: true });
				} catch (error) {
					console.warn(`Failed to cleanup orphaned project ${orphanedName}:`, error);
				}
			}
			vscode.window.showInformationMessage(`Cleaned up ${orphanedProjects.length} incomplete project director${orphanedProjects.length === 1 ? 'y' : 'ies'}.`);
		} else if (choice === 'Configure manually') {
			// Handle legacy projects by asking user to specify their type
			for (const orphanedName of orphanedProjects) {
				const typeChoice = await vscode.window.showWarningMessage(
					`What type of project is "${orphanedName}"?`,
			'Object Detection',
			'Image Classification',
					'Instance Segmentation',
					'Keypoint Detection',
					'Delete this directory'
		);
		
				if (typeChoice === 'Object Detection') {
					const projectInfo: ProjectInfo = { name: orphanedName, type: 'object-detection' };
					await ensureProjectSetup(projectInfo);
					existingProjects.push(projectInfo);
				} else if (typeChoice === 'Image Classification') {
					const projectInfo: ProjectInfo = { name: orphanedName, type: 'image-classification' };
					await ensureProjectSetup(projectInfo);
					existingProjects.push(projectInfo);
				} else if (typeChoice === 'Instance Segmentation') {
					const projectInfo: ProjectInfo = { name: orphanedName, type: 'instance-segmentation' };
					await ensureProjectSetup(projectInfo);
					existingProjects.push(projectInfo);
				} else if (typeChoice === 'Keypoint Detection') {
					const projectInfo: ProjectInfo = { name: orphanedName, type: 'keypoint-detection' };
					await ensureProjectSetup(projectInfo);
					existingProjects.push(projectInfo);
				} else if (typeChoice === 'Delete this directory') {
					try {
						const orphanedDir = vscode.Uri.joinPath(projectsRoot, orphanedName);
						await vscode.workspace.fs.delete(orphanedDir, { recursive: true });
					} catch (error) {
						vscode.window.showErrorMessage(`Failed to delete project directory: ${error}`);
					}
		}
				// If they don't choose anything, the project won't be included in the list
			}
		}
		// If they choose 'Ignore for now', orphaned projects won't be shown in the list
	}
	
	const projectOptions = [
		{ label: '+ New Project', description: 'Create a new annotation project', id: 'new' },
		...existingProjects.map(p => ({ 
			label: p.name, 
			description: `${p.type === 'object-detection' ? 'Object Detection' : 
						   p.type === 'image-classification' ? 'Image Classification' : 
						   		p.type === 'instance-segmentation' ? 'Instance Segmentation' :
						   'Keypoint Detection'} project`,
			id: p.name,
			projectInfo: p
		}))
	];
	
	const pick = await vscode.window.showQuickPick(projectOptions, { 
		placeHolder: 'Select or create project',
		matchOnDescription: true 
	});
	
	if (!pick) {return;}
	
	if (pick.id === 'new') {
		// Create new project workflow
		const projectType = await selectProjectType();
		if (!projectType) {return;}
		
		const projectName = await vscode.window.showInputBox({ 
			prompt: `Enter name for ${projectType === 'object-detection' ? 'Object Detection' : 
									  projectType === 'image-classification' ? 'Image Classification' : 
									  		projectType === 'instance-segmentation' ? 'Instance Segmentation' :
									  'Keypoint Detection'} project`,
			validateInput: (value) => {
				if (!value || value.trim().length === 0) {
					return 'Project name cannot be empty';
				}
				if (existingProjects.some(p => p.name === value.trim())) {
					return 'A project with this name already exists';
				}
				if (!/^[a-zA-Z0-9_-]+$/.test(value.trim())) {
					return 'Project name can only contain letters, numbers, underscores, and hyphens';
				}
				return null;
			}
		});
		if (!projectName) {return;}
		
		const projectInfo: ProjectInfo = { name: projectName.trim(), type: projectType };
		
		// Ensure project is created and configured properly
		try {
			await ensureProjectSetup(projectInfo);
		context.globalState.update(PROJECT_KEY, projectInfo);
		return projectInfo;
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to create project: ${error}`);
			return;
		}
	} else {
		// Existing project
		const projectInfo = (pick as any).projectInfo as ProjectInfo;
		context.globalState.update(PROJECT_KEY, projectInfo);
		return projectInfo;
	}
}

async function ensureProjectSetup(projectInfo: ProjectInfo) {
	const root = getWorkspaceRoot();
	if (!root) {return;}
	const projDir = vscode.Uri.joinPath(root, '/.annovis/projects', projectInfo.name);
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
		// File doesn't exist, create directory and file atomically
		try {
			await vscode.workspace.fs.createDirectory(projDir);
		const initial = {
			name: projectInfo.name,
			type: projectInfo.type,
			labels: [{ name: 'Object', color: COLOR_PALETTE[0] }],
			created: new Date().toISOString()
		};
		await vscode.workspace.fs.writeFile(projFile, Buffer.from(JSON.stringify(initial, null, 2)));
		} catch (error) {
			// If project creation fails, clean up the directory to avoid orphaned folders
			try {
				await vscode.workspace.fs.delete(projDir, { recursive: true });
			} catch (cleanupError) {
				console.warn('Failed to cleanup incomplete project directory:', cleanupError);
			}
			throw error;
		}
	}
}

async function getProjectType(projectName: string): Promise<AnnotationType | undefined> {
	const root = getWorkspaceRoot();
	if (!root) {return undefined;}
	
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
			vscode.window.showInformationMessage(`Current AnnoVis project: ${projectInfo.name} (${projectInfo.type === 'object-detection' ? 'Object Detection' : 
																											  projectInfo.type === 'image-classification' ? 'Image Classification' : 
																											  		projectInfo.type === 'instance-segmentation' ? 'Instance Segmentation' :
																											  'Keypoint Detection'})`);
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
			if (!projectInfo) {return;}
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
			case 'instance-segmentation':
				await handleInstanceSegmentation(context, target, projectInfo.name);
				break;
			case 'keypoint-detection':
				await handleKeypointDetection(context, target, projectInfo.name);
				break;
		}
	});
	context.subscriptions.push(annotateCmd);

	// Annotate command with forced project selection
	const annotateWithSelectionCmd = vscode.commands.registerCommand('annovis.annotateImageWithProjectSelection', async (resource?: vscode.Uri) => {
		// Always show project selection for this command
		const projectInfo = await selectProject(context);
		if (!projectInfo) {return;}
		
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
			case 'instance-segmentation':
				await handleInstanceSegmentation(context, target, projectInfo.name);
				break;
			case 'keypoint-detection':
				await handleKeypointDetection(context, target, projectInfo.name);
				break;
		}
	});
	context.subscriptions.push(annotateWithSelectionCmd);

	// Visualize existing annotation file
	const vizCmd = vscode.commands.registerCommand('annovis.visualizeAnnotation', async (resource: vscode.Uri) => {
		if (!resource) {return;}

		const root = getWorkspaceRoot();
		if (!root) {return;}

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
					} else if (parts[projIdx + 1] === 'instances') {
						projectName = parts[projIdx + 2];
						projectType = 'instance-segmentation';
					} else if (parts[projIdx + 1] === 'keypoints') {
						projectName = parts[projIdx + 2];
						projectType = 'keypoint-detection';
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
				case 'instance-segmentation':
					await handleInstanceSegmentation(context, imageUri, projectName);
					break;
				case 'keypoint-detection':
					await handleKeypointDetection(context, imageUri, projectName);
					break;
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Error reading annotation file: ${error}`);
		}
	});
	context.subscriptions.push(vizCmd);
}

export function deactivate() {}
