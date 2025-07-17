(() => {
    const vscode = acquireVsCodeApi();
    
    // Get previous state from VS Code
    const previousState = vscode.getState();
    
    const canvasEl = document.getElementById('c');
    const wrap = document.getElementById('canvasWrap');
    const labelSelect = document.getElementById('labelSelect');
    const sidebar = document.getElementById('sidebar');
    const drawBtn = document.getElementById('drawModeBtn');
    const selectBtn = document.getElementById('selectModeBtn');
    const moveBtn = document.getElementById('moveModeBtn');
    const modeButtons = { draw: drawBtn, select: selectBtn, move: moveBtn };
    const deleteBtn = document.getElementById('deleteBtn');
    const saveBtn = document.getElementById('saveBtn');
    const addClassBtn = document.getElementById('addClassBtn');
    const renameBtn = document.getElementById('renameBtn');
    const delClassBtn = document.getElementById('delClassBtn');

    const imageUrl = window.imageUrl;
    let labelArray = window.labels;
    let labelMap = Object.fromEntries(labelArray.map(l => [l.name, l.color]));
    let imgW = 0, imgH = 0;
    let mode = previousState?.mode || 'move';
    let drawing = false, rect, startX, startY;
    let panning = false, panStartX = 0, panStartY = 0, startVpt;
    
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
            // Only restore mode, not canvas state which interferes with operations
            if (previousState.mode) {
                setTimeout(() => setMode(previousState.mode), 50);
            }
        }
    };

    const updateCounts = () => {
        const counts = {};
        canvas.getObjects('rect').forEach(r => counts[r.label] = (counts[r.label] || 0) + 1);
        sidebar.innerHTML = Object.entries(counts).map(([name, count]) => {
            const col = colorForLabel(name);
            return `<div class="sidebar-item"><span class="color-dot" style="background:${col}"></span>${name} ${count}</div>`;
        }).join('');
        saveState();
    };

    const setMovementLock = lock => {
        canvas.getObjects('rect').forEach(r => {
            r.lockMovementX = lock;
            r.lockMovementY = lock;
            r.selectable = !lock;
            r.evented = !lock;
        });
    };

    const clampRect = rect => {
        if (!imgW || !imgH) {return;}
        const w = rect.width * rect.scaleX;
        const h = rect.height * rect.scaleY;
        let newLeft = Math.max(0, Math.min(rect.left, imgW - w));
        let newTop = Math.max(0, Math.min(rect.top, imgH - h));
        rect.set({ left: newLeft, top: newTop });
    };

    const setMode = newMode => {
        mode = newMode;
        Object.values(modeButtons).forEach(b => b.classList.remove('active'));
        modeButtons[newMode].classList.add('active');
        canvas.selection = newMode === 'select';
        canvas.skipTargetFind = newMode !== 'select';
        setMovementLock(newMode !== 'select');
        canvas.discardActiveObject();
        deleteBtn.disabled = true;

        const cursors = { move: 'grab', draw: 'crosshair', select: 'default' };
        wrap.style.cursor = cursors[newMode];
        saveState();
    };

    const saveAnnotations = () => {
        const w = imgW || canvas.getWidth();
        const h = imgH || canvas.getHeight();
        const annotations = canvas.getObjects('rect').map(r => ({
            label: r.label,
            x: r.left / w,
            y: r.top / h,
            width: r.width / w,
            height: r.height / h
        }));
        vscode.postMessage({ type: 'saveAnnotation', annotation: annotations });
    };

    // Load image and initial annotations
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

        if (window.initialAnnotations) {
            window.initialAnnotations.forEach(a => {
                const col = colorForLabel(a.label);
                canvas.add(new fabric.Rect({
                    left: a.x * imgW, top: a.y * imgH,
                    width: a.width * imgW, height: a.height * imgH,
                    fill: col + '33', stroke: col, strokeWidth: 1,
                    selectable: true, label: a.label
                }));
            });
            updateCounts();
            setMovementLock(mode !== 'select');
            
            // Save initial state for undo
            saveToHistory();
        }
        // Restore state after canvas is fully loaded
        setTimeout(restoreState, 200);
        canvas.requestRenderAll();
    });

    // Mode switching
    drawBtn.addEventListener('click', () => setMode('draw'));
    selectBtn.addEventListener('click', () => setMode('select'));
    moveBtn.addEventListener('click', () => setMode('move'));

    // Pan implementation
    wrap.addEventListener('mousedown', e => {
        if (mode !== 'move' || e.button !== 0) {return;}
        panning = true;
        wrap.style.cursor = 'grabbing';
        panStartX = e.clientX;
        panStartY = e.clientY;
        startVpt = canvas.viewportTransform.slice();
        e.preventDefault();
    });

    window.addEventListener('mousemove', e => {
        if (!panning) {return;}
        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;
        const vpt = startVpt.slice();
        vpt[4] += dx;
        vpt[5] += dy;
        canvas.setViewportTransform(vpt);
        canvas.forEachObject(obj => obj.setCoords());
        canvas.requestRenderAll();
    });

    window.addEventListener('mouseup', () => {
        if (!panning) {return;}
        panning = false;
        wrap.style.cursor = 'grab';
    });

    // Canvas events
    canvas.on('mouse:down', opt => {
        if (mode === 'select') {
            if (opt.target && opt.target.type === 'rect') {
                // Save state before starting to move an object
                saveToHistory();
                opt.target._startLeft = opt.target.left;
                opt.target._startTop = opt.target.top;
                wrap.style.cursor = 'move';
            } else {
                wrap.style.cursor = 'default';
            }
        }

        if (mode !== 'draw' || opt.e.button !== 0) {return;}
        
        // Save state before starting to draw a new rectangle
        saveToHistory();
        
        const ptr = canvas.getPointer(opt.e);
        drawing = true;
        startX = ptr.x;
        startY = ptr.y;
        const col = colorForLabel(labelSelect.value);
        rect = new fabric.Rect({
            left: startX, top: startY, width: 0, height: 0,
            fill: col + '33', stroke: col, strokeWidth: 1,
            selectable: true, label: labelSelect.value, objectCaching: false
        });
        canvas.add(rect);
    });

    canvas.on('mouse:move', opt => {
        if (!drawing) {return;}
        const p = canvas.getPointer(opt.e);
        const w = p.x - startX, h = p.y - startY;
        let left = w < 0 ? p.x : startX;
        let top = h < 0 ? p.y : startY;
        let width = Math.abs(w);
        let height = Math.abs(h);
        
        if (left < 0) { width += left; left = 0; }
        if (top < 0) { height += top; top = 0; }
        if (left + width > imgW) {width = imgW - left;}
        if (top + height > imgH) {height = imgH - top;}
        
        rect.set({ left, top, width, height });
        canvas.requestRenderAll();
    });

    canvas.on('mouse:up', opt => {
        if (mode === 'select') {
            wrap.style.cursor = 'default';
        }
        if (!drawing) {return;}
        drawing = false;
        if (rect.width < 10 || rect.height < 10) {
            canvas.remove(rect);
            // Remove the state we saved when starting to draw since the rectangle was deleted
            if (undoHistory.length > 0) {
                undoHistory.pop();
            }
            return;
        }
        rect.setCoords();
        canvas.setActiveObject(rect);
        deleteBtn.disabled = false;
        labelSelect.value = rect.label || labelSelect.options[0].value;
        if (mode !== 'select') {
            rect.lockMovementX = true;
            rect.lockMovementY = true;
            rect.selectable = false;
            rect.evented = false;
        }
        updateCounts();
        saveAnnotations();
        // Don't save to history here - we already saved before drawing
        canvas.requestRenderAll();
    });

    canvas.on('object:moving', e => {
        const t = e.target;
        if (!t || t.type !== 'rect') {return;}
        if (!e.e || e.e.buttons === 0) {
            if (typeof t._startLeft === 'number' && typeof t._startTop === 'number') {
                t.set({ left: t._startLeft, top: t._startTop });
                t.setCoords();
                canvas.requestRenderAll();
            }
            return;
        }
        clampRect(t);
    });

    canvas.on('object:scaling', e => {
        if (e.target && e.target.type === 'rect') {clampRect(e.target);}
    });

    canvas.on('selection:created', e => {
        const obj = e.selected[0];
        if (obj) {
            deleteBtn.disabled = false;
            labelSelect.value = obj.label || labelSelect.options[0].value;
        }
    });

    canvas.on('selection:updated', e => {
        const obj = e.selected[0];
        if (obj) {
            deleteBtn.disabled = false;
            labelSelect.value = obj.label || labelSelect.options[0].value;
        }
    });

    canvas.on('selection:cleared', () => {
        deleteBtn.disabled = true;
    });

    // Add flag to track when we should save to history
    let shouldSaveToHistory = false;

    canvas.on('object:added', (e) => {
        updateCounts();
        // Only save to history if this is not during drawing and not an auto-deleted small rect
        if (!drawing && shouldSaveToHistory) {
            saveToHistory();
            shouldSaveToHistory = false;
        }
    });
    
    canvas.on('object:removed', (e) => {
        updateCounts();
        // Only save to history if this is a deliberate deletion (not auto-deletion of small rects)
        if (!drawing && shouldSaveToHistory) {
            saveToHistory();
            shouldSaveToHistory = false;
        }
    });
    
    canvas.on('object:modified', (e) => {
        updateCounts();
        saveAnnotations();
        // Don't save to history here - we already saved before modification started
    });

    // Remove these problematic event handlers that save state unnecessarily
    // canvas.on('selection:created', saveState);
    // canvas.on('selection:updated', saveState);
    // canvas.on('selection:cleared', saveState);

    canvas.on('mouse:wheel', opt => {
        if (!opt.e.ctrlKey) {return;}
        let delta = opt.e.deltaY;
        let zoom = canvas.getZoom() * Math.pow(0.999, delta);
        zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
        const ptr = canvas.getPointer(opt.e);
        canvas.zoomToPoint(new fabric.Point(ptr.x, ptr.y), zoom);
        canvas.forEachObject(obj => obj.setCoords());
        opt.e.preventDefault();
        opt.e.stopPropagation();
    });

    // UI event handlers
    labelSelect.addEventListener('change', () => {
        if (canvas.getActiveObjects().length > 0) {
            // Save state before changing label
            saveToHistory();
        }
        canvas.getActiveObjects().forEach(o => {
            o.label = labelSelect.value;
            const col = colorForLabel(labelSelect.value);
            o.set({ stroke: col, fill: col + '33' });
        });
        canvas.requestRenderAll();
        updateCounts();
        saveState();
    });

    deleteBtn.addEventListener('click', () => {
        // Save state before deletion
        saveToHistory();
        shouldSaveToHistory = true; // Flag that this deletion should be saved to history
        canvas.getActiveObjects().forEach(o => canvas.remove(o));
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        deleteBtn.disabled = true;
    });

    saveBtn.addEventListener('click', saveAnnotations);

    addClassBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'requestAddLabel' });
    });

    renameBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'requestRenameLabel', current: labelSelect.value });
    });

    delClassBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'requestDeleteLabel', name: labelSelect.value });
    });

    window.addEventListener('keydown', e => {
        if (e.key === 'Delete') {
            // Check if a class is selected in dropdown (focus on select element)
            if (document.activeElement === labelSelect) {
                delClassBtn.click();
            } else if (!deleteBtn.disabled) {
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

    // Message handling
    window.addEventListener('message', ev => {
        const msg = ev.data;
        if (msg.type === 'labelAdded') {
            const { label } = msg;
            // If this is the first real label, remove the default 'Object' label
            if (label.removedDefault) {
                labelArray = labelArray.filter(l => l.name !== 'Object');
                delete labelMap['Object'];
                // Remove 'Object' option from select
                const objectOption = labelSelect.querySelector('option[value="Object"]');
                if (objectOption) {
                    objectOption.remove();
                }
            }
            const opt = document.createElement('option');
            opt.value = label.name;
            opt.textContent = label.name;
            opt.style.background = label.color;
            labelSelect.appendChild(opt);
            labelSelect.value = label.name;
            labelMap[label.name] = label.color;
            labelArray.push(label);
            // Don't save to history for label operations - these don't affect annotations
        } else if (msg.type === 'labelRenamed') {
            [...labelSelect.options].forEach(o => {
                if (o.value === msg.oldName) {
                    o.value = o.textContent = msg.newName;
                }
            });
            const oldColor = labelMap[msg.oldName] || '#ff0000';
            canvas.getObjects('rect').forEach(r => {
                if (r.label === msg.oldName) {
                    r.label = msg.newName;
                    r.set({ stroke: oldColor, fill: oldColor + '33' });
                }
            });
            delete labelMap[msg.oldName];
            labelMap[msg.newName] = oldColor;
            labelArray.forEach(l => {
                if (l.name === msg.newName) {
                    l.color = oldColor;
                }
            });
            saveToHistory(); // Save to undo history after label renamed
        } else if (msg.type === 'labelDeleted') {
            const { name } = msg;
            [...labelSelect.options].forEach(o => {
                if (o.value === name) {
                    o.remove();
                }
            });
            delete labelMap[name];
            labelArray = labelArray.filter(l => l.name !== name);
            // Restore default 'Object' label if no other labels remain
            if (labelArray.length === 0 || labelArray.every(l => l.name === 'Object')) {
                const defaultLabel = { name: 'Object', color: '#ff0000' };
                labelArray = [defaultLabel];
                labelMap = { Object: '#ff0000' };
                const opt = document.createElement('option');
                opt.value = defaultLabel.name;
                opt.textContent = defaultLabel.name;
                opt.style.background = defaultLabel.color;
                labelSelect.appendChild(opt);
                labelSelect.value = defaultLabel.name;
            }
            saveToHistory(); // Save to undo history after label deleted
        }
    });
})();