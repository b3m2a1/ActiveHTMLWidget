// Old JSDOM lacks DragEvent. This permits importing Lumino; the tests do not
// exercise drag-and-drop or claim browser compatibility from this shim.
if (typeof global.DragEvent === 'undefined') global.DragEvent=window.MouseEvent;
