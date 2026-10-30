import gc
import weakref
import pytest
from traitlets import TraitError
from ..widget import HTMLElement


def test_callbacks_are_released_on_close():
    class Owner:
        def event(self, message): pass
    owner=Owner(); ref=weakref.ref(owner); widget=HTMLElement()
    widget.bind_callback(owner.event); del owner; gc.collect()
    assert ref() is not None
    widget.close(); gc.collect()
    assert ref() is None
    assert not widget._callbacks.callbacks
    assert not widget._buffer_callbacks.callbacks
    assert widget._handle not in widget._msg_callbacks.callbacks
    widget.close()


def test_ordinary_events_and_binary_callbacks_need_no_tokens():
    widget=HTMLElement(); messages=[]; binary=[]
    widget.bind_callback(messages.append)
    widget.bind_callback(lambda message,buffers: binary.append((message,buffers)),with_buffers=True)
    data={'type':'click'}; buffers=[memoryview(b'123')]
    widget._handle(widget,data,buffers)
    assert messages==[data] and binary==[(data,buffers)]
    widget.close(); widget._handle(widget,data,buffers)
    assert len(messages)==1


def test_unregister_and_reset_callbacks():
    widget=HTMLElement(); events=[]
    widget.bind_callback(events.append)
    widget.bind_callback(events.append,remove=True)
    widget._handle(widget,{'type':'click'},[])
    assert not events
    widget.bind_callback(events.append); widget.reset_callbacks()
    assert not widget._callbacks.callbacks
    widget.close()


def test_closing_a_parent_does_not_close_shared_children():
    child=HTMLElement(); parent=HTMLElement(children=(child,))
    parent.close()
    assert child.comm is not None and not child._active_html_closed
    child.close()


def test_closed_widget_rejects_commands_and_new_callbacks():
    widget=HTMLElement(); widget.close()
    for operation in (lambda:widget.call('method'),lambda:widget.trigger('event'),lambda:widget.bind_callback(lambda data:None)):
        with pytest.raises(RuntimeError,match='closed'): operation()


def test_command_wire_format_and_buffers_remain_compatible():
    widget=HTMLElement(); sent=[]
    widget._send=lambda message,buffers=None: sent.append((message,buffers))
    content={'number':3}; buffers=[memoryview(b'123')]
    widget.call('method',content,buffers=buffers)
    widget.trigger('event',content)
    assert sent==[({'method':'call','content':{'number':3,'handle':'method'}},buffers),({'method':'trigger','content':{'number':3,'handle':'event'}},None)]
    assert content=={'number':3}
    widget.close()


def test_compact_defaults_and_legacy_opt_in():
    widget=HTMLElement()
    assert widget.eventTargetMode=='compact'
    assert widget.eventThrottleMs==0
    assert 'innerHTML' not in widget.eventTargetFields
    assert 'altKey' in widget.defaultEventProperties
    assert 'timeStamp' in widget.defaultEventProperties
    widget.eventTargetMode='legacy'
    with pytest.raises(TraitError): widget.eventThrottleMs=-1
    widget.close()


def test_unsynced_aliases_are_both_serializable():
    widget=HTMLElement(unsyncedProps=['color'],unsyncedProperties=['title'])
    state=widget.get_state()
    assert state['unsyncedProps']==['color'] and state['unsyncedProperties']==['title']
    widget.close()


@pytest.mark.parametrize('kind', ['labextension', 'nbextension'])
def test_extension_upgrade_is_staged_and_overwrite_is_explicit(tmp_path, monkeypatch, kind):
    package=tmp_path/'package'; source=package/kind; source.mkdir(parents=True)
    (source/'asset.js').write_text('new')
    monkeypatch.setattr(HTMLElement,'_here',str(package/'widget.py'))
    prefix=tmp_path/'prefix'
    target=prefix/'share/jupyter'/(kind+'s')/'ActiveHTMLWidget'
    target.mkdir(parents=True); (target/'asset.js').write_text('old')
    assert not HTMLElement._install_extension(kind,prefix,False)
    assert (target/'asset.js').read_text()=='old'
    assert HTMLElement._install_extension(kind,prefix,True)
    assert (target/'asset.js').read_text()=='new'
    assert not list(target.parent.glob('.activehtml-*'))


def test_extension_upgrade_restores_original_after_rename_failure(tmp_path, monkeypatch):
    from pathlib import Path
    package=tmp_path/'package'; source=package/'labextension'; source.mkdir(parents=True)
    (source/'asset.js').write_text('new')
    monkeypatch.setattr(HTMLElement,'_here',str(package/'widget.py'))
    prefix=tmp_path/'prefix'; target=prefix/'share/jupyter/labextensions/ActiveHTMLWidget'
    target.mkdir(parents=True);(target/'asset.js').write_text('old')
    original=Path.replace
    def fail(path,destination):
        if path.name=='replacement': raise OSError('simulated rename failure')
        return original(path,destination)
    monkeypatch.setattr(Path,'replace',fail)
    with pytest.raises(OSError,match='simulated'):
        HTMLElement._install_extension('labextension',prefix,True)
    assert (target/'asset.js').read_text()=='old'
    assert not list(target.parent.glob('.activehtml-*'))



def test_extension_backup_survives_a_failed_rollback(tmp_path, monkeypatch):
    from pathlib import Path
    package=tmp_path/'package';source=package/'labextension';source.mkdir(parents=True)
    (source/'asset.js').write_text('new')
    monkeypatch.setattr(HTMLElement,'_here',str(package/'widget.py'))
    prefix=tmp_path/'prefix';target=prefix/'share/jupyter/labextensions/ActiveHTMLWidget'
    target.mkdir(parents=True);(target/'asset.js').write_text('old')
    original=Path.replace
    def fail(path,destination):
        if path.name in ('replacement','original'): raise OSError('simulated failure')
        return original(path,destination)
    monkeypatch.setattr(Path,'replace',fail)
    with pytest.raises(RuntimeError,match='retained for recovery'):
        HTMLElement._install_extension('labextension',prefix,True)
    backups=list(target.parent.glob('.activehtml-*/original/asset.js'))
    assert len(backups)==1 and backups[0].read_text()=='old'
