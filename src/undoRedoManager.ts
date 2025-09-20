const MAX_STATES = 5;

export class UndoRedoManager {
    private statesQueue: any[] = [];
    private currentPointer: number = -1; // Points to the current state in the queue

    constructor() {
        // Simplified constructor - no file system operations needed
    }

    async initialize() {
        // No initialization needed for in-memory implementation
    }

    /**
     * Saves a new state to the queue. This is called when a change is made to the canvas
     * that is NOT from undo/redo operations.
     */
    async saveState(annotations: any): Promise<void> {
        // If we're not at the latest state (i.e., we've used undo), 
        // remove all states ahead of the current pointer
        if (this.currentPointer < this.statesQueue.length - 1) {
            this.statesQueue = this.statesQueue.slice(0, this.currentPointer + 1);
        }

        // Add the new state
        this.statesQueue.push(JSON.parse(JSON.stringify(annotations))); // Deep copy
        
        // If queue exceeds max size, remove the oldest state
        if (this.statesQueue.length > MAX_STATES) {
            this.statesQueue.shift();
        } else {
            // Only increment pointer if we didn't remove the oldest state
            this.currentPointer++;
        }
        
        // Ensure pointer is at the latest state
        this.currentPointer = this.statesQueue.length - 1;
    }

    /**
     * Moves the pointer one step back and returns the previous state.
     * Returns null if already at the oldest state.
     */
    async undo(): Promise<any | null> {
        if (this.currentPointer <= 0) {
            return null; // Already at the oldest state or no states
        }
        
        this.currentPointer--;
        return JSON.parse(JSON.stringify(this.statesQueue[this.currentPointer])); // Deep copy
    }

    /**
     * Moves the pointer one step forward and returns the next state.
     * Returns null if already at the newest state.
     */
    async redo(): Promise<any | null> {
        if (this.currentPointer >= this.statesQueue.length - 1) {
            return null; // Already at the newest state or no states
        }
        
        this.currentPointer++;
        return JSON.parse(JSON.stringify(this.statesQueue[this.currentPointer])); // Deep copy
    }

    /**
     * Returns the current state without changing the pointer.
     */
    getCurrentState(): any | null {
        if (this.currentPointer >= 0 && this.currentPointer < this.statesQueue.length) {
            return JSON.parse(JSON.stringify(this.statesQueue[this.currentPointer])); // Deep copy
        }
        return null;
    }

    /**
     * Returns debug information about the current state of the manager.
     */
    getDebugInfo(): { queueLength: number, currentPointer: number, canUndo: boolean, canRedo: boolean } {
        return {
            queueLength: this.statesQueue.length,
            currentPointer: this.currentPointer,
            canUndo: this.currentPointer > 0,
            canRedo: this.currentPointer < this.statesQueue.length - 1
        };
    }

    async cleanup(): Promise<void> {
        // Clear all states
        this.statesQueue = [];
        this.currentPointer = -1;
    }
}
