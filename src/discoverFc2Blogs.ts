import mysql from "mysql2/promise";

type ExistingBlogRow = {
  url: string;
};

type DiscoveredBlog = {
  url: string;
  title: string;
  sourceUrl: string;
};

type RssEntry = {
  title: string;
  link: string;
  postDate: Date;
};

const shouldApply = process.argv.includes("--apply");
const sourceUrl =
  process.argv
    .find((arg) => arg.startsWith("--source="))
    ?.split("=")
    .slice(1)
    .join("=") || "https://blog.fc2.com/newentry.html";
const maxCandidates = Number(
  process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] || 100,
);

const pad2 = (value: number) => String(value).padStart(2, "0");

const formatPostDate = (date: Date) =>
  `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

const toUtf8mb3Text = (value: string, maxLength?: number) => {
  const supportedChars = Array.from(value).filter((char) => {
    const codePoint = char.codePointAt(0);
    return codePoint !== undefined && codePoint <= 0xffff;
  });
  const trimmedChars =
    maxLength === undefined ? supportedChars : supportedChars.slice(0, maxLength);
  return trimmedChars.join("").trim();
};

const normalizeBlogUrl = (value: string) => {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.protocol = "http:";

  if (/\/blog-entry-\d+\.html$/i.test(url.pathname)) {
    url.pathname = "/";
  }
  if (url.pathname === "") {
    url.pathname = "/";
  }
  if (!url.pathname.endsWith("/") && !/\.[a-z0-9]+$/i.test(url.pathname)) {
    url.pathname += "/";
  }

  return url.toString();
};

const isCandidateBlogUrl = (url: URL) => {
  const host = url.hostname.toLowerCase();
  if (host === "blog.fc2.com" || host.endsWith(".id.fc2.com")) {
    return false;
  }
  return (
    host.endsWith(".blog.fc2.com") ||
    host.endsWith(".fc2.net") ||
    host.includes(".blog") ||
    host.endsWith(".com") ||
    host.endsWith(".jp") ||
    host.endsWith(".net")
  );
};

const fetchText = async (url: string) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FC2 Selenium Discovery",
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const discoverFromFc2NewEntries = async (): Promise<DiscoveredBlog[]> => {
  const html = await fetchText(sourceUrl);
  const markerIndex = html.search(/main_entry_list/);
  const targetHtml = markerIndex >= 0 ? html.slice(markerIndex) : html;
  const anchorPattern =
    /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  const candidates = new Map<string, DiscoveredBlog>();

  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(targetHtml)) !== null) {
    try {
      const attributes = `${match[1]} ${match[3]}`;
      if (!/\bgtm-blog_link\b/.test(attributes)) {
        continue;
      }

      const absoluteUrl = new URL(match[2], sourceUrl);
      if (!isCandidateBlogUrl(absoluteUrl)) {
        continue;
      }

      const normalizedUrl = normalizeBlogUrl(absoluteUrl.toString());
      const title = toUtf8mb3Text(
        decodeHtmlEntities(
          match[4].replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi, ""),
        ),
        255,
      );
      if (!title || /^\d+\s/.test(title)) {
        continue;
      }
      if (!candidates.has(normalizedUrl)) {
        candidates.set(normalizedUrl, {
          url: normalizedUrl,
          title,
          sourceUrl,
        });
      }
    } catch (_) {
      continue;
    }
  }

  return Array.from(candidates.values()).slice(0, maxCandidates);
};

const buildRssUrl = (blogUrl: string) => {
  const rssUrl = new URL(blogUrl);
  rssUrl.hash = "";
  rssUrl.search = "?xml";
  if (!rssUrl.pathname.endsWith("/")) {
    rssUrl.pathname = "/";
  }
  return rssUrl.toString();
};

const getXmlTagValue = (xml: string, tagName: string) => {
  const match = xml.match(
    new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"),
  );
  if (!match) {
    return "";
  }
  return decodeHtmlEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
};

const fetchRecentRssEntries = async (blogUrl: string): Promise<RssEntry[]> => {
  const rss = await fetchText(buildRssUrl(blogUrl));
  const items = Array.from(rss.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi));

  return items
    .map((itemMatch) => {
      const itemXml = itemMatch[1];
      const pubDateText =
        getXmlTagValue(itemXml, "pubDate") ||
        getXmlTagValue(itemXml, "dc:date") ||
        getXmlTagValue(itemXml, "date");
      const postDate = new Date(pubDateText);
      if (!pubDateText || Number.isNaN(postDate.getTime())) {
        return null;
      }
      return {
        title: toUtf8mb3Text(getXmlTagValue(itemXml, "title")),
        link: getXmlTagValue(itemXml, "link"),
        postDate,
      };
    })
    .filter((entry): entry is RssEntry => entry !== null)
    .sort((a, b) => b.postDate.getTime() - a.postDate.getTime());
};

const decideActiveFlg = (entries: RssEntry[]) => {
  const now = new Date();
  const latest = entries[0];
  const daysSinceLatest =
    (now.getTime() - latest.postDate.getTime()) / (24 * 60 * 60 * 1000);
  const updateIntervalDays =
    entries.length >= 2
      ? (entries[0].postDate.getTime() - entries[1].postDate.getTime()) /
        (24 * 60 * 60 * 1000)
      : null;

  if (daysSinceLatest >= 180) {
    return {
      activeFlg: 3,
      reason: `auto discovered: latest post is ${Math.floor(daysSinceLatest)} days old`,
      updateIntervalDays,
    };
  }
  if (daysSinceLatest >= 30) {
    return {
      activeFlg: 2,
      reason: `auto discovered: latest post is ${Math.floor(daysSinceLatest)} days old`,
      updateIntervalDays,
    };
  }
  if (updateIntervalDays !== null && updateIntervalDays >= 4) {
    return {
      activeFlg: 2,
      reason: `auto discovered: update interval is ${updateIntervalDays.toFixed(1)} days`,
      updateIntervalDays,
    };
  }
  return {
    activeFlg: 0,
    reason: "auto discovered: frequent update",
    updateIntervalDays,
  };
};

const createConnection = () =>
  mysql.createConnection({
    host: process.env.MYSQL_HOST || "localhost",
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "rootpass",
    port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE || "seleniumdb",
  });

const discoverFc2Blogs = async () => {
  if (!Number.isInteger(maxCandidates) || maxCandidates <= 0) {
    throw new Error("Invalid --limit value. Use a positive integer.");
  }

  const connection = await createConnection();
  try {
    const [rows] = await connection.execute("select url from selenium_url_fc2");
    const existingUrls = new Set(
      (rows as ExistingBlogRow[]).map((row) => normalizeBlogUrl(row.url)),
    );
    const [maxIdRows] = await connection.execute(
      "select coalesce(max(id), 0) as maxId from selenium_url_fc2",
    );
    let nextId = Number((maxIdRows as { maxId: number }[])[0].maxId) + 1;

    const candidates = await discoverFromFc2NewEntries();
    let existing = 0;
    let skipped = 0;
    let discovered = 0;

    for (const candidate of candidates) {
      if (existingUrls.has(candidate.url)) {
        existing++;
        continue;
      }

      let entries: RssEntry[];
      try {
        entries = await fetchRecentRssEntries(candidate.url);
      } catch (e: any) {
        skipped++;
        console.warn(`skip rss failed ${candidate.url} ${e.message}`);
        continue;
      }
      if (entries.length === 0) {
        skipped++;
        console.warn(`skip rss empty ${candidate.url}`);
        continue;
      }

      const decision = decideActiveFlg(entries);
      const postDate = formatPostDate(entries[0].postDate);
      const title = toUtf8mb3Text(candidate.title, 255);
      const remarks = toUtf8mb3Text(
        `[${formatPostDate(new Date())}] ${decision.reason}; source=${candidate.sourceUrl}; latest="${entries[0].title}"`,
      );
      discovered++;

      console.log(
        `${shouldApply ? "insert" : "dry-run"} id=${nextId} active_flg=${decision.activeFlg} post_date=${postDate} interval=${decision.updateIntervalDays?.toFixed(1) ?? "n/a"} ${candidate.url} ${title}`,
      );

      if (shouldApply) {
        await connection.execute(
          "insert into selenium_url_fc2 (id, url, title, active_flg, post_date, remarks) values (?, ?, ?, ?, ?, ?)",
          [
            nextId,
            candidate.url,
            title,
            decision.activeFlg,
            postDate,
            remarks,
          ],
        );
      }

      existingUrls.add(candidate.url);
      nextId++;
    }

    console.log(
      `${shouldApply ? "inserted" : "would insert"} ${discovered} blogs, existing ${existing}, skipped ${skipped}`,
    );
    if (!shouldApply) {
      console.log("Run with -- --apply to insert discovered blogs.");
    }
  } finally {
    await connection.end();
  }
};

discoverFc2Blogs().catch((error) => {
  console.error(error);
  process.exit(1);
});
