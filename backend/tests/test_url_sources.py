import pytest

from myteacher.courses.pages import readable_text
from tests.helpers import back_to_teacher, streamed
from tests.test_course_access import COLLEAGUE, as_teacher, grant, invite_teachers
from tests.test_courses import create_course
from tests.test_sources import job, source, sources_url

PAGE_URL = "https://spanish.example/preterito"
ARTICLE = """<!doctype html>
<html lang="es">
<head><title>El pretérito indefinido</title><style>p { color: red }</style></head>
<body>
  <nav><a href="/">Inicio</a> <a href="/blog">Blog</a></nav>
  <main>
    <h1>El pretérito indefinido</h1>
    <p>Se usa para acciones   terminadas:
       <b>hablé</b>, hablaste, habló.</p>
    <script>track("visit")</script>
    <ul><li>Ayer comí paella.</li><li>Fui a Madrid.</li></ul>
  </main>
  <footer>© Spanish Example</footer>
</body>
</html>"""


@pytest.fixture
def course(teacher) -> int:
    return create_course(teacher).json()["id"]


def add_url(client, course_id, url=PAGE_URL, **fields):
    return client.post(f"{sources_url(course_id)}/url", json={"url": url, **fields})


# Snapshot


def test_a_url_becomes_a_source_whose_readable_text_is_fetched_once(teacher, course, web, clock):
    web.page(PAGE_URL, ARTICLE)

    added = add_url(teacher, course)

    assert added.status_code == 202
    body = added.json()
    assert body["job"]["kind"] == "source_extraction"
    assert job(teacher, body["job"]["id"])["state"] == "succeeded"
    snapshot = source(teacher, course, body["source"]["id"])
    assert snapshot["kind"] == "url"
    assert snapshot["url"] == PAGE_URL
    assert snapshot["fetched_at"] == "2026-09-24T08:00:00Z"
    assert snapshot["extracted_with"] == "page"
    assert snapshot["media_type"] == "text/html"
    # Named after the page when the teacher gave no name.
    assert snapshot["name"] == "El pretérito indefinido"
    assert snapshot["text"] == (
        "El pretérito indefinido\n\n"
        "Se usa para acciones terminadas: hablé, hablaste, habló.\n\n"
        "Ayer comí paella.\n"
        "Fui a Madrid."
    )
    assert web.requests == [PAGE_URL]


def test_the_teachers_name_for_the_page_is_kept(teacher, course, web):
    web.page(PAGE_URL, ARTICLE)

    sid = add_url(teacher, course, name=" Pretérito (blog) ").json()["source"]["id"]

    assert source(teacher, course, sid)["name"] == "Pretérito (blog)"


def test_the_snapshot_does_not_change_and_the_page_is_not_fetched_again(teacher, course, web):
    web.page(PAGE_URL, ARTICLE)
    sid = add_url(teacher, course).json()["source"]["id"]
    web.page(PAGE_URL, "<p>Completely rewritten</p>")

    again = teacher.post(f"{sources_url(course)}/{sid}/extract", json={"ocr": False})

    assert again.status_code == 409
    assert again.json() == {"detail": "snapshot_taken"}
    assert "hablé" in source(teacher, course, sid)["text"]
    assert teacher.get(sources_url(course)).json()[0]["characters"] > 0
    assert web.requests == [PAGE_URL]


def test_a_plain_text_page_is_kept_as_it_is(teacher, course, web):
    url = "https://spanish.example/notes.txt"
    web.page(url, "Hablé\nHablaste\n", content_type="text/plain")

    sid = add_url(teacher, course, url=url).json()["source"]["id"]

    assert source(teacher, course, sid)["text"] == "Hablé\nHablaste"


def test_the_page_is_read_in_its_declared_encoding(teacher, course, web):
    body = '<html><head><meta charset="windows-1250"></head><body><p>Šťastný žák</p></body></html>'
    web.page(PAGE_URL, body.encode("windows-1250"), content_type="text/html")

    sid = add_url(teacher, course).json()["source"]["id"]

    assert source(teacher, course, sid)["text"] == "Šťastný žák"


