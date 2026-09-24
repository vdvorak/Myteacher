"""Fetching a web page a teacher named as a source, once, and reading its text.

The server fetches on the teacher's behalf, so it refuses addresses inside the network (loopback,
private, link-local and other non-public ranges) before every request, redirects included: a
source URL must never reach the app itself, the school's network or a cloud metadata service.
The request goes to the very address that was checked, so a name that resolves differently the
second time (DNS rebinding) cannot slip through. Failures raise `JobFailed` with a kind the
teacher can act on.
"""

import ipaddress
import re
import zlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import anyio
import httpx

from myteacher.jobs.runner import JobFailed

# A long article fits; a whole site dump does not. Counted after decompression.
MAX_SIZE = 5 * 1024 * 1024
MAX_REDIRECTS = 5
# Per connect and read, and for the whole fetch, so a page that trickles in cannot hold a job.
TIMEOUT_S = 20
DEADLINE_S = 60
# What can be read as a page; anything else (a PDF, an image) is uploaded as a file instead.
PAGE_TYPES = ("text/html", "application/xhtml+xml", "text/plain", "text/markdown")
_HTML_TYPES = PAGE_TYPES[:2]

Resolve = Callable[[str], Awaitable[list[str]]]


@dataclass(frozen=True)
class Page:
    media_type: str
    size: int
    title: str | None
    text: str


async def _resolve(host: str) -> list[str]:
    try:
        infos = await anyio.getaddrinfo(host, None)
    except OSError:
        raise JobFailed("unreachable") from None
    return [str(info[4][0]) for info in infos]


def is_web_address(url: str) -> bool:
    try:
        parts = urlsplit(url)
        # Reading the port refuses one out of range.
        return parts.scheme in ("http", "https") and bool(parts.hostname) and parts.port != 0
    except ValueError:
        return False


_NAT64 = ipaddress.ip_network("64:ff9b::/96")
_IPV4_COMPATIBLE = ipaddress.ip_network("::/96")


def is_public(address: str) -> bool:
    """Whether the address is on the public internet, also when an IPv6 address carries an
    IPv4 one (mapped, NAT64 or compatible) that is not."""
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
        elif ip in _NAT64 or ip in _IPV4_COMPATIBLE:
            ip = ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
    return ip.is_global


class PageFetcher:
    """Fetches pages over `transport` (the real network by default), resolving hosts with
    `resolve`; tests replace both."""

    def __init__(
        self, transport: httpx.AsyncBaseTransport | None = None, resolve: Resolve = _resolve
    ):
        self._transport = transport
        self._resolve = resolve

    async def _vetted(self, url: str) -> str:
        """The public address to connect to for the URL; raises `JobFailed` otherwise."""
        if not is_web_address(url):
            raise JobFailed("unreachable")
        host = urlsplit(url).hostname or ""
        try:
            ipaddress.ip_address(host)
            addresses = [host]
        except ValueError:
            addresses = await self._resolve(host)
        # Every address the name resolves to must be public, or the name is not trusted at all.
        if not addresses or not all(is_public(a) for a in addresses):
            raise JobFailed("blocked_address")
        return addresses[0]

    async def fetch(self, url: str) -> Page:
        try:
            with anyio.fail_after(DEADLINE_S):
                return await self._fetch(url)
        except TimeoutError:
            raise JobFailed("unreachable") from None

    async def _fetch(self, url: str) -> Page:
        async with httpx.AsyncClient(
            transport=self._transport,
            follow_redirects=False,
            timeout=TIMEOUT_S,
            headers={
                "Accept": "text/html,text/plain;q=0.9,*/*;q=0.1",
                # Compressed pages could unpack past the limit before it is checked.
                "Accept-Encoding": "identity",
            },
        ) as client:
            for _ in range(MAX_REDIRECTS + 1):
                address = await self._vetted(url)
                try:
                    target = httpx.URL(url)
                    request = client.build_request(
                        "GET",
                        target.copy_with(host=address),
                        headers={"Host": target.netloc.decode("ascii")},
                        # The certificate is checked against the name, not the address.
                        extensions={"sni_hostname": target.host}
                        if target.scheme == "https"
                        else {},
                    )
                    response = await client.send(request, stream=True)
                    try:
                        if response.is_redirect and "location" in response.headers:
                            url = urljoin(url, response.headers["location"])
                            continue
                        return await _read(response)
                    finally:
                        await response.aclose()
                except (httpx.HTTPError, httpx.InvalidURL, ValueError):
                    raise JobFailed("unreachable") from None
        raise JobFailed("unreachable")


async def _body(response: httpx.Response) -> bytes:
    """The body, unpacked when the server compressed it anyway, never past the limit."""
    encoding = response.headers.get("content-encoding", "identity").strip().lower()
    if encoding not in ("identity", "", "gzip", "x-gzip", "deflate"):
        raise JobFailed("page_error")
    # Gzip or zlib, told apart by their header.
    unpacker = None if encoding in ("identity", "") else zlib.decompressobj(47)
    content = bytearray()
    try:
        async for chunk in response.aiter_raw():
            if unpacker is None:
                content += chunk
            else:
                content += unpacker.decompress(chunk, MAX_SIZE + 1 - len(content))
                if unpacker.unconsumed_tail:
                    raise JobFailed("too_large")
            if len(content) > MAX_SIZE:
                raise JobFailed("too_large")
    except zlib.error:
        raise JobFailed("page_error") from None
    return bytes(content)


