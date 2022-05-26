

class JSCleaner:
    def __init__(self, file):
        self.file = file
    def clean(self):
        with open(self.file) as f:
            content = f.read()
        content = content.replace('@jupyter-widgets/base', 'jupyter-js-widgets')
        with open(self.file, 'w') as dump:
            dump.write(content)

if __name__ == "__main__":
    try:
        JSCleaner('ActiveHTMLWidget/nbextension/index.js').clean()
        JSCleaner('ActiveHTMLWidget/nbextension/extension.js').clean()
    except:
        import traceback, sys
        traceback.print_exc()
        sys.exit(1)