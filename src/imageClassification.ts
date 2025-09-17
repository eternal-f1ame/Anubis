import * as vscode from 'vscode';
import { handleAnnotation } from './utils';

export async function handleImageClassification(
	context: vscode.ExtensionContext,
	target: vscode.Uri,
	project: string
) {
	await handleAnnotation(context, target, project, {
		directory: 'classifications',
		panelId: 'annovisImageClassification',
		title: 'Image Classification',
		projectType: 'image-classification',
		saveMessageType: 'saveClassification',
		saveDataProperty: 'classification',
		saveSuccessMessage: 'Classification saved',
		includeFabric: false,
		dataProperty: 'initialClassification'
	});
} 