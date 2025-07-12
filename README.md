# AnnoVis

AnnoVis is a lightweight image-annotation extension for VS Code / Cursor. It lets you draw bounding-box annotations on common image formats (PNG, JPG, GIF, BMP, TIFF) directly inside the editor and saves them as JSON alongside your project.

## Features

* Draw, move and resize bounding boxes on images.
* Assign custom labels with unique colors.
* Maintain multiple annotation projects per workspace.
* Saves annotations as plain JSON for easy post-processing.

## Usage

1. Right-click an image file and choose **Annotate Image with AnnoVis** (or run the command from the Command Palette).
2. Use the toolbar to toggle between **Draw** and **Select** mode, pick labels, add / rename / delete labels, and save annotations.
3. Annotations are stored under `/.annovis/annotations/` in your workspace.

## Requirements

No external dependencies — works anywhere VS Code or Cursor runs (Windows, macOS, Linux).

## Release Notes

### 0.0.1

• Initial preview release.
