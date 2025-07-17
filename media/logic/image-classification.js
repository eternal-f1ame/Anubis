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
    const classificationChoices = document.getElementById('classificationChoices');
    const selectedLabelsList = document.getElementById('selectedLabelsList');
    const classificationImage = document.getElementById('classificationImage');
    
    // State
    const imageUrl = window.imageUrl;
    let labelArray = window.labels;
    let labelMap = Object.fromEntries(labelArray.map(l => [l.name, l.color]));
    let selectedLabels = new Set();
    
    // Load initial classification if exists
    if (window.initialClassification && window.initialClassification.labels) {
        selectedLabels = new Set(window.initialClassification.labels.map(l => l.name));
    }
    
    // Initialize image
    classificationImage.src = imageUrl;
    
    const colorForLabel = name => labelMap[name] || '#ff0000';
    
    const saveState = () => {
        const state = {
            selectedLabels: Array.from(selectedLabels)
        };
        vscode.setState(state);
    };
    
    const restoreState = () => {
        if (previousState && previousState.selectedLabels) {
            selectedLabels = new Set(previousState.selectedLabels);
            updateUI();
        }
    };
    
    const updateClassificationChoices = () => {
        classificationChoices.innerHTML = '';
        
        labelArray.forEach(label => {
            const choiceItem = document.createElement('div');
            choiceItem.className = 'choice-item';
    
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `choice-${label.name}`;
            checkbox.checked = selectedLabels.has(label.name);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    selectedLabels.add(label.name);
                } else {
                    selectedLabels.delete(label.name);
                }
                updateSelectedLabels();
                saveState();
            });
            
            const colorDot = document.createElement('div');
            colorDot.className = 'color-dot';
            colorDot.style.backgroundColor = label.color;
            
            const labelText = document.createElement('label');
            labelText.setAttribute('for', `choice-${label.name}`);
            labelText.textContent = label.name;
            labelText.className = 'choice-label';
            
            choiceItem.appendChild(checkbox);
            choiceItem.appendChild(colorDot);
            choiceItem.appendChild(labelText);
            
            classificationChoices.appendChild(choiceItem);
        });
    };
    
    const updateSelectedLabels = () => {
        selectedLabelsList.innerHTML = '';
        
        if (selectedLabels.size === 0) {
            selectedLabelsList.innerHTML = '<div class="no-selection">No labels selected</div>';
            return;
        }
        
        Array.from(selectedLabels).forEach(labelName => {
            const color = colorForLabel(labelName);
            const item = document.createElement('div');
            item.className = 'selected-label-item';
            item.innerHTML = `
                <div class="color-dot" style="background-color: ${color}"></div>
                <span class="label-name">${labelName}</span>
            `;
            selectedLabelsList.appendChild(item);
        });
        
        // Auto-save when selections change
        saveClassification();
    };
    
    const updateUI = () => {
        updateClassificationChoices();
        updateSelectedLabels();
    };
    
    const clearAllSelections = () => {
        selectedLabels.clear();
        updateUI();
        saveState();
    };
    
    const saveClassification = () => {
        const labels = Array.from(selectedLabels).map(name => ({ name }));
        const classification = {
            labels: labels,
            timestamp: new Date().toISOString()
        };
        vscode.postMessage({ type: 'saveClassification', classification });
    };
    
    const handleAddLabel = () => {
        vscode.postMessage({ type: 'requestAddLabel' });
    };
    
    const handleRenameLabel = () => {
        // Use the first selected label for renaming, or prompt for which one
        const selectedArray = Array.from(selectedLabels);
        if (selectedArray.length > 0) {
            vscode.postMessage({ type: 'requestRenameLabel', current: selectedArray[0] });
        } else {
            vscode.postMessage({ type: 'requestRenameLabel', current: null });
        }
    };
    
    const handleDeleteLabel = () => {
        const selectedArray = Array.from(selectedLabels);
        if (selectedArray.length > 0) {
            vscode.postMessage({ type: 'requestDeleteLabel', name: selectedArray[0] });
        } else {
            vscode.postMessage({ type: 'requestDeleteLabel', name: null });
        }
    };
    
    // Event listeners
    clearBtn.addEventListener('click', clearAllSelections);
    saveBtn.addEventListener('click', saveClassification);
    addClassBtn.addEventListener('click', handleAddLabel);
    renameBtn.addEventListener('click', handleRenameLabel);
    delClassBtn.addEventListener('click', handleDeleteLabel);
    
    // Handle messages from VS Code
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'labelAdded':
                // If this is the first real label, remove the default 'Object' label
                if (message.label.removedDefault) {
                    labelArray = labelArray.filter(l => l.name !== 'Object');
                    delete labelMap['Object'];
                    selectedLabels.delete('Object');
                }
                labelArray.push(message.label);
                labelMap[message.label.name] = message.label.color;
                updateUI();
                break;
            case 'labelRenamed':
                const oldName = message.oldName;
                const newName = message.newName;
                const labelIndex = labelArray.findIndex(l => l.name === oldName);
                if (labelIndex !== -1) {
                    labelArray[labelIndex].name = newName;
                labelMap[newName] = labelMap[oldName];
                delete labelMap[oldName];
                    // Update selected labels if necessary
                    if (selectedLabels.has(oldName)) {
                        selectedLabels.delete(oldName);
                        selectedLabels.add(newName);
                }
                updateUI();
                }
                break;
            case 'labelDeleted':
                const deletedName = message.name;
                labelArray = labelArray.filter(l => l.name !== deletedName);
                delete labelMap[deletedName];
                selectedLabels.delete(deletedName);
                updateUI();
                break;
            case 'classificationSaved':
                console.log('Classification saved successfully');
                break;
        }
    });
    
    // Initialize UI
    updateUI();
    restoreState();
})(); 