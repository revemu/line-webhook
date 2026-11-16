-- Migration: Create member_ny_week_tbl for New Year party registration with datetime
CREATE TABLE IF NOT EXISTS `member_ny_week_tbl` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `datetime` DATETIME NOT NULL,
  `member_id` INT NOT NULL,
  `name` VARCHAR(100) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_datetime_member` (`datetime`, `member_id`),
  KEY `idx_datetime` (`datetime`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Optional template_tpl config for dynamic New Year announcement and event datetime
INSERT INTO `template_tpl` (`name`, `value`, `code`, `url`, `size`)
VALUES (
  'ny_schedule',
  '2026-12-19 19:00:00',
  'ประกาศจัดงานเลี้ยงปีใหม่นะครับ \nวันเสาร์ที่ 19 ธันวาคม เวลา 19.00-24.00 น. หลังจากเตะบอล 17.00-19.00 น. นะครับ\nสถานที่: Waterside ห้องคาราโอกะ K5 Club Pool นะครับ \nขอเรียนเชิญทุกท่านที่มาร่วมงานพิมพ์ x1 เพื่อลงชื่อด้วยนะครับ\n\n',
  NULL,
  NULL
)
ON DUPLICATE KEY UPDATE
  `value` = VALUES(`value`),
  `code` = VALUES(`code`);
