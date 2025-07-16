(() => {
    const vscode = acquireVsCodeApi();
    
    // Get previous state from VS Code
    const previousState = vscode.getState();
    
    const canvasEl = document.getElementById('c');
    const wrap = document.getElementById('canvasWrap');
    const labelSelect = document.getElementById('labelSelect');
    const sidebar = document.getElementById('sidebar');
    const keypointBtn = document.getElementById('keypointModeBtn');
    const selectBtn = document.getElementById('selectModeBtn');
    const moveBtn = document.getElementById('moveModeBtn');
    const connectBtn = document.getElementById('connectModeBtn');
    const modeButtons = { keypoint: keypointBtn, select: selectBtn, move: moveBtn, connect: connectBtn };
    const deleteBtn = document.getElementById('deleteBtn');
    const saveBtn = document.getElementById('saveBtn');
    const addClassBtn = document.getElementById('addClassBtn');
    const renameBtn = document.getElementById('renameBtn');
    const delClassBtn = document.getElementById('delClassBtn');
    const toggleSkeletonBtn = document.getElementById('toggleSkeletonBtn');
    const clearConnectionsBtn = document.getElementById('clearConnectionsBtn');

    const imageUrl = window.imageUrl;
    let labelArray = window.labels;
    let labelMap = Object.fromEntries(labelArray.map(l => [l.name, l.color]));
    let imgW = 0, imgH = 0;
    let mode = previousState?.mode || 'move';
    let panning = false, panStartX = 0, panStartY = 0, startVpt;
    let showSkeleton = true;
    let connections = [];
    let connectingKeypoint = null;
    let keypoints = [];
    
    // === FILE-BASED UNDO/REDO SYSTEM ===
    const CACHE_DIR = '.cache';
    const CACHE_PREFIX = 'keypoint-undo-';
    const CACHE_MAX = 5;
    let cacheIndex = 0; // 0 = latest, increases as you undo
    let cacheLength = 1; // how many states are in cache (1 = only latest)

    // Save annotation JSON to .cache/keypoint-undo-0.json, shift older files
    function saveAnnotationToCache(data) {
        // Shift older files up (4->5, 3->4, ... 0->1)
        for (let i = CACHE_MAX - 1; i > 0; i--) {
            vscode.postMessage({ type: 'moveCacheFile', from: `${CACHE_DIR}/${CACHE_PREFIX}${i-1}.json`, to: `${CACHE_DIR}/${CACHE_PREFIX}${i}.json` });
        }
        // Save new state to 0
        vscode.postMessage({ type: 'writeCacheFile', file: `${CACHE_DIR}/${CACHE_PREFIX}0.json`, data });
        cacheIndex = 0;
        cacheLength = Math.min(cacheLength + 1, CACHE_MAX);
    }

    // Load annotation JSON from .cache/keypoint-undo-X.json
    function loadAnnotationFromCache(idx) {
        vscode.postMessage({ type: 'readCacheFile', file: `${CACHE_DIR}/${CACHE_PREFIX}${idx}.json` });
    }

    // Call this after any annotation change
    function pushAnnotationState() {
        const annotations = keypoints.map(kp => ({
            type: 'keypoint',
            id: kp.id,
            label: kp.label,
            x: kp.x / imgW,
            y: kp.y / imgH,
            visibility: kp.visibility
        }));
        const data = { annotations, connections };
        saveAnnotationToCache(data);
    }

    function undoCache() {
        if (cacheIndex + 1 >= cacheLength) return;
        cacheIndex++;
        loadAnnotationFromCache(cacheIndex);
    }

    function redoCache() {
        if (cacheIndex === 0) return;
        cacheIndex--;
        loadAnnotationFromCache(cacheIndex);
    }

    labelSelect.innerHTML = labelArray.map(l => `<option value="${l.name}" style="background:${l.color}">${l.name}</option>`).join('');

    const canvas = new fabric.Canvas(canvasEl, { selection: true });
    canvas.hoverCursor = 'default';
    canvas.moveCursor = 'move';

    const MIN_ZOOM = 0.1;
    const MAX_ZOOM = 10;
    const KEYPOINT_RADIUS = 6;

    const colorForLabel = name => labelMap[name] || '#ff0000';
    
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
            selectedLabel: labelSelect.value,
            showSkeleton,
            connections,
            keypoints
        };
        vscode.setState(state);
    };

    const restoreState = () => {
        if (previousState) {
            if (previousState.selectedLabel && labelSelect.querySelector(`option[value="${previousState.selectedLabel}"]`)) {
                labelSelect.value = previousState.selectedLabel;
            }
            if (previousState.showSkeleton !== undefined) {
                showSkeleton = previousState.showSkeleton;
                toggleSkeletonBtn.classList.toggle('active', showSkeleton);
            }
            if (previousState.connections) {
                connections = previousState.connections;
            }
            if (previousState.keypoints) {
                keypoints = previousState.keypoints;
            }
            setMode(previousState.mode || 'move');
        }
    };

    const updateCounts = () => {
        const counts = {};
        for (const label of labelArray) {counts[label.name] = 0;}
        keypoints.forEach(kp => {
            if (kp.label && counts.hasOwnProperty(kp.label)) {counts[kp.label]++;}
        });
        
        const connectionCount = connections.length;
        
        sidebar.innerHTML = `
            <h3>Keypoints</h3>
            <div class="stats-section">
                <div class="stat-item">Total: ${keypoints.length}</div>
                <div class="stat-item">Connections: ${connectionCount}</div>
            </div>
            
            <h4>By Label</h4>
            <div class="counts-section">
                ${Object.entries(counts).map(([label, count]) => {
                    const color = colorForLabel(label);
                    return `<div class="count-item">
                        <div class="color-dot" style="background:${color}"></div>
                        <span>${label}: ${count}</span>
                    </div>`;
                }).join('')}
            </div>
            
            ${connections.length > 0 ? `
                <h4>Connections</h4>
                <div class="connections-section">
                    ${connections.map((conn, index) => {
                        const from = keypoints.find(kp => kp.id === conn.from);
                        const to = keypoints.find(kp => kp.id === conn.to);
                        if (!from || !to) {
                            return '';
                        }
                        return `<div class="connection-item">
                            <span>${from.label} → ${to.label}</span>
                            <button class="remove-connection" onclick="removeConnection(${index})">×</button>
                        </div>`;
                    }).join('')}
                </div>
            ` : ''}
            
            ${mode === 'keypoint' ? '<div class="mode-hint">Click to place keypoints</div>' : ''}
            ${mode === 'connect' ? '<div class="mode-hint">Click two keypoints to connect</div>' : ''}
        `;
    };

    const setMode = (newMode) => {
        mode = newMode;
        for (const [name, btn] of Object.entries(modeButtons)) {
            btn.classList.toggle('active', name === newMode);
        }
        
        canvas.selection = (newMode === 'select');
        canvas.isDrawingMode = false;
        
        // Update cursor based on mode
        canvasEl.className = `${newMode}-mode`;
        
        // Reset connecting state when not in connect mode
        if (newMode !== 'connect') {
            resetConnectingState();
        }
        
        // Set movability of keypoints based on mode
        keypoints.forEach(kp => {
            if (kp.fabricObj) {
                kp.fabricObj.set({
                    selectable: newMode === 'select' || newMode === 'connect', // Only selectable in select and connect modes
                    evented: newMode !== 'move', // Not evented in move mode
                    lockMovementX: newMode === 'connect', // Lock movement in connect mode
                    lockMovementY: newMode === 'connect' // Lock movement in connect mode
                });
            }
        });
        
        // Update cursor for keypoint mode
        if (newMode === 'keypoint') {
            canvas.hoverCursor = 'crosshair';
            canvas.defaultCursor = 'crosshair';
            showFeedback('Click to place keypoints');
        } else {
            canvas.hoverCursor = 'default';
            canvas.defaultCursor = 'default';
        }
        
        if (newMode === 'connect') {
            showFeedback('Click two keypoints to connect them');
        }
        
        updateCounts();
        saveState();
    };

    const resetConnectingState = () => {
        connectingKeypoint = null;
        keypoints.forEach(kp => {
            if (kp.fabricObj) {
                kp.fabricObj.set({
                    stroke: colorForLabel(kp.label),
                    strokeWidth: 2,
                    strokeDashArray: null
                });
            }
        });
        canvas.renderAll();
    };

    // Helper function to clamp coordinates within image boundaries
    const clampToImageBounds = (x, y) => {
        const clampedX = Math.max(KEYPOINT_RADIUS, Math.min(imgW - KEYPOINT_RADIUS, x));
        const clampedY = Math.max(KEYPOINT_RADIUS, Math.min(imgH - KEYPOINT_RADIUS, y));
        return { x: clampedX, y: clampedY };
    };

    const createKeypoint = (x, y, label) => {
        // Clamp coordinates to image boundaries
        const clamped = clampToImageBounds(x, y);
        x = clamped.x;
        y = clamped.y;
        
        const id = Date.now().toString() + '.' + Math.random().toString(36).substr(2, 9);
        const color = colorForLabel(label);
        
        const circle = new fabric.Circle({
            left: x - KEYPOINT_RADIUS,
            top: y - KEYPOINT_RADIUS,
            radius: KEYPOINT_RADIUS,
            fill: color,
            stroke: color,
            strokeWidth: 2,
            selectable: mode === 'select' || mode === 'connect', // Only selectable in select and connect modes
            evented: mode !== 'move', // Not evented in move mode
            hasControls: false,
            hasBorders: false,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true,
            lockMovementX: mode === 'connect', // Lock movement in connect mode
            lockMovementY: mode === 'connect' // Lock movement in connect mode
        });
        
        const keypoint = {
            id: id,
            label: label,
            x: x,
            y: y,
            fabricObj: circle,
            visibility: true
        };
        
        circle.keypointId = id;
        keypoints.push(keypoint);
        canvas.add(circle);
        
        // Update position when moved with boundary constraints
        circle.on('moving', () => {
            const newX = circle.left + KEYPOINT_RADIUS;
            const newY = circle.top + KEYPOINT_RADIUS;
            const clamped = clampToImageBounds(newX, newY);
            
            // Update circle position to clamped coordinates
            circle.set({
                left: clamped.x - KEYPOINT_RADIUS,
                top: clamped.y - KEYPOINT_RADIUS
            });
            
            // Update keypoint data
            keypoint.x = clamped.x;
            keypoint.y = clamped.y;
            // Don't update skeleton lines here - they will update when selection is cleared
        });
        
        return keypoint;
    };

    const findKeypointById = (id) => {
        return keypoints.find(kp => kp.id === id);
    };

    // Helper function to synchronize keypoint data with fabric object positions
    const synchronizeKeypointPositions = () => {
        keypoints.forEach(kp => {
            if (kp.fabricObj) {
                kp.x = kp.fabricObj.left + KEYPOINT_RADIUS;
                kp.y = kp.fabricObj.top + KEYPOINT_RADIUS;
            }
        });
    };

    const createConnection = (fromKeypoint, toKeypoint) => {
        const connection = {
            from: fromKeypoint.id,
            to: toKeypoint.id
        };
        
        if (!connections.find(c => 
            (c.from === connection.from && c.to === connection.to) ||
            (c.from === connection.to && c.to === connection.from)
        )) {
            connections.push(connection);
            updateSkeletonLines();
            showFeedback(`Connected ${fromKeypoint.label} to ${toKeypoint.label}`);
        } else {
            showFeedback('Connection already exists', 'error');
        }
    };

    const updateSkeletonLines = () => {
        // Synchronize keypoint data with fabric object positions
        synchronizeKeypointPositions();
        
        // Remove existing skeleton lines
        canvas.getObjects().forEach(obj => {
            if (obj.isSkeletonLine) {
                canvas.remove(obj);
            }
        });
        
        if (!showSkeleton) {
            return;
        }
        
        // Draw new skeleton lines using the same approach as instance detection
        connections.forEach(conn => {
            const fromKp = findKeypointById(conn.from);
            const toKp = findKeypointById(conn.to);
            
            if (fromKp && toKp) {
                const line = new fabric.Line([fromKp.x, fromKp.y, toKp.x, toKp.y], {
                    stroke: '#00ff00',
                    strokeWidth: 2,
                    strokeDashArray: [5, 5],
                    selectable: false,
                    evented: false,
                    isSkeletonLine: true
                });
                
                canvas.add(line);
            }
        });
        
        canvas.renderAll();
    };

    const hideSkeletonLines = () => {
        // Remove existing skeleton lines without redrawing them
        canvas.getObjects().forEach(obj => {
            if (obj.isSkeletonLine) {
                canvas.remove(obj);
            }
        });
        canvas.renderAll();
    };

    const removeConnection = (index) => {
        connections.splice(index, 1);
        updateSkeletonLines();
        updateCounts();
        saveAnnotations(); // Auto-save when connection is removed
        saveState();
    };

    // Make removeConnection globally accessible
    window.removeConnection = removeConnection;

    const saveAnnotations = () => {
        const annotations = keypoints.map(kp => ({
            type: 'keypoint',
            id: kp.id,
            label: kp.label,
            x: kp.x / imgW,
            y: kp.y / imgH,
            visibility: kp.visibility
        }));
        
        const data = {
            annotations: annotations,
            connections: connections
        };
        
        vscode.postMessage({ type: 'saveAnnotation', annotation: data });
    };

    // Event handlers
    canvas.on('mouse:down', (e) => {
        if (mode === 'keypoint') {
            const pointer = canvas.getPointer(e.e);
            const label = labelSelect.value;
            createKeypoint(pointer.x, pointer.y, label);
            updateCounts();
            saveAnnotations(); // Auto-save when keypoint is added
            pushAnnotationState(); // Save to undo history after auto-save
            saveState();
            return;
        }
        
        if (mode === 'connect' && e.target && e.target.keypointId) {
            const clickedKeypoint = findKeypointById(e.target.keypointId);
            
            if (!clickedKeypoint) {
                return;
            }
            
            if (!connectingKeypoint) {
                // First keypoint selected
                connectingKeypoint = clickedKeypoint;
                clickedKeypoint.fabricObj.set({
                    stroke: '#ffff00',
                    strokeWidth: 3,
                    strokeDashArray: [5, 5]
                });
                canvas.renderAll();
                showFeedback(`Selected ${clickedKeypoint.label}. Click another keypoint to connect.`);
            } else {
                // Second keypoint selected
                if (connectingKeypoint.id !== clickedKeypoint.id) {
                    createConnection(connectingKeypoint, clickedKeypoint);
                    updateCounts();
                    saveAnnotations(); // Auto-save when connection is created
                    pushAnnotationState(); // Save to undo history after auto-save
                    saveState();
                }
                resetConnectingState();
            }
            return;
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
    });

    canvas.on('mouse:up', (e) => {
        if (panning) {
            panning = false;
        }
    });

    canvas.on('selection:created', (e) => {
        deleteBtn.disabled = false;
        // Hide skeleton lines when any selection is made, except in connect mode
        if (mode !== 'connect') {
            hideSkeletonLines();
        }
    });

    canvas.on('selection:updated', (e) => {
        deleteBtn.disabled = false;
        // Hide skeleton lines when selection is updated, except in connect mode
        if (mode !== 'connect') {
            hideSkeletonLines();
        }
    });

    canvas.on('selection:cleared', (e) => {
        deleteBtn.disabled = true;
        // Show skeleton lines when selection is cleared, except in connect mode (they should already be visible)
        if (mode !== 'connect') {
            updateSkeletonLines();
        }
        // Ensure annotations are saved after any selection changes
        // This catches cases where keypoints were moved and then deselected
        saveAnnotations();
    });

    canvas.on('object:moved', (e) => {
        // Handle both individual keypoint movement and group movement
        if (e.target.keypointId) {
            // Single keypoint moved
            saveAnnotations(); // Auto-save when keypoint is moved
            saveState();
        } else if (e.target.type === 'activeSelection') {
            // Group of objects moved - check if any are keypoints
            const keypointObjects = e.target.getObjects().filter(obj => obj.keypointId);
            if (keypointObjects.length > 0) {
                // Update keypoint data to match final fabric object positions
                // Do NOT apply individual clamping here as it causes convergence
                keypointObjects.forEach(circle => {
                    const keypoint = keypoints.find(kp => kp.id === circle.keypointId);
                    if (keypoint) {
                        keypoint.x = circle.left + KEYPOINT_RADIUS;
                        keypoint.y = circle.top + KEYPOINT_RADIUS;
                    }
                });
                
                saveAnnotations(); // Auto-save when keypoints are moved
                saveState();
            }
        }
    });

    // Handle boundary clamping during movement
    canvas.on('object:moving', (e) => {
        // Only handle individual keypoint movement here
        // Group movements should not have individual clamping as it causes convergence
        if (e.target.keypointId) {
            // Single keypoint being moved - boundary clamping is handled in createKeypoint
            // No additional action needed here
        }
        // Note: Group movements are intentionally not handled here to prevent keypoint convergence
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
        if (e.key === 'Escape' && mode === 'connect') {
            resetConnectingState();
            showFeedback('Connection cancelled');
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
            undoCache();
        }
        // Ctrl+Y for redo
        if (e.ctrlKey && e.key === 'y') {
            e.preventDefault();
            redoCache();
        }
    });

    // Mode button handlers
    keypointBtn.addEventListener('click', () => setMode('keypoint'));
    selectBtn.addEventListener('click', () => setMode('select'));
    moveBtn.addEventListener('click', () => setMode('move'));
    connectBtn.addEventListener('click', () => setMode('connect'));

    // Other button handlers
    deleteBtn.addEventListener('click', () => {
        const activeObjects = canvas.getActiveObjects();
        if (activeObjects.length > 0) {
            activeObjects.forEach(obj => {
                if (obj.keypointId) {
                    // Remove keypoint
                    const keypointIndex = keypoints.findIndex(kp => kp.id === obj.keypointId);
                    if (keypointIndex !== -1) {
                        keypoints.splice(keypointIndex, 1);
                    }
                    
                    // Remove associated connections
                    connections = connections.filter(conn => 
                        conn.from !== obj.keypointId && conn.to !== obj.keypointId
                    );
                }
                canvas.remove(obj);
            });
            
            canvas.discardActiveObject();
            updateSkeletonLines();
            updateCounts();
            saveAnnotations(); // Auto-save when keypoints are deleted
            pushAnnotationState(); // Save to undo history after auto-save
            saveState();
            showFeedback(`Deleted ${activeObjects.length} keypoint(s)`);
        }
    });

    toggleSkeletonBtn.addEventListener('click', () => {
        showSkeleton = !showSkeleton;
        toggleSkeletonBtn.classList.toggle('active', showSkeleton);
        updateSkeletonLines();
        saveState();
        showFeedback(showSkeleton ? 'Skeleton lines enabled' : 'Skeleton lines disabled');
    });

    clearConnectionsBtn.addEventListener('click', () => {
        connections = [];
        updateSkeletonLines();
        updateCounts();
        saveAnnotations(); // Auto-save when all connections are cleared
        pushAnnotationState(); // Save to undo history after auto-save
        saveState();
        showFeedback('All connections cleared');
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
            if (window.initialAnnotations.annotations) {
                window.initialAnnotations.annotations.forEach(ann => {
                    if (ann.type === 'keypoint') {
                        // Use direct image coordinates and clamp to bounds
                        const x = ann.x * imgW;
                        const y = ann.y * imgH;
                        const clamped = clampToImageBounds(x, y);
                        const keypoint = createKeypoint(clamped.x, clamped.y, ann.label);
                        
                        // Preserve the original ID from saved annotations
                        if (keypoint && ann.id) {
                            keypoint.id = ann.id;
                            keypoint.fabricObj.keypointId = ann.id;
                        }
                        
                        // Ensure keypoint data coordinates match fabric object position
                        if (keypoint && keypoint.fabricObj) {
                            keypoint.x = keypoint.fabricObj.left + KEYPOINT_RADIUS;
                            keypoint.y = keypoint.fabricObj.top + KEYPOINT_RADIUS;
                        }
                    }
                });
            }
            
            if (window.initialAnnotations.connections) {
                connections = window.initialAnnotations.connections;
            }
        }
        
        // Synchronize keypoint positions and update skeleton lines after loading
        synchronizeKeypointPositions();
        updateSkeletonLines();
        // Update keypoint properties based on current mode
        keypoints.forEach(kp => {
            if (kp.fabricObj) {
                kp.fabricObj.set({
                    selectable: mode === 'select' || mode === 'connect', // Only selectable in select and connect modes
                    evented: mode !== 'move', // Not evented in move mode
                    lockMovementX: mode === 'connect', // Lock movement in connect mode
                    lockMovementY: mode === 'connect' // Lock movement in connect mode
                });
            }
        });
        // Restore state after canvas is fully loaded
        setTimeout(restoreState, 200);
        updateCounts();
        canvas.requestRenderAll();
        
        // Save initial state for undo
        setTimeout(() => pushAnnotationState(), 300);
    });

    // Message handler for VS Code communication
    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.type) {
            case 'loadAnnotations':
                if (message.annotations) {
                    // Clear existing keypoints and connections
                    keypoints.forEach(kp => canvas.remove(kp.fabricObj));
                    keypoints = [];
                    connections = [];
                    
                    // Load keypoints
                    if (message.annotations.annotations) {
                        message.annotations.annotations.forEach(ann => {
                            if (ann.type === 'keypoint') {
                                const x = ann.x * imgW;
                                const y = ann.y * imgH;
                                const clamped = clampToImageBounds(x, y);
                                const keypoint = createKeypoint(clamped.x, clamped.y, ann.label);
                                
                                // Preserve the original ID from saved annotations
                                if (keypoint && ann.id) {
                                    keypoint.id = ann.id;
                                    keypoint.fabricObj.keypointId = ann.id;
                                }
                                
                                // Ensure keypoint data coordinates match fabric object position
                                if (keypoint && keypoint.fabricObj) {
                                    keypoint.x = keypoint.fabricObj.left + KEYPOINT_RADIUS;
                                    keypoint.y = keypoint.fabricObj.top + KEYPOINT_RADIUS;
                                }
                            }
                        });
                    }
                    
                    // Load connections
                    if (message.annotations.connections) {
                        connections = message.annotations.connections;
                    }
                    
                    // Synchronize keypoint positions and update skeleton lines
                    synchronizeKeypointPositions();
                    updateSkeletonLines();
                    // Update keypoint properties based on current mode
                    keypoints.forEach(kp => {
                        if (kp.fabricObj) {
                            kp.fabricObj.set({
                                selectable: mode === 'select' || mode === 'connect', // Only selectable in select and connect modes
                                evented: mode !== 'move', // Not evented in move mode
                                lockMovementX: mode === 'connect', // Lock movement in connect mode
                                lockMovementY: mode === 'connect' // Lock movement in connect mode
                            });
                        }
                    });
                    updateCounts();
                    canvas.renderAll();
                }
                break;
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
                pushAnnotationState(); // Save to undo history after label added
                break;
            case 'labelRenamed':
                const oldName = message.oldName;
                const newName = message.newName;
                labelArray.forEach(l => { if (l.name === oldName) {l.name = newName;} });
                labelMap[newName] = labelMap[oldName];
                delete labelMap[oldName];
                labelSelect.innerHTML = labelArray.map(l => `<option value="${l.name}" style="background:${l.color}">${l.name}</option>`).join('');
                labelSelect.value = newName;
                
                // Update existing keypoints
                keypoints.forEach(kp => {
                    if (kp.label === oldName) {
                        kp.label = newName;
                        const newColor = colorForLabel(newName);
                        kp.fabricObj.set({
                            fill: newColor,
                            stroke: newColor
                        });
                    }
                });
                
                updateCounts();
                canvas.renderAll();
                pushAnnotationState(); // Save to undo history after label renamed
                break;
            case 'labelDeleted':
                const deletedName = message.name;
                labelArray = labelArray.filter(l => l.name !== deletedName);
                delete labelMap[deletedName];
                labelSelect.innerHTML = labelArray.map(l => `<option value="${l.name}" style="background:${l.color}">${l.name}</option>`).join('');
                
                // Remove keypoints with deleted label
                keypoints = keypoints.filter(kp => {
                    if (kp.label === deletedName) {
                        canvas.remove(kp.fabricObj);
                        return false;
                    }
                    return true;
                });
                
                // Remove connections involving deleted keypoints
                connections = connections.filter(conn => {
                    const fromKp = findKeypointById(conn.from);
                    const toKp = findKeypointById(conn.to);
                    return fromKp && toKp;
                });
                
                updateSkeletonLines();
                updateCounts();
                canvas.renderAll();
                pushAnnotationState(); // Save to undo history after label deleted
                break;
        }
    });

    // Initialize
    restoreState();
    updateCounts();
})();