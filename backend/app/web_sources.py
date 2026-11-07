from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from io import BytesIO
import ipaddress
import re
import socket
from urllib.parse import urljoin, urlsplit

import httpx
from pypdf import PdfReader


MAX_WEB_BYTES = 5 * 1024 * 1024


class WebSourceError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


@dataclass(frozen=True)
class WebResult:
    title: str
    url: str
    snippet: str


@dataclass(frozen=True)
class WebDocument:
    title: str
    url: str
    content: bytes

    def text(self) -> str:
        try:
            if self.content.startswith(b"%PDF"):
                return "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(self.content)).pages)
            return self.content.decode("utf-8", errors="replace")
        except Exception as error:
            raise WebSourceError(422, "公开资料正文无法读取，请换用其他来源") from error


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript", "svg"}:
            self.ignored_depth += 1
        elif tag in {"p", "div", "section", "article", "li", "h1", "h2", "h3", "h4", "br"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript", "svg"} and self.ignored_depth:
            self.ignored_depth -= 1
        elif tag in {"p", "div", "section", "article", "li", "h1", "h2", "h3", "h4"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.ignored_depth:
            self.parts.append(data)

    def text(self) -> str:
        lines = [re.sub(r"\s+", " ", line).strip() for line in "".join(self.parts).splitlines()]
        return "\n".join(line for line in lines if line)


def validate_public_url(value: str) -> str:
    try:
        parsed = urlsplit(value.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
        for address in addresses:
            ip = ipaddress.ip_address(address[4][0])
            if not ip.is_global:
                raise WebSourceError(422, "网络资料只允许公开 HTTP(S) 地址，不能访问本机或内网")
    except WebSourceError:
        raise
    except (ValueError, OSError) as error:
        raise WebSourceError(422, "网络资料地址无效或无法解析") from error
    return value.strip()


class WebSourceService:
    def __init__(self, transport: httpx.BaseTransport | None = None):
        self.transport = transport

    def _client(self) -> httpx.Client:
        return httpx.Client(
            timeout=httpx.Timeout(30.0, connect=10.0),
            headers={"User-Agent": "ExamEngine/0.1 (personal learning research)"},
            transport=self.transport,
            follow_redirects=False,
        )

    @staticmethod
    def _checked_response(response: httpx.Response) -> httpx.Response:
        if response.status_code in {401, 403}:
            raise WebSourceError(422, "该公开来源拒绝访问，请换用其他结果或自行下载后上传")
        if response.status_code == 429:
            raise WebSourceError(429, "公开搜索暂时限流，请稍后重试或补充本地资料")
        if response.status_code >= 400:
            raise WebSourceError(502, f"公开来源返回错误（{response.status_code}）")
        return response

    def _get(self, client: httpx.Client, url: str) -> httpx.Response:
        current = validate_public_url(url)
        for _ in range(5):
            response = self._checked_response(client.get(current))
            if response.status_code not in {301, 302, 303, 307, 308}:
                return response
            location = response.headers.get("location")
            if not location:
                raise WebSourceError(502, "公开来源返回了无效重定向")
            current = validate_public_url(urljoin(current, location))
        raise WebSourceError(502, "公开来源重定向次数过多")

    def search(self, query: str) -> list[WebResult]:
        query = query.strip()
        if len(query) < 2:
            raise WebSourceError(422, "请提供需要补全的具体考点或资料类型")
        if '"' not in query:
            query = " ".join(
                f'"{term}"' if re.search(r"[\u3400-\u9fff]", term) and not term.startswith("site:") else term
                for term in query.split()[:2]
            )
        try:
            with self._client() as client:
                search_url = httpx.URL("https://www.bing.com/search", params={"q": query, "format": "rss"})
                response = self._get(client, str(search_url))
        except httpx.TimeoutException as error:
            raise WebSourceError(504, "公开搜索超时，请稍后重试或上传已有资料") from error
        except httpx.RequestError as error:
            raise WebSourceError(502, "公开搜索暂时不可用，请检查网络或上传已有资料") from error
        import xml.etree.ElementTree as ET
        try:
            root = ET.fromstring(response.content)
        except ET.ParseError as error:
            raise WebSourceError(502, "公开搜索返回了无法识别的结果") from error
        results = []
        for item in root.findall(".//item")[:8]:
            title = (item.findtext("title") or "").strip()
            url = (item.findtext("link") or "").strip()
            snippet = re.sub(r"\s+", " ", (item.findtext("description") or "").strip())
            if title and url:
                results.append(WebResult(title=title[:300], url=url, snippet=snippet[:2000]))
        if not results:
            raise WebSourceError(404, "没有找到可读取的公开结果，请换个具体考点或补充本地资料")
        return results

    def fetch(self, url: str) -> WebDocument:
        try:
            with self._client() as client:
                response = self._get(client, url)
        except httpx.TimeoutException as error:
            raise WebSourceError(504, "公开资料读取超时，请换用其他来源") from error
        except httpx.RequestError as error:
            raise WebSourceError(502, "公开资料读取失败，请换用其他来源") from error
        if len(response.content) > MAX_WEB_BYTES:
            raise WebSourceError(413, "单个网页或公开文件不能超过 5 MB")
        final_url = str(response.url)
        media_type = response.headers.get("content-type", "").split(";", 1)[0].strip().casefold()
        if media_type == "application/pdf" or response.content.startswith(b"%PDF"):
            title = "公开课程资料"
            return WebDocument(title=title, url=final_url, content=response.content)
        if media_type not in {"text/html", "application/xhtml+xml", "text/plain", ""}:
            raise WebSourceError(415, "当前仅支持公开网页、纯文本和 PDF")
        encoding = response.encoding or "utf-8"
        try:
            text = response.content.decode(encoding, errors="replace")
        except LookupError:
            text = response.content.decode("utf-8", errors="replace")
        if media_type in {"text/html", "application/xhtml+xml"}:
            extractor = TextExtractor()
            extractor.feed(text)
            text = extractor.text()
        text = text.strip()
        if len(text) < 40:
            raise WebSourceError(422, "网页未提取到足够正文，请换用其他来源或下载原件上传")
        title = "公开网络补充"
        markdown = (
            f"# {title}\n\n"
            f"来源 URL：{final_url}\n"
            f"获取时间：{datetime.now(timezone.utc).isoformat()}\n"
            "来源说明：公开网络补充，不代表本校本专业考试要求。\n\n"
            f"{text}\n"
        )
        return WebDocument(title=title, url=final_url, content=markdown.encode("utf-8"))
