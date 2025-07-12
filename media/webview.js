(() => {
    const vscode = acquireVsCodeApi();

    const canvasEl = document.getElementById('c');
    const wrap = document.getElementById('canvasWrap');
    const labelSelect = document.getElementById('labelSelect');
    const sidebar = document.getElementById('sidebar');
    const modeBtn = document.getElementById('modeBtn');
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

    const canvas = new fabric.Canvas(canvasEl, { selection: false });
    canvas.perPixelTargetFind = false;
    canvas.selectionFullyContained = false;

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

    fabric.Image.fromURL(imageUrl, img => {
        canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
        canvas.setWidth(img.width);
        canvas.setHeight(img.height);
        wrap.style.width = img.width + 'px';
        wrap.style.height = img.height + 'px';
    });

    let mode = 'draw';
    let drawing = false,
        rect, startX, startY;

    function setMode(newMode) {
        mode = newMode;
        modeBtn.textContent = 'Mode: ' + newMode.charAt(0).toUpperCase() + newMode.slice(1);
        canvas.selection = newMode === 'select';
        canvas.discardActiveObject();
        deleteBtn.disabled = true;
    }

    modeBtn.addEventListener('click', () => setMode(mode === 'draw' ? 'select' : 'draw'));

    function colorForLabel(name) {
        return labelMap[name] || '#ff0000';
    }

    function updateCounts() {
        const counts = {};
        canvas.getObjects('rect').forEach(r => {
            counts[r.label] = (counts[r.label] || 0) + 1;
        });
        sidebar.innerHTML = Object.entries(counts).map(([name, count]) => {
            const col = colorForLabel(name);
            return '<div style="display:flex;align-items:center;gap:4px;margin:2px 0;"><span style="width:12px;height:12px;background:' + col + ';display:inline-block;border-radius:50%;"></span>' + name + ' ' + count + '</div>';
        }).join('');
    }

    canvas.on('mouse:down', opt => {
        if (mode !== 'draw') return;
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
        if (!drawing) return;
        const p = canvas.getPointer(opt.e);
        const w = p.x - startX,
            h = p.y - startY;
        rect.set({
            left: w < 0 ? p.x : startX,
            top: h < 0 ? p.y : startY,
            width: Math.abs(w),
            height: Math.abs(h)
        });
        canvas.requestRenderAll();
    });

    canvas.on('mouse:up', () => {
        drawing = false;
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
        updateCounts();
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
                if (l.name === msg.oldName) l.name = msg.newName;
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
        if (e.key === 'Delete' && !deleteBtn.disabled) deleteBtn.click();
    });

    saveBtn.addEventListener('click', () => {
        const annotations = canvas.getObjects('rect').map(r => ({
            label: r.label,
            x: r.left,
            y: r.top,
            width: r.width,
            height: r.height
        }));
        vscode.postMessage({
            type: 'saveAnnotation',
            annotation: annotations
        });
    });

    canvas.on('object:added', updateCounts);
    canvas.on('object:removed', updateCounts);
    canvas.on('object:modified', updateCounts);

    canvas.on('mouse:dblclick', opt => {
        if (opt.target && opt.target.type === 'rect') {
            const p = canvas.getPointer(opt.e);
            showLabelPicker(p.x, p.y, opt.target);
        }
    });

    canvas.upperCanvasEl.addEventListener('contextmenu', e => {
        e.preventDefault();
        const rect = canvas.findTarget(e, true);
        if (rect && rect.type === 'rect') {
            const bbox = canvas.upperCanvasEl.getBoundingClientRect();
            showLabelPicker(e.clientX - bbox.left, e.clientY - bbox.top, rect);
        }
    });
})();