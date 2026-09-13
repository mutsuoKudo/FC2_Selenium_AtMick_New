// 構造を確認済みのサイトのみ対応。一般的な日付や関連記事の日付は使わない。
export const supportsHtmlPostDate = (url: string) =>
  ["windy1998.blog.fc2.com", "nut827.blog.fc2.com"].includes(new URL(url).hostname);

export function parseHtmlPostDate(html: string, blogUrl: string) {
  const base = new URL(blogUrl);
  if (!supportsHtmlPostDate(blogUrl)) throw new Error("Unsupported HTML post date source");
  const candidates: { title: string; link: string; date: Date }[] = [];
  const add = (link: string, timestamp: string, title: string) => {
    const url = new URL(link, base);
    if (url.hostname !== base.hostname || !/^\/blog-entry-\d+\.html$/.test(url.pathname)) return;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(timestamp)) return;
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return;
    // Dateによる存在しない日付の繰り上がりも拒否する。
    if (new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 19) !== timestamp.slice(0, 19)) return;
    candidates.push({ title: title.replace(/<[^>]*>/g, "").trim(), link: url.href, date });
  };
  if (base.hostname === "nut827.blog.fc2.com") {
    for (const match of html.matchAll(/<rdf:Description\b[^>]*>/gi)) {
      const tag = match[0];
      const link = tag.match(/\brdf:about="([^"]+)"/i)?.[1];
      const date = tag.match(/\bdc:date="([^"]+)"/i)?.[1];
      if (link && date) add(link, date, tag.match(/\bdc:title="([^"]*)"/i)?.[1] || "");
    }
  } else {
    for (const match of html.matchAll(/<time\b[^>]*datetime="([^"]+)"[^>]*>[\s\S]*?<h2\b[^>]*id="entry\d+"[^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      add(match[2], match[1], match[3]);
    }
  }
  candidates.sort((a, b) => b.date.getTime() - a.date.getTime());
  if (!candidates.length) throw new Error("HTML article post date not found; DB value preserved");
  return candidates[0];
}
