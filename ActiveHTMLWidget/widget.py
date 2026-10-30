
from ipywidgets import Widget, DOMWidget, register, widget_serialization, CallbackDispatcher
from traitlets import Unicode, Bool, Instance, Dict, List, Enum, Int
from ipywidgets.widgets.trait_types import TypedTuple
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
    unsyncedProps = List().tag(sync=True)  # legacy alias
    unsyncedProperties = List().tag(sync=True)
    elementAttributes = Dict().tag(sync=True, **widget_serialization)
    innerHTML = Unicode('').tag(sync=True)
    textContent = Unicode('').tag(sync=True)
    children = TypedTuple(trait=Instance(Widget)).tag(sync=True, **widget_serialization)
    id = Unicode('').tag(sync=True)
    value = Unicode('').tag(sync=True)
    exportData = Dict().tag(sync=True, **widget_serialization)
    trackInput = Bool(False).tag(sync=True)
    continuousUpdate = Bool(True).tag(sync=True)
    eventPropertiesDict = Dict().tag(sync=True)
    jsHandlers = Dict().tag(sync=True)
    jsAPI = Instance(Widget, allow_none=True).tag(sync=True, **widget_serialization)
    onevents = Dict().tag(sync=True)
    eventTargetMode = Enum(['compact', 'legacy'], default_value='compact').tag(sync=True)
    eventTargetFields = List(Unicode(), default_value=['id', 'name', 'type', 'value', 'checked']).tag(sync=True)
    eventThrottleMs = Int(0, min=0).tag(sync=True)
    coalescedEvents = List(Unicode(), default_value=['pointermove', 'mousemove', 'input', 'wheel']).tag(sync=True)
    defaultEventProperties = List(default_value=[
        "bubbles", "cancelable", "composed",
        "target", "timeStamp", "type",
        "key", "repeat",
        "button", "buttons",
        "altKey", "shiftKey", "ctrlKey", "metaKey"
    ]).tag(sync=True)
    _debugPrint = Bool(False).tag(sync=True)

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._active_html_closed = False
        self._callbacks = CallbackDispatcher()
        self._buffer_callbacks = CallbackDispatcher()
        self.on_msg(self._handle)

    def _handle(self, _, msg, buffers):
        if not self._active_html_closed and isinstance(msg, dict):
            self._callbacks(msg)
            self._buffer_callbacks(msg, buffers)

    def bind_callback(self, callback, remove=False, *, with_buffers=False):
        """Register an event callback; opt into ``callback(message, buffers)``."""
        if self._active_html_closed and not remove:
            raise RuntimeError('Widget is closed')
        dispatcher = self._buffer_callbacks if with_buffers else self._callbacks
        dispatcher.register_callback(callback, remove=remove)

    def reset_callbacks(self):
        self._callbacks.callbacks.clear()
        self._buffer_callbacks.callbacks.clear()

    def close(self):
        if getattr(self, '_active_html_closed', False):
            return
        self._active_html_closed = True
        if hasattr(self, '_callbacks'):
            self.reset_callbacks()
            self.on_msg(self._handle, remove=True)
        super().close()

    def _require_open(self):
        if self._active_html_closed or self.comm is None:
            raise RuntimeError('Widget is closed')

    def __repr__(self):
        body = self.children if len(self.children) > 0 else self.innerHTML if len(self.innerHTML) > 0 else self.textContent
        return "{}({}, {!r}, cls={}, style={})".format(
            type(self).__name__,
            'div' if self.tagName == "" else self.tagName,
            body,
            self.classList,
            self.styleDict
        )

    _here = __file__
    @classmethod
    def _install_extension(cls, kind, exec_prefix=None, overwrite=False):
        """Stage the replacement before moving an existing extension out of place."""
        import sys
        import shutil
        import tempfile
        from pathlib import Path
        if kind not in ('labextension', 'nbextension'):
            raise ValueError('Unknown extension kind')
        source = Path(cls._here).resolve().parent / kind
        prefix = Path(sys.exec_prefix if exec_prefix is None else exec_prefix)
        target = prefix / 'share/jupyter' / (kind + 's') / 'ActiveHTMLWidget'
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and not overwrite:
            return False
        temporary = Path(tempfile.mkdtemp(prefix='.activehtml-', dir=target.parent))
        replacement = temporary / 'replacement'
        backup = temporary / 'original'
        retain_backup = False
        try:
            shutil.copytree(source, replacement)
            if target.exists() and not overwrite:
                return False
            try:
                if target.exists():
                    target.replace(backup)
                replacement.replace(target)
            except BaseException:
                if backup.exists():
                    try:
                        backup.replace(target)
                    except BaseException as restore_error:
                        retain_backup = True
                        raise RuntimeError('Original extension retained for recovery at ' + str(backup)) from restore_error
                raise
        finally:
            if not retain_backup:
                shutil.rmtree(temporary, ignore_errors=True)
        return True

    @classmethod
    def jupyterlab_install(cls, exec_prefix=None, overwrite=False):
        from IPython.display import HTML
        if cls._install_extension('labextension', exec_prefix, overwrite):
            return HTML('<h4>Extension installed. Reload the page to load the widget.</h4>')

    @classmethod
    def jupyternb_install(cls, exec_prefix=None, overwrite=False):
        from IPython.display import HTML
        if cls._install_extension('nbextension', exec_prefix, overwrite):
            return HTML('<h4>Extension installed. Reload the page to load the widget.</h4>')

    def trigger(self, event, content=None, buffers=None):
        self._require_open()
        if content is None:
            content = {}
        content = content.copy()
        content['handle'] = event
        return self._send({"method": "trigger", "content": content}, buffers=buffers)
    def call(self, method, content=None, buffers=None):
        self._require_open()
        if content is None:
            content = {}
        content = content.copy()
        content['handle'] = method
        return self._send({"method": "call", "content": content}, buffers=buffers)