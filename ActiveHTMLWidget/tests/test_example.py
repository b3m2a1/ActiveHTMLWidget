from ..widget import HTMLElement


def test_element_creation_blank():
    widget=HTMLElement()
    assert widget.value=='' and widget.tagName=='div'
    widget.close()
