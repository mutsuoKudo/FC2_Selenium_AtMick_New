import mysql from "mysql2/promise";
import { Builder, By, until, WebDriver } from "selenium-webdriver";
import path from "path";
import os from "os";
const chrome = require("selenium-webdriver/chrome");

// Chromeオプションの設定
let options = new chrome.Options();
options.addArguments("--remote-debugging-port=0");
options.addArguments(
  `--user-data-dir=${path.join(os.tmpdir(), `fc2-selenium-chrome-${process.pid}-${Date.now()}`)}`,
);
// options.addArguments("--headless");
options.addArguments("--no-sandbox");
options.addArguments("--enable-unsafe-swiftshader");
options.addArguments("--use-gl=swiftshader");
options.addArguments("--disable-gpu");
options.addArguments("--disable-webgpu");
options.addArguments("--disable-features=WebGPU,Vulkan,D3D11");
options.addArguments("--use-angle=swiftshader");
options.addArguments("--window-size=900,900"); // ウィンドウサイズを指定する
options.addArguments("--disable-dev-shm-usage");
options.addArguments("--lang=ja");
options.addArguments("--disable-notifications");
options.addArguments("--ignore-ssl-errors");
options.addArguments("--ignore-certificate-errors");
options.addArguments("--disable-background-networking");
options.addArguments("--disable-blink-features=AutomationControlled");
options.addArguments("--allow-insecure-localhost");
options.setPageLoadStrategy("eager");
options.addArguments("--disable-extensions");
options.addArguments("--disable-popup-blocking");
options.addArguments("--js-flags=--max-old-space-size=512");
options.addArguments("--memory-pressure-off");
options.addArguments("--process-per-site");

// ログ出力先は、サーバー内の絶対パスを動的に取得して出力先を設定したい
const APP_ROOT = path.join(__dirname, "../");
const logger = require("../lib/log/logger").application;

const getActiveFlgFromArgs = () => {
  const activeFlgArg = process.argv.find((arg) =>
    arg.startsWith("--active-flg="),
  );
  if (!activeFlgArg) {
    return 0;
  }

  const activeFlg = Number(activeFlgArg.split("=")[1]);
  if (!Number.isInteger(activeFlg) || activeFlg < 0 || activeFlg > 4) {
    throw new Error(
      `Invalid --active-flg value: ${activeFlgArg}. Use 0, 1, 2, 3, or 4.`,
    );
  }
  return activeFlg;
};

const targetActiveFlg = getActiveFlgFromArgs();

// SQL準備
const readySqlsUrl = [
  "SELECT * FROM selenium_url_fc2 where id >= 0 and active_flg = ? order by id DESC",
];
const redySqlUpdatePostDate = "update selenium_url_fc2 set ";
const readySqlUpdateLatestPostDate =
  "update selenium_url_fc2 set post_date = ? where id = ?";
const readySqlMarkInactive =
  "update selenium_url_fc2 set active_flg = 3, remarks = concat(coalesce(remarks, ''), case when remarks is null or remarks = '' then '' else '\n' end, ?) where id = ?";
const readySqlMarkRestricted =
  "update selenium_url_fc2 set active_flg = 4, remarks = concat(coalesce(remarks, ''), case when remarks is null or remarks = '' then '' else '\n' end, ?) where id = ?";
const redySqlUpdateNotApplicable =
  "update selenium_url_fc2 set active_flg= '2',remarks = '投稿日が見つからない' where id = ";

/* 途中経過表示用変数 */
type LatestRssEntry = {
  title: string;
  link: string;
  postDate: string;
  rssUrl: string;
};

type BlogAvailability =
  | {
      inactive: true;
      reason: string;
      restricted?: false;
    }
  | {
      restricted: true;
      reason: string;
      inactive?: false;
    }
  | {
      inactive: false;
      restricted?: false;
      reason?: string;
    };

const fc2ClosedPagePatterns = [
  /404\s*not\s*found/i,
  /このブログは存在しません/,
  /ブログが存在しません/,
  /ブログが見つかりません/,
  /指定されたページは見つかりません/,
  /お探しのページが見つかりません/,
  /このページは表示できません/,
];

const restrictedPagePatterns = [
  /password authentication/i,
  /this blog is password protected/i,
  /this page is password protected/i,
  /パスワード認証/,
  /パスワードを入力/,
  /閲覧制限/,
  /認証が必要/,
  /このブログはパスワードで保護されています/,
  /このページはパスワードで保護されています/,
];

