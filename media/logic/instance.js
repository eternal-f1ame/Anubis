(() => {
    const vscode = acquireVsCodeApi();
    
    // Get previous state from VS Code
    const previousState = vscode.getState();
    
    const canvasEl = document.getElementById('c');
    const wrap = document.getElementById('canvasWrap');
    const labelSelect = document.getElementById('labelSelect');
    const sidebar = document.getElementById('sidebar');
    const polygonBtn = document.getElementById('polygonModeBtn');
    const selectBtn = document.getElementById('selectModeBtn');
    const moveBtn = document.getElementById('moveModeBtn');
    const editBtn = document.getElementById('editModeBtn');
    const modeButtons = { polygon: polygonBtn, select: selectBtn, move: moveBtn, edit: editBtn };
    const deleteBtn = document.getElementById('deleteBtn');
    const saveBtn = document.getElementById('saveBtn');
    const addClassBtn = document.getElementById('addClassBtn');
    const renameBtn = document.getElementById('renameBtn');
    const delClassBtn = document.getElementById('delClassBtn');
    const finishPolygonBtn = document.getElementById('finishPolygonBtn');
    const cancelPolygonBtn = document.getElementById('cancelPolygonBtn');

    const imageUrl = window.imageUrl;
    let labelArray = window.labels;
    let labelMap = Object.fromEntries(labelArray.map(l => [l.name, l.color]));
    let imgW = 0, imgH = 0;
    let mode = previousState?.mode || 'move';
    let panning = false, panStartX = 0, panStartY = 0, startVpt;
    
    // Polygon drawing state
    let currentPolygon = null;
    let polygonPoints = [];
    let isDrawingPolygon = false;
    let tempLine = null;
    let previewLine = null;
    let pointMarkers = [];
    
    // Undo/Redo system
    let undoHistory = [];
    let redoHistory = [];
    const MAX_UNDO_STEPS = 5;

    labelSelect.innerHTML = labelArray.map(l => `<option value="${l.name}" style="background:${l.color}">${l.name}</option>`).join('');

    const canvas = new fabric.Canvas(canvasEl, { selection: true });
    canvas.hoverCursor = 'default';
    canvas.moveCursor = 'move';

    const MIN_ZOOM = 0.1;
    const MAX_ZOOM = 10;

    const colorForLabel = name => labelMap[name] || '#ff0000';
    
    // Helper function to clamp coordinates within image boundaries
    const clampToImageBounds = (point) => {
        return {
            x: Math.max(0, Math.min(imgW, point.x)),
            y: Math.max(0, Math.min(imgH, point.y))
        };
    };
    
    // Helper function to calculate polygon bounding rectangle
    const getPolygonBounds = (polygon) => {
        if (!polygon || !polygon.points) {
            return { left: 0, top: 0, width: 0, height: 0 };
        }
        
        // Get the actual points considering polygon's position and transformations
        const matrix = polygon.calcTransformMatrix();
        const points = polygon.points.map(point => {
            const transformed = fabric.util.transformPoint(point, matrix);
            return transformed;
        });
        
        // Find min/max x and y coordinates
        let minX = points[0].x;
        let maxX = points[0].x;
        let minY = points[0].y;
        let maxY = points[0].y;
        
        for (let i = 1; i < points.length; i++) {
            minX = Math.min(minX, points[i].x);
            maxX = Math.max(maxX, points[i].x);
            minY = Math.min(minY, points[i].y);
            maxY = Math.max(maxY, points[i].y);
        }
        
        return {
            left: minX,
            top: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    };
    
    // Helper function to clamp polygon bounds (simple approach like object detection + bottom/right)
    const clampPolygon = polygon => {
        if (!imgW || !imgH || !polygon) {
            return;
        }
        const bounds = getPolygonBounds(polygon);
        const newLeft = Math.max(0, Math.min(polygon.left, imgW - bounds.width));
        const newTop = Math.max(0, Math.min(polygon.top, imgH - bounds.height));
        polygon.set({ left: newLeft, top: newTop });
    };
    
    // Undo/Redo system functions
    const saveToHistory = () => {
        const state = {
            canvasState: canvas.toJSON(['label']),
            labelArray: JSON.parse(JSON.stringify(labelArray)),
            labelMap: JSON.parse(JSON.stringify(labelMap)),
            selectedLabel: labelSelect.value
        };
        
        undoHistory.push(state);
        if (undoHistory.length > MAX_UNDO_STEPS) {
            undoHistory.shift(); // Remove oldest state
        }
        
        // Clear redo history when new changes are made
        redoHistory = [];
    };
    
    const undo = () => {
        if (undoHistory.length === 0) {
            return;
        }
        
        // Save current state to redo history before undoing
        const currentState = {
            canvasState: canvas.toJSON(['label']),
            labelArray: JSON.parse(JSON.stringify(labelArray)),
            labelMap: JSON.parse(JSON.stringify(labelMap)),
            selectedLabel: labelSelect.value
        };
        
        redoHistory.push(currentState);
        if (redoHistory.length > MAX_UNDO_STEPS) {
            redoHistory.shift(); // Remove oldest redo state
        }
        
        const previousState = undoHistory.pop();
        
        // Restore canvas
        canvas.loadFromJSON(previousState.canvasState, () => {
            canvas.renderAll();
            
            // Restore labels
            labelArray = previousState.labelArray;
            labelMap = previousState.labelMap;
            
            // Rebuild label select
            labelSelect.innerHTML = labelArray.map(l => 
                `<option value="${l.name}" style="background:${l.color}">${l.name}</option>`
            ).join('');
            
            // Restore selected label
            if (previousState.selectedLabel && labelSelect.querySelector(`option[value="${previousState.selectedLabel}"]`)) {
                labelSelect.value = previousState.selectedLabel;
            }
            
            updateCounts();
            saveState();
        });
    };
    
    const redo = () => {
        if (redoHistory.length === 0) {
            return;
        }
        
        // Save current state to undo history before redoing
        const currentState = {
            canvasState: canvas.toJSON(['label']),
            labelArray: JSON.parse(JSON.stringify(labelArray)),
            labelMap: JSON.parse(JSON.stringify(labelMap)),
            selectedLabel: labelSelect.value
        };
        
        undoHistory.push(currentState);
        if (undoHistory.length > MAX_UNDO_STEPS) {
            undoHistory.shift(); // Remove oldest undo state
        }
        
        const nextState = redoHistory.pop();
        
        // Restore canvas
        canvas.loadFromJSON(nextState.canvasState, () => {
            canvas.renderAll();
            
            // Restore labels
            labelArray = nextState.labelArray;
            labelMap = nextState.labelMap;
            
            // Rebuild label select
            labelSelect.innerHTML = labelArray.map(l => 
                `<option value="${l.name}" style="background:${l.color}">${l.name}</option>`
            ).join('');
            
            // Restore selected label
            if (nextState.selectedLabel && labelSelect.querySelector(`option[value="${nextState.selectedLabel}"]`)) {
                labelSelect.value = nextState.selectedLabel;
            }
            
            updateCounts();
            saveState();
        });
    };

    const showFeedback = (message, type = 'info') => {
        const existing = document.querySelector('.feedback-message');
        if (existing) {existing.remove();}
        
        const feedback = document.createElement('div');
        feedback.className = `feedback-message ${type}`;
        feedback.textContent = message;
        feedback.style.cssText = `
            position: absolute;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            background: ${type === 'error' ? '#d32f2f' : '#1976d2'};
            color: white;
            padding: 8px 16px;
            border-radius: 4px;
            font-size: 14px;
            z-index: 1000;
            pointer-events: none;
        `;
        wrap.appendChild(feedback);
        
        setTimeout(() => {
            if (feedback.parentNode) {
                feedback.parentNode.removeChild(feedback);
            }
        }, 3000);
    };

    const saveState = () => {
        const state = {
            mode,
            selectedLabel: labelSelect.value
        };
        vscode.setState(state);
    };

    const restoreState = () => {
        if (previousState) {
            if (previousState.selectedLabel && labelSelect.querySelector(`option[value="${previousState.selectedLabel}"]`)) {
                labelSelect.value = previousState.selectedLabel;
            }
            setMode(previousState.mode || 'move');
        }
    };

    const updateCounts = () => {
        const counts = {};
        for (const label of labelArray) {counts[label.name] = 0;}
        canvas.getObjects().forEach(obj => {
            if (obj.label && counts.hasOwnProperty(obj.label)) {counts[obj.label]++;}
        });
        sidebar.innerHTML = `
            <h3>Instance Counts</h3>
            ${Object.entries(counts).map(([label, count]) => {
                const color = colorForLabel(label);
                return `<div class="sidebar-item"><div class="color-dot" style="background:${color}"></div> ${label}: ${count}</div>`;
            }).join('')}
            ${isDrawingPolygon ? '<div class="drawing-hint">Click to add points<br>Right-click to finish<br>Press Escape to cancel</div>' : ''}
        `;
    };

    const setMode = (newMode) => {
        // Cancel any ongoing polygon drawing when switching modes
        if (isDrawingPolygon && newMode !== 'polygon') {
            cancelPolygonDrawing();
        }
        
        mode = newMode;
        for (const [name, btn] of Object.entries(modeButtons)) {
            btn.classList.toggle('active', name === newMode);
        }
        
        canvas.selection = (newMode === 'select');
        canvas.isDrawingMode = false;
        
        // Update cursor based on mode
        canvasEl.className = `${newMode}-mode`;
        
        // Handle polygon mode UI
        if (newMode === 'polygon') {
            canvas.hoverCursor = 'crosshair';
            canvas.defaultCursor = 'crosshair';
            showFeedback('Click to add points, right-click to finish polygon');
        } else {
            canvas.hoverCursor = 'default';
            canvas.defaultCursor = 'default';
            finishPolygonBtn.disabled = true;
            cancelPolygonBtn.disabled = true;
        }
        
        // Update button states
        finishPolygonBtn.style.display = newMode === 'polygon' ? 'inline-block' : 'none';
        cancelPolygonBtn.style.display = newMode === 'polygon' ? 'inline-block' : 'none';
        
        saveState();
    };

    const saveAnnotations = () => {
        const annotations = canvas.getObjects().filter(obj => obj.label).map(obj => {
            if (obj.type === 'polygon' && obj.points) {
                const points = obj.points.map(p => ({
                    x: p.x / imgW,
                    y: p.y / imgH
                }));
                return {
                    type: 'polygon',
                    label: obj.label,
                    points: points
                };
            }
            return null;
        }).filter(ann => ann !== null);
        
        vscode.postMessage({ type: 'saveAnnotation', annotation: annotations });
    };

    const createPolygonFromPoints = (points, label) => {
        if (points.length < 3) {
            return null;
        }
        
        const color = colorForLabel(label);
        const polygon = new fabric.Polygon(points, {
            fill: color + '40',
            stroke: color,
            strokeWidth: 2,
            selectable: true,
            evented: true,
            objectCaching: false
        });
        
        polygon.label = label;
        polygon.points = points;
        
        return polygon;
    };

    const startPolygonDrawing = () => {
        isDrawingPolygon = true;
        polygonPoints = [];
        pointMarkers = [];
        finishPolygonBtn.disabled = false;
        cancelPolygonBtn.disabled = false;
        canvas.selection = false;
        canvas.forEachObject(obj => obj.selectable = false);
        updateCounts();
        showFeedback('Click to add points, right-click to finish');
    };

    const addPolygonPoint = (point) => {
        // Clamp point to image boundaries
        const clampedPoint = clampToImageBounds(point);
        polygonPoints.push(clampedPoint);
        
        // Create visual feedback point
        const circle = new fabric.Circle({
            left: clampedPoint.x - 4,
            top: clampedPoint.y - 4,
            radius: 4,
            fill: '#ff4444',
            stroke: '#ffffff',
            strokeWidth: 1,
            selectable: false,
            evented: false,
            isPolygonPoint: true
        });
        canvas.add(circle);
        pointMarkers.push(circle);
        
        // Update polygon preview
        updatePolygonPreview();
        
        // Update UI
        updateCounts();
        canvas.renderAll();
    };

    const updatePolygonPreview = () => {
        // Remove old preview
        if (tempLine) {
            canvas.remove(tempLine);
            tempLine = null;
        }
        
        if (polygonPoints.length > 1) {
            const color = colorForLabel(labelSelect.value);
            tempLine = new fabric.Polyline(polygonPoints, {
                fill: 'transparent',
                stroke: color,
                strokeWidth: 2,
                strokeDashArray: [5, 5],
                selectable: false,
                evented: false,
                isPolygonTemp: true
            });
            canvas.add(tempLine);
        }
    };

    const updatePreviewLine = (currentPoint) => {
        if (previewLine) {
            canvas.remove(previewLine);
            previewLine = null;
        }
        
        if (polygonPoints.length > 0 && currentPoint) {
            const lastPoint = polygonPoints[polygonPoints.length - 1];
            const clampedCurrentPoint = clampToImageBounds(currentPoint);
            const color = colorForLabel(labelSelect.value);
            
            previewLine = new fabric.Line([lastPoint.x, lastPoint.y, clampedCurrentPoint.x, clampedCurrentPoint.y], {
                stroke: color,
                strokeWidth: 1,
                strokeDashArray: [3, 3],
                selectable: false,
                evented: false,
                isPreviewLine: true
            });
            canvas.add(previewLine);
        }
    };

    const finishPolygonDrawing = () => {
        if (polygonPoints.length < 3) {
            showFeedback('Polygon must have at least 3 points', 'error');
            return;
        }
        
        const label = labelSelect.value;
        const polygon = createPolygonFromPoints(polygonPoints, label);
        
        if (polygon) {
            canvas.add(polygon);
            cleanupPolygonDrawing();
            updateCounts();
            saveAnnotations(); // Auto-save when polygon is added
            saveToHistory(); // Save to undo history after auto-save
            canvas.renderAll();
            showFeedback(`Polygon added with label: ${label}`);
        }
    };

    const cancelPolygonDrawing = () => {
        cleanupPolygonDrawing();
        showFeedback('Polygon drawing cancelled');
    };

    const cleanupPolygonDrawing = () => {
        isDrawingPolygon = false;
        polygonPoints = [];
        
        // Remove all temporary visual elements
        canvas.getObjects().forEach(obj => {
            if (obj.isPolygonPoint || obj.isPolygonTemp || obj.isPreviewLine) {
                canvas.remove(obj);
            }
        });
        
        pointMarkers = [];
        tempLine = null;
        previewLine = null;
        
        finishPolygonBtn.disabled = true;
        cancelPolygonBtn.disabled = true;
        canvas.selection = (mode === 'select');
        canvas.forEachObject(obj => obj.selectable = true);
        canvas.renderAll();
        updateCounts();
    };

    // Event handlers
    canvas.on('mouse:down', (e) => {
        if (mode === 'polygon' && isDrawingPolygon) {
            if (e.e.button === 2) { // Right click
                e.e.preventDefault();
                finishPolygonDrawing();
                return;
            }
            
            if (e.e.button === 0) { // Left click
                const pointer = canvas.getPointer(e.e);
                addPolygonPoint(pointer);
                return;
            }
        }
        
        if (mode === 'move') {
            panning = true;
            panStartX = e.e.clientX;
            panStartY = e.e.clientY;
            startVpt = canvas.viewportTransform.slice();
        }
    });

    canvas.on('mouse:move', (e) => {
        if (panning && mode === 'move') {
            const deltaX = e.e.clientX - panStartX;
            const deltaY = e.e.clientY - panStartY;
            const vpt = startVpt.slice();
            vpt[4] += deltaX;
            vpt[5] += deltaY;
            canvas.setViewportTransform(vpt);
        }
        
        // Update preview line during polygon drawing
        if (mode === 'polygon' && isDrawingPolygon) {
            const pointer = canvas.getPointer(e.e);
            updatePreviewLine(pointer);
        }
    });

    canvas.on('mouse:up', (e) => {
        if (panning) {
            panning = false;
        }
    });

    canvas.on('selection:created', (e) => {
        deleteBtn.disabled = false;
    });

    canvas.on('selection:updated', (e) => {
        deleteBtn.disabled = false;
    });

    canvas.on('selection:cleared', (e) => {
        deleteBtn.disabled = true;
    });

    // Simple polygon movement constraint (like object detection)
    canvas.on('object:moving', (e) => {
        const obj = e.target;
        if (obj && obj.type === 'polygon' && obj.label) {
            clampPolygon(obj);
        }
    });

    canvas.on('object:scaling', (e) => {
        const obj = e.target;
        if (obj && obj.type === 'polygon' && obj.label) {
            clampPolygon(obj);
        }
    });

    // Mouse wheel zoom
    canvas.on('mouse:wheel', (opt) => {
        const delta = opt.e.deltaY;
        let zoom = canvas.getZoom();
        zoom *= 0.999 ** delta;
        zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
        canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
        opt.e.preventDefault();
        opt.e.stopPropagation();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isDrawingPolygon) {
            cancelPolygonDrawing();
        }
        
        // Delete key for objects and classes
        if (e.key === 'Delete') {
            // Check if a class is selected in dropdown (focus on select element)
            if (document.activeElement === labelSelect) {
                delClassBtn.click();
            } else {
                // Delete selected objects
                deleteBtn.click();
            }
        }
        
        // Ctrl+Z for undo
        if (e.ctrlKey && e.key === 'z') {
            e.preventDefault();
            undo();
        }
        
        // Ctrl+Y for redo
        if (e.ctrlKey && e.key === 'y') {
            e.preventDefault();
            redo();
        }
    });

    // Prevent right-click context menu
    canvas.upperCanvasEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    // Mode button handlers
    polygonBtn.addEventListener('click', () => {
        setMode('polygon');
        startPolygonDrawing();
    });

    selectBtn.addEventListener('click', () => setMode('select'));
    moveBtn.addEventListener('click', () => setMode('move'));
    editBtn.addEventListener('click', () => setMode('edit'));

    // Polygon control buttons
    finishPolygonBtn.addEventListener('click', finishPolygonDrawing);
    cancelPolygonBtn.addEventListener('click', cancelPolygonDrawing);

    // Other button handlers
    deleteBtn.addEventListener('click', () => {
        const activeObjects = canvas.getActiveObjects();
        if (activeObjects.length > 0) {
            activeObjects.forEach(obj => canvas.remove(obj));
            canvas.discardActiveObject();
            updateCounts();
            saveAnnotations(); // Auto-save when objects are deleted
            saveToHistory(); // Save to undo history after auto-save
            canvas.renderAll();
            showFeedback(`Deleted ${activeObjects.length} object(s)`);
        }
    });

    saveBtn.addEventListener('click', saveAnnotations);
    addClassBtn.addEventListener('click', () => vscode.postMessage({ type: 'requestAddLabel' }));
    renameBtn.addEventListener('click', () => {
        const current = labelSelect.value;
        if (current) {vscode.postMessage({ type: 'requestRenameLabel', current });}
    });
    delClassBtn.addEventListener('click', () => {
        const name = labelSelect.value;
        if (name) {vscode.postMessage({ type: 'requestDeleteLabel', name });}
    });

    // Label selection handler
    labelSelect.addEventListener('change', saveState);

    // Load image and initial annotations (using object-detection's working approach)
    fabric.Image.fromURL(imageUrl, img => {
        canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
        canvas.setWidth(img.width);
        canvas.setHeight(img.height);
        imgW = img.width;
        imgH = img.height;

        const scale = Math.min(wrap.clientWidth / img.width, wrap.clientHeight / img.height, 1);
        canvas.setZoom(scale);
        const vpt = canvas.viewportTransform;
        vpt[4] = (wrap.clientWidth - img.width * scale) / 2;
        vpt[5] = (wrap.clientHeight - img.height * scale) / 2;

        // Load existing annotations
        if (window.initialAnnotations) {
            window.initialAnnotations.forEach(ann => {
                if (ann.type === 'polygon' && ann.points) {
                    // Use direct image coordinates and clamp to bounds
                    const points = ann.points.map(p => {
                        const point = {
                            x: p.x * imgW,
                            y: p.y * imgH
                        };
                        return clampToImageBounds(point);
                    });
                    const polygon = createPolygonFromPoints(points, ann.label);
                    if (polygon) {
                        canvas.add(polygon);
                    }
                }
            });
        }
        
        // Restore state after canvas is fully loaded
        setTimeout(restoreState, 200);
        updateCounts();
        canvas.requestRenderAll();
        
        // Save initial state for undo
        setTimeout(() => saveToHistory(), 300);
    });

    // Message handler for VS Code communication
    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.type) {
            case 'labelAdded':
                const newLabel = message.label;
                // If this is the first real label, remove the default 'Object' label
                if (newLabel.removedDefault) {
                    labelArray = labelArray.filter(l => l.name !== 'Object');
                    delete labelMap['Object'];
                }
                labelArray.push(newLabel);
                labelMap[newLabel.name] = newLabel.color;
                labelSelect.innerHTML = labelArray.map(l => `<option value="${l.name}" style="background:${l.color}">${l.name}</option>`).join('');
                labelSelect.value = newLabel.name;
                updateCounts();
                saveToHistory(); // Save to undo history after label added
                break;
            case 'labelRenamed':
                const oldName = message.oldName;
                const newName = message.newName;
                labelArray.forEach(l => { if (l.name === oldName) {l.name = newName;} });
                labelMap[newName] = labelMap[oldName];
                delete labelMap[oldName];
                labelSelect.innerHTML = labelArray.map(l => `<option value="${l.name}" style="background:${l.color}">${l.name}</option>`).join('');
                labelSelect.value = newName;
                
                // Update existing polygons
                canvas.getObjects().forEach(obj => {
                    if (obj.label === oldName) {
                        obj.label = newName;
                    }
                });
                
                updateCounts();
                canvas.renderAll();
                saveToHistory(); // Save to undo history after label renamed
                break;
            case 'labelDeleted':
                const deletedName = message.name;
                labelArray = labelArray.filter(l => l.name !== deletedName);
                delete labelMap[deletedName];
                labelSelect.innerHTML = labelArray.map(l => `<option value="${l.name}" style="background:${l.color}">${l.name}</option>`).join('');
                
                // Remove polygons with deleted label
                canvas.getObjects().forEach(obj => {
                    if (obj.label === deletedName) {
                        canvas.remove(obj);
                    }
                });
                
                updateCounts();
                canvas.renderAll();
                saveToHistory(); // Save to undo history after label deleted
                break;
        }
    });

    // Initialize
    restoreState();
    updateCounts();
})(); 