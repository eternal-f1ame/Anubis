import * as vscode from 'vscode';
import * as path from 'path';

const MAX_UNDO_STEPS = 5;

export class UndoRedoManager {
    private cacheDir: vscode.Uri;
    private currentFile: string;
    private projectType: string;
    private undoStack: string[] = [];
    private redoStack: string[] = [];

    constructor(workspaceRoot: vscode.Uri, project: string, projectType: string, imageFile: string) {
        this.cacheDir = vscode.Uri.joinPath(workspaceRoot, '/.annovis/.cache', projectType, project);
        this.currentFile = path.basename(imageFile);
        this.projectType = projectType;
    }

    async initialize() {
        await vscode.workspace.fs.createDirectory(this.cacheDir);
    }

    async saveState(annotations: any): Promise<void> {
        const timestamp = Date.now().toString();
        const filename = `${this.currentFile}_${timestamp}.json`;
        const filepath = vscode.Uri.joinPath(this.cacheDir, filename);
        
        await vscode.workspace.fs.writeFile(filepath, Buffer.from(JSON.stringify(annotations, null, 2)));
        
        this.undoStack.push(filename);
        if (this.undoStack.length > MAX_UNDO_STEPS) {
            const toDelete = this.undoStack.shift();
            if (toDelete) {
                try {
                    await vscode.workspace.fs.delete(vscode.Uri.joinPath(this.cacheDir, toDelete));
                } catch (e) { /* ignore */ }
            }
        }
        
        // Clear redo stack when new state is saved
        await this.clearRedoStack();
    }

    async undo(): Promise<any | null> {
        if (this.undoStack.length <= 1) {
            return null; // Keep at least one state
        }
        
        const currentState = this.undoStack.pop();
        if (currentState) {
            this.redoStack.push(currentState);
            if (this.redoStack.length > MAX_UNDO_STEPS) {
                const toDelete = this.redoStack.shift();
                if (toDelete) {
                    try {
                        await vscode.workspace.fs.delete(vscode.Uri.joinPath(this.cacheDir, toDelete));
                    } catch (e) { /* ignore */ }
                }
            }
        }
        
        const previousState = this.undoStack[this.undoStack.length - 1];
        if (previousState) {
            const filepath = vscode.Uri.joinPath(this.cacheDir, previousState);
            try {
                const data = await vscode.workspace.fs.readFile(filepath);
                return JSON.parse(data.toString());
            } catch (e) {
                return null;
            }
        }
        return null;
    }

    async redo(): Promise<any | null> {
        if (this.redoStack.length === 0) {
            return null;
        }
        
        const nextState = this.redoStack.pop();
        if (nextState) {
            this.undoStack.push(nextState);
            const filepath = vscode.Uri.joinPath(this.cacheDir, nextState);
            try {
                const data = await vscode.workspace.fs.readFile(filepath);
                return JSON.parse(data.toString());
            } catch (e) {
                return null;
            }
        }
        return null;
    }

    private async clearRedoStack(): Promise<void> {
        for (const filename of this.redoStack) {
            try {
                await vscode.workspace.fs.delete(vscode.Uri.joinPath(this.cacheDir, filename));
            } catch (e) { /* ignore */ }
        }
        this.redoStack = [];
    }

    async cleanup(): Promise<void> {
        try {
            await vscode.workspace.fs.delete(this.cacheDir, { recursive: true });
        } catch (e) { /* ignore */ }
    }
}
