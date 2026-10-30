# ActiveHTMLWidget

A general DOM widget for Jupyter, built on ipywidgets' model/view and comm APIs.
It exposes elements, CSS, child widgets, browser handlers and Python callbacks.
It does not require ipywidgets Layout, Box, GridBox or a secondary UI framework.

This 0.2 development draft targets Python 3.9+, ipywidgets 8.1+ and JupyterLab 4.
Rebuild the JavaScript assets together with the Python package: the frontend module
version is now `^0.2.0`, so older 0.1 bundles cannot satisfy it.

```python
from IPython.display import display
from ActiveHTMLWidget import HTMLElement

button = HTMLElement(
    tagName='button', textContent='Run',
    eventPropertiesDict={'click': ['type', 'target']}
)
button.bind_callback(lambda event: print(event['type'], event['target']))
display(button)
```

Use normal CSS for layout:

```python
panel = HTMLElement(
    styleDict={'display': 'grid', 'grid-template-columns': '2fr 1fr', 'gap': '1rem'},
    children=(left_widget, right_widget)
)
```

`jsHandlers` defines browser methods. A ready handler executes in the DOM event
stack, so it can cancel the event before the browser's default action. Set
`notify=True` when both the JavaScript method and Python notification are wanted:

```python
button.jsHandlers = {'cancel': 'event.preventDefault();'}
button.eventPropertiesDict = {
    'click': {'method': 'cancel', 'notify': True, 'fields': ['type', 'target']}
}
button.call('cancel', {})  # Invoke an already registered browser method.
```

Arbitrary handler source and module imports remain executable code. The token-based
execution policy is a separate design proposal; this release does not implement a
JavaScript sandbox or claim to enforce that policy.

## Events and state

- `eventTargetMode='compact'` is the default. The target snapshot contains its tag
  and selected scalar properties, including current input value/checked state.
- `eventTargetMode='legacy'` retains the previous full-attribute/innerHTML snapshot.
  Existing callbacks depending on that data must opt in or select specific
  `eventTargetFields`, such as `['id', 'value', 'data-role']`.
- `eventThrottleMs` defaults to zero. A positive value coalesces custom event
  notifications in `coalescedEvents`; final/discrete events flush pending data.
  This does not delay local JavaScript handlers or automatically throttle trait
  synchronization. `continuousUpdate=False` retains commit-only input updates.
- Explicit JSON fields such as `CustomEvent.detail` are supported. Cyclic objects
  and DOM objects are not generic JSON event data. For binary custom messages,
  use comm buffers and `bind_callback(callback, with_buffers=True)` on Python.
- `timeStamp` and `altKey` are the corrected default fields. Explicitly requested
  older `timestamp` and `alKey` spellings remain aliases.
- Both `unsyncedProperties` and the old `unsyncedProps` name are recognized.

Python callbacks take one message argument by default. Buffer-aware callbacks
receive `(message, buffers)`. Registration/removal remains through `bind_callback`.
Calling `close()` releases callbacks and closes the comm; commands on a closed
widget raise. Closing a parent does not close shared child Python widgets.

Views clean up their own event listeners and owned child/attribute views on
removal. Removal hooks may return a Promise; model closure waits for them before
discarding registered handlers. Externally supplied attribute views remain owned
by their caller.

## Development

Use a supported Node environment and the project Python environment. Regenerate
`package-lock.json` with `npm install`, then run `npm test` and `npm run build:lib`.
`npm run build` also builds the classic-notebook and JupyterLab assets. Install the
Python package and refreshed frontend assets together, then restart the kernel
and reload the notebook. A live notebook pass is required in addition to unit tests.
