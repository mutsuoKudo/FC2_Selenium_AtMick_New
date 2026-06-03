import mysql from "mysql2/promise";
import { Builder, By, until } from "selenium-webdriver";
import path from "path";
const chrome = require("selenium-webdriver/chrome");

// Chromeオプションの設定
let options = new chrome.Options();
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
options.addArguments("----lang=ja");
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

// SQL準備
const readySqlsUrl = [
  "SELECT * FROM selenium_url_fc2 where id >= 0 and active_flg = 0 order by id DESC",
];
const redySqlUpdatePostDate = "update selenium_url_fc2 set ";
const redySqlUpdateNotApplicable =
  "update selenium_url_fc2 set active_flg= '2',remarks = '投稿日が見つからない' where id = ";

/* 途中経過表示用変数 */
let no_of_nice = 0;
let no_of_access = 0;
let no_of_skip = 0;
let no_of_nontitle = 0;
let no_of_nonicebutton = 0;
let no_of_alreadynice = 0;
let no_of_nicefail = 0;
let no_of_transferfail = 0;
let no_of_clickfail = 0;

// 更新用変数
let blog_active_flg = 0;
let blog_id = 0;
let blog_url = "";
let blog_title = "";
let blog_post_date = "";
let article_post_only_date = "";
let addStarButtonDisplayed = false;
let postDateDisplayed = false;
let nice_button = null;
let element_post_year = null;
let element_post_month = null;
let element_post_day = null;
let proccessed_Number_of_row = 0;

// 非同期関数設定
const seleniumTetsuwanGenshiFc2 = async () => {
  console.log("APP_ROOT:", APP_ROOT);
  console.log("Log directory:", path.join(APP_ROOT, "./log/application/"));
  await logger.info("selenium_AtMick_FC2", "Selenium AtMick Start");
  console.log("selenium AtMick FC2 Start");

  // MySQLデータベース接続
  const connection = await mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "rootpass",
    port: 3306,
    database: "seleniumdb",
  });
  const [urls] = await connection.execute(readySqlsUrl[0]);
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
      console.log(
        " access:" +
          no_of_access +
          " nice:" +
          no_of_nice +
          " skip:" +
          no_of_skip +
          " non_title:" +
          no_of_nontitle +
          " no_nice_button:" +
          no_of_nonicebutton +
          " already_nice:" +
          no_of_alreadynice +
          " nice_fail:" +
          no_of_nicefail +
          " transfer_fail:" +
          no_of_transferfail +
          " click_fail:" +
          no_of_clickfail,
      );

      blog_active_flg = url.active_flg;
      blog_id = url.id;
      blog_url = url.url;
      blog_title = url.title;
      blog_post_date = url.post_date;

      if (blog_active_flg != 0) {
        console.log(blog_url + ", " + blog_title + "は有効でないためとばす");
        await logger.warn(
          "selenium_AtMick_FC2",
          blog_id +
            " " +
            blog_url +
            ", " +
            blog_title +
            "は有効でないためとばす",
        );
        continue;
      } else {
        console.log(blog_url + ", " + blog_title + "にアクセス");
        await logger.info(
          "selenium_AtMick_FC2",
          blog_id + " " + blog_url + ", " + blog_title + "にアクセス",
        );
        no_of_access++;
      }

      // URL移動
      try {
        await driver.manage().setTimeouts({
          pageLoad: 50000,
          implicit: 10000,
        });

        await driver.get(blog_url);

        // ページが完全に読み込まれるまで待機
        await driver.wait(
          async function () {
            const readyState = await driver.executeScript(
              "return document.readyState",
            );
            return readyState === "complete";
          },
          50000,
          "ページの読み込みがタイムアウトしました",
        );

        console.log(blog_title + " に移動 ");
        await logger.info("selenium_AtMick_FC2", blog_url + " に移動 ");
      } catch (e: any) {
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
          `access:${no_of_access} nice:${no_of_nice} skip:${no_of_skip} non_title:${no_of_nontitle} no_nice_button:${no_of_nonicebutton} already_nice:${no_of_alreadynice} nice_fail:${no_of_nicefail} transfer_fail:${no_of_transferfail} click_fail:${no_of_clickfail}`,
        );

        // ドライバークラッシュ（ECONNREFUSED）検出時は再起動
        if (e.message && e.message.includes("ECONNREFUSED")) {
          console.log("ドライバーがクラッシュしました。再起動します...");
          await logger.warn(
            "selenium_AtMick_FC2",
            "ドライバークラッシュを検出。再起動します。",
          );
          try {
            await driver.quit();
          } catch (_) {}
          driver = await buildDriver();
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
    console.log(
      " access:" +
        no_of_access +
        " nice:" +
        no_of_nice +
        " skip:" +
        no_of_skip +
        " non_title:" +
        no_of_nontitle +
        " no_nice_button:" +
        no_of_nonicebutton +
        " already_nice:" +
        no_of_alreadynice +
        " nice_fail:" +
        no_of_nicefail +
        " transfer_fail:" +
        no_of_transferfail +
        " click_fail:" +
        no_of_clickfail,
    );
    await logger.info(
      "selenium_AtMick_FC2",
      "＠ミックとして巡回" +
        " " +
        blog_title +
        " access:" +
        no_of_access +
        " nice:" +
        no_of_nice +
        " skip:" +
        no_of_skip +
        " non_title:" +
        no_of_nontitle +
        " no_nice_button:" +
        no_of_nonicebutton +
        " already_nice:" +
        no_of_alreadynice +
        " nice_fail:" +
        no_of_nicefail +
        " transfer_fail:" +
        no_of_transferfail +
        " click_fail:" +
        no_of_clickfail,
    );
    await driver.quit();
    await connection.end();
  }
};

// 非同期関数呼び出し
seleniumTetsuwanGenshiFc2();