def test_a_redirect_is_followed_and_the_url_asked_for_is_kept(teacher, course, web):
    web.page(PAGE_URL, "", status=301, headers={"location": "/es/preterito"})
    web.page("https://spanish.example/es/preterito", ARTICLE)

    sid = add_url(teacher, course).json()["source"]["id"]

    snapshot = source(teacher, course, sid)
    assert "hablé" in snapshot["text"]
    assert snapshot["url"] == PAGE_URL


def test_the_original_of_a_page_is_its_url_not_a_file(teacher, course, web):
    web.page(PAGE_URL, ARTICLE)
    sid = add_url(teacher, course).json()["source"]["id"]

    assert teacher.get(f"{sources_url(course)}/{sid}/file").status_code == 404


# Refused and failed fetches


@pytest.mark.parametrize("url", ["ftp://spanish.example/a", "spanish.example", "", "https://"])
def test_only_web_addresses_are_accepted(teacher, course, url):
    assert add_url(teacher, course, url=url).status_code == 422


def test_an_unreachable_page_fails_with_a_readable_reason(teacher, course, web):
    web.fail(PAGE_URL)

    added = add_url(teacher, course).json()

    assert job(teacher, added["job"]["id"])["error_kind"] == "unreachable"
    assert source(teacher, course, added["source"]["id"])["text"] is None


def test_a_missing_page_fails_with_a_readable_reason(teacher, course, web):
    added = add_url(teacher, course).json()

    assert job(teacher, added["job"]["id"])["error_kind"] == "page_error"


def test_a_page_that_is_not_text_fails_with_a_readable_reason(teacher, course, web):
    web.page(PAGE_URL, b"%PDF-1.4", content_type="application/pdf")

    added = add_url(teacher, course).json()

    assert job(teacher, added["job"]["id"])["error_kind"] == "not_a_page"


def test_a_page_with_no_readable_text_fails(teacher, course, web):
    web.page(PAGE_URL, "<html><body><script>app()</script></body></html>")

    added = add_url(teacher, course).json()

    assert job(teacher, added["job"]["id"])["error_kind"] == "no_text"


def test_a_huge_page_fails_as_too_large(teacher, course, web, monkeypatch):
    from myteacher.courses import pages

    monkeypatch.setattr(pages, "MAX_SIZE", 100)
    web.page(PAGE_URL, "<p>" + "a" * 200 + "</p>")

    added = add_url(teacher, course).json()

    assert job(teacher, added["job"]["id"])["error_kind"] == "too_large"


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/admin",
        "http://[::1]/",
        "http://169.254.169.254/latest/meta-data/",
        "http://intranet.skola.example/",
    ],
)
def test_addresses_inside_the_network_are_never_fetched(teacher, course, web, url):
    web.address("intranet.skola.example", "10.0.0.5")

    added = add_url(teacher, course, url=url).json()

    assert job(teacher, added["job"]["id"])["error_kind"] == "blocked_address"
    assert web.requests == []


def test_a_redirect_into_the_network_is_not_followed(teacher, course, web):
    web.page(PAGE_URL, "", status=302, headers={"location": "http://127.0.0.1:8000/api/admin"})

    added = add_url(teacher, course).json()

    assert job(teacher, added["job"]["id"])["error_kind"] == "blocked_address"
    assert web.requests == [PAGE_URL]


def test_a_failed_fetch_is_tried_again_and_then_kept(teacher, course, web):
    web.fail(PAGE_URL)
    sid = add_url(teacher, course).json()["source"]["id"]
    web.unreachable.clear()
    web.page(PAGE_URL, ARTICLE)

    again = teacher.post(f"{sources_url(course)}/{sid}/extract", json={"ocr": False})

    assert again.status_code == 202
    assert "hablé" in source(teacher, course, sid)["text"]


def test_ocr_is_not_offered_for_a_page(teacher, course, web):
    web.fail(PAGE_URL)
    sid = add_url(teacher, course).json()["source"]["id"]

    refused = teacher.post(f"{sources_url(course)}/{sid}/extract", json={"ocr": True})

    assert refused.status_code == 422


# Access


