CREATE TABLE `selenium_url_hatena` (
  `id` int NOT NULL,
  `url` varchar(255) NOT NULL,
  `title` varchar(255) DEFAULT NULL,
  `active_flg` tinyint(1) NOT NULL,
  `post_date` varchar(17) DEFAULT NULL,
  `remarks` text,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
