-- Migration: Create scheduled_task_tbl for database-driven scheduled tasks
-- Supports auto-running commands (e.g. /randomteam on Friday 20:00, +2 for debt call at 12:00)
-- Supports auto-chat text messages with template placeholders (#weekdate, #timerange, #max, #registered, #remaining, {all}) and conditionals ({{#if remaining > 0}}...{{/if}})

CREATE TABLE IF NOT EXISTS `scheduled_task_tbl` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `task_key` VARCHAR(100) NOT NULL UNIQUE,
  `task_name` VARCHAR(255) NOT NULL,
  `task_type` ENUM('command', 'text') NOT NULL DEFAULT 'command',
  `command` VARCHAR(255) NULL,
  `text_message` TEXT NULL,
  `schedule_days` VARCHAR(100) NOT NULL DEFAULT '*',
  `schedule_time` VARCHAR(10) NOT NULL DEFAULT '20:00',
  `group_id` VARCHAR(100) NULL,
  `delivery_mode` ENUM('push', 'reply_on_chat', 'log_only') NOT NULL DEFAULT 'push',
  `expire_minutes` INT NULL DEFAULT 60,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `last_run_date` VARCHAR(30) NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Initial default tasks
INSERT INTO `scheduled_task_tbl` (`task_key`, `task_name`, `task_type`, `command`, `text_message`, `schedule_days`, `schedule_time`, `enabled`)
VALUES
  ('randomteam_friday', 'Auto Random Team (Friday 20:00)', 'command', 'randomteam', NULL, 'fri', '20:00', 1),
  ('schedule_summary', 'Daily Schedule Summary', 'text', NULL, '{all}\nเสาร์นี้ #weekdate เราเริ่มเตะเวลา #timerange นะครับ\n\n{{#if remaining > 0}}\nยังบวกเพิ่มได้อีก #remaining นะครับ\n{{/if}}', 'mon-fri', '16:00', 1),
  ('debt_call', 'Daily Debt Call Reminder', 'command', '+2', NULL, 'mon-fri', '12:00', 1)
ON DUPLICATE KEY UPDATE `task_name` = VALUES(`task_name`);

