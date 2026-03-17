const mysql = require("mysql2/promise");

const fs = require('fs');
const { promisify } = require('util');

//QueryのPromise作成関数
exports.promiseQuery = function promiseQuery(readySqls) {
    return con => {
        const sqls = readySqls;
        return Promise.all(sqls.map(sql => con.query(sql)));
    };
};

//Insert,Edit,DeleteのPromise作成関数
exports.promiseCUD = function promiseCUD(readySqls, additionalData) {
    return con => {
        console.log("additionalData:" + additionalData);
        const sqls = readySqls;
        return Promise.all(sqls.map(sql => con.query(sql, additionalData)));
    };
};

//DB接続関数
exports.connectDatabase = function connectDatabase() {
    //DB接続
    const con = mysql.createPool({
        host: "localhost",
        user: "root",
        password: "rootpass",
        port: 3306
        , database: "seleniumdb"
    });
    return con;
};

//ページングデータ作成関数
exports.getPagingParam = function getPagingParam(allCount, countParPage, specifiedPage) {
    let displayCount = countParPage;
    let pageNationArray = new Array();
    let pagePrevArray = new Array();
    let pageNextArray = new Array();
    console.log("全件数：" + allCount);
    const pageNumber = Math.ceil(allCount / countParPage);
    console.log("ページ数:" + pageNumber);
    const startIdNumber = ((specifiedPage - 1) * countParPage);
    const pageCriteria = "limit " + startIdNumber + "," + countParPage;
    if (specifiedPage == pageNumber) {
        displayCount = allCount - countParPage * (pageNumber - 1);
    }
    console.log("表示件数:" + displayCount);
    //ページネーション用データ
    for (let i = 1; i <= pageNumber; i++) {
        let pageObject;
        if (i == specifiedPage) {
            pageObject = {
                active: true
                , page: i
            }
        } else {
            pageObject = {
                active: false
                , page: i
            }
        }
        pageNationArray.push(pageObject);
    }
    //Prev用データ
    let prevObject;
    if (specifiedPage == 1) {
        prevObject = {
            prev: false,
            page: 1
        }
    } else {
        prevObject = {
            prev: true,
            page: specifiedPage - 1
        }
    }
    pagePrevArray.push(prevObject);
    //Next用データ
    let nextObject;
    if (specifiedPage == pageNumber) {
        nextObject = {
            next: false,
            page: pageNumber
        }
    } else {
        nextObject = {
            next: true,
            page: 1 + Number(specifiedPage)
        }
    }
    pageNextArray.push(nextObject);
    pageNationObject = {
        pageNumber: pageNumber,
        specifiedPage: specifiedPage,
        pageCriteria: pageCriteria,
        displayCount: displayCount,
        pageNationArray: pageNationArray,
        pagePrevArray: pagePrevArray,
        pageNextArray: pageNextArray
    }
    return pageNationObject;
}

//スクリーンショットを保存する関数
exports.getScreenShot = function screenShot(base64, title) {
    //スクリーンショット
    let buffer = Buffer.from(base64, 'base64');

    // bufferを保存
    const hiduke = new Date().getDate();
    const jikoku = new Date().getTime();
    let now = (hiduke + jikoku);

    promisify(fs.writeFile)('./shots/' + title + now + '.jpg', buffer);
};