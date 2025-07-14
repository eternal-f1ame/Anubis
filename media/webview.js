(() => {
    const vscode = acquireVsCodeApi();

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

    // These will be provided by the extension
    const imageUrl = window.imageUrl;
    let labelArray = window.labels;
    let labelMap = Object.fromEntries(labelArray.map(l => [l.name, l.color]));

    labelSelect.innerHTML = labelArray.map(l => `<option value="${l.name}" style="background:${l.color}">${l.name}</option>`).join('');

    // Initialise canvas with group selection enabled (will be toggled per mode)
    const canvas = new fabric.Canvas(canvasEl, { selection: true });

    // ---------- Zoom & pan config ----------
    const MIN_ZOOM = 0.1;
    const MAX_ZOOM = 10;

    function showLabelPicker(x, y, target) {
        const sel = document.createElement('select');
        labelArray.forEach(l => {
            const o = document.createElement('option');
            o.value = l.name;
            o.textContent = l.name;
            sel.appendChild(o);
        });
        sel.value = target.label;
        sel.style.position = 'absolute';
        sel.style.left = x + 'px';
        sel.style.top = y + 'px';
        document.body.appendChild(sel);
        sel.focus();
        sel.onchange = () => {
            target.label = sel.value;
            const col = colorForLabel(sel.value);
            target.set({ stroke: col, fill: col + '33' });
            canvas.requestRenderAll();
            updateCounts();
            document.body.removeChild(sel);
        };
        sel.onblur = () => document.body.removeChild(sel);
    }

    let imgW = 0, imgH = 0; // store image dimensions

    fabric.Image.fromURL(imageUrl, img => {
        canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
        canvas.setWidth(img.width);
        canvas.setHeight(img.height);

        imgW = img.width;
        imgH = img.height;

        // Fit the image inside the available viewport on first load
        const scale = Math.min(wrap.clientWidth / img.width, wrap.clientHeight / img.height, 1);
        canvas.setZoom(scale);
        const vpt = canvas.viewportTransform;
        vpt[4] = (wrap.clientWidth - img.width * scale) / 2;
        vpt[5] = (wrap.clientHeight - img.height * scale) / 2;

        // Render any provided annotations
        if (window.initialAnnotations) {
            window.initialAnnotations.forEach(a => {
                const col = colorForLabel(a.label);
                const r = new fabric.Rect({
                    left: a.x * imgW,
                    top: a.y * imgH,
                    width: a.width * imgW,
                    height: a.height * imgH,
                    fill: col + '33',
                    stroke: col,
                    strokeWidth: 1,
                    selectable: true,
                    label: a.label,
                });
                canvas.add(r);
            });
            updateCounts();
            // Ensure newly added rectangles respect current mode interaction rules
            setMovementLock(mode !== 'select');
        }

        canvas.requestRenderAll();
    });

    let mode = 'move';
    let drawing = false,
        rect, startX, startY;

    // No right-click moving anymore

    // Mode buttons listeners
    drawBtn.addEventListener('click', () => setMode('draw'));
    selectBtn.addEventListener('click', () => setMode('select'));
    moveBtn.addEventListener('click', () => setMode('move'));

    function setMode(newMode) {
        mode = newMode;
        // update button highlight
        Object.values(modeButtons).forEach(b => b.classList.remove('active'));
        modeButtons[newMode].classList.add('active');
        canvas.selection = newMode === 'select';
        // Re-apply selection behaviour each time we toggle so that
        // partial-overlap marquee selection keeps working even after
        // switching modes.
        canvas.selectionFullyContained = false;
        canvas.perPixelTargetFind = false;
        // Disable target finding in any non-select mode so clicks on rects do nothing
        canvas.skipTargetFind = newMode !== 'select';

        // Lock movement when not in select mode
        setMovementLock(newMode !== 'select');
        canvas.discardActiveObject();
        deleteBtn.disabled = true;

        // Update cursor cues
        if (newMode === 'move') {
            wrap.style.cursor = 'grab';
        } else if (newMode === 'draw') {
            wrap.style.cursor = 'crosshair';
        } else {
            wrap.style.cursor = 'default';
        }
    }

    // ----------------------------------
    // Pan (move) implementation
    // ----------------------------------
    let panning = false, panStartX = 0, panStartY = 0, startVpt;

    wrap.addEventListener('mousedown', e => {
        if (mode !== 'move' || e.button !== 0) {return;} // left button only
        panning = true;
        wrap.style.cursor = 'grabbing';
        panStartX = e.clientX;
        panStartY = e.clientY;
        startVpt = canvas.viewportTransform.slice(); // clone current VPT
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
        // refresh coords so hit-testing & marquee selection stay accurate
        canvas.forEachObject(obj => obj.setCoords());
        canvas.requestRenderAll();
    });

    window.addEventListener('mouseup', () => {
        if (!panning) {return;}
        panning = false;
        wrap.style.cursor = 'grab';
    });

    function colorForLabel(name) {
        return labelMap[name] || '#ff0000';
    }

    // Lock/unlock movement of rectangles when in draw mode
    function setMovementLock(lock){
        canvas.getObjects('rect').forEach(r=>{
            r.lockMovementX = lock;
            r.lockMovementY = lock;
            r.selectable = !lock;
            r.evented = !lock; // prevents hover cursor change
        });
    }

    // Helper: make a rectangle the active selection and sync toolbar state
    function selectRect(r) {
        canvas.setActiveObject(r);
        deleteBtn.disabled = false;
        labelSelect.value = r.label || labelSelect.options[0].value;
        canvas.requestRenderAll();
    }

    // Keep rectangle within image bounds
    function clampRect(rect){
        if(!imgW || !imgH) return;
        const w = rect.width * rect.scaleX;
        const h = rect.height * rect.scaleY;
        let newLeft = rect.left;
        let newTop = rect.top;
        if(newLeft < 0) newLeft = 0;
        if(newTop < 0) newTop = 0;
        if(newLeft + w > imgW) newLeft = imgW - w;
        if(newTop + h > imgH) newTop = imgH - h;
        rect.set({left:newLeft, top:newTop});
    }

    canvas.on('object:moving', e => {
        // Keep rectangles within image bounds while they are being dragged
        if (e.target && e.target.type === 'rect') {
            clampRect(e.target);
        }
    });

    canvas.on('object:scaling', e=>{
        if(e.target && e.target.type==='rect'){ clampRect(e.target); }
    });

    function updateCounts() {
        const counts = {};
        canvas.getObjects('rect').forEach(r => {
            counts[r.label] = (counts[r.label] || 0) + 1;
        });
        sidebar.innerHTML = Object.entries(counts).map(([name, count]) => {
            const col = colorForLabel(name);
            return `<div class="sidebar-item"><span class="color-dot" style="background:${col}"></span>${name} ${count}</div>`;
        }).join('');
    }

    canvas.on('mouse:down', opt => {
        // In Select mode, show a move cursor only while the mouse is actively pressed on a rectangle
        if (mode === 'select') {
            if (opt.target && opt.target.type === 'rect') {
                wrap.style.cursor = 'move';
            } else {
                // Clicked outside any rectangle, keep the default cursor
                wrap.style.cursor = 'default';
            }
        }

        // Prevent selecting / moving boxes in non-select modes
        if (mode !== 'select' && opt.target && opt.target.type === 'rect') {
            return;
        }

        if (mode !== 'draw' || opt.e.button !== 0) {return;} // only left draw
        const ptr = canvas.getPointer(opt.e);
        drawing = true;
        startX = ptr.x;
        startY = ptr.y;
        const col = colorForLabel(labelSelect.value);
        rect = new fabric.Rect({
            left: startX,
            top: startY,
            width: 0,
            height: 0,
            fill: col + '33',
            stroke: col,
            strokeWidth: 1,
            selectable: true,
            label: labelSelect.value,
            objectCaching: false
        });
        canvas.add(rect);
    });

    canvas.on('mouse:move', opt => {
        // Update the in-progress rectangle only while drawing
        if (!drawing) {return;}
        const p = canvas.getPointer(opt.e);
        const w = p.x - startX,
            h = p.y - startY;
        let left = w < 0 ? p.x : startX;
        let top = h < 0 ? p.y : startY;
        let width = Math.abs(w);
        let height = Math.abs(h);
        // clamp drawing to image bounds
        if(left < 0) { width += left; left = 0; }
        if(top < 0) { height += top; top = 0; }
        if(left + width > imgW) { width = imgW - left; }
        if(top + height > imgH) { height = imgH - top; }
        rect.set({ left, top, width, height });
        canvas.requestRenderAll();
    });

    canvas.on('mouse:up', opt => {
        // Always reset any temporary cursor state when the mouse is released
        if (mode === 'select') {
            wrap.style.cursor = 'default';
        }

        // If we were not in the middle of a drawing operation, bail out early
        if (!drawing) {
            return;
        }

        // We *were* drawing – finish creating the rectangle
        drawing = false;
        // if the rect is too small, delete it
        if (rect.width < 10 || rect.height < 10) {
            canvas.remove(rect);
            return;
        }

        // Ensure coordinates are up-to-date for accurate selection hit-testing
        rect.setCoords();
        // Automatically select the newly created rectangle
        selectRect(rect);
        // Lock movement if not in select mode to prevent accidental drags
        if (mode !== 'select') {
            rect.lockMovementX = true;
            rect.lockMovementY = true;
            rect.selectable = false;
            rect.evented = false;
        }
        updateCounts();
        scheduleAutoSave();
        canvas.requestRenderAll();
    });

    canvas.on('selection:created', syncToolbar);
    canvas.on('selection:updated', syncToolbar);
    canvas.on('selection:cleared', () => {
        deleteBtn.disabled = true;
    });

    function syncToolbar(e) {
        const obj = e.selected[0];
        if (obj) {
            deleteBtn.disabled = false;
            labelSelect.value = obj.label || labelSelect.options[0].value;
        }
    }

    labelSelect.addEventListener('change', () => {
        canvas.getActiveObjects().forEach(o => {
            o.label = labelSelect.value;
            o.set({
                stroke: colorForLabel(labelSelect.value),
                fill: colorForLabel(labelSelect.value) + '33'
            });
        });
        canvas.requestRenderAll();
        updateCounts();
    });

    deleteBtn.addEventListener('click', () => {
        canvas.getActiveObjects().forEach(o => canvas.remove(o));
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        deleteBtn.disabled = true;
        // updateCounts will be triggered by the 'object:removed' event listener
    });

    addClassBtn.addEventListener('click', () => {
        vscode.postMessage({
            type: 'requestAddLabel'
        });
    });

    renameBtn.addEventListener('click', () => {
        vscode.postMessage({
            type: 'requestRenameLabel',
            current: labelSelect.value
        });
    });

    delClassBtn.addEventListener('click', () => {
        vscode.postMessage({
            type: 'requestDeleteLabel',
            name: labelSelect.value
        });
    });

    window.addEventListener('message', ev => {
        const msg = ev.data;
        if (msg.type === 'labelAdded') {
            const {
                label
            } = msg;
            const opt = document.createElement('option');
            opt.value = label.name;
            opt.textContent = label.name;
            opt.style.background = label.color;
            labelSelect.appendChild(opt);
            labelSelect.value = label.name;
            labelMap[label.name] = label.color;
            labelArray.push(label);
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
                    r.set({
                        stroke: oldColor,
                        fill: oldColor + '33'
                    });
                }
            });
            delete labelMap[msg.oldName];
            labelMap[msg.newName] = oldColor;
            labelArray.forEach(l => {
                if (l.name === msg.oldName) {l.name = msg.newName;}
            });
            updateCounts();
        } else if (msg.type === 'labelDeleted') {
            [...labelSelect.options].forEach(o => {
                if (o.value === msg.name) {
                    o.remove();
                }
            });
            canvas.getObjects('rect').filter(r => r.label === msg.name).forEach(r => canvas.remove(r));
            delete labelMap[msg.name];
            labelArray = labelArray.filter(l => l.name !== msg.name);
            if (labelSelect.value === msg.name && labelSelect.options.length > 0) {
                labelSelect.value = labelSelect.options[0].value;
            }
            updateCounts();
        }
    });

    window.addEventListener('keydown', e => {
        if (e.key === 'Delete' && !deleteBtn.disabled) {deleteBtn.click();}
    });

    // Save annotations using relative coordinates so they are robust to image resizing
    saveBtn.addEventListener('click', () => {
        // Determine current image dimensions
        const imgW = canvas.backgroundImage ? canvas.backgroundImage.width : canvas.getWidth();
        const imgH = canvas.backgroundImage ? canvas.backgroundImage.height : canvas.getHeight();

        const annotations = canvas.getObjects('rect').map(r => ({
            label: r.label,
            // Normalize coordinates and size
            x: r.left / imgW,
            y: r.top / imgH,
            width: r.width / imgW,
            height: r.height / imgH
        }));

        vscode.postMessage({
            type: 'saveAnnotation',
            annotation: annotations
        });
    });

    canvas.on('object:added', updateCounts);
    canvas.on('object:removed', updateCounts);
    canvas.on('object:modified', updateCounts);

    // ---------------- Auto-save ----------------
    let saveDebounce = null;
    function scheduleAutoSave(){
        if(saveDebounce){ clearTimeout(saveDebounce); }
        saveDebounce = setTimeout(doSave, 400);
    }

    function doSave(){
        saveDebounce = null;
        // Determine image dimensions for relative coords
        const w = imgW || canvas.getWidth();
        const h = imgH || canvas.getHeight();
        const annotations = canvas.getObjects('rect').map(r=>({
            label:r.label,
            x:r.left / w,
            y:r.top / h,
            width:r.width / w,
            height:r.height / h
        }));
        vscode.postMessage({type:'saveAnnotation', annotation:annotations});
    }

    canvas.on('object:removed', ()=>{ scheduleAutoSave(); });
    canvas.on('object:modified', ()=>{ scheduleAutoSave(); });

    // keep manual Save button for explicit save if user wants

    canvas.on('mouse:dblclick', opt => {
        if (opt.target && opt.target.type === 'rect') {
            const p = canvas.getPointer(opt.e);
            showLabelPicker(p.x, p.y, opt.target);
        }
    });

    canvas.upperCanvasEl.addEventListener('contextmenu', e => {
        e.preventDefault();
        const rect = canvas.findTarget(e, true);
        if (!rect || rect.type !== 'rect') return;

        if (mode === 'select') {
            const bbox = canvas.upperCanvasEl.getBoundingClientRect();
            showLabelPicker(e.clientX - bbox.left, e.clientY - bbox.top, rect);
        }
        e.preventDefault();
    });

    // Ensure initial tool state is correctly applied to default (Move) mode.
    setMode('move');

    // Zoom in/out with Ctrl + Mouse wheel, centred on cursor
    canvas.on('mouse:wheel', opt => {
        if (!opt.e.ctrlKey) {
            return; // let normal scroll behaviour happen
        }
        let delta = opt.e.deltaY;
        let zoom = canvas.getZoom();
        // Using exponential factor for smooth zooming
        zoom *= Math.pow(0.999, delta);
        if (zoom > MAX_ZOOM) {zoom = MAX_ZOOM;}
        if (zoom < MIN_ZOOM) {zoom = MIN_ZOOM;}

        const ptr = canvas.getPointer(opt.e);
        canvas.zoomToPoint(new fabric.Point(ptr.x, ptr.y), zoom);
        canvas.forEachObject(obj => obj.setCoords());
        opt.e.preventDefault();
        opt.e.stopPropagation();
    });
})();