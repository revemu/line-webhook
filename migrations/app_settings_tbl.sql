-- Migration: Create app_settings_tbl for system/application settings
-- Separates operational configuration from template_tpl (which is intended for formatting/templates).

CREATE TABLE IF NOT EXISTS `app_settings_tbl` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `setting_key` VARCHAR(100) NOT NULL UNIQUE,
  `setting_value` TEXT NULL,
  `category` VARCHAR(50) NOT NULL DEFAULT 'general',
  `description` VARCHAR(255) NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Initial slip verification scheduler settings
INSERT IGNORE INTO `app_settings_tbl` (`setting_key`, `setting_value`, `category`, `description`)
VALUES
  ('slip_verify_enabled', '1', 'slip_verify', 'Enable background EasySlip verification for noticed slips (1=on, 0=off)'),
  ('slip_verify_poll_seconds', '60', 'slip_verify', 'Polling interval in seconds for checking due noticed slips (min 15)'),
  ('slip_verify_max_attempts', '8', 'slip_verify', 'Maximum EasySlip verification retry attempts per slip'),
  ('slip_verify_max_age_hours', '168', 'slip_verify', 'Maximum slip age in hours to keep retrying verification (168 = 1 week)'),
  ('slip_verify_batch_limit', '10', 'slip_verify', 'Maximum number of slips checked per scheduler sweep'),
  ('slip_verify_notify_success', '0', 'slip_verify', 'Push LINE notification when delayed slip verifies cleanly (1=on, 0=off)'),
  ('slip_verify_retry_delays', '120,300,600,900,1800,3600,7200,14400', 'slip_verify', 'Comma-separated retry backoff delays in seconds per attempt');
