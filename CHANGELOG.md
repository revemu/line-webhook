# 📝 Changelog

บันทึกประวัติการเปลี่ยนแปลงและการพัฒนาของโปรเจกต์ `line-webhook`

---

## [Unreleased] - 2026-10-03

### Added
- **New Year Party Companion Registration (ระบบลงทะเบียนผู้ติดตามงานเลี้ยงปีใหม่)**:
  - เพิ่มปุ่ม `👥 มีผู้ติดตาม` (สีน้ำเงิน, คำสั่ง `x2`) ใน Footer ของ Party Flex Message
  - เพิ่มการนับจำนวนคนร่วมงานรวม (Headcount) ใน Section Header: แสดง `👥 ผู้ร่วมงานทั้งหมด (X คน)` พร้อมรายละเอียด `(สมาชิก Y + ผู้ติดตาม Z)` เมื่อมีผู้ติดตาม
  - เพิ่มการแสดงจำนวนผู้ติดตามต่อท้ายชื่อสมาชิก เช่น `สมชาย (+1)` ใน Flex Message 2-column layout และ `(+1 ผู้ติดตาม)` ในโหมดข้อความธรรมดา
  - รองรับคำสั่งลงชื่อพร้อมผู้ติดตาม:
    - `x1` หรือ `+ny`: ลงชื่อ 1 คน (ไม่มีผู้ติดตาม)
    - `x2` หรือ `+ny 2`, `+ny +1`, `+ny2`: ลงชื่อ 2 คน (สมาชิก + ผู้ติดตาม 1 คน)
    - `x3`..`x20`: รองรับการระบุจำนวนคนร่วมงานแบบ dynamic
    - `x0` หรือ `-ny`, `-x1`, `-x2`: ยกเลิกการลงชื่อ
    - รองรับการ mention เช่น `x2 @ชื่อสมาชิก` หรือ `+ny @ชื่อสมาชิก 2`
  - เพิ่มคอลัมน์ `guests INT NOT NULL DEFAULT 0` ในตาราง `member_ny_week_tbl` พร้อมระบบ auto-migration ใน `ensureNYTable()`

---

## [0.5.1] - 2026-10-02
- **Dynamic Team Count for `/schedule`**: คำสั่ง `/schedule` เช็คจำนวนคนลงทะเบียนในสัปดาห์ (`member_team_week_tbl`) อัตโนมัติ หากเกิน 24 คนจะแบ่งเป็น 4 ทีม และหากไม่เกิน 24 คนจะแบ่งเป็น 3 ทีม
- **Team Count Options in `/schedule`**: รองรับการระบุจำนวนทีมผ่าน option ในคำสั่ง เช่น `/schedule 4`, `/schedule 3`, `/schedule 4ทีม`, `/schedule 4t`, `team:4`
- **Cache Invalidation for Team Count**: เพิ่มการตรวจสอบจำนวนทีมใน `schedule.json` หากจำนวนทีมในแคชไม่ตรงกับจำนวนทีมปัจจุบันที่ต้องแบ่ง จะทำการ regenerate ใหม่ทันที
- **Capacity Adjustment in `randomTeamByPosition`**: ขยายความจุการสุ่มทีมเป็น 32 คนอัตโนมัติเมื่อจำนวนคนลงทะเบียนเกิน 24 คน เพื่อรองรับการแบ่ง 4 ทีม
- **Auto 4th Team Color**: ฟังก์ชัน `addTeamColorWeek` เพิ่มการตรวจจับจำนวนผู้ลงทะเบียนเกิน 24 คน เพื่อสร้างสีทีมที่ 4 อัตโนมัติ

### Initial Setup
- **PROJECT_KNOWLEDGE.md**: เอกสารรวบรวม Knowledge องค์รวมของโปรเจกต์ (สถาปัตยกรรม, Tech Stack, โครงสร้างไฟล์, ระบบการทำงานหลัก เช่น Random Team Algorithm, Slip Verification, Worker Scheduler)
- **CHANGELOG.md**: ไฟล์ติดตามประวัติการเปลี่ยนแปลงและการแก้ไขโค้ดในแต่ละรอบ
- เพิ่มข้อกำหนดมาตรฐาน:
  1. บันทึกทุกสิ่งที่แก้ไขลงใน `CHANGELOG.md` ทุกครั้ง
  2. เมื่อแก้ไขเสร็จ ก่อนทำการ Git Commit จะต้องถามยืนยันผ่านปุ่ม interactive เสมอ
