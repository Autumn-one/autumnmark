export const isDrawingPath = (path: string) => /\.excalidraw$/i.test(path)

export const blankDrawing = JSON.stringify({
  type: 'excalidraw', version: 2, source: 'AutumnMark', elements: [], appState: {}, files: {}
})
