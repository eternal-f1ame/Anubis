(() => {
    const vscode = acquireVsCodeApi();
    
    // Get previous state from VS Code
    const previousState = vscode.getState();
    
    // DOM elements
    const clearBtn = document.getElementById('clearBtn');
    const addClassBtn = document.getElementById('addClassBtn');
    const renameBtn = document.getElementById('renameBtn');
    const delClassBtn = document.getElementById('delClassBtn');
    const saveBtn = document.getElementById('saveBtn');
    const labelsList = document.getElementById('labelsList');
    const selectedLabels = document.getElementById('selectedLabels');
    const classificationResults = document.getElementById('classificationResults');
    const classificationImage = document.getElementById('classificationImage');
    
    // State
    const imageUrl = window.imageUrl;
    let labelArray = window.labels;
    let labelMap = Object.fromEntries(labelArray.map(l => [l.name, l.color]));
    let selectedLabelNames = new Set();
    let classificationData = window.initialClassification || {};
    
    // Initialize image
    classificationImage.src = imageUrl;
    
    const colorForLabel = name => labelMap[name] || '#ff0000';
    
    const saveState = () => {
        const state = {
            selectedLabels: Array.from(selectedLabelNames),
            classificationData: classificationData
        };
        vscode.setState(state);
    };
    
    const restoreState = () => {
        if (previousState) {
            if (previousState.selectedLabels) {
                selectedLabelNames = new Set(previousState.selectedLabels);
            }
            if (previousState.classificationData) {
                classificationData = previousState.classificationData;
            }
            updateUI();
        }
    };
    
    const updateLabelsListUI = () => {
        labelsList.innerHTML = '';
        labelArray.forEach(label => {
            const item = document.createElement('div');
            item.className = 'label-item';
            item.onclick = () => toggleLabel(label.name);
            
            if (selectedLabelNames.has(label.name)) {
                item.classList.add('selected');
            }
            
            item.innerHTML = `
                <div class="color-dot" style="background-color: ${label.color}"></div>
                <div class="label-name">${label.name}</div>
            `;
            
            labelsList.appendChild(item);
        });
    };
    
    const updateSelectedLabelsUI = () => {
        selectedLabels.innerHTML = '';
        selectedLabelNames.forEach(labelName => {
            const color = colorForLabel(labelName);
            const confidence = classificationData[labelName] || 0.5;
            
            const item = document.createElement('div');
            item.className = 'selected-label';
            item.innerHTML = `
                <div class="color-dot" style="background-color: ${color}"></div>
                <div class="label-name">${labelName}</div>
                <input type="number" class="confidence-input" min="0" max="1" step="0.1" value="${confidence}">
                <button class="remove-label">×</button>
            `;
            
            const confidenceInput = item.querySelector('.confidence-input');
            confidenceInput.addEventListener('change', (e) => {
                const value = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0));
                e.target.value = value;
                classificationData[labelName] = value;
                updateClassificationResults();
                saveState();
            });
            
            const removeBtn = item.querySelector('.remove-label');
            removeBtn.addEventListener('click', () => {
                selectedLabelNames.delete(labelName);
                delete classificationData[labelName];
                updateUI();
                saveState();
            });
            
            selectedLabels.appendChild(item);
        });
    };
    
    const updateClassificationResults = () => {
        classificationResults.innerHTML = '';
        
        if (selectedLabelNames.size === 0) {
            classificationResults.innerHTML = '<div style="color: #888;">No labels selected</div>';
            return;
        }
        
        // Sort by confidence (highest first)
        const sortedLabels = Array.from(selectedLabelNames)
            .map(name => ({ name, confidence: classificationData[name] || 0.5 }))
            .sort((a, b) => b.confidence - a.confidence);
        
        sortedLabels.forEach(({ name, confidence }) => {
            const color = colorForLabel(name);
            const item = document.createElement('div');
            item.className = 'result-item';
            item.innerHTML = `
                <div class="color-dot" style="background-color: ${color}"></div>
                <div class="label-name">${name}</div>
                <div class="result-confidence">${(confidence * 100).toFixed(1)}%</div>
            `;
            classificationResults.appendChild(item);
        });
    };
    
    const updateUI = () => {
        updateLabelsListUI();
        updateSelectedLabelsUI();
        updateClassificationResults();
    };
    
    const toggleLabel = (labelName) => {
        if (selectedLabelNames.has(labelName)) {
            selectedLabelNames.delete(labelName);
            delete classificationData[labelName];
        } else {
            selectedLabelNames.add(labelName);
            classificationData[labelName] = 0.5; // Default confidence
        }
        updateUI();
        saveState();
    };
    
    const saveClassification = () => {
        const classification = {
            labels: Array.from(selectedLabelNames).map(name => ({
                name: name,
                confidence: classificationData[name] || 0.5
            })),
            timestamp: new Date().toISOString()
        };
        
        vscode.postMessage({
            type: 'saveClassification',
            classification: classification
        });
    };
    
    // Event listeners
    clearBtn.addEventListener('click', () => {
        selectedLabelNames.clear();
        classificationData = {};
        updateUI();
        saveState();
    });
    
    addClassBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'requestAddLabel' });
    });
    
    renameBtn.addEventListener('click', () => {
        if (selectedLabelNames.size === 0) {
            vscode.postMessage({ type: 'showError', message: 'Please select a label to rename' });
            return;
        }
        
        const labelName = Array.from(selectedLabelNames)[0];
        vscode.postMessage({
            type: 'requestRenameLabel',
            current: labelName
        });
    });
    
    delClassBtn.addEventListener('click', () => {
        if (selectedLabelNames.size === 0) {
            vscode.postMessage({ type: 'showError', message: 'Please select a label to delete' });
            return;
        }
        
        const labelName = Array.from(selectedLabelNames)[0];
        vscode.postMessage({
            type: 'requestDeleteLabel',
            name: labelName
        });
    });
    
    saveBtn.addEventListener('click', saveClassification);
    
    // Handle messages from extension
    window.addEventListener('message', event => {
        const message = event.data;
        
        switch (message.type) {
            case 'labelAdded':
                const newLabel = message.label;
                labelArray.push(newLabel);
                labelMap[newLabel.name] = newLabel.color;
                updateLabelsListUI();
                break;
                
            case 'labelRenamed':
                const oldName = message.oldName;
                const newName = message.newName;
                
                // Update label array
                const label = labelArray.find(l => l.name === oldName);
                if (label) {
                    label.name = newName;
                }
                
                // Update label map
                labelMap[newName] = labelMap[oldName];
                delete labelMap[oldName];
                
                // Update selected labels
                if (selectedLabelNames.has(oldName)) {
                    selectedLabelNames.delete(oldName);
                    selectedLabelNames.add(newName);
                }
                
                // Update classification data
                if (classificationData[oldName] !== undefined) {
                    classificationData[newName] = classificationData[oldName];
                    delete classificationData[oldName];
                }
                
                updateUI();
                saveState();
                break;
                
            case 'labelDeleted':
                const deletedName = message.name;
                
                // Remove from arrays
                labelArray = labelArray.filter(l => l.name !== deletedName);
                delete labelMap[deletedName];
                
                // Remove from selected
                selectedLabelNames.delete(deletedName);
                delete classificationData[deletedName];
                
                updateUI();
                saveState();
                break;
        }
    });
    
    // Initialize
    updateUI();
    
    // Load existing classification if available
    if (window.initialClassification) {
        const initial = window.initialClassification;
        if (initial.labels) {
            initial.labels.forEach(({ name, confidence }) => {
                if (labelMap[name]) {
                    selectedLabelNames.add(name);
                    classificationData[name] = confidence;
                }
            });
            updateUI();
        }
    }
    
    // Restore state after initialization
    setTimeout(restoreState, 100);
    
    // Auto-save every 10 seconds
    setInterval(() => {
        if (selectedLabelNames.size > 0) {
            saveState();
        }
    }, 10000);
})(); 