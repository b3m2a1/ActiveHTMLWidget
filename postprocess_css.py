
class StringStreamIterator:
    def __init__(self, string:str):
        self.string = string
        self.mark = 0
        self.pos = 0
    def find(self, tag, mark=False):
        pos = self.string.find(tag, self.pos, len(self.string))
        if pos > -1:
            if mark:
                self.mark = pos
                self.pos = pos + len(tag)
            return pos, self.string[self.mark:pos+len(tag)]
        else:
            raise ValueError('{} not found'.format(tag))


class JHTMLStripper:
    def __init__(self, string):
        self.stream = StringStreamIterator(string)
    replacements = [
        ('.jhtml .', '.jhtml.'),
        (".jhtml body", ".jhtml")
    ]
    def clean_block(self, block):
        b0 = block
        changed = False
        if block.startswith(".jhtml "):
            header, rest = block.split("{", 1)
            header_bits = list(header.split(","))
            for h in tuple(header_bits):
                h0 = h
                for start, end in self.replacements:
                    h = h.replace(start, end)
                if h0 != h:
                    changed = True
                    header_bits.append(h)
            if changed:
                block = ", ".join(header_bits) + "{" + rest
        if changed:
            return b0, block
        else:
            return None
    def next_block(self):
        try:
            _, b = self.stream.find(".jhtml ", mark=True)
            p, block = self.stream.find("}")
            self.stream.pos = p + 1
            while block.count("{") > block.count("}"):
                p, block = self.stream.find("}")
                self.stream.pos = p + 1
        except ValueError:
            raise StopIteration()
        return block
    def __iter__(self):
        return self
    def __next__(self):
        return self.next_block()
    def get_changes(self):
        blocks = []
        for block in self:
            new = self.clean_block(block)
            if new is not None:
                blocks.append(new)
        return blocks

class CSSCleaner:
    def __init__(self, file):
        self.file = file
    def clean(self):
        with open(self.file) as f:
            content = f.read()
        if '.jhtml.' in content:
            return
        else:
            chunks = JHTMLStripper(content).get_changes()
            for old, new in chunks:
                content = content.replace(old, new)
            with open(self.file, 'w') as dump:
                dump.write(content)

if __name__ == "__main__":
    try:
        CSSCleaner('css/bootstrap.css').clean()
    except:
        import traceback, sys
        traceback.print_exc()
        sys.exit(1)