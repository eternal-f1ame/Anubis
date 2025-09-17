import * as vscode from 'vscode';
import { handleAnnotation } from './utils';

export async function handleInstanceSegmentation(
	context: vscode.ExtensionContext,
	target: vscode.Uri,
	project: string
) {
	await handleAnnotation(context, target, project, {
		directory: 'instances',
		panelId: 'annovisInstanceSegmentation',
		title: 'Instance Segmentation',
		projectType: 'instance-segmentation',
		saveMessageType: 'saveAnnotation',
		saveDataProperty: 'annotation',
		saveSuccessMessage: 'Instance annotations saved',
		includeFabric: true,
		dataProperty: 'initialAnnotations'
	});
} 