async def _read(response: httpx.Response) -> Page:
    if response.status_code >= 400:
        raise JobFailed("page_error")
    media_type, _, parameters = response.headers.get("content-type", "").partition(";")
    media_type = media_type.strip().lower()
    if media_type not in PAGE_TYPES:
        raise JobFailed("not_a_page")
    content = await _body(response)
    decoded = _decode(content, parameters, html=media_type in _HTML_TYPES)
    if media_type in _HTML_TYPES:
        title, text = readable_text(decoded)
    else:
        title, text = None, decoded.strip()
    if not text:
        raise JobFailed("no_text")
    return Page(media_type=media_type, size=len(content), title=title, text=text)


_CHARSET = re.compile(r"""charset\s*=\s*["']?([\w.:-]+)""", re.IGNORECASE)


def _decode(content: bytes, parameters: str, *, html: bool) -> str:
    """In the charset the response declares, else the one an HTML page declares, else UTF-8."""
    declared = _CHARSET.search(parameters)
    if declared is None and html:
        declared = _CHARSET.search(content[:4096].decode("ascii", errors="ignore"))
    encoding = declared.group(1) if declared else "utf-8"
    try:
        return content.decode(encoding, errors="replace")
    except LookupError:
        return content.decode("utf-8", errors="replace")


# Never text a reader wants.
_SKIPPED = {
    "script", "style", "noscript", "template", "svg", "iframe", "canvas", "object",
    "nav", "footer", "aside", "form", "button", "select",
}  # fmt: skip
# Each starts a new line of text.
_BLOCKS = {
    "p", "div", "section", "article", "main", "header", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "dl", "dt", "dd", "table", "tr", "blockquote", "pre", "figure",
    "figcaption", "br", "hr", "address", "details", "summary",
}  # fmt: skip
# Breaks marked while reading; a run of them becomes one line break, or a blank line when any
# of them ends or starts a paragraph.
_LINE, _PARAGRAPH = "\x02", "\x03"
_BREAKS = re.compile(r"[ \t]*[\x02\x03][\x02\x03 \t]*")
# Each starts a new paragraph.
_PARAGRAPHS = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "table", "ul", "ol"}


class _Reader(HTMLParser):
    """Collects the page title, the text of the whole body and, apart, of its main content and
    of each top-level article."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title: str | None = None
        self.body: list[str] = []
        self.main: list[str] = []
        self.articles: list[list[str]] = []
        self._in_title = False
        # Once the body started, a <title> is an icon's or a drawing's, not the page's. The
        # <body> and </head> tags may both be left out, so the first content tag starts it too.
        self._in_body = False
        self._skip = 0
        self._pre = 0
        self._main_depth = 0
        self._article_depth = 0

    def _emit(self, text: str) -> None:
        self.body.append(text)
        if self._main_depth:
            self.main.append(text)
        if self._article_depth:
            self.articles[-1].append(text)

    def handle_starttag(self, tag, attrs):
        if tag == "title" and not self._in_body and not self._skip:
            self._in_title = True
            return
        if tag == "body" or tag in _BLOCKS:
            self._in_body = True
        if tag in _SKIPPED:
            self._skip += 1
        if self._skip:
            return
        if tag == "main":
            self._main_depth += 1
        if tag == "article":
            if not self._article_depth:
                self.articles.append([])
            self._article_depth += 1
        if tag == "pre":
            self._pre += 1
        if tag in _BLOCKS:
            self._emit(_PARAGRAPH if tag in _PARAGRAPHS else _LINE)

    def handle_startendtag(self, tag, attrs):
        if not self._skip and tag in ("br", "hr"):
            self._emit(_LINE)

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
            return
        if tag in _SKIPPED:
            self._skip = max(0, self._skip - 1)
            return
        if self._skip:
            return
        if tag == "pre":
            self._pre = max(0, self._pre - 1)
        if tag in _BLOCKS:
            self._emit(_PARAGRAPH if tag in _PARAGRAPHS else _LINE)
        if tag == "main":
            self._main_depth = max(0, self._main_depth - 1)
        if tag == "article":
            self._article_depth = max(0, self._article_depth - 1)

    def handle_data(self, data):
        if self._in_title:
            self.title = ((self.title or "") + data).strip() or None
            return
        if self._skip:
            return
        # Kept as it is inside <pre>, where spacing carries meaning; marked so it is not squeezed.
        if self._pre:
            self._emit(data.replace(" ", "\x01").replace("\n", "\x00"))
        else:
            self._emit(re.sub(r"\s+", " ", data))


def _tidy(parts: list[str]) -> str:
    text = _BREAKS.sub(lambda m: "\n\n" if _PARAGRAPH in m.group() else "\n", "".join(parts))
    lines = [re.sub(r" {2,}", " ", line).strip() for line in text.split("\n")]
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    return text.replace("\x00", "\n").replace("\x01", " ")


def readable_text(html: str) -> tuple[str | None, str]:
    """The page's title and the text a reader sees in its main content, else in its body.

    The main content is what <main> holds or, without one, the page's only article when it
    holds most of the text; a teaser card or a list of articles is not the main content.
    """
    reader = _Reader()
    reader.feed(html)
    reader.close()
    body = _tidy(reader.body)
    main = _tidy(reader.main)
    if not main and len(reader.articles) == 1:
        article = _tidy(reader.articles[0])
        if len(article) * 2 >= len(body):
            main = article
    return reader.title, main or body
