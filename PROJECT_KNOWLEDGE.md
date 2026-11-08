# 📚 Project Knowledge: LINE Webhook & Soccer Bot Unified System

> **เอกสารรวบรวมข้อมูล สถาปัตยกรรม และคู่มือการทำงานของระบบ LINE Webhook Bot & Soccer Bot Web Dashboard**

---

## 1. ข้อมูลภาพรวม (Project Overview)

ระบบ **LINE Webhook & Soccer Bot** เป็น Node.js Unified Application สำหรับบริหารจัดการกลุ่มกิจกรรมกีฬา/เตะฟุตบอลประจำสัปดาห์แบบครบวงจร ครอบคลุมทั้ง LINE Bot และ Web Management Dashboard:
- **ระบบลงทะเบียนและจัดทีมฟุตบอลอัตโนมัติ (`/randomteam`)**: มีอัลกอริทึมเฉลี่ยสมดุล (Rating, ตำแหน่ง GK/DF/MF/CF, Priority, Avoid Pair และ Bound Group)
- **ระบบชำระเงินและตรวจสอบสลิป (Payment & Slip Verification)**: สร้าง QR Code พร้อมเพย์ และถอดรหัส QR จากรูปสลิปที่ส่งเข้าห้องแชทเพื่อตรวจสอบยอดเงินและสถานะอัตโนมัติ
- **ระบบจัดตารางงานเบื้องหลัง (Task Scheduler & Worker Threads)**: รองรับการรัน background jobs เช่น การแจ้งเตือนเตะบอล, สรุปยอดค่าสนาม, แจ้งเตือนสลิป
- **ระบบ Flex Message UI**: แสดงผลสวยงามผ่าน LINE Flex Carousel, Bubble และการ Generate ภาพกราฟิกผังผู้เล่น
- **ระบบเว็บแดชบอร์ดและการแข่งขัน (Web Dashboard & Match Manager - `/web/match`)**: บันทึกผลการแข่งขันแบบอินเตอร์แอคทีฟ (Interactive Pitch View), เพิ่มประตู/แอสซิสต์, ยืมตัวผู้เล่นข้ามทีม, คุมวงจรสถานะแมตช์ (LIVE / รอแข่ง / จบแมตช์)
- **ระบบผู้ชมแบบเรียลไทม์ (Read-Only Match Viewer - `/web/view`)**: หน้าแสดงผลสนามฟุตบอลและผลการแข่งขันแบบอ่านอย่างเดียว สำหรับสมาชิกในกลุ่มและผู้ชมทั่วไป
- **ระบบวางแผนยุทธวิธี (Tactical Position Manager - `/web/position`)**: จัดวางและสลับตัวผู้เล่นข้ามทีมบนผังสนามแนวนอน รองรับทั้ง Drag & Drop, แตะ/กดค้าง (Touch Long-press 380ms), 1-Click Action Modal และ Interactive Swap Mode รองรับทั้งสิทธิ์ `admin` และ `root` พร้อมตรวจสอบโควตาตำแหน่ง (`pos_tbl`)
- **ระบบยืนยันตัวตนและการเข้าถึง (Authentication & RBAC)**: รองรับสิทธิ์ `admin` และ `root` ผ่านระบบ Bcrypt Password และ Signed HMAC-SHA256 Token

---

## 2. Tech Stack & Dependencies