const chromeSslErrorPatterns = [
  /ERR_SSL_VERSION_OR_CIPHER_MISMATCH/i,
  /ERR_SSL_PROTOCOL_ERROR/i,
  /ERR_SSL_OBSOLETE_VERSION/i,
  /ERR_SSL_CLIENT_AUTH_CERT_NEEDED/i,
  /ERR_CERT_AUTHORITY_INVALID/i,
  /ERR_CERT_COMMON_NAME_INVALID/i,
  /ERR_CERT_DATE_INVALID/i,
  /ERR_CERT_INVALID/i,
  /ERR_NAME_NOT_RESOLVED/i,
  /DNS_PROBE_FINISHED_NXDOMAIN/i,
  /doesn't support a secure connection/i,
  /can't provide a secure connection/i,
  /DNS address could not be found/i,
  /uses an unsupported protocol/i,
  /chrome-error:\/\/chromewebdata/i,
];

const buildRssUrl = (blogUrl: string) => {
  const rssUrl = new URL(blogUrl);
  rssUrl.hash = "";
  if (/\/blog-entry-\d+\.html$/i.test(rssUrl.pathname)) {
    rssUrl.pathname = "/";
  }
  rssUrl.search = "?xml";
  return rssUrl.toString();
};

const decodeXml = (text: string) =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

const getXmlTagValue = (xml: string, tagName: string) => {
  const tagPattern = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(
    new RegExp(`<${tagPattern}[^>]*>([\\s\\S]*?)</${tagPattern}>`, "i"),
  );
  return match ? decodeXml(match[1]) : "";
};

const formatPostDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}/${month}/${day} ${hours}:${minutes}`;
};

const fetchText = async (url: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FC2-Selenium-RSS/1.0",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
};

const detectRestrictedPage = (text: string) => {
  const matchedPattern = restrictedPagePatterns.find((pattern) =>
    pattern.test(text),
  );
  return matchedPattern
    ? `password/restricted page detected: ${matchedPattern.toString()}`
    : "";
};

const detectChromeSslError = (text: string) => {
  const matchedPattern = chromeSslErrorPatterns.find((pattern) =>
    pattern.test(text),
  );
  return matchedPattern
    ? `Chrome SSL error page detected: ${matchedPattern.toString()}`
    : "";
};

const inspectChromeSslErrorPage = async (driver: WebDriver) => {
  const [currentUrl, title, pageSource] = await Promise.all([
    driver.getCurrentUrl().catch(() => ""),
    driver.getTitle().catch(() => ""),
    driver.getPageSource().catch(() => ""),
  ]);
  return detectChromeSslError(`${currentUrl}\n${title}\n${pageSource}`);
};

const shouldRestartDriverAfterNavigationError = (text: string) =>
  /ECONNREFUSED/i.test(text) ||
  /Timed out receiving message from renderer/i.test(text) ||
  /chrome not reachable/i.test(text) ||
  /invalid session id/i.test(text) ||
  /session deleted/i.test(text) ||
  /target window already closed/i.test(text);

const inspectBlogAvailability = async (
  blogUrl: string,
): Promise<BlogAvailability> => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(blogUrl);
  } catch (e: any) {
    return {
      inactive: true,
      reason: `invalid URL: ${e.message}`,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(parsedUrl.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FC2-Selenium-Check/1.0",
      },
    });

    if (response.status === 404 || response.status === 410) {
      return {
        inactive: true,
        reason: `blog page returned HTTP ${response.status}`,
      };
    }

    if (!response.ok) {
      return {
        inactive: false,
        reason: `blog page returned HTTP ${response.status}`,
      };
    }

    const html = await response.text();
    const closedPattern = fc2ClosedPagePatterns.find((pattern) =>
      pattern.test(html),
    );
    if (closedPattern) {
      return {
        inactive: true,
        reason: `FC2 closed/not-found page detected: ${closedPattern.toString()}`,
      };
    }

    const restrictedReason = detectRestrictedPage(html);
    if (restrictedReason) {
      return {
        restricted: true,
        reason: restrictedReason,
      };
    }

    return { inactive: false };
  } catch (e: any) {
    return {
      inactive: false,
      reason: `blog availability check failed: ${e.message}`,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const markBlogInactive = async (
  connection: mysql.Connection,
  blogId: number,
  blogUrl: string,
  blogTitle: string,
  reason: string,
) => {
  const detectedAt = formatPostDate(new Date());
  const remarks = `[${detectedAt}] inactive by crawler: ${reason}`;
  await connection.execute(readySqlMarkInactive, [remarks, blogId]);
  console.log(`${blogTitle} marked inactive: ${reason}`);
  await logger.warn(
    "selenium_AtMick_FC2",
    `${blogId} ${blogUrl} marked inactive: ${reason}`,
  );
};

const markBlogRestricted = async (
  connection: mysql.Connection,
  blogId: number,
  blogUrl: string,
  blogTitle: string,
  reason: string,
) => {
  const detectedAt = formatPostDate(new Date());
  const remarks = `[${detectedAt}] restricted by crawler: ${reason}`;
  await connection.execute(readySqlMarkRestricted, [remarks, blogId]);
  console.log(`${blogTitle} marked restricted: ${reason}`);
  await logger.warn(
    "selenium_AtMick_FC2",
    `${blogId} ${blogUrl} marked restricted: ${reason}`,
  );
};

const dismissUnexpectedAlert = async (driver: WebDriver) => {
  try {
    await driver.switchTo().alert().dismiss();
  } catch (_) {}
};

const closeExtraWindows = async (driver: WebDriver, keepWindowHandle: string) => {
  const handles = await driver.getAllWindowHandles();
  if (handles.length <= 1) {
    return keepWindowHandle;
  }

  const keepHandle = handles.includes(keepWindowHandle)
    ? keepWindowHandle
    : handles[0];
  for (const handle of handles) {
    if (handle === keepHandle) {
      continue;
    }
    try {
      await driver.switchTo().window(handle);
      await driver.close();
    } catch (_) {}
  }
  await driver.switchTo().window(keepHandle);
  return keepHandle;
};

const waitForBlogPageReady = async (driver: WebDriver) => {
  const body = await driver.wait(until.elementLocated(By.css("body")), 15000);
  await driver.wait(until.elementIsVisible(body), 10000);

  try {
    await driver.wait(
      async () => {
        const readyState = (await driver.executeScript(
          "return document.readyState",
        )) as string;
        return readyState === "interactive" || readyState === "complete";
      },
      5000,
      "page did not reach interactive state",
    );
  } catch (e: any) {
    await logger.warn(
      "selenium_AtMick_FC2",
      `body is visible but readyState check did not finish: ${e.message}`,
    );
  }
};

const fetchLatestRssEntry = async (blogUrl: string): Promise<LatestRssEntry> => {
  const rssUrl = buildRssUrl(blogUrl);
  const rss = await fetchText(rssUrl);
  const itemMatch = rss.match(/<item\b[^>]*>([\s\S]*?)<\/item>/i);
  if (!itemMatch) {
    throw new Error("RSS item not found");
  }

  const itemXml = itemMatch[1];
  const pubDateText =
    getXmlTagValue(itemXml, "pubDate") ||
    getXmlTagValue(itemXml, "dc:date") ||
    getXmlTagValue(itemXml, "date");
  if (!pubDateText) {
    throw new Error("RSS post date not found");
  }

  const pubDate = new Date(pubDateText);
  if (Number.isNaN(pubDate.getTime())) {
    throw new Error(`Invalid RSS post date: ${pubDateText}`);
  }

  return {
    title: getXmlTagValue(itemXml, "title"),
    link: getXmlTagValue(itemXml, "link"),
    postDate: formatPostDate(pubDate),
    rssUrl,
  };
};

const updateLatestPostDate = async (
  connection: mysql.Connection,
  blogId: number,
  blogUrl: string,
  blogTitle: string,
) => {
  const latestEntry = await fetchLatestRssEntry(blogUrl);
  await connection.execute(readySqlUpdateLatestPostDate, [
    latestEntry.postDate,
    blogId,
  ]);
  console.log(
    `${blogTitle} RSS latest post_date updated: ${latestEntry.postDate}`,
  );
  await logger.info(
    "selenium_AtMick_FC2",
    `${blogId} ${blogUrl} RSS latest post_date updated: ${latestEntry.postDate} ${latestEntry.title} ${latestEntry.link} ${latestEntry.rssUrl}`,
  );
};

let no_of_access = 0;
let no_of_skip = 0;
let no_of_transferfail = 0;
let no_of_inactive = 0;
let no_of_restricted = 0;

const progressText = () =>
  `access:${no_of_access} skip:${no_of_skip} inactive:${no_of_inactive} restricted:${no_of_restricted} transfer_fail:${no_of_transferfail}`;

// 更新用変数
let blog_id = 0;
let blog_url = "";
let blog_title = "";
let blog_post_date = "";

// 非同期関数設定
const seleniumTetsuwanGenshiFc2 = async () => {
  console.log("APP_ROOT:", APP_ROOT);
  console.log("Log directory:", path.join(APP_ROOT, "./log/application/"));
  await logger.info("selenium_AtMick_FC2", "Selenium AtMick Start");
  console.log("selenium AtMick FC2 Start");
  console.log("target active_flg:", targetActiveFlg);
  await logger.info(
    "selenium_AtMick_FC2",
    `target active_flg: ${targetActiveFlg}`,
  );

  // MySQLデータベース接続
  const connection = await mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "rootpass",
    port: 3306,
    database: "seleniumdb",
  });
  const [urls] = await connection.execute(readySqlsUrl[0], [targetActiveFlg]);
  const urlResults = urls as any[];
  if (urlResults.length > 0) {
    console.log("first access url:", urlResults[0].url);
  } else {
    await logger.info("selenium_AtMick_FC2", "URL取得に失敗しました");
    console.log("URL取得に失敗しました");
    process.exit(1);
  }

  // Selenium WebDriver
  const buildDriver = () =>
    new Builder().forBrowser("chrome").setChromeOptions(options).build();
  let driver = await buildDriver();
  let mainWindowHandle = await driver.getWindowHandle();
  try {
    await driver.manage().setTimeouts({
      pageLoad: 30000,
      implicit: 10000,
    });

    try {
      // FC2ブログのログイン画面にアクセス
      await driver.get("https://fc2.com/login.php?ref=blog");
      await driver.wait(until.elementLocated(By.name("id")), 8000);
      await driver
        .findElement(By.name("id"))
        .sendKeys("mukudo@aqu.bekkoame.ne.jp");
      await driver.wait(until.elementLocated(By.name("pass")), 1000);
      await driver.findElement(By.name("pass")).sendKeys("ncr162100");
      await driver.wait(until.elementLocated(By.name("image")), 1000);

      let loginButton = await driver.findElement(By.name("image"));
      await driver
        .actions()
        .move({ origin: loginButton })
        .pause(1000)
        .click()
        .perform();

      await driver.sleep(1000);

      // セレクターで要素が表示されるまで待つ（最大5秒）
      const selector = "#sh_header > a";
      const element = await driver.wait(
        until.elementLocated(By.css(selector)),
        5000,
      );
      await driver.wait(until.elementIsVisible(element), 10000);

      // 要素をクリック
      await element.click();

      // 3秒待機
      await driver.sleep(3000);

      console.log(" ＠ミックとしてログイン ");
      await logger.info("selenium_AtMick_FC2", " ＠ミックとしてログイン ");
      await driver.sleep(1000);
    } catch (e: any) {
      console.log(" FC2ブログのログインに失敗しました ");
      await logger.warn(
        "selenium_AtMick_FC2",
        " FC2ブログのログインに失敗しました " + e.message,
      );
    } finally {
      // 必要であれば処理を描く
    }

    // 取得したURLの数だけループ
    for (let url of urlResults) {
      console.log(" " + progressText());

      blog_id = url.id;
      blog_url = url.url;
      blog_title = url.title;
      blog_post_date = url.post_date;

      console.log(blog_url + ", " + blog_title + "にアクセス");
      await logger.info(
        "selenium_AtMick_FC2",
        blog_id + " " + blog_url + ", " + blog_title + "にアクセス",
      );
      no_of_access++;

      const availability = await inspectBlogAvailability(blog_url);
      if (availability.inactive) {
        await markBlogInactive(
          connection,
          blog_id,
          blog_url,
          blog_title,
          availability.reason,
        );
        no_of_inactive++;
        no_of_skip++;
        await logger.info(
          "selenium_AtMick_FC2",
          progressText(),
        );
        continue;
      }
      if (availability.restricted) {
        await markBlogRestricted(
          connection,
          blog_id,
          blog_url,
          blog_title,
          availability.reason,
        );
        no_of_restricted++;
        no_of_skip++;
        await logger.info(
          "selenium_AtMick_FC2",
          progressText(),
        );
        continue;
      }
      if (availability.reason) {
        await logger.warn(
          "selenium_AtMick_FC2",
          `${blog_id} ${blog_url} availability check warning: ${availability.reason}`,
        );
      }

      // URL移動
      try {
        try {
          await updateLatestPostDate(connection, blog_id, blog_url, blog_title);
        } catch (e: any) {
          console.log(
            `${blog_title} RSS latest post_date update failed: ${e.message}`,
          );
          await logger.warn(
            "selenium_AtMick_FC2",
            `${blog_id} ${blog_url} RSS latest post_date update failed: ${e.message}`,
          );
        }

        await driver.manage().setTimeouts({
          pageLoad: 50000,
          implicit: 10000,
        });

        await dismissUnexpectedAlert(driver);
        mainWindowHandle = await closeExtraWindows(driver, mainWindowHandle);
        await driver.get(blog_url);
        await dismissUnexpectedAlert(driver);
        await waitForBlogPageReady(driver);

        const sslErrorReason = await inspectChromeSslErrorPage(driver);
        if (sslErrorReason) {
          await markBlogInactive(
            connection,
            blog_id,
            blog_url,
            blog_title,
            sslErrorReason,
          );
          no_of_inactive++;
          no_of_skip++;
          await logger.info(
            "selenium_AtMick_FC2",
            progressText(),
          );
          continue;
        }

        const pageSource = await driver.getPageSource();
        const restrictedReason = detectRestrictedPage(pageSource);
        if (restrictedReason) {
          await markBlogRestricted(
            connection,
            blog_id,
            blog_url,
            blog_title,
            restrictedReason,
          );
          no_of_restricted++;
          no_of_skip++;
          await logger.info(
            "selenium_AtMick_FC2",
            progressText(),
          );
          continue;
        }

        console.log(blog_title + " に移動 ");
        await logger.info("selenium_AtMick_FC2", blog_url + " に移動 ");
      } catch (e: any) {
        const sslErrorReason = detectChromeSslError(e.message || "");
        if (sslErrorReason) {
          await markBlogInactive(
            connection,
            blog_id,
            blog_url,
            blog_title,
            sslErrorReason,
          );
          no_of_inactive++;
          no_of_skip++;
          await logger.info(
            "selenium_AtMick_FC2",
            progressText(),
          );
          continue;
        }

        console.log(blog_title + " URLの移動に失敗しました ");
        await logger.warn(
          "selenium_AtMick_FC2",
          "URLの移動に失敗しました " +
            blog_id +
            " " +
            blog_title +
            " " +
            blog_url +
            " " +
            e.message,
        );
        no_of_transferfail++;
        no_of_skip++;
        await logger.info(
          "selenium_AtMick_FC2",
          progressText(),
        );

        // レンダラータイムアウトなどでChromeが不安定な場合は再起動
        if (shouldRestartDriverAfterNavigationError(e.message || "")) {
          console.log("ドライバーが不安定なため再起動します...");
          await logger.warn(
            "selenium_AtMick_FC2",
            "ドライバー不安定を検出。再起動します。 " + e.message,
          );
          try {
            await driver.quit();
          } catch (_) {}
          driver = await buildDriver();
          mainWindowHandle = await driver.getWindowHandle();
          await driver.manage().setTimeouts({
            pageLoad: 50000,
            implicit: 10000,
          });
          continue;
        }

        try {
          await driver.navigate().back();
        } catch (_) {}
        continue;
      }

      // // ポスト日を取得しDBにセーブ
      // try {
      //   await driver.wait(
      //     until.elementLocated(By.css(".ul.entry_date li:first-child")),
      //     1000
      //   );
      //   let dateElement = await driver.findElement(
      //     By.css("ul.entry_date li:first-child")
      //   );
      //   let dateText = await dateElement.getText();
      //   console.log("取得した日付:" + dateText);
      // } catch (e: any) {
      //   console.error(e.message);
      // }
    }
  } finally {
    await driver.sleep(5000);
    console.log(" " + progressText());
    await logger.info(
      "selenium_AtMick_FC2",
      "＠ミックとして巡回" + " " + blog_title + " " + progressText(),
    );
    await driver.quit();
    await connection.end();
  }
};

// 非同期関数呼び出し
seleniumTetsuwanGenshiFc2();
