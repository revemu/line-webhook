-- Migration: Create line_group_id_tbl for storing LINE group profile metadata
-- Stores group name, member count, and profile picture URL.
-- References can be linked to scheduled_task_tbl.group_id using line_group_id_tbl.id.

CREATE TABLE IF NOT EXISTS `line_group_id_tbl` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `line_group_id` VARCHAR(64) NOT NULL UNIQUE,
  `group_name` VARCHAR(255) NULL,
  `member_count` INT NULL DEFAULT 0,
  `picture_url` VARCHAR(500) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_line_group_id` (`line_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