- **Runtime & Framework**: Node.js (v18+), Express.js (`^5.1.0`)
- **LINE SDK**: `@line/bot-sdk` (`^9.9.0`)
- **Database**: MySQL (`mysql2` connection pool แบบรวมศูนย์)
- **Web Dashboard & Authentication**:
  - `bcryptjs` (`^3.0.3`): แฮชรหัสผ่านความปลอดภัยสูง
  - `cookie-parser` (`^1.4.7`): จัดการ Cookie Token (`soccer_auth`)
  - `cors` (`^2.8.6`): ควบคุม Cross-Origin Resource Sharing
  - `multer` (`^2.4.0`): จัดการ Multipart Form Data (`upload.none()`)
  - `winston` (`^3.19.0`): ระบบบันทึก Log สำหรับ API
  - Frontend: Vue.js 2 (CDN), Axios, Vanilla CSS3 (Flexbox/Grid), Server-Side Includes (`.shtml`)
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
├── index.js                    # จุดเริ่มต้น Express server รวมทั้ง Bot Webhook และ Web Dashboard
├── server.js                   # Entry point launcher เสริม (Backward compatibility รัน index.js)
├── cmd.js                      # Parser คำสั่ง Bot ทั้งหมด (Slash commands / Text commands)
├── query.js                    # รวมคำสั่ง SQL Database Queries (MySQL2 Pool รวมศูนย์)
├── flex.js                     # ตัวสร้าง LINE Flex Message Templates (JSON structure)
├── lineClient.js               # Initializer LINE Bot Client และ Helper ฟังก์ชันส่งข้อความ
├── slip.js                     # ตรรกะการตรวจสอบสลิปเงินและถอดรหัส QR Code จากสลิป
├── qr_gen.js                   # การสร้างภาพ QR Code PromptPay สำหรับเรียกเก็บเงิน
├── team_img.js                 # ระบบสร้างภาพกราฟิกทีม/ผังนักเตะ
├── schedule.json               # ค่าคอนฟิกตารางเวลา/เทมเพลตงาน
├── schema_user.sql             # โครงสร้างตารางผู้ใช้งานระบบ Web Dashboard (`user_tbl`)
├── randomteam_flowchart.md     # Flowchart อธิบายอัลกอริทึมการสุ่มทีม
│
├── routes/                     # ตัวจัดการเส้นทาง API และเว็บ
│   └── web.js                  # รวม API & Web Dashboard Endpoints (Match, View, Position, Auth)
│
├── public/                     # ไฟล์ส่วนแสดงผล Frontend (Web Dashboard)
│   ├── login.shtml             # หน้าล็อกอินเข้าสู่ระบบ
│   ├── match.shtml / update.shtml # หน้าบันทึกผลการแข่งขันและผังสนามบอล (Admin/Root)
│   ├── position.shtml          # หน้าจัดตำแหน่งผู้เล่นเชิงยุทธวิธี (Tactical Pitch สำหรับ Root)
│   ├── view.shtml              # หน้าแสดงผลการแข่งขันแบบอ่านอย่างเดียว
│   └── style.css               # สไตล์ชีทส่วนกลาง (Pitch, Theme, Player Cards)
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
│   ├── match_stat_schedule.sql
│   ├── member_ny_week_tbl.sql
│   ├── scheduled_task_tbl.sql
│   └── schema_user.sql
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
กระบวนการทำงานมี 6 เฟสหลัก:
1. **เตรียมข้อมูล**: ดึงผู้เล่นประจำสัปดาห์ (`week_tbl`, `member_team_week_tbl`), **คัดแยกผู้รักษาประตู (`member_tbl.team_id = 100`) ออกจากการสุ่มทีมทั้งหมด** และตั้งค่า `team_id = 0`, จำกัดผู้เล่นในสนาม (Outfield) ตาม `maxweek` (`week_tbl.max` เช่น 24 คน) แบบ FIFO เคร่งครัด (ไม่ขยายเป็น 32 คน), ผู้เล่นที่เกินโควตาจะถูกตัดเป็นสำรองทั้งหมด (Reserve `team_id = 0`), ดึงเรตติ้งย้อนหลัง (`member_year_stat_tbl`), ตรวจสอบ Avoid Map (คนที่ไม่อยากอยู่ทีมเดียวกัน)
2. **Phase 0 (Lock Pre-assigned Members)**: ผู้เล่นที่มีทีมอยู่แล้ว (`team_id > 0`) จะถูกล็อกให้อยู่ทีมเดิมทันที ไม่มีการสุ่มเปลี่ยนทีม และคำนวณหักลบ Capacity ของทีมนั้นๆ
3. **Phase 1 (Bound Groups)**: ผู้เล่นที่ถูกล็อกกลุ่ม (`week_team > 0`) ให้อยู่ทีมเดียวกันก่อน
4. **Phase 2 (Priority 1)**: กระจายผู้เล่นคีย์แมน/ระดับสูงตามตำแหน่ง (DF, DW, DM, MF, AM, CF โดยไม่เลือกตำแหน่งโกล์ เพื่อให้สลับกันเล่น)
5. **Phase 3 (Avoid Players)**: กระจายผู้เล่นที่มีข้อกำหนด Avoid ไม่ให้ชนกัน
6. **Phase 4 & 5 (Remaining & Fallback)**: กระจายผู้เล่นที่เหลือตามโควตาและบาลานซ์เรตติ้งรวมของทีม

