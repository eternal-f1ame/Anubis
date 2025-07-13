# AnnoVis

AnnoVis is a lightweight image-annotation extension for VS Code / Cursor. It supports multiple annotation types including object detection (bounding boxes) and image classification directly inside the editor, saving annotations as JSON alongside your project.

## Features

### Object Detection
* Draw, move and resize bounding boxes on images.
* Assign custom labels with unique colors.
* Maintain multiple annotation projects per workspace.

### Image Classification
* Classify entire images with multiple labels.
* Assign confidence scores to each classification.
* Support for multi-label classification.
* Real-time classification results display.

### General Features
* Support for common image formats (PNG, JPG, GIF, BMP, TIFF).
* Saves annotations as plain JSON for easy post-processing.
* Multiple annotation projects per workspace.
* Shared label management across annotation types.
* Project-based workflow with type selection.

## Usage

### Creating Projects

1. Use **AnnoVis: Set Project** command from the Command Palette or right-click menu.
2. Select **+ New Project** to create a new project.
3. Choose the project type:
   - **Object Detection**: For drawing bounding boxes around objects
   - **Image Classification**: For classifying entire images with labels
4. Enter a project name.
5. The project is now ready for annotation.

### Annotating Images

1. **Quick Annotation**: Right-click an image file and choose **Annotate Image with AnnoVis**.
   - This uses your current active project if you have one
   - Only shows project selection if you don't have an active project
2. **Select Different Project**: Right-click an image file and choose **Annotate Image with AnnoVis (Select Project)**.
   - Always shows project selection to let you switch projects
3. The annotation interface will open based on your project type:
   - **Object Detection**: Canvas with drawing tools for bounding boxes
   - **Image Classification**: Label selection interface with confidence scoring

### Project Management

* Projects are automatically saved and remembered.
* Each project has its own set of labels and settings.
* **Switch between projects** using:
  - **AnnoVis: Set Project** command from Command Palette
  - **Annotate Image with AnnoVis (Select Project)** when annotating
* **Legacy Project Handling**: If you have old projects without type information, the extension will ask you to specify whether they are Object Detection or Image Classification projects.
* **Visualizing existing files**: Right-click any annotation/classification JSON file and select "Visualize Annotation with AnnoVis" - the correct project and interface will open automatically based on the file's metadata.

## Data Storage

* **Object Detection**: Annotations stored in `/.annovis/annotations/[project-name]/`
* **Image Classification**: Classifications stored in `/.annovis/classifications/[project-name]/`
* **Project Settings**: Project configuration in `/.annovis/projects/[project-name]/project.json`

## Data Format

### Object Detection
Annotations are saved as JSON files with metadata and bounding box coordinates (normalized 0-1):
```json
{
  "metadata": {
    "projectName": "My Detection Project",
    "projectType": "object-detection",
    "imageName": "image.jpg",
    "created": "2024-01-01T12:00:00.000Z",
    "version": "1.0"
  },
  "annotations": [
    {
      "label": "person",
      "x": 0.1,
      "y": 0.2,
      "width": 0.3,
      "height": 0.4
    }
  ]
}
```

### Image Classification
Classifications are saved as JSON files with metadata and labels with confidence scores:
```json
{
  "metadata": {
    "projectName": "My Classification Project",
    "projectType": "image-classification",
    "imageName": "image.jpg",
    "created": "2024-01-01T12:00:00.000Z",
    "version": "1.0"
  },
  "classification": {
    "labels": [
      {
        "name": "outdoor",
        "confidence": 0.9
      },
      {
        "name": "nature",
        "confidence": 0.7
      }
    ],
    "timestamp": "2024-01-01T12:00:00.000Z"
  }
}
```

### Project Configuration
Project settings are stored in `project.json`:
```json
{
  "name": "My Detection Project",
  "type": "object-detection",
  "labels": [
    {
      "name": "person",
      "color": "#e6194b"
    }
  ],
  "created": "2024-01-01T12:00:00.000Z"
}
```

## Requirements

No external dependencies — works anywhere VS Code or Cursor runs (Windows, macOS, Linux).

## Release Notes

### 0.0.1

• Initial preview release with Object Detection support.
• Added annotation type selection for Image Classification.
• Implemented full Image Classification functionality with confidence scoring.
• Improved workflow: project type selection during creation, direct annotation based on project type.
• **Fixed critical bug**: Project type corruption that was causing Image Classification projects to become Object Detection projects.
• **Enhanced project management**: Project files now always contain type information, with automatic handling of legacy projects.
• **Improved workflow**: Smart project selection that uses current project when available, with explicit option to switch projects.
