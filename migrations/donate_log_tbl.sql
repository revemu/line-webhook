-- Migration: Create donate_log_tbl for tracking member donation history
-- Keeps member_tbl.donate synchronized as the cumulative total while recording every +/- transaction.

CREATE TABLE IF NOT EXISTS `donate_log_tbl` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `member_id` INT NOT NULL,
  `amount` INT NOT NULL,
  `source` VARCHAR(50) NOT NULL DEFAULT 'manual',
  `note` VARCHAR(255) NULL,
  `created_by` VARCHAR(100) NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_donate_member` (`member_id`),
  INDEX `idx_donate_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Seed initial balances once if donate_log_tbl is empty
INSERT INTO `donate_log_tbl` (`member_id`, `amount`, `source`, `note`, `created_by`)
SELECT `id`, `donate`, 'initial', 'ยอดสะสมเดิม', 'system'
FROM `member_tbl`
WHERE `donate` > 0
  AND NOT EXISTS (SELECT 1 FROM `donate_log_tbl` LIMIT 1);
