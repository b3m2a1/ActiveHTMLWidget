
from ipywidgets import Widget, DOMWidget, register, widget_serialization, CallbackDispatcher
from traitlets import Unicode, Bool, Instance, Dict, List
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
    defaultEventProperties = List(default_value=[
        "bubbles", "cancelable", "composed",
        "target", "timestamp", "type",
        "key", "repeat",
        "button", "buttons",
        "alKey", "shiftKey", "ctrlKey", "metaKey"
    ]).tag(sync=True)
    _debugPrint = Bool(False).tag(sync=True)

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
    def jupyterlab_install(self, overwrite=False):
        """
        Attempts to do a basic installation for JupterLab
        :return:
        :rtype:
        """
        import sys, shutil, os, tempfile as tf

        prefix = sys.exec_prefix
        pkg_root = os.path.dirname(os.path.abspath(self._here))
        pkg_name = os.path.basename(pkg_root)
        src = os.path.join(pkg_root, 'labextension')
        target = os.path.join(prefix, "share", "jupyter", "labextensions", pkg_name)
        copied = False
        if overwrite or not os.path.isdir(target):
            copied = True
            if os.path.exists(target):
                with tf.TemporaryDirectory() as new_loc:
                    try:
                        os.remove(new_loc)
                    except:
                        pass
                os.rename(target, new_loc)
            else:
                new_loc = None
            try:
                shutil.copytree(src, target)
            except:
                if new_loc is not None:
                   os.rename(new_loc, target)

        from IPython.core.display import HTML
        if copied:
            return HTML("<h4>Extension installed to {}. You will need to reload the page to get the widgets to display.</h1>".format(target))
    @classmethod
    def jupyternb_install(self, overwrite=False):
        """
        Attempts to do a basic installation for JupterLab
        :return:
        :rtype:
        """
        import sys, shutil, os, tempfile as tf

        prefix = sys.exec_prefix
        pkg_root = os.path.dirname(os.path.abspath(self._here))
        pkg_name = os.path.basename(pkg_root)
        src = os.path.join(pkg_root, 'nbextension')
        target = os.path.join(prefix, "share", "jupyter", "nbextensions", pkg_name)
        copied = False
        if overwrite or not os.path.isdir(target):
            copied = True
            if os.path.exists(target):
                with tf.TemporaryDirectory() as new_loc:
                    try:
                        os.remove(new_loc)
                    except:
                        pass
                os.rename(target, new_loc)
            else:
                new_loc = None
            try:
                shutil.copytree(src, target)
            except:
                if new_loc is not None:
                   os.rename(new_loc, target)

        from IPython.core.display import HTML
        if copied:
            return HTML("<h4>Extension installed to {}. You will need to reload the page to get the widgets to display.</h1>".format(target))

    def trigger(self, event, content=None, buffers=None):
        if content is None:
            content = {}
        content = content.copy()
        content['handle'] = event
        return self._send({"method": "trigger", "content": content}, buffers=buffers)
    def call(self, method, content=None, buffers=None):
        if content is None:
            content = {}
        content = content.copy()
        content['handle'] = method
        return self._send({"method": "call", "content": content}, buffers=buffers)