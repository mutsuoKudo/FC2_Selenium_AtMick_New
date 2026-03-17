DELETE FROM seleniumdb.selenium_url_hatena
WHERE id IN (
    SELECT id
    FROM (
        SELECT 
            id
        FROM seleniumdb.selenium_url_hatena t1
        WHERE id NOT IN (
            SELECT MIN(id)
            FROM seleniumdb.selenium_url_hatena t2
            GROUP BY t2.url
        )
    ) AS subquery
);
