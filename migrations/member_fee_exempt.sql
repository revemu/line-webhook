-- Migration: Add fee_exempt column to member_tbl
-- Decouples pitch fee exemption from member_tbl.admin so admins can still be charged normally unless explicitly exempted.

ALTER TABLE `member_tbl`
  ADD COLUMN `fee_exempt` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = ยกเว้นไม่ตั้งยอดค้างชำระ/ไม่แสดงในรายการทวงเงิน, 0 = เรียกเก็บเงินปกติ';