def test_a_viewer_reads_page_sources_but_cannot_add_them(teacher, sender, course, web):
    web.page(PAGE_URL, ARTICLE)
    sid = add_url(teacher, course).json()["source"]["id"]
    invite_teachers(teacher, sender, COLLEAGUE)
    grant(teacher, course, COLLEAGUE, "view")
    as_teacher(teacher, COLLEAGUE)

    assert source(teacher, course, sid)["url"] == PAGE_URL
    assert add_url(teacher, course).status_code == 403
    back_to_teacher(teacher)


# Reading the page


def test_readable_text_prefers_the_article_and_keeps_preformatted_text():
    html = (
        "<body><header>Site</header><article><h2>Tabla</h2>"
        "<pre>yo    hablé\ntú    hablaste</pre><p>a<br>b</p></article>"
        "<aside>Ads</aside></body>"
    )

    title, text = readable_text(html)

    assert title is None
    assert text == "Tabla\n\nyo    hablé\ntú    hablaste\n\na\nb"


def test_the_page_is_fetched_from_the_address_that_was_checked(teacher, course, web):
    # Resolving the name again when connecting could give another address (DNS rebinding).
    web.page(PAGE_URL, ARTICLE)

    add_url(teacher, course)

    assert web.connected == [(web.PUBLIC, PAGE_URL)]


def test_a_redirect_to_a_malformed_address_fails_as_unreachable(teacher, course, web):
    web.page(PAGE_URL, "", status=302, headers={"location": "http://spanish.example:99999/"})

    added = add_url(teacher, course).json()

    assert job(teacher, added["job"]["id"])["error_kind"] == "unreachable"


# Reading the page, and fetching it without the app


def fetch(transport, url=PAGE_URL):
    import asyncio

    import httpx

    from myteacher.courses.pages import PageFetcher

    async def resolve(host):
        return ["93.184.215.14"]

    fetcher = PageFetcher(transport=httpx.MockTransport(transport), resolve=resolve)
    return asyncio.run(fetcher.fetch(url))


def failure_of(transport, url=PAGE_URL) -> str:
    from myteacher.jobs.runner import JobFailed

    with pytest.raises(JobFailed) as failed:
        fetch(transport, url)
    return failed.value.kind


def test_a_page_that_trickles_in_is_given_up_after_a_deadline(monkeypatch):
    import anyio

    from myteacher.courses import pages

    monkeypatch.setattr(pages, "DEADLINE_S", 0.05)

    async def slow(request):
        await anyio.sleep(5)
        return streamed(200, {"content-type": "text/html"}, b"<p>x</p>")

    assert failure_of(slow) == "unreachable"


def test_a_compressed_page_is_read_within_the_limit(monkeypatch):
    import gzip

    from myteacher.courses import pages

    def serve(body: bytes):
        def handler(request):
            assert request.headers["accept-encoding"] == "identity"
            headers = {"content-type": "text/html", "content-encoding": "gzip"}
            return streamed(200, headers, gzip.compress(body))

        return handler

    assert fetch(serve(b"<p>Hola</p>")).text == "Hola"
    monkeypatch.setattr(pages, "MAX_SIZE", 1000)
    # Small on the wire, huge once unpacked.
    assert failure_of(serve(b"<p>" + b"a" * 1_000_000 + b"</p>")) == "too_large"


@pytest.mark.parametrize("url", ["http://[64:ff9b::7f00:1]/", "http://[::ffff:127.0.0.1]/"])
def test_addresses_that_embed_a_private_one_are_blocked(url):
    def never(request):
        raise AssertionError("fetched")

    assert failure_of(never, url) == "blocked_address"


def test_a_page_that_leaves_out_the_end_of_its_head_is_read():
    title, text = readable_text("<html><head><title>T</title><body><p>Hello world</p>")

    assert (title, text) == ("T", "Hello world")


def test_titles_inside_the_body_do_not_join_the_page_title():
    html = "<title>Page</title><body><svg><title>Menu icon</title></svg><p>Text</p></body>"

    assert readable_text(html) == ("Page", "Text")


def test_a_teaser_article_does_not_hide_the_rest_of_the_page():
    html = "<body><article><p>Teaser card</p></article><div><p>Real long content</p></div></body>"

    assert readable_text(html)[1] == "Teaser card\n\nReal long content"