### 4.3 ระบบสลิปและการเงิน (`slip.js`, `qr_gen.js`, `query.js`)
- รองรับการสร้าง PromptPay QR Code ตามยอดเงิน (`thai-qr-payment`)
- เมื่อสมาชิกส่งรูปสลิปเข้ากลุ่ม:
  - ดึง Image Stream จาก LINE Content API
  - ประมวลผลภาพด้วย `jimp` และถอดรหัส QR ผ่าน `zxing-wasm` (ถ้าล้มเหลวจะ fallback ไป `jsqr` / `zbarimg`)
  - ตรวจสอบความถูกต้องของสลิปผ่าน EasySlip API v2 (`verifyEasySlipByPayload`)
  - **กรณีติดต่อ API หรือตรวจสอบสลิปไม่สำเร็จ (`!slipData`)**:
    - ไม่แสดงข้อความแจ้งเตือนข้อผิดพลาดหรือคำเตือนตรวจสอบซ้ำ
    - ตอบกลับสั้นๆ เพียงยืนยันว่าได้รับสลิปแล้ว: `🙏 {ชื่อสมาชิก} ได้รับสลิปโอนแล้ว` (หากเป็นสลิปซ้ำจะระบุ `** สลิปนี้เคยส่งเข้ามาแล้ว **`)
    - บันทึกลงฐานข้อมูลสถานะ `logStatus = 'noticed'` และอัปเดตสถานะชำระเงินของสัปดาห์ให้สมาชิกตามปกติ
  - **กรณีติดต่อ API สำเร็จและได้ข้อมูล (`slipData`)**:
    - แสดงข้อมูลรายละเอียด ยอดเงิน, ผู้โอน, ธนาคาร, ผู้รับโอน และวันที่โอนครบถ้วน
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

### 4.6 ระบบจัดตารางแข่งและ Match Lifecycle (`/schedule`, `/now`, `/live`)
- **ฐานข้อมูลเป็น Single Source of Truth (MySQL `match_stat_tbl` 100%)**:
  - เมื่อรันคำสั่ง `/schedule` ระบบจะตรวจสอบข้อมูลจาก `match_stat_tbl` โดยตรงผ่านฟังก์ชัน `getScheduleFromDb(week_id)`
  - **Dynamic Schedule Invalidation & Team Sync (`maxweek`, `time_range`)**: 
    - ฟังก์ชัน `getScheduleFromDb` ตรวจสอบจำนวนทีมที่ลงเล่นจริงในแมตช์ (`playingTeamCount`) เทียบกับจำนวนทีมที่ต้องการ (`desiredTeamCount` ซึ่งคำนวณจาก `maxweek` หรือจำนวนผู้ลงทะเบียน) หากจำนวนทีมไม่ตรงกัน, จำนวนแมตช์ไม่ครบรอบ Round-Robin, หรือเวลาเริ่มต้น (`startTime`) ไม่ตรงกับ `time_range` ที่ตั้งไว้ และยังไม่มีการแข่งขันจริง (`hasPlayedMatches = false`) ระบบจะ Invalidate ตารางเดิมและทำการ Generate ตารางใหม่ให้สอดคล้องกับ `maxweek` ทันที
    - คำสั่ง `/setmaxweek` และ `/weektime` จะทำการล้างแมตช์ที่รอแข่ง (`status = 'scheduled'`) ใน `match_stat_tbl` โดยอัตโนมัติหากมีการเปลี่ยนจำนวนทีมหรือเวลา เพื่อให้ตารางแข่งขันอัปเดตตรงตามการตั้งค่าใหม่เสมอ
  - หากยังไม่มีตารางแข่งขัน (หรือสั่ง `/schedule reset` / `force`) ระบบจะคำนวณผัง Round-Robin พร้อมเวลาเริ่ม-สิ้นสุด และทำการบันทึกแมตช์ลงในตาราง `match_stat_tbl` โดยตรง (`saveScheduleToDb`)
  - คำสั่ง `/now` และ `/live` (`getCurrentMatch`) ดึงข้อมูลตารางและสถานะการแข่งขันจาก `match_stat_tbl` JOIN กับ `team_color_week_tbl` และ `week_tbl` โดยตรง ไม่จำเป็นต้องพึ่งพาไฟล์ `schedule.json` อีกต่อไป
  - โครงสร้างคอลัมน์รองรับ: `round` (รอบที่), `start_time` (เวลาเริ่ม), `end_time` (เวลาจบ), `status` (`scheduled`, `in_progress`, `finished`), `team_a_goal`, `team_b_goal` (รองรับ NULL สำหรับแมตช์ที่รอแข่ง)
  - รองรับการป้องกันการเขียนทับผลการแข่งขันของแมตช์ที่แข่งเสร็จแล้ว เว้นแต่จะระบุคำสั่ง reset/force
