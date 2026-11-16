-- ==============================================================
-- Soccer Bot Web Authentication Schema
-- Table: user_tbl
-- Description: Stores web dashboard user credentials and roles
-- ==============================================================

CREATE TABLE IF NOT EXISTS `user_tbl` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL,
  `password` varchar(255) NOT NULL COMMENT 'Bcrypt hashed password',
  `role` enum('admin','root') NOT NULL DEFAULT 'admin',
  `name` varchar(100) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================
-- Initial User Accounts:
-- 1. admin : admin1234
-- 2. root  : root1234
-- (Passwords below are securely hashed with bcrypt cost 10)
-- ==============================================================

INSERT INTO `user_tbl` (`username`, `password`, `role`, `name`) VALUES
('admin', '$2b$10$DOtGRoaOcG3UGGBjWdxtFutYUcq/FJ47bKeLMf5hSPwSFl6HEr1xG', 'admin', 'Match Admin'),
('root', '$2b$10$NFftupORvl9C7xgWiLdeFujSb8m/W1otZZhXNFc7iOd.RJxv/RrK.', 'root', 'System Root')
ON DUPLICATE KEY UPDATE `username` = VALUES(`username`);
