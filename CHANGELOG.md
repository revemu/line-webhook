# 📝 Changelog

บันทึกประวัติการเปลี่ยนแปลงและการพัฒนาของโปรเจกต์ `line-webhook`

---

## [Unreleased] - 2026-10-02

### Added
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