- **วงจรสถานะแมตช์ (Match Lifecycle State Machine)**:
  - `scheduled`: รอเริ่มแข่ง (แสดง `vs` และระบุหัวข้อ "แมตช์ถัดไป (รอเริ่ม)" ใน `/now` โดยไม่คิดผล 0-0 ในตารางสถิติ)
  - `in_progress`: กำลังแข่งขัน (บันทึกสกอร์ปัจจุบัน โดยหน้าเว็บจะตัดป้าย "LIVE" ออกเพื่อความเรียบร้อย สบายตา ไม่เกะกะ UI)
  - `finished`: จบการแข่งขันแล้ว (บันทึกสกอร์จริงและผู้ยิง/แอสซิสต์ พร้อมป้าย `FT`)
  - **หมายเหตุ**: 
    - ฟังก์ชัน `getLastMatchWeek()` จะไม่ทำการ auto-update สถานะแมตช์ที่ 1 เป็น `in_progress` ล่วงหน้าก่อนเวลาแข่งขันจริงใน HTTP GET request เพื่อให้สถานะในฐานข้อมูลสะท้อนความเป็นจริงเสมอ
    - การจัดการแมตช์ในสัปดาห์ที่จบไปแล้ว (`isWeekEnded = true`): รองรับการสร้างแมตช์เพิ่มย้อนหลังได้เสมอผ่านปุ่ม `➕ สร้าง Match` และปลดล็อกให้สามารถกดปุ่ม "↩️ แข่งต่อ" (Reopen Match) ได้เพื่อความยืดหยุ่นในการบันทึกหรือแข่งขันรอบพิเศษ
    - หน้าระบบจดสกอร์ (`isManager = true`): ทำการซ่อนการ์ดสรุปทีม (`team-summary-card`) ออกทั้งหมด เพื่อไม่ให้รกหรือบดบังพื้นที่ทำงานของกรรมการ โดยยังคงแสดงการ์ดสรุปทีมให้ผู้ชมเห็นตามปกติในหน้า Viewer (`!isManager`)
    - ปิดการ Auto-Scroll ทั้งหมดในหน้าจดสกอร์ (`isManager = true`): เมื่อกดจบแมตช์, สัญญาณ WebSocket แมตช์จบ, หรือเปิดฟอร์มคลาสสิก หน้าจอจะไม่เลื่อนหนีตำแหน่งเดิม ช่วยให้กรรมการบันทึกผลได้อย่างนิ่งสนิทและต่อเนื่อง โดยระบบเลื่อนตามแมตช์อัตโนมัติ (`scrollToCurrentMatch`) จะทำงานเฉพาะหน้าผู้ชม (`!isManager`) เท่านั้น
    - รวมการสลับผังสนามเข้ากับป้ายชื่อทีมบน Scoreboard โดยตรง (คลิกป้ายทีมเพื่อดูผังเดี่ยว, คลิกซ้ำ/คลิกผลบอลเพื่อกลับสู่สนามคู่) และตัดแถบแท็บเลือกทีม `pitch-view-selector-bar` ออกทั้งหมด เพื่อลดความซ้ำซ้อนสูงสุดและเริ่มต้นด้วยสนามคู่หากไม่ได้เลือก
- **การเลื่อน Cursor นัดถัดไปอัตโนมัติ (`getCurrentMatch`)**:
  - เมื่อกรรมการ/หน้าเว็บบันทึกผลจบแมตช์ $N$ (`status = 'finished'`) ระบบจะเลื่อน Current Match ไปยังแมตช์ $N+1$ ที่มีสถานะ `scheduled` (หรือแมตช์ที่ยังไม่จบ) ทันที เพื่อแจ้งเตือนคู่ถัดไปให้เตรียมตัวลงสนาม
  - ในหน้าดูผลสกอร์ (`/webhook/view`): กรอบไฮไลท์แมตช์ปัจจุบัน (`currentLiveMatch` และ `is-current-match-card`) จะสลับไปยังแมตช์ถัดไปทันทีที่มีการจบแมตช์ ไม่ว่าจะเป็นสัปดาห์ปัจจุบันหรือสัปดาห์ย้อนหลัง โดยปลดเงื่อนไขเวลาสัปดาห์ออก และป้องกันไม่ให้กรอบไฮไลท์ค้างอยู่ที่แมตช์เดิมที่จบไปแล้ว
  - ในหน้าจดผล (`/webhook/match`): เมื่อกดยืนยันจบแมตช์ (`finishCurrentMatch`) ตัวเลือกบน Scoreboard (`selectedMatchIndex` และ `update-match-select`) จะทำการสลับไปยังแมตช์ถัดไปให้อัตโนมัติทันทีผ่าน `selectMatch(nextMatchNum)` พร้อมอัปเดตคู่ทีมและผังสนาม (เว้นแต่เป็นแมตช์สุดท้าย จะคงอยู่ที่แมตช์นั้นและแสดงสถานะ FT พร้อมปุ่ม "↩️ แข่งต่อ") โดยคงระบบล็อกแมตช์ในอนาคตล่วงหน้า (`isMatchLocked = true`) ไว้ตามปกติ และปลดล็อกเฉพาะแมตช์ถัดไปแบบ Progressive เมื่อแมตช์ก่อนหน้าแข่งจบลงจริงเท่านั้น
  - หากกำลังมีแมตช์ที่แข่งอยู่ (`status = 'in_progress'`) บอทจะล็อกไปที่แมตช์นั้นเป็น Current Match แบบ Realtime
- **การแยกคำนวณสถิติและการเรียงลำดับตารางคะแนน**:
  - ฟังก์ชันคำนวณ Clean Sheet, Goals Against (GA) และสรุปผลงาน (`getMatchWeek`) จะกรองเฉพาะแมตช์ที่เตะแล้วเท่านั้น (`status = 'finished'` หรือ `'in_progress'`)
  - ตารางคะแนนประจำสัปดาห์ (`queryWeekTable` ใน `routes/web.js` และ `queryTableWeek` ใน `query.js`) เรียงลำดับตาม **`PTS` (คะแนน) ➔ `GD` (ผลต่างประตูได้-เสีย `G - A`) ➔ `G` (ประตูได้) ➔ `W` (จำนวนนัดที่ชนะ)** และแสดงผลคอลัมน์ในลำดับ `Team | W | D | L | GD | PTS` (โดย `PTS` อยู่ขวาสุด และแสดง `GD` แทน `G`, `A`)

### 4.7 ระบบป้องกันการเปิดเผยรายชื่อทีมล่วงหน้า (Team Roster Leak Protection / Friday 20:00 Cutoff)
- **วัตถุประสงค์**: เพื่อป้องกันผู้ดูแลระบบ (Admin) หรือสมาชิกแอบดูรายชื่อทีมและผู้เล่นที่อาจถูกสุ่มไว้ล่วงหน้าก่อนเวลาประกาศจริง
- **เงื่อนไขการล็อก (Lock Conditions)**:
  1. สัปดาห์เป้าหมายเป็น **สัปดาห์ปัจจุบัน** (Week ล่าสุดใน `week_tbl`) เท่านั้น สำหรับสัปดาห์ในอดีตจะสามารถดูข้อมูลได้เสมอ
  2. เวลาปัจจุบันในประเทศไทย (Asia/Bangkok) **ยังไม่เกิน 20:00:00 น. ของวันศุกร์** ในสัปดาห์แข่งขันนั้น
  3. ผู้ใช้ **ไม่ได้เข้าสู่ระบบด้วยสิทธิ์ Root** (สิทธิ์ `admin` และผู้เข้าชมทั่วไป `guest` จะถูกล็อกไม่ให้เห็นรายชื่อทีมและไม่สามารถเข้าหน้า `/web/position` ล่วงหน้าได้ จนกว่าจะพ้นเวลาวันศุกร์ 20:00 น. ในขณะที่สิทธิ์ `root` ได้รับการยกเว้นให้เข้าถึงและจัดวางแท็กติกล่วงหน้าได้ตลอดเวลา)
- **การป้องกันระดับข้อมูล (Backend Data Sanitization)**:
  - ฟังก์ชัน `getLastMatchWeek()` ตรวจสอบผ่าน `isWeekRosterLocked()` และส่งสถานะ `is_roster_locked: true`
  - ทำการ Sanitization ข้อมูลผู้เล่นใน `allmembers`: ปรับค่า `team_id = 0` และ `color = null` ทั้งหมด ทำให้ไม่สามารถตรวจสอบผ่าน Network Request หรือ API Payload ได้
  - API `get_team_members` ตรวจสอบผ่าน `isMatchRosterLocked()` และส่งคืน `[]` ว่าง
- **การแสดงผลฝั่งหน้าเว็บ (Frontend UI)**:
  - ใน `update.shtml`: เมื่อพบ `info.is_roster_locked === true` จะแสดงกล่องแจ้งเตือน "🎲 ระบบจะทำการสุ่มทีมวันศุกร์ เวลา 20:00 น." (แจ้งเวลาสุ่มทีมอย่างชัดเจน ไม่ใช้คำว่าเปิดเผยรายชื่อ เพื่อไม่ให้เข้าใจผิดว่าสุ่มไว้แล้ว)
  - ซ่อนผังสนาม (Pitch Field), แถบเลือกทีม (Team Selector Tabs), คลังยืมตัว (Loan Pool) และเครื่องมือบันทึกแมตช์
  - เมื่อถึงเวลา 20:00 น. ของวันศุกร์ ระบบจะปลดล็อกและแสดงผลรายชื่อทีมพร้อมผังสนามโดยอัตโนมัติ

---

### 4.8 ระบบจัดการทีมและตำแหน่งทางยุทธวิธี (Tactical Position & Team Manager)
- **การเข้าถึงและสิทธิ์การใช้งาน (RBAC)**:
  - สิทธิ์ `root`: สามารถเข้าใช้งานหน้า Position Manager และแก้ไขตำแหน่งได้ตลอดเวลา (รวมทั้งเข้าล่วงหน้าก่อนวันศุกร์ 20:00 น.)
  - สิทธิ์ `admin`: สามารถเข้าใช้งานและแก้ไขตำแหน่งได้ **เฉพาะหลังวันศุกร์ 20:00 น. เป็นต้นไป** (ไม่สามารถเข้าล่วงหน้าได้) โดยระบบจะตรวจสอบสถานะล็อกตามสัปดาห์ที่กำลังเปิดใช้งาน (`reqWeek`) ไม่ล็อกตายตัวที่สัปดาห์ล่าสุดในอนาคต หากเข้าใช้งานโดยไม่ระบุสัปดาห์และสัปดาห์ล่าสุดในอนาคตยังติดล็อก ระบบจะพา Admin ไปยังสัปดาห์ล่าสุดที่ปลดล็อกแล้วให้อัตโนมัติ (`getLatestUnlockedWeek`)
  - แถบ Navbar แสดงแท็บ `🛡️ จัดทีม/ตำแหน่ง` สำหรับ `root` เสมอ และจะแสดงให้ `admin` เห็นเฉพาะเมื่อพ้นเวลาตัดรอบวันศุกร์ 20:00 น. (`!info.is_roster_locked`) ของสัปดาห์ที่เปิดดู
  - **การอ้างอิงสัปดาห์ที่แม่นยำ (`queryWeekId`)**: ค้นหาด้วย Primary Key `WHERE id = ${num}` ก่อนเสมอ เพื่อป้องกันปัญหา ID ชนกับหมายเลขสัปดาห์ `number` ซึ่งเดิมทำให้การเลือกสัปดาห์ในอดีตกระโดดกลับไปสัปดาห์ล่าสุดตลอดเวลา
