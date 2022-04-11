
from ipywidgets import DOMWidget, register, widget_serialization, CallbackDispatcher
from traitlets import Unicode, List, Dict, Bool
from ._frontend import module_name, module_version

@register
class HTMLElement(DOMWidget):
    """
    Represents an HTML element that can be interacted with
    and configured richly, in contrast to the limited interactions
    available in most core Jupyter widgets
    """
    _model_name = Unicode('ActiveHTMLModel').tag(sync=True)
    _model_module = Unicode(module_name).tag(sync=True)
    _model_module_version = Unicode(module_version).tag(sync=True)
    _view_name = Unicode('ActiveHTMLView').tag(sync=True)
    _view_module = Unicode(module_name).tag(sync=True)
    _view_module_version = Unicode(module_version).tag(sync=True)
    tagName = Unicode('div').tag(sync=True)
    classList = List().tag(sync=True)
    styleDict = Dict().tag(sync=True)
    elementAttributes = Dict().tag(sync=True)
    innerHTML = Unicode('').tag(sync=True)
    textContent = Unicode('').tag(sync=True)
    children = List().tag(sync=True, **widget_serialization)
    id = Unicode('').tag(sync=True)
    value = Unicode('').tag(sync=True)
    trackInput = Bool(False).tag(sync=True)
    eventPropertiesDict = Dict().tag(sync=True)
    defaultEventProperties = List(default_value=[
        "bubbles", "cancelable", "composed",
        "target", "timestamp", "type",
        "key", "repeat",
        "button", "buttons",
        "alKey", "shiftKey", "ctrlKey", "metaKey"
    ]).tag(sync=True)

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._callbacks = CallbackDispatcher()
        self.on_msg(self._handle)
    def _handle(self, _, msg, __):
        self._callbacks(msg)

    def bind_callback(self, callback, remove=False):
        """Register a callback to execute when a DOM event occurs.
        The callback will be called with one argument, an dict whose keys
        depend on the type of event.
        Parameters
        ----------
        remove: bool (optional)
            Set to true to remove the callback from the list of callbacks.
        """
        self._callbacks.register_callback(callback, remove=remove)
    def reset_callbacks(self):
        """Remove any previously defined callback."""
        self._callbacks.callbacks.clear()


