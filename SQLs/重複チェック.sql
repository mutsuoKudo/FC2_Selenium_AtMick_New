SELECT 
    url,
    COUNT(*) AS count
FROM 
    seleniumdb.selenium_url_hatena
GROUP BY 
    url
HAVING 
    COUNT(*) > 1;
