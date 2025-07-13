import * as vscode from 'vscode';

export type AnnotationType = 'object-detection' | 'image-classification';

export interface AnnotationTypeOption {
	label: string;
	description: string;
	id: AnnotationType;
}

export async function selectAnnotationType(): Promise<AnnotationType | undefined> {
	const options: AnnotationTypeOption[] = [
		{
			label: 'Object Detection',
			description: 'Draw bounding boxes around objects',
			id: 'object-detection'
		},
		{
			label: 'Image Classification',
			description: 'Classify the entire image with labels',
			id: 'image-classification'
		}
	];
	
	const picked = await vscode.window.showQuickPick(options, {
		placeHolder: 'Select annotation type',
		matchOnDescription: true
	});
	
	return picked?.id;
} 