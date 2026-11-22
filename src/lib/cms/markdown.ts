/**
 * A deliberately small, safe Markdown renderer for CMS pages.
 *
 * The CMS stores Markdown. Rendering happens here, never with raw HTML:
 * every block is HTML-escaped first and only the tags this function emits are
 * ever present. Links are limited to http(s), mailto, relative and anchor URLs,
 * so `javascript:` and `data:` payloads cannot survive.
 *
 * Supported: headings, paragraphs, lists, blockquotes, fenced code, rules,
 * bold, italic, inline code and links. That is enough for policy pages and
 * blog posts; anything richer belongs in a reviewed component, not in content.
 */

const ALLOWED_LINK = /^(https?:\/\/|mailto:|\/|#)/i;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inline(text: string): string {
  let html = escapeHtml(text);

  // Inline code first, so its contents are not treated as emphasis.
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
    const url = href.replace(/&amp;/g, "&");
    if (!ALLOWED_LINK.test(url)) return label;
    const safeHref = escapeHtml(url);
    const external = /^https?:\/\//i.test(url);
    const rel = external ? ' target="_blank" rel="noopener noreferrer nofollow"' : "";
    return `<a href="${safeHref}"${rel}>${label}</a>`;
  });

  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  return html;
}

function renderList(lines: string[], ordered: boolean): string {
  const tag = ordered ? "ol" : "ul";
  const items = lines
    .map((line) => line.replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, ""))
    .map((item) => `<li>${inline(item)}</li>`)
    .join("");
  return `<${tag}>${items}</${tag}>`;
}

export function renderMarkdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    // Fenced code block.
    if (/^```/.test(line.trim())) {
      const language = line.trim().slice(3).trim();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1; // closing fence
      const className = language ? ` class="language-${escapeHtml(language)}"` : "";
      out.push(`<pre><code${className}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      out.push("<hr />");
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        body.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      out.push(`<blockquote>${inline(body.join(" "))}</blockquote>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      out.push(renderList(body, false));
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      out.push(renderList(body, true));
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^```/.test(lines[index].trim()) &&
      !/^>\s?/.test(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index]) &&
      !/^\s*(---|\*\*\*|___)\s*$/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    out.push(`<p>${paragraph.map(inline).join("<br />")}</p>`);
  }

  return out.join("\n");
}
