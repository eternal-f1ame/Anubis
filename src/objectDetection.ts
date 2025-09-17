import * as vscode from 'vscode';
import { handleAnnotation } from './utils';

export async function handleObjectDetection(
	context: vscode.ExtensionContext,
	target: vscode.Uri,
	project: string
) {
	await handleAnnotation(context, target, project, {
		directory: 'annotations',
		panelId: 'annovisObjectDetection',
		title: 'Object Detection',
		projectType: 'object-detection',
		saveMessageType: 'saveAnnotation',
		saveDataProperty: 'annotation',
		saveSuccessMessage: 'Annotations saved',
		includeFabric: true,
		dataProperty: 'initialAnnotations'
	});
} 