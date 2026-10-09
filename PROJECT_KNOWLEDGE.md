# 📚 Project Knowledge: LINE Webhook (Football Management Bot)

> **เอกสารรวบรวมข้อมูล สถาปัตยกรรม และคู่มือการทำงานของระบบ LINE Webhook Bot**

---

## 1. ข้อมูลภาพรวม (Project Overview)

ระบบ **LINE Webhook** นี้เป็น Node.js Application ออกแบบมาสำหรับบริหารจัดการกลุ่มกิจกรรมกีฬา/เตะฟุตบอลประจำสัปดาห์ ผ่าน LINE Official Account / LINE Group โดยมีความสามารถหลักดังนี้:
- **ระบบลงทะเบียนและจัดทีมฟุตบอลอัตโนมัติ (`/randomteam`)**: มีอัลกอริทึมเฉลี่ยสมดุล (Rating, ตำแหน่ง GK/DF/MF/CF, Priority, Avoid Pair และ Bound Group)
- **ระบบชำระเงินและตรวจสอบสลิป (Payment & Slip Verification)**: สร้าง QR Code พร้อมเพย์ และถอดรหัส QR จากรูปสลิปที่ส่งเข้าห้องแชทเพื่อตรวจสอบยอดเงินและสถานะอัตโนมัติ
- **ระบบจัดตารางงานเบื้องหลัง (Task Scheduler & Worker Threads)**: รองรับการรัน background jobs เช่น การแจ้งเตือนเตะบอล, สรุปยอดค่าสนาม, แจ้งเตือนสลิป
- **ระบบ Flex Message UI**: แสดงผลสวยงามผ่าน LINE Flex Carousel, Bubble และการ Generate ภาพกราฟิกผังผู้เล่น

---

## 2. Tech Stack & Dependencies

- **Runtime & Framework**: Node.js, Express.js (`^5.1.0`)
- **LINE SDK**: `@line/bot-sdk` (`^9.9.0`)
- **Database**: MySQL (`mysql2` connection pool)
- **Image Processing & QR Decoding**:
  - `zxing-wasm`: ตัวถอดรหัส QR Code ประสิทธิภาพสูงผ่าน WebAssembly (พร้อม Fallback โหลด local WASM)
  - `jsqr`, `qrcode-reader`, `zbarimg`: เครื่องมือถอดรหัสสำรอง
  - `jimp`: ปรับแต่งและประมวลผลรูปภาพ (Image manipulation / cropping / filters)
  - `thai-qr-payment` & `svg2img`: สร้าง PromptPay QR Code
- **Background Tasks**: Node.js `worker_threads` ร่วมกับ MySQL state management (`scheduled_task_tbl`)
- **Security & Utilities**:
  - `spamProtection.js`: ป้องกันการยิงคำสั่งซ้ำถี่ (Rate limiting / Command debouncing)
  - `logger.js`: ระบบบันทึก Log มีการจัดระดับ (INFO, WARN, ERROR)

---

## 3. โครงสร้างโปรเจกต์ (Directory & File Structure)

```text
line-webhook/
├── index.js                    # จุดเริ่มต้น Express server, รับ Webhook จาก LINE, Routing
├── cmd.js                      # Parser คำสั่ง Bot ทั้งหมด (Slash commands / Text commands)
├── query.js                    # รวมคำสั่ง SQL Database Queries (MySQL2 Pool)
├── flex.js                     # ตัวสร้าง LINE Flex Message Templates (JSON structure)
├── lineClient.js               # Initializer LINE Bot Client และ Helper ฟังก์ชันส่งข้อความ
├── slip.js                     # ตรรกะการตรวจสอบสลิปเงินและถอดรหัส QR Code จากสลิป
├── qr_gen.js                   # การสร้างภาพ QR Code PromptPay สำหรับเรียกเก็บเงิน
├── team_img.js                 # ระบบสร้างภาพกราฟิกทีม/ผังนักเตะ
├── schedule.json               # ค่าคอนฟิกตารางเวลา/เทมเพลตงาน
├── randomteam_flowchart.md     # Flowchart อธิบายอัลกอริทึมการสุ่มทีม
│
├── scheduler/                  # ระบบ Background Job Scheduler
│   ├── index.js                # Initializer และ Controller ของ Scheduler
│   ├── taskRegistry.js         # ทะเบียนงานและ Action ต่างๆ ที่ระบบรองรับ
│   ├── pendingManager.js       # จัดการคิวงานที่รอประมวลผล
│   ├── worker.js               # Worker thread สำหรับประมวลผลงานแบบแยกเธรด
│   └── tasks/                  # โค้ดคำสั่งแยกตามประเภทงาน
│
├── utils/                      # เครื่องมือช่วยเหลือ (Utility Modules)
│   ├── date.js                 # จัดการฟอร์แมตวันที่ เวลา และพุทธศักราช
│   ├── logger.js               # จัดการ Log ข้อความสีและ Format
│   ├── spamProtection.js       # ป้องกันสแปมและการส่งคำสั่งรัว
│   └── url.js                  # จัดการ Base URL แบบ Dynamic รองรับ Nginx Reverse Proxy
│
├── migrations/                 # สคริปต์ SQL Migration
│   ├── line_group_id_tbl.sql
│   ├── member_ny_week_tbl.sql
│   └── scheduled_task_tbl.sql
│
├── assets/ & fonts/            # ไฟล์ฟอนต์และ Asset รูปภาพที่ใช้สร้างกราฟิก
├── img/ & qr/ & temp/          # ที่จัดเก็บรูปภาพชั่วคราวและ QR code ที่ถูกสร้างขึ้น
├── PROJECT_KNOWLEDGE.md        # [เอกสารนี้] คลังความรู้และคู่มือสถาปัตยกรรมโปรเจกต์
└── CHANGELOG.md                # บันทึกประวัติการแก้ไขและฟีเจอร์ในแต่ละรอบ
```

---

## 4. โมดูลสำคัญและการทำงาน (Core Modules)

### 4.1 LINE Event Handling (`index.js` & `cmd.js`)
- รับ Webhook `POST /webhook` จาก LINE Platform
- ตรวจสอบ Signature ผ่าน `@line/bot-sdk` middleware
- ตรวจจับประเภท Event:
  - `message: text`: ตรวจสอบคำสั่งผ่าน `cmd.js` และเช็ค Spam ด้วย `spamProtection.js`
  - `message: image`: ส่งภาพไปถอดรหัส QR เพื่อตรวจสอบว่าเป็นสลิปการโอนเงินหรือไม่ (`slip.js`)
  - `postback` / `follow` / `join`: ตอบสนองตาม Event ต่างๆ

### 4.2 ระบบจัดทีมและสุ่มผู้เล่น (`/randomteam`)
กระบวนการทำงานมี 5 เฟสหลัก:
1. **เตรียมข้อมูล**: ดึงผู้เล่นประจำสัปดาห์ (`week_tbl`, `member_team_week_tbl`), **คัดแยกผู้รักษาประตู (`member_tbl.team_id = 100`) ออกจากการสุ่มทีมทั้งหมด** และตั้งค่า `team_id = 0`, จำกัดผู้เล่นในสนาม (Outfield) ตาม `maxweek` (`week_tbl.max` เช่น 24 คน) แบบ FIFO เคร่งครัด (ไม่ขยายเป็น 32 คน), ผู้เล่นที่เกินโควตาจะถูกตัดเป็นสำรองทั้งหมด (Reserve `team_id = 0`), ดึงเรตติ้งย้อนหลัง (`member_year_stat_tbl`), ตรวจสอบ Avoid Map (คนที่ไม่อยากอยู่ทีมเดียวกัน)
2. **Phase 1 (Bound Groups)**: ผู้เล่นที่ถูกล็อกกลุ่ม (`week_team > 0`) ให้อยู่ทีมเดียวกันก่อน
3. **Phase 2 (Priority 1)**: กระจายผู้เล่นคีย์แมน/ระดับสูงตามตำแหน่ง (DF, DW, DM, MF, AM, CF โดยไม่เลือกตำแหน่งโกล์ เพื่อให้สลับกันเล่น)
4. **Phase 3 (Avoid Players)**: กระจายผู้เล่นที่มีข้อกำหนด Avoid ไม่ให้ชนกัน
5. **Phase 4 & 5 (Remaining & Fallback)**: กระจายผู้เล่นที่เหลือตามโควตาและบาลานซ์เรตติ้งรวมของทีม

### 4.3 ระบบสลิปและการเงิน (`slip.js`, `qr_gen.js`, `query.js`)
- รองรับการสร้าง PromptPay QR Code ตามยอดเงิน (`thai-qr-payment`)
- เมื่อสมาชิกส่งรูปสลิปเข้ากลุ่ม:
  - ดึง Image Stream จาก LINE Content API
  - ประมวลผลภาพด้วย `jimp` และถอดรหัส QR ผ่าน `zxing-wasm` (ถ้าล้มเหลวจะ fallback ไป `jsqr` / `zbarimg`)
  - ตรวจสอบข้อมูลสลิป เช่น ข้อมูล PromptPay Transfer, ข้อมูลบัญชี, วันที่และเวลา
  - อัปเดตสถานะชำระเงินของสมาชิกในสัปดาห์นั้นลงฐานข้อมูล
- **ระบบคำนวณค่าสนาม (`/setcost` / `setWeekCost`)**:
  - **ผู้เล่นในสนาม (Field Players)**: นำผู้เล่นในสนามตัวจริงทั้งหมดตามโควตา `max_players` มาเป็นตัวหารค่าสนาม (สูตร: `Math.ceil((totalCost + 100) / count) + 35`)
  - **โกล์ (Goalkeepers)**: โกล์ (`team_id = 100`) จะไม่ถูกนำไปหารค่าสนาม แต่จะถูกกำหนดค่าธรรมเนียมคงที่ไว้ที่ **40 บาท**เสมอ
  - **Admin (`admin > 0` หรือ `team_id = 101`)**: **Admin ไม่ได้เล่นฟรี** แต่เนื่องจาก Admin เป็นคนสำรองจ่ายค่าสนามและเคลียร์หักยอดกันเองภายนอก จึงกำหนด `debt = 0` ในระบบเพื่อไม่ให้มีรายการแจ้งเตือนค้างชำระ และไม่จำเป็นต้องส่งสลิปยืนยันในแชท (โดยที่จำนวน Admin ยังคงถูกนำมานับเป็นตัวหารตามปกติเพื่อให้ยอดเฉลี่ยต่อคนถูกต้อง)
  - **ผู้เล่นสำรอง (Reserves)**: สมาชิกที่เป็นตัวสำรองจะถูกตั้งค่า `debt = 0` (ไม่คิดเงินจนกว่าจะได้ลงเล่นจริง)

### 4.4 ระบบ Task Scheduler (`scheduler/`)
- ทำงานคู่กับฐานข้อมูล `scheduled_task_tbl`
- รันผ่าน Node.js `worker_threads` เพื่อป้องกันไม่ให้งานหนักบล็อก Event Loop ของเซิร์ฟเวอร์
- ตรวจสอบและดึงงานที่ถึงกำหนดเวลา (Scheduled Tasks) เช่น แจ้งเตือนสลิปค้างจ่าย หรือการแจ้งข่าวสาร
- **ระบบข้อความ Template (`resolveScheduleTemplateText`)**:
  - ตัวแปร: `#weekdate`, `#timerange`, `#max`, `#registered`, `#remaining`, `{all}`
  - Conditional Blocks: `{{#if expr}}...{{else}}...{{/if}}` หรือ `[if expr]...[else]...[/if]`
  - รองรับเงื่อนไขวันในสัปดาห์:
    - รูปแบบระบุตัวแปร: `{{#if dow == fri}}`, `{{#if dow == 5}}`, `{{#if day == sat}}`
    - รูปแบบย่อตามชื่อวัน: `{{#if fri}}`, `{{#if friday}}`, `{{#if sat}}`
    - ตรรกะตัวเลข: `{{#if remaining > 0}}`, `{{#if remaining == 0}}`

### 4.5 ระบบลงทะเบียนงานเลี้ยงปีใหม่และผู้ติดตาม (`cmd.js`, `flex.js`, `query.js`)
- **ฐานข้อมูล**: ตาราง `member_ny_week_tbl` เก็บ `datetime`, `member_id`, `name`, `guests` (จำนวนผู้ติดตามเริ่มต้นเป็น 0)
- **การนับยอดร่วมงาน (Headcount)**:
  - สมาชิกลงชื่อ 1 คน = 1 ที่
  - มีผู้ติดตาม `guests = N` = ยอดร่วมงานทั้งหมดเป็น `1 + N` คน
  - รายชื่อสมาชิกแสดง `ชื่อ (+N)` เช่น `สมชาย (+1)`
  - ส่วนหัวสรุปยอดแสดง `👥 ผู้ร่วมงานทั้งหมด (X คน)` พร้อม `(สมาชิก Y + ผู้ติดตาม Z)`
- **ฟังก์ชันหลัก**:
  - `registerNY(member_id, member_name, target_datetime, guests)`: ลงชื่อหรืออัปเดตจำนวนผู้ติดตาม
  - `unregisterGuestNY(member_id, target_datetime)`: รีเซ็ต `guests = 0` โดยสมาชิกยังคงลงชื่ออยู่
  - `unregisterNY(member_id, target_datetime)`: ลบชื่อสมาชิกและผู้ติดตามออกทั้งหมด
- **คำสั่งและปุ่มกด (Commands & UI)**:
  - แถบปุ่มกดแบบ 2 แถว 4 ปุ่ม:
    - `➕ ลงชื่อ (คนเดียว)` ส่ง `+ny`
    - `👥 มีผู้ติดตาม` ส่ง `x2`
    - `➖ ยกเลิกผู้ติดตาม` ส่ง `-guest` (ปรับผู้ติดตามเป็น 0 ยังคงชื่อสมาชิกไว้)
    - `❌ ยกเลิกทั้งหมด` ส่ง `-ny` (ถอนชื่อออกทั้งหมด)
  - คำสั่งพิมพ์ในแชท:
    - ลงชื่อ: `x1` ถึง `x20`, `+ny`, `+ny 2`, `+ny +1`, `+ny2`
    - ยกเลิกเฉพาะผู้ติดตาม: `-guest`, `-guests`, `-follower`, `delguest`, `-ny guest`
    - ยกเลิกทั้งหมด: `x0`, `-x1`, `-x2`, `-ny`
    - รองรับการ mention เช่น `x2 @ชื่อสมาชิก`, `-guest @ชื่อสมาชิก`

---

## 5. กฎระเบียบและข้อกำหนดการพัฒนา (Development Rules)

> [!IMPORTANT]
> **ข้อตกลงในการพัฒนาและจัดการโค้ด:**
> 1. **บันทึกทุกสิ่งที่แก้ไข**: ทุกครั้งที่มีการสร้าง แก้ไข หรือปรับปรุงระบบ ต้องบันทึกรายละเอียดลงใน [`CHANGELOG.md`](file:///c:/Sites/github/line-webhook/CHANGELOG.md) เสมอ
> 2. **การ Commit Git ต้องผ่านการยืนยัน**: เมื่อทำการแก้ไขเสร็จสิ้น ห้าม commit git อัตโนมัติเด็ดขาด **ต้องถามยืนยันจากผู้ใช้ด้วยปุ่มผ่าน `ask_question` เสมอ**
