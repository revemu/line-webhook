-- Migration: Add schedule and lifecycle columns to match_stat_tbl
-- Enables /schedule to save match fixtures directly into MySQL
-- Supports match lifecycle: 'scheduled' (รอแข่ง) -> 'in_progress' (กำลังแข่ง) -> 'finished' (จบการแข่งขัน)

ALTER TABLE `match_stat_tbl`
  ADD COLUMN `round` INT NULL DEFAULT 1 COMMENT 'รอบการแข่งขัน' AFTER `match_num`,
  ADD COLUMN `start_time` VARCHAR(10) NULL COMMENT 'เวลาเริ่ม เช่น 18:00' AFTER `round`,
  ADD COLUMN `end_time` VARCHAR(10) NULL COMMENT 'เวลาสิ้นสุด เช่น 18:08' AFTER `start_time`,
  ADD COLUMN `status` ENUM('scheduled', 'in_progress', 'finished') NOT NULL DEFAULT 'finished' COMMENT 'สถานะแมตช์' AFTER `team_b_goal`,
  ADD COLUMN `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `match_stat_tbl`
  MODIFY COLUMN `team_a_goal` INT NULL DEFAULT NULL,
  MODIFY COLUMN `team_b_goal` INT NULL DEFAULT NULL;

-- Optional: Add index on (week_id, match_num) for fast lookups
-- ALTER TABLE `match_stat_tbl` ADD INDEX `idx_week_match` (`week_id`, `match_num`);