- **กลไกการเปลี่ยนตำแหน่งและสลับตัวผู้เล่น (Multi-input UX)**:
  - **HTML5 Drag & Drop**: ลากการ์ดผู้เล่นไปวางลงบนช่องตำแหน่ง (Slot), ม้านั่งสำรอง (Bench), กล่องผู้เล่นไม่มีทีม (Unassigned), หรือลากทับผู้เล่นคนอื่นเพื่อสลับตัว (Swap)
  - **Horizontal Pitch Scroll Containment & Mobile Responsive Layout**: ห่อหุ้มผังสนามแบบ Landscape Formation ด้วย `.tactical-pitch-scroll-wrapper` (`overflow-x: auto`, `overscroll-behavior-x: contain`) โดยไม่บล็อกการเลื่อนแนวตั้ง (`overflow-y`) ทำให้บนมือถือสามารถเลื่อนดูผู้เล่นตั้งแต่ GK ไปจนถึง CF ได้เฉพาะภายในกรอบสนามอย่างลื่นไหล และเลื่อนหน้าจอขึ้น-ลงได้ตามปกติ พร้อมจัดเรียงชิปโควตาทั้ง 7 ตำแหน่ง (`GK`, `DF`, `DW`, `DM`, `MF`, `AM`, `CF`) ด้วย CSS Grid 7 คอลัมน์ในบรรทัดเดียว ซ่อนปุ่มควบคุมของจอคอมพิวเตอร์ และปรับขนาดไอคอนบนมือถือให้กะทัดรัดพอดีจอ
  - **Touch Long-Press & Tap Support**: แตะหรือกดค้าง (380ms) บนการ์ดผู้เล่นเพื่อเปิด **Player Action Modal** ทันที ไม่ต้องลากนิ้วข้ามจอ
  - **1-Click Position Switcher**: เปลี่ยนตำแหน่งระหว่าง GK, DF, DW, DM, MF, AM, CF หรือม้านั่งสำรองได้ในคลิกเดียว
  - **1-Click Team Transfer**: ย้ายทีมหรือปลดออกจากทีมได้ทันทีพร้อมอัปเดตสีและจำนวนผู้เล่นในทีม
  - **Interactive Swap Mode (โหมดสลับตัว)**: กดปุ่มสลับตัว แล้วแตะที่ผู้เล่นเป้าหมายหรือช่องว่างในสนามเพื่อทำการสลับตัวทันที สะดวกสำหรับอุปกรณ์มือถือและแท็บเล็ต
  - **Slot Picker Modal**: แตะที่ช่องตำแหน่งว่างในสนามเพื่อเปิดหน้าต่างเลือกผู้เล่นจากม้านั่งสำรองหรือผู้เล่นว่างเข้ามาลงเล่นได้ทันที
  - **Batch Update & Unsaved Protection**: บันทึกการเปลี่ยนแปลงแบบกลุ่มผ่าน API `/batch_update_positions` พร้อมปุ่มบันทึกและปุ่มรีเซ็ตคืนค่าเดิม

---

## 5. กฎระเบียบและข้อกำหนดการพัฒนา (Development Rules)

> [!IMPORTANT]
> **ข้อตกลงในการพัฒนาและจัดการโค้ด:**
> 1. **บันทึกทุกสิ่งที่แก้ไข**: ทุกครั้งที่มีการสร้าง แก้ไข หรือปรับปรุงระบบ ต้องบันทึกรายละเอียดลงใน [`PROJECT_KNOWLEDGE.md`](file:///c:/Sites/github/line-webhook/PROJECT_KNOWLEDGE.md) และ [`CHANGELOG.md`](file:///c:/Sites/github/line-webhook/CHANGELOG.md) เสมอ
> 2. **การบันทึกและอัปเดต Git**: เมื่อทำการแก้ไขเสร็จสิ้นในแต่ละรอบ ให้บันทึกการเปลี่ยนแปลงและ commit + push ขึ้น Git เสมอตามคำสั่งของผู้ใช้
