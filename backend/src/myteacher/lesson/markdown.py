from markdown_it import MarkdownIt

_parser = MarkdownIt("commonmark")


def contains_raw_html(text: str) -> bool:
    """True when the Markdown carries HTML that a renderer would pass through."""
    for token in _parser.parse(text):
        if token.type == "html_block":
            return True
        if any(child.type == "html_inline" for child in token.children or ()):
            return True
    return False
