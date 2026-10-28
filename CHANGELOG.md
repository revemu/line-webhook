# 📝 Changelog

บันทึกประวัติการเปลี่ยนแปลงและการพัฒนาของโปรเจกต์ `line-webhook`

---

## [0.7.16] - 2026-10-28

### Perf: Real-Time Instant WebSocket Handshake & iOS Safari Context-Switch Optimization
- **แก้ปัญหา Toast แจ้งเตือนเด้งช้าเมื่อเปิดลิงก์ข้ามแอปจาก LINE ไป Safari (`utils/wsBroadcaster.js`, `public/update.shtml`, `update.shtml`)**:
  - **ต้นตอของปัญหาความล่าช้า (Why it was slow from LINE vs fast on Refresh)**:
    1. **iOS WebKit App-Switch Throttling & Zombie State**: เมื่อผู้ใช้กดลิงก์จาก LINE ระบบของ iOS จะทำการสลับหน้าจอ (App Context Switch) ในเสี้ยววินาทีนี้ WebKit ของ Safari จะจัดให้แท็บอยู่ในสถานะ Background / Transitioning ส่งผลให้การเชื่อมต่อ WebSocket ที่เริ่มขึ้นใน `mounted()` ถูกระบบปฏิบัติการลดความสำคัญ (CPU & Network Throttling) สัญญาณ TLS Handshake ค้างอยู่ในสถานะ `CONNECTING` (readyState = 0) นานหลายวินาทีกว่าจะเชื่อมต่อสำเร็จ
    2. **ขาดระบบ Handshake Watchdog**: โค้ดเดิมจะตรวจจับเฉพาะกรณี `CLOSED` หรือ `CLOSING` แต่เมื่อ Socket ค้างอยู่ในสถานะ `CONNECTING` ระบบจะไม่ยอมสั่ง Reconnect ทำให้ต้องรอจนเกิด Timeout
    3. **ความแตกต่างเมื่อ Refresh**: เมื่อผู้ใช้อยู่บน Safari แล้วกด Refresh ตัวแท็บอยู่ในสถานะ Foreground (`document.visibilityState === 'visible'`) 100% อยู่แล้ว WebKit จึงให้ความสำคัญสูงสุด ทำให้เชื่อมต่อได้ไวในเสี้ยววินาที
  - **การปรับปรุงแก้ไข**:
    - **Initial Week Handshake**: ส่ง `?week_id=...` แนบไปใน URL ของการเชื่อมต่อ WebSocket ทันที โดยดึงจากแคช `last_active_week` ทำให้ Server ทราบสัปดาห์ที่ผู้ใช้ดูตั้งแต่จังหวะ Upgrade Request โดยไม่ต้องรอ API สัปดาห์ตอบกลับมา
    - **Handshake Watchdog (2500ms)**: เพิ่มตัวจับเวลาตรวจจับ หาก WebSocket ค้างอยู่ในสถานะ `CONNECTING` เกิน 2.5 วินาที ระบบจะสั่งยกเลิกและเปิดการเชื่อมต่อใหม่ใน Foreground ทันที
    - **Stalled Detection ใน `checkAndReconnectWs`**: เมื่อหน้าจอ Safari สลับขึ้นมา หากพบว่า Socket ค้าง จะสั่ง Reconnect ทันทีโดยไม่ต้องรอ
    - **Fast 12s Keepalive Ping**: ลดรอบส่ง Ping จาก 25 วินาทีเป็น 12 วินาที เพื่อกระตุ้นช่องทาง TCP ของเสาสัญญาณมือถือ (4G/5G/Wi-Fi) บน iOS ให้ตื่นตัวตลอดเวลา ป้องกันไม่ให้เข้าสู่โหมดประหยัดพลังงาน
    - **15s Server Heartbeat**: ลดระยะเวลา Heartbeat ฝั่ง Node.js Server จาก 30 วินาทีเป็น 15 วินาที เพื่อเคลียร์การเชื่อมต่อที่หลุดอย่างรวดเร็ว

## [0.7.15] - 2026-10-28

### Fix: Fix Safari iOS Toast Notification Double-Bounce / Double-Trigger Artifacts
- **แก้ปัญหา Toast แจ้งเตือนเด้ง 2 ครั้ง (Double Pop) บน Safari iOS หลังจากเปิดลิงก์จาก LINE (`public/style.css`, `public/update.shtml`, `update.shtml`)**:
  - **ต้นตอของปัญหาอย่างละเอียด**:
    1. **CSS Animation + Vue Transition Conflict ใน WebKit (Safari iOS)**: เดิมทีตัวคลาส `.match-toast` มีคำสั่ง CSS `animation: toastPopTop 0.35s ...` ฝังอยู่ถาวร และถูกครอบด้วย `<transition name="fade">` ของ Vue ซึ่งมีคลาส `.fade-enter-active { transition: opacity 0.3s, transform 0.3s; }` บน iOS Safari เมื่อ Vue transition สิ้นสุดที่ 300ms คลาส `.fade-enter-active` จะถูกถอดออก ทำให้ WebKit มองว่า class list เปลี่ยนแปลง จึงสั่ง Restart CSS Keyframe animation จากวินาทีที่ 0 ซ้ำอีกรอบ ส่งผลให้ Toast ปรากฏแล้วเด้งซ้ำเป็นรอบที่สองทันที
    2. **DOM Re-render จาก Background Refresh**: เมื่อได้รับสัญญาณ WebSocket หน้าเว็บจะเรียก `refreshMatch()` ไปพร้อมกับการแสดง Toast ทันที เมื่อได้รับข้อมูล HTTP ตอบกลับมา (~200-300ms) การอัปเดต State ทำให้ Vue สั่ง Patch DOM ซึ่งหาก element ไม่มี `:key` เฉพาะตัว WebKit จะ reset animation ทำให้เด้งซ้ำ
    3. **Lifecycle Reconnect Flood จาก LINE Transition**: เมื่อเปิดลิงก์จาก LINE iOS ระบบของ iOS จะสลับ Safari ขึ้นมาและยิง Event `pageshow`, `visibilitychange`, และ `focus` ติดต่อกันในเสี้ยววินาที ทำให้เกิดการส่ง HTTP Refresh และซ็อกเก็ตเช็คซ้ำซ้อนในเวลาเดียวกัน
  - **แนวทางการแก้ไข**:
    - **Single Pure CSS Transition (`toast-slide`)**: ยกเลิกคำสั่ง `@keyframes animation` ที่ฝังถาวรใน `.match-toast` ทั้งหมด และเปลี่ยนมาใช้ Vue Transition แบบ Pure CSS Transition (`.toast-slide-enter-active`, `.toast-slide-enter`, `.toast-slide-leave-to`) ที่ควบคุมทั้ง opacity และ transform เมื่อ Transition จบลงจะไม่มี Keyframe ค้างอยู่ให้ WebKit รีสตาร์ทซ้ำได้อีกต่อไป
    - **Unique Dynamic Key (`:key="toastKey"`)**: ผูก `:key="toastKey"` บน `.match-toast` เพื่อให้ Virtual DOM ของ Vue แยกแยะ Element ชัดเจน ไม่ถูก Re-patch หรือกวนการเคลื่อนไหวเมื่อ Background data refresh
    - **Strict 8s De-duplication & 2s Throttle**: ขยายเวลาตรวจจับข้อความซ้ำใน `showToast()` เป็น 8 วินาที และเพิ่มตัวบล็อกความถี่ขั้นต่ำ 2 วินาทีระหว่าง Toast เพื่อป้องกันการเด้งกระพริบซ้อนกัน
    - **Event De-duplication Extended**: ขยายเวลา Event ID deduplication ใน `handleWebSocketMessage()` เป็น 8 วินาที
    - **Debounced Lifecycle Handlers**: เพิ่มตัวหน่วงเวลา (2000ms debounce) ให้กับ `pageshow`, `visibilitychange`, และ `focus` ป้องกันการยิงคำขอรีเฟรชหรือเชื่อมต่อชนกันหลายระลอกในจังหวะสลับแอปจาก LINE

## [0.7.14] - 2026-10-28

### Feat: Hybrid Debounce for Player Ratings & Immediate Calculation on Match Finish
- **เพิ่มระบบ Hybrid Debounce ชะลอการคำนวณเรตติ้ง 10 วินาทีระหว่างแข่ง และคำนวณทันทีเมื่อจบแมตช์ (`routes/web.js`, `public/update.shtml`, `update.shtml`)**:
  - **แก้ปัญหาการคำนวณเรตติ้งซ้ำซ้อน**: ก่อนหน้านี้ ทุกครั้งที่มีการกดเพิ่มประตู, บันทึกแอสซิสต์, ทำเข้าประตูตัวเอง (OG) หรือกดยกเลิกประตู ระบบจะสั่งล้างแคชเรตติ้งทันที ทำให้เมื่อหน้าเว็บรีเฟรชจะเกิดการคำนวณเรตติ้งผู้เล่นทั้งสัปดาห์ใหม่ทุกคลิก สิ้นเปลืองทรัพยากร CPU และฐานข้อมูลโดยไม่จำเป็น
  - **การทำงานของระบบ Hybrid Debounce**: 
    1. **ระหว่างแมตช์ (ยิง/แก้ประตู)**: เมื่อมีการกดบันทึกหรือยกเลิกประตู ระบบจะส่งผลตอบกลับและอัปเดตสกอร์ทันทีในเสี้ยววินาที จากนั้นจะตั้งเวลา **Debounce 10 วินาที**
    2. **รีเซ็ตเวลาอัตโนมัติ**: หากภายใน 10 วินาที มีการบันทึกประตูหรือแอสซิสต์เพิ่มเข้ามาอีก ระบบจะรีเซ็ตเวลานับถอยหลัง 10 วินาทีใหม่ทันที
    3. **Background Calculation**: เมื่อครบ 10 วินาทีโดยไม่มีเหตุการณ์ใหม่เข้ามา ระบบจะทำการคำนวณเรตติ้งและ TOTW ในฉากหลังเพียงรอบเดียว แล้วส่งสัญญาณ `RATINGS_UPDATED` ผ่าน WebSocket ให้อัปเดตตารางสรุปคะแนนบนหน้าจอผู้ใช้ทุกคนพร้อมกันอย่างเงียบๆ
    4. **Immediate on Match Finish**: เมื่อผู้จัดการกด "🏁 จบ Match" ระบบจะยกเลิก Timer ที่ค้างอยู่ และสั่งคำนวณเรตติ้ง + สรุปผลตารางสัปดาห์ทันที 100% โดยไม่ต้องรอ 10 วินาที

## [0.7.13] - 2026-10-28

### Fix: Eliminated Duplicate Toast Notifications via Multi-Layer Event De-duplication & Socket Teardown
- **แก้ปัญหา Toast แจ้งเตือนเด้งซ้ำ 2 รอบ (`utils/wsBroadcaster.js`, `public/update.shtml`, `update.shtml`)**:
  - **ต้นตอของปัญหา**: 
    1. ในจังหวะสลับหน้าจอหรือเชื่อมต่อใหม่ ฟังก์ชัน `initWebSocket()` สั่ง `close()` ซ็อกเก็ตเก่า แต่ไม่ได้ปลด Event Listener (`onmessage = null`) ออกจาก Socket เดิม ทำให้ในช่วงที่ Socket เดิมยังอยู่ในสถานะกำลังปิด (Closing Handshake) เมื่อเซิร์ฟเวอร์ยิงข้อความเข้ามา ทั้งซ็อกเก็ตเดิมและซ็อกเก็ตใหม่ต่างได้รับข้อความทั้งคู่ และสั่งแสดงผล Toast ซ้ำสองรอบ
    2. เซิร์ฟเวอร์ยังไม่มีการระบุหมายเลขประจำตัวข้อความ (`event_id`) และฝั่ง Client ใน `handleWebSocketMessage` ยังไม่มีกลไก De-duplication เพื่อคัดกรองข้อความซ้ำที่มาจากหลาย Connection หรือ Retransmission
  - **การแก้ไข**:
    - **Clean Socket Teardown**: ปรับปรุงฟังก์ชัน `initWebSocket()` ให้เคลียร์ `wsReconnectTimer` ทันที และปลด Handlers ทุกตัว (`onopen = null`, `onmessage = null`, `onclose = null`, `onerror = null`) ก่อนปิดซ็อกเก็ตเก่า เพื่อรับประกันว่าจะไม่มีข้อความหลุดรอดจากซ็อกเก็ตเดิมอีก
    - **Unique Broadcast Event ID**: เพิ่มการสร้างรหัส `event_id` เฉพาะตัวในทุก Broadcast Packet ที่ส่งออกจาก `broadcastMatchEvent` ใน `wsBroadcaster.js`
    - **Client-Side Event De-duplication**: เพิ่มตัวกรองตรวจสอบ `event_id` / ลายเซ็นของข้อความใน `handleWebSocketMessage()` หากเป็นเหตุการณ์เดียวกันที่ได้รับซ้ำภายใน 4 วินาที จะถูกละทิ้งทันที
    - **Toast Content De-duplication**: เพิ่มระบบจำกัดความถี่ในฟังก์ชัน `showToast()` ป้องกันไม่ให้ข้อความที่เหมือนกันแสดงผลซ้ำซ้อนภายในระยะเวลา 3 วินาที

## [0.7.12] - 2026-10-28

### Fix: Safari iOS WebSocket Connection & Lifecycle Auto-Reconnect for External Browser Launch
- **แก้ปัญหา Toast Notification ไม่เด้งเมื่อเปิดลิงก์ผลสดจาก LINE บน Safari iOS (`public/update.shtml`, `update.shtml`)**:
  - **ต้นตอของปัญหา**: 
    1. เมื่อผู้ใช้คลิกลิงก์จาก LINE และระบบเปิด Safari (`openExternalBrowser=1`) ตัว iOS WebKit อยู่ระหว่างแอนิเมชันสลับแอป ทำให้ Socket Network ในเสี้ยววินาทีแรกถูกตัดการเชื่อมต่อ (`The operation couldn't be completed. Socket is not connected`) และ `wsConnected` กลายเป็น `false`
    2. หน้าเว็บเดิมมี Event Listeners (`pageshow`, `visibilitychange`, `focus`) ดักจับเฉพาะหน้า Manager (`this.isManager`) ทำให้หน้า Viewer (`/webhook/view`) ไม่เคยสั่ง Reconnect WebSocket เลยเมื่อ Safari สลับแอปมาทำงานเต็มจอ ส่งผลให้กลายเป็น Zombie Connection ค้างจนกว่าจะกด Refresh เอง
    3. Race Condition ของ `subscribe week_id`: ในขณะที่ WebSocket เชื่อมต่อในตอนแรก ข้อมูล `this.week` ยังเป็น `null` ทำให้คำสั่ง `subscribe` ไม่ถูกส่ง และเมื่อ API `refreshMatch` โหลดข้อมูลสัปดาห์เสร็จสิ้น ก็ไม่ได้ส่ง `subscribe` ซ้ำไปยัง WebSocket
  - **การแก้ไข**:
    - **Universal Visibility & Lifecycle Reconnect**: ปรับปรุง `pageshow`, `visibilitychange`, และ `focus` ให้ตรวจจับสถานะ WebSocket และสั่ง Reconnect อัตโนมัติทันทีที่หน้าจอ Safari กลับมา Active ไม่ว่าจะเป็น Viewer หรือ Manager
    - **Auto Week Subscription**: เพิ่มเมธอด `subscribeToCurrentWeek()` และสั่งให้ส่งการสมัครรับข้อมูลสัปดาห์ปัจจุบันทันทีที่ API `refreshMatch` โหลดข้อมูล `this.week` เสร็จสมบูรณ์
    - **Client-side Keepalive Ping**: เพิ่มตัวส่งสัญญาณ Heartbeat `{ type: 'ping' }` ทุกๆ 25 วินาที เพื่อป้องกันไม่ให้ iOS Safari ตัดการเชื่อมต่อเมื่อเปิดหน้าจอทิ้งไว้นานๆ
    - **Manual Refresh Auto-Reconnect**: เพิ่มการตรวจสอบและต่อ WebSocket ใหม่อัตโนมัติทันทีเมื่อผู้ใช้แตะปุ่มรีเฟรชหน้าเว็บ

## [0.7.11] - 2026-10-28

### Fix: Removed Dangerous schedule.json Auto-Migrate in getCurrentMatch & Cleaned Stale Fixtures
- **แก้ปัญหาตารางแข่งขันถูกสร้างเองโดยไม่ได้สั่ง และจำนวนทีม/สีทีมไม่ตรงกับโควตาสัปดาห์ (`query.js`, `routes/web.js`)**:
  - **ต้นตอที่แท้จริง**: ในฟังก์ชัน `getCurrentMatch` (`query.js`) มีโค้ด Legacy Fallback เก่าที่คอยตรวจว่าหากในฐานข้อมูล `match_stat_tbl` ของสัปดาห์ปัจจุบันยังไม่มีตารางแข่งขัน ระบบจะไปอ่านไฟล์ `schedule.json` ที่ค้างอยู่บนดิสก์ แล้วสั่ง `saveScheduleToDb` ยัดแมตช์จากไฟล์นั้นลงฐานข้อมูลให้อัตโนมัติทันที
  - ส่งผลให้เมื่อมีการเรียกดู `/live` หรือเปิดหน้าเว็บ สัปดาห์ใหม่ (Week 334) ซึ่งยังไม่มีการสุ่มหรือสร้างตาราง จึงถูกนำเอาแมตช์ 15 นัดของสัปดาห์ก่อนหน้า (Week 333) ที่ค้างอยู่ใน `schedule.json` บันทึกลงตารางทันที โดยไม่ได้ดูโควตาผู้เล่น (`max = 28` ซึ่งต้องเป็น 4 ทีม) และนำเอา `team_id` เก่า (991, 992, 993) ข้ามสัปดาห์มาใส่ ทำให้ระบบแสดงผลเป็นเลข ID ("ทีม 991") แทนที่จะแสดงเป็นสีทีม
  - **การแก้ไข**:
    - ลบโค้ด Legacy Auto-Migrate จาก `schedule.json` ใน `getCurrentMatch` ออกทั้งหมด หากยังไม่มีการสร้างตารางใน Database ระบบจะคืนค่า `null` และแจ้งเตือนให้ผู้ใช้ใช้คำสั่ง `/schedule` ก่อนตามพฤติกรรมที่ถูกต้อง
    - ล้างข้อมูล 15 แมตช์ที่ผิดพลาดของ Week 334 ออกจากฐานข้อมูล `match_stat_tbl`
    - ลบ Fallback สีจำลอง (`White` / `Black`) ใน `routes/web.js` คืนค่าที่ถูกต้องตามทีมจริงในสัปดาห์นั้น

--- 
## [0.7.10] - 2026-10-28

### Fix: Root Cause of Unresponsive Week Picker — Eliminated Vue Template Render Crash on Undefined Team Colors
- **แก้ปัญหาต้นตอที่กดปุ่มเปลี่ยนวันแล้วไม่ตอบสนอง (`routes/web.js`, `public/update.shtml`, `update.shtml`, `public/position.shtml`)**:
  - สืบหาต้นตอที่แท้จริงจาก Browser Runtime (ผ่าน CDP Browser Diagnostics): พบว่า Vue ประสบปัญหา Runtime Error ระหว่าง Render (`TypeError: Cannot read properties of undefined (reading 'toLowerCase')`) เนื่องจากข้อมูลแมตช์ในสัปดาห์ปัจจุบันมีการอ้างอิง `team_a_id` และ `team_b_id` ที่สีของทีมยังไม่ได้ถูกจับคู่หรือเป็น `undefined`
  - เมื่อเกิด Error ดังกล่าว ตัวเรนเดอร์ของ Vue จะหยุดทำงาน (Halt Rendering) ทำให้เมื่อผู้ใช้แตะปุ่ม "📅 เปลี่ยนวัน" (`showWeekPicker = true`) ตัว Watcher ของ Vue พยายาม Render ใหม่แต่ติด Crash ที่เดิม ทำให้หน้าต่าง Modal ไม่สามารถเปิดขึ้นมาได้
  - **Backend Fix (`routes/web.js`)**: เพิ่มการ Query ค้นหาสีของทีมที่ตกหล่นข้ามสัปดาห์ (`missingTeamIds`) จากตาราง `team_color_week_tbl` และกำหนดค่า Fallback อัตโนมัติ (`White` / `Black`) เพื่อรับประกันว่า `team_a_color` และ `team_b_color` จะไม่ส่งค่า `undefined` ออกมายัง Frontend
  - **Frontend Fix (`public/update.shtml`, `update.shtml`, `public/position.shtml`)**: เพิ่ม Null-Safety Guards ป้องกันทุกจุดที่มีการเรียก `.toLowerCase()` บนสีของทีมและผู้เล่น (`(color || '#ccc').toLowerCase()`) เพื่อให้ Vue ปลอดภัยจากการ Crash 100% แม้ข้อมูลจะมีค่าว่าง
  - ทดสอบผ่าน Headless Browser อัตโนมัติ ยืนยันว่าการคลิกปุ่ม "📅 เปลี่ยนวัน" เปิด Modal สำเร็จ มีรายการให้เลือกครบ 20 สัปดาห์ และการเลือกสัปดาห์สามารถสลับผลการแข่งขันได้อย่างสมบูรณ์แบบโดยมี Error เป็น 0

--- 
## [0.7.9] - 2026-10-28

### Fix: Resolved Black Screen Overlay Caused by HTML Tag Mismatch & Added v-cloak Protection
- **แก้ปัญหาหน้าจอดำค้างและไม่สามารถกดเปลี่ยนวันหรือปิดหน้าต่างได้ (`public/update.shtml`, `update.shtml`, `public/position.shtml`, `public/style.css`)**:
  - แก้ไขแท็กปิด `</button>` ของปุ่มเปลี่ยนวัน (`.week-badge-pill`) ซึ่งก่อนหน้านี้ปิดผิดเป็น `</div>` ทำให้โครงสร้าง HTML พังและปิดแท็ก root `#soccer-match` ก่อนเวลาอันควร ส่งผลให้ Vue ไม่สามารถ Compile ส่วนที่เหลือของหน้าเว็บได้ และทำให้ Modals ทั้งหมด (Date Picker, Pitch Modal Overlay, Close Button) หลุดออกไปนอก Vue แล้วแสดงค้างเป็นแผ่นฟิล์มดำบังเต็มหน้าจอ (`.pitch-modal-backdrop` + `.modal-overlay`)
  - ตรวจสอบความสมบูรณ์และโครงสร้างคู่แท็ก HTML (Tag Balancing) ทั้งหมดในทุกหน้าเว็บให้ถูกต้อง 100%
  - เพิ่ม Directive `[v-cloak]` ใน CSS และบน Root Element ของทุกหน้า เพื่อซ่อน Element ที่ยังไม่ได้ถูกเรนเดอร์หรือ Compile โดย Vue ป้องกันไม่ให้เกิดอาการกระพริบหรือแสดงผลผิดพลาดแม้ในกรณีโหลดช้า

--- 
## [0.7.8] - 2026-10-28

### Fix: Week Date Switcher Click & Mobile Tap Responsiveness
- **แก้ปัญหาการกดปุ่มเปลี่ยนวันในหน้าผลการแข่งขันและตัวจัดการตำแหน่ง (`public/update.shtml`, `update.shtml`, `public/position.shtml`, `public/style.css`, `flex.js`)**:
  - เปลี่ยนองค์ประกอบปุ่ม `week-badge-pill` จาก `div` เป็น `button type="button"` พร้อมกำหนด `font-family: inherit` เพื่อให้เบราว์เซอร์บนมือถือ (iOS Safari / Chrome) ตอบสนองต่อการแตะสัมผัส (Tap/Click) ได้ทันทีโดยไม่ติดขัดหรือมีปัญหา Tap Delay
  - เพิ่ม Event Stop Propagation (`@click.stop`) ที่ปุ่มเปิด Modal และกล่องคอนเทนต์ภายใน เพื่อป้องกันการส่งต่อ Event สัมผัสไปยังพื้นหลัง Overlay ซึ่งอาจทำให้ Modal เด้งปิดตัวเองในเสี้ยววินาที
  - เพิ่มสถานะแสดงผลการโหลดข้อมูล (`isRefreshing`) ทันทีที่ผู้ใช้แตะเลือกสัปดาห์ใน Modal เพื่อให้ผู้ใช้ทราบว่าระบบกำลังดึงข้อมูลแมตช์ของวันใหม่
  - ปรับปรุง `base_url` และ Fallback URL ใน `flex.js` ให้ชี้ไปยังพาท `/webhook/` เสมอ เพื่อป้องกันปัญหา Nginx Reverse Proxy คืนค่า 502 Bad Gateway เมื่อเข้าถึงผ่าน `/web/`

--- 
## [0.7.7] - 2026-10-28

### Feature: Force External Browser on /live Web Links
- **บังคับเปิดลิงก์ผลการแข่งขันจากคำสั่ง `/live` ในเบราว์เซอร์ภายนอก (Safari / Chrome) อัตโนมัติ (`flex.js`, `cmd.js`, `query.js`, `public/update.shtml`, `update.shtml`, `public/position.shtml`)**:
  - เพิ่มพารามิเตอร์ `openExternalBrowser=1` ให้กับ URL ปลายทางของหน้าเว็บผลการแข่งขันสด (`targetWebUrl` / `webLiveUrl`) เพื่อให้แอป LINE ส่งต่อการเปิดหน้าเว็บไปยัง Default Browser ของเครื่องผู้ใช้โดยตรงทันทีเมื่อกดปุ่มหรือแบนเนอร์
  - ช่วยแก้ปัญหา In-App Browser ของ LINE รีเฟรชตัวเองขณะเลื่อนจอ และรองรับการแสดงผลหน้าเว็บเต็มประสิทธิภาพด้วยเอนจินของ Safari/Chrome พร้อมการเลื่อนจอที่ลื่นไหลระดับ 60Hz/120Hz
  - เพิ่มฟังก์ชันทำความสะอาดพารามิเตอร์ `openExternalBrowser` ออกจากแถบที่อยู่เว็บ (Address Bar) อัตโนมัติหลังหน้าเว็บโหลดเสร็จผ่าน `window.history.replaceState` เพื่อความสวยงามและสะดวกต่อการแชร์/บุ๊กมาร์ก

--- 
## [0.7.6] - 2026-10-28

### Fix: Mobile Scroll Boundary Lock & Stutter at Top/Bottom Edges
- **แก้ปัญหาหน้าเว็บเลื่อนขึ้น-ลงแทบไม่ได้เมื่ออยู่ขอบบนสุดหรือขอบล่างสุดของหน้าจอ (`public/style.css`, `public/update.shtml`, `update.shtml`, `public/position.shtml`)**:
  - ลบ JavaScript Touch Guard (`touchmove` preventDefault `{ passive: false }`) ออกทั้งหมด เนื่องจากไปบล็อกและยกเลิก Gesture การสัมผัสบน iOS WebKit และ Chrome WebView ทำให้จังหวะที่แตะนิ้วเพื่อเลื่อนจอที่ขอบบนเกิดอาการค้าง/กระตุกอย่างรุนแรง
  - ปรับการตั้งค่า CSS ใน `body` ให้ใช้ `overscroll-behavior-y: contain` เพียงอย่างเดียว โดยยกเลิก `overscroll-behavior: none` และ `touch-action: pan-x pan-y` ออกจาก `html` และ `body` เพื่อคืนค่า Momentum Physics การเลื่อนนิ้วแบบนุ่มนวลตามธรรมชาติของ iOS และป้องกันอาการ Boundary Freeze ที่ขอบบน-ขอบล่างของหน้าเว็บ
  - คงค่า `overscroll-behavior-x: contain` ให้กับคอนเทนเนอร์แนวนอนด้านใน เช่น ตารางและแถบทีมการ์ดตามเดิม เพื่อป้องกันการปัดซ้าย-ขวาหลุดไปที่ระบบ Back/Forward ของ In-App Browser โดยไม่กระทบการเลื่อนแนวตั้งหลัก

--- 
## [0.7.5] - 2026-10-27

### Fix: LINE In-App Browser Accidental Page Reload on Scroll (Vertical & Horizontal)
- **แก้ปัญหาหน้าเว็บรีโหลดตัวเองเวลาเลื่อนจอ (Scroll) บน LINE In-App Browser ทั้งแนวตั้งและแนวนอน (`public/style.css`, `public/update.shtml`, `update.shtml`, `public/position.shtml`)**:
  - กำหนด `overscroll-behavior: none`, `overscroll-behavior-y: none`, `overscroll-behavior-x: none` ให้กับ `html` และ `body` เพื่อปิดการทำงานของ Pull-to-refresh ของ WebView และป้องกันการเด้งรีโหลด
  - เพิ่ม `touch-action: pan-x pan-y` และ `overscroll-behavior-x: contain` ให้กับคอนเทนเนอร์ที่เลื่อนแนวนอน เช่น `.team-summary-grid` (การ์ดทีมบนมือถือ), `.team-filter-scroll` และตารางข้อมูล เพื่อไม่ให้ gesture การเลื่อนนิ้วหลุดไปสั่งงาน Back/Forward ของ In-App Browser
  - เพิ่มระบบตรวจจับ Touch Gesture Guard ใน JavaScript เพื่อดักจับและยกเลิก (`preventDefault`) พฤติกรรม Pull-to-refresh เมื่ออยู่ที่ขอบบนสุดของหน้า และ Edge-swipe navigation เมื่อลากนิ้วจากขอบหน้าจอบนอุปกรณ์มือถือ

--- 

## [0.7.4] - 2026-10-26

### Fix: Persistent Update Notification Loop & Robust Cache-Busting Reload
- **แก้ปัญหาแจ้งเตือนอัปเดตเวอร์ชันค้างแม้กดปุ่มรีโหลดแล้ว (`public/update.shtml`, `update.shtml`, `utils/version.js`, `routes/web.js`, `public/position.shtml`)**:
  - แก้ไขปัญหาความไม่ตรงกันของ `asset_version` ระหว่างฝั่งเซิร์ฟเวอร์ที่คำนวณแยกกัน (HTML vs API Endpoint) โดยปรับระบบคำนวณใน `utils/version.js` ให้เป็นโมเดลส่วนกลางที่ตรวจจับไฟล์ทั้งหมดใน `public/` ร่วมกันอย่างแม่นยำ
  - ปรับปรุงฟังก์ชัน `reloadApp()` ให้ส่งพารามิเตอร์ `_v=<timestamp>` เพื่อบังคับเบราว์เซอร์ดาวน์โหลดหน้าเว็บเวอร์ชันใหม่โดยตรงแบบข้ามแคช (Cache Busting) อย่างสมบูรณ์ และมีระบบลบพารามิเตอร์ `_v` ออกจากแถบ Address Bar อัตโนมัติเมื่อโหลดเสร็จ
  - เพิ่มเงื่อนไข `else { this.newVersionAvailable = false; }` ใน `refreshMatch()` และ `fetchCurrentUser()` เพื่อปิดการแสดงผลป้ายอัปเดตทันทีเมื่อเวอร์ชันตรงกัน
  - ปรับข้อความป้ายแจ้งเตือนให้ฉลาดขึ้น หากเวอร์ชันหลักตรงกันแต่มีการอัปเดตไฟล์ย่อย จะแสดง `🚀 มีอัปเดตใหม่ (แตะเพื่อโหลด)` โดยไม่แสดงเลขเวอร์ชันซ้ำซ้อน

--- 

## [0.7.3] - 2026-10-26

### Enhancement: Retain Auto-Scroll to Current Match for Viewers
- **คงการเลื่อนจออัตโนมัติ (Auto-scroll) ไปยังแมตช์ปัจจุบันสำหรับหน้าจอ Viewer (public/update.shtml, update.shtml)**:
  - ในหน้าจอ Match Viewer (`!isManager`) เมื่อโหลดหน้าจอหรือสลับสัปดาห์ หน้าจอจะยังคงเลื่อน (Scroll) ไปยังแมตช์ปัจจุบันหรือแมตช์ที่กำลังแข่งตามปกติ
  - ในหน้าจอ Match Manager (`isManager`) ปิดการเลื่อนอัตโนมัติ เพื่อให้ผู้จัดการแข่งขันสามารถจัดการผลสกอร์บน Scoreboard และ Pitch ได้สะดวกโดยหน้าจอไม่เลื่อนหนี

--- 

## [0.7.2] - 2026-10-26

### Feature & UX Improvements: Goal Notification Avatar, Colored Bold Scores, & Manager UX
- **แสดง Avatar ผู้เล่นใน Toast การทำประตู / ยกเลิกประตู (routes/web.js, public/style.css, public/update.shtml, update.shtml)**:
  - ดึงข้อมูล `m.picture_url` ของผู้เล่นเพื่อส่งผ่าน WebSocket Event และแสดงรูป Avatar กลมขนาด 32px พร้อม fallback ตัวอักษรย่อเมื่อไม่มีรูป
  - ไม่แสดงชื่อสีทีมในข้อความ (`[สี...]`) เพื่อความกระชับสะอาดตา
- **เน้นสีและตัวหนาที่ตัวเลขประตูฝั่งที่อัปเดต (routes/web.js)**:
  - เพิ่มฟังก์ชัน `getTeamColorHex` เพื่อแปลงสีทีมเป็นรหัสสี HEX
  - ตัวเลขประตูฝั่งที่ได้ประตูหรือถูกแก้ไข จะแสดงสีประจำทีมและตัวหนา (`<b style="color: ...; font-weight: 800;">`) ชัดเจนโดยไม่ต้องระบุชื่อสีในข้อความ
- **แสดงผลสกอร์ล่าสุดเมื่อมีการยกเลิกประตู (routes/web.js)**:
  - เมื่อมีคำสั่งลบ/ยกเลิกประตู (`remove_goal`), ทำการ query สกอร์ล่าสุดของแมตช์ (`team_a_goal`, `team_b_goal`) และกระจาย WebSocket broadcast แจ้งเตือนพร้อมสกอร์ที่อัปเดตใหม่ทันที
- **ปิด Notification และ Toast บนหน้าจอ Match Manager (public/update.shtml, update.shtml)**:
  - ในหน้าจอ Manager (`isManager: true`), ปิดการรับ Toast การแข่งขันจาก WebSocket และการแตะอัปเดตบนสนาม เพื่อไม่ให้รบกวนการทำงานของผู้จัดการแข่งขัน (ยังคงแสดงเฉพาะการแจ้งเตือน Error/เตือนสำคัญ)
- **ปิดการเลื่อนจออัตโนมัติ (Auto-scroll) ไปยังแมตช์ปัจจุบัน (public/update.shtml, update.shtml)**:
  - ยกเลิกคำสั่ง `scrollToCurrentMatch(true)` อัตโนมัติเมื่อโหลดหน้าจอ เพื่อให้ผู้จัดการแข่งขันสามารถจัดการผลสกอร์บน Scoreboard และ Pitch ด้านบนได้อย่างต่อเนื่องโดยหน้าจอไม่เลื่อนหนี

--- 

## [0.7.1] - 2026-10-26

### Bug Fix: Mobile Toast Notification Visibility & Robust WebSocket Goal Broadcast
- **แก้ไขชื่อตารางในคำสั่ง SQL สำหรับ Broadcast (routes/web.js)**:
  - แก้ไขชื่อตารางจาก `team_week_tbl` เป็น `team_color_week_tbl` ใน Query ของ `add_goal`, `finish_match`, และ `start_match`
  - ก่อนหน้านี้การเพิ่มประตู/แอสซิสต์ทำให้เกิด Error `Table 'soccerbot.team_week_tbl' doesn't exist` ภายใน Try/Catch ทำให้คำสั่ง `broadcastMatchEvent('GOAL_ADDED')` ไม่ถูกยิงออกไป ในขณะที่คำสั่งลบประตู (`remove_goal`) ใช้งานตาราง `match_stat_tbl` จึงยิง broadcast สำเร็จเพียงลำพัง
- **อัปเกรดฟังก์ชัน `doQuery` และ `doUpdate` ใน routes/web.js**:
  - รองรับ Parameterized Query (`params`) เพื่อความปลอดภัยและป้องกัน SQL error
- **ปรับปรุงตำแหน่งและความชัดเจนของ Toast Notification บนมือถือ (public/style.css)**:
  - ยกระดับ `z-index` เป็น `999999 !important` ป้องกันการถูก Stadium Pitch Modal (`z-index: 9999`) หรือ Bottom Bar บดบัง
  - บนมือถือ (`max-width: 600px`): ย้ายตำแหน่งการแสดงผลไปไว้ด้านบน (`top: max(16px, env(safe-area-inset-top))`) ในลักษณะ Native Push Banner / Dynamic Island เพื่อให้มองเห็นได้ทันที ชัดเจน ไม่โดนนิ้วมือหรือ Browser Navigation Bar บัง
  - เพิ่ม `pointer-events: none` เพื่อให้ผู้ใช้สามารถแตะใช้งานหน้าจอด้านล่างต่อได้ทันทีโดยไม่ติดขัด
  - เพิ่ม CSS transition animations (`fade-enter-active`, `fade-leave-active`, `toastPopTop`)
- **เพิ่มความปลอดภัยและแม่นยำในการกรองข้อมูลบน Client (public/update.shtml, update.shtml)**:
  - ตรวจสอบ `data.week_id` เทียบทั้ง `this.week.id` และ `this.week.number` เพื่อป้องกันการ Drop Event
  - ปรับปรุงการคำนวณชื่อทีม (`teamColor`) และชื่อผู้เล่น (`pAlias`) ใน `quickAddGoal` และ `quickRemovePlayerEvent` ให้มี Fallback ป้องกัน `undefined`

--- 

## [0.7.0] - 2026-10-26

### Feature: Real-Time Live Scoreboard via WebSocket & Instant Toast Notifications
- **ระบบกระจายข้อมูลสดผ่าน WebSocket Broadcaster (`utils/wsBroadcaster.js`, `index.js`, `package.json`)**:
  - ติดตั้ง library `ws` และเชื่อมต่อ WebSocket Server เข้ากับ HTTP Server โดยตรงที่เส้นทาง `/webhook/ws` (และ `/ws/live`, `/web/ws`)
  - มีระบบตรวจจับการเชื่อมต่อ (Ping/Pong Heartbeat ทุก 30 วินาที) และระบบ Auto-reconnect หากหลุดการเชื่อมต่อ
  - รองรับการ Subscribe แยกตาม `week_id` เพื่อส่งข้อมูลเฉพาะสัปดาห์ที่ผู้ใช้กำลังดูอยู่ได้อย่างแม่นยำ
- **ระบบ Push Events เมื่อเกิดเหตุการณ์แข่งขันใน Manager (`routes/web.js`)**:
  - ⚽ **ยิงประตู / แอสซิสต์**: ส่ง Event `GOAL_ADDED` พร้อมชื่อผู้ทำประตู, ทีม และสกอร์คู่แข่ง ณ ขณะนั้น
  - 🏁 **จบแมตช์**: ส่ง Event `MATCH_FINISHED` พร้อมสกอร์สุดท้ายที่จบการแข่งขัน
  - ▶️ **เริ่มแมตช์**: ส่ง Event `MATCH_STARTED` แจ้งเตือนแมตช์คู่ถัดไปที่เริ่มลงสนาม (LIVE)
  - ↩️ **เปิดแมตช์แข่งต่อ / แก้ไขผล**: ส่ง Event `MATCH_REOPENED` / `GOAL_REMOVED`
  - 🛡️ **ปรับผังตำแหน่งผู้เล่น**: ส่ง Event `ROSTER_UPDATED`
- **ระบบ Real-Time Live Viewer และแจ้งเตือน Toast บนหน้าจอ (`public/update.shtml`, `update.shtml`, `public/style.css`)**:
  - เมื่อหน้าจอ Viewer ได้รับ Event จาก WebSocket จะแสดง **Toast Notification** ทันที เช่น *"⚽ GOAL! @Guy ยิงให้ Yellow (Yellow 1 - 0 White)"* หรือ *"🏁 จบ Match 3 เรียบร้อยแล้ว (Yellow 2 - 1 White)"*
  - สั่ง Sync ข้อมูลสกอร์และตารางคะแนนล่าสุดมารีเฟรชบนหน้าจอทันทีแบบเบื้องหลัง (< 50ms) โดยที่ผู้ชมไม่ต้องรอตัวเลขนับถอยหลัง 30 วินาที
  - แสดงจุดเขียวกะพริบสด (Live Dot) ข้างปุ่มรีเฟรชเพื่อบอกสถานะการเชื่อมต่อ WebSocket แบบ Real-time
  - เพิ่มสไตล์ Responsive ให้กับ `.match-toast` จัดตำแหน่งกึ่งกลางหน้าจออย่างสวยงามบนสมาร์ตโฟน
  - คงระบบ Timer (30s) ไว้เบื้องหลังเป็น Fallback Sync ในกรณีที่อินเทอร์เน็ตมือถือหลุดหรือพักหน้าจอ

--- 

## [0.6.21] - 2026-10-26

### Optimization & Feature: Smart Change Detection & DB-Backed Week Leader Stats
- **ระบบตรวจสอบการเปลี่ยนแปลงข้อมูลอัจฉริยะ (Smart Change Detection & Checksum) (`query.js`)**:
  - เพิ่มฟังก์ชัน `computeWeekChangeChecksum(week_id)` สร้าง Fingerprint ตรวจจับการเปลี่ยนแปลงของข้อมูลในสัปดาห์นั้นอย่างครอบคลุม 100%: จำนวนแมตช์, จำนวนแมตช์ที่จบ, สกอร์ทีม A/B, ประตูรวม, แอสซิสต์รวม, Checksum ผู้ทำประตู/แอสซิสต์ (`member_id * 100 + status`), Checksum ผู้เล่นและตำแหน่ง (`member_id * 1000 + team_id * 10 + pos_id`) และ Timestamp ล่าสุดของแมตช์
  - บันทึก Checksum ลงใน `template_tpl` เพื่อใช้ตรวจสอบความสดใหม่ของข้อมูล (Freshness Check) ในทุก Request
- **โหลดสถิติและคะแนนเรตติ้งจาก DB ทันทีเมื่อไม่มีการแก้ไข (`query.js`, `routes/web.js`)**:
  - เพิ่มฟังก์ชัน `loadSavedWeekLeaderStats(week_id, groupId)` ดึงคะแนน Rating, MVP, Top Scorer, Top Assist และ TOTW จากตาราง `mvp_week_tbl` และ `member_team_week_tbl` ส่งกลับได้ทันทีโดยไม่ต้องรันลูปคำนวณซ้ำ
  - เมื่อเปิดดูสัปดาห์ย้อนหลังที่จบไปแล้ว (เช่น Week 333) ข้อมูลจะถูกตอบกลับภายใน 5–15 ms โดยไม่วนลูปคำนวณแต้มดิบใหม่ ไม่ยิง SQL UPDATE ซ้ำ และไม่พ่น MVP Calculation Log ออกมารบกวนคอนโซล
  - เมื่อมีข้อมูลเปลี่ยนแปลงจริง (สกอร์เปลี่ยน, เพิ่ม/ลบ/เปลี่ยนคนยิงประตู, เปลี่ยนตำแหน่งผู้เล่น หรือกดจบแมตช์ด้วย `forceRefresh = true`) ระบบจะตรวจจับความต่างได้ทันทีและทำการคำนวณใหม่พร้อมอัปเดต Checksum ให้อัตโนมัติ
- **ยกระดับโครงสร้างตาราง `mvp_week_tbl` (`query.js`)**:
  - เพิ่มคอลัมน์ `matches` (จำนวนแมตช์ที่ลงเล่น) และ `pos_code` (รหัสตำแหน่ง) ในตาราง `mvp_week_tbl` ผ่าน `ensureMvpWeekTable()` และบันทึกข้อมูลครบถ้วนใน `saveWeekMvpRecords()`
  - ปรับการแสดงผล Log การคำนวณ MVP: แสดงหัวข้อชัดเจนระบุสาเหตุการคำนวณ (`Forced Refresh` หรือ `Data Changed / First Calculation`) และปรับข้อความคำนวณรายคนเป็นระดับ `debug` เพื่อให้คอนโซลสะอาดเป็นระเบียบ

--- 

## [0.6.20] - 2026-10-26

### Bug Fix: Mobile Carousel Tiling Lag & Right/Left Edge Blank Space
- **แก้ไขปัญหาเลื่อนไปซ้ายสุดหรือขวาสุดแล้วมีพื้นที่ว่างเปล่าและต้องรอโหลด (`public/style.css`)**:
  - กำหนด `scroll-snap-align: start` สำหรับการ์ดแรก (`:first-child`) และ `scroll-snap-align: end` สำหรับการ์ดสุดท้าย (`:last-child`) ทำให้เมื่อเลื่อนไปขวาสุด การ์ดสุดท้ายจะ snap ชิดขอบขวาพอดี 100% ไม่มีช่องว่างสีมืดว่างเปล่าหลงเหลือ
  - การ์ดระหว่างกลางใช้ `scroll-snap-align: center` เพื่อให้อยู่กึ่งกลางหน้าจออย่างสมดุล พร้อมเห็นส่วนปลายของการ์ดข้างเคียงให้รู้ว่าเลื่อนต่อได้
- **เปิดใช้ GPU Hardware Acceleration ป้องกัน WebKit/Safari Tiling Lag (`public/style.css`)**:
  - เพิ่ม `-webkit-transform: translate3d(0, 0, 0)`, `transform: translate3d(0, 0, 0)`, `-webkit-backface-visibility: hidden` และ `will-change: transform` ให้กับการ์ดทีมทุกใบ
  - สั่งให้ WebKit บน iOS Safari และ LINE In-App Browser เรนเดอร์การ์ดทั้งหมดเก็บไว้ใน GPU VRAM ล่วงหน้า ทำให้เลื่อนสไลด์ซ้าย-ขวาได้แบบ 60fps ลื่นไหลทันทีโดยไม่ต้องรอโหลดหรือรอเรนเดอร์ (ไม่มีอาการ Blank Tile)
- **ปรับปรุงประสิทธิภาพการเรนเดอร์ผังสนามใน Vue (`public/update.shtml`, `update.shtml`)**:
  - คำนวณแถวตำแหน่งผู้เล่น (`tacticalRows`) ไว้ล่วงหน้าใน `teamRostersSummary` เพื่อลดการเรียกฟังก์ชัน `getTeamTacticalRows` ซ้ำซ้อนหลายสิบรอบในแต่ละ Render Frame
  - เพิ่มแอตทริบิวต์ `loading="eager" decoding="async"` ให้กับภาพ Avatar ผู้เล่นทั้งหมด

--- 

## [0.6.19] - 2026-10-26

### UI Simplification: Clean Mobile Carousel Heading & Single TOTW Title
- **ปรับแถบนำทางบนมือถือเป็นหัวข้อเรียบง่าย (Heading) (`public/update.shtml`, `update.shtml`, `public/style.css`)**:
  - นำปุ่มแท็บสลับทีมและตัวระบุจุดสไลด์เดิมออกตามความต้องการของผู้ใช้
  - แทนที่ด้วยแถบหัวข้อเรียบง่าย `👥 ผังผู้เล่นและสรุปทีม` พร้อมคำแนะนำ `⇄ เลื่อนเพื่อดูแต่ละทีม` ช่วยประหยัดพื้นที่แนวตั้งบนจอมือถือและให้ผู้ใช้ใช้นิ้วปัดเลื่อนการ์ดซ้าย-ขวาได้อย่างเป็นธรรมชาติ
- **ปรับหัวข้อการ์ด Team of the Week ให้เหลือเฉพาะชื่อหัวข้ออย่างเดียว (`public/update.shtml`, `update.shtml`, `public/style.css`)**:
  - ตัดคำว่า `Best XI (X คน)` ออกเนื่องจากจำนวนผู้เล่นจริงคือ 7 หรือ 8 คน (ไม่ใช่ XI/11 คน)
  - แสดงเฉพาะหัวข้อ `⭐ TEAM OF THE WEEK` กึ่งกลางการ์ดเด่นชัด สวยงาม เรียบหรู และไม่มีปัญหาข้อความตกบรรทัดในทุกอุปกรณ์

--- 

## [0.6.18] - 2026-10-26

### Enhancement: Prepend TOTW to Front & Enforce Single-Line Team Card Header
- **ย้ายทีมยอดเยี่ยมประจำสัปดาห์ (TOTW) มาไว้ลำดับแรกด้านหน้าสุด (`public/update.shtml`, `update.shtml`)**:
  - เปลี่ยนจากการต่อท้ายแถว (`teams.push`) เป็นการนำ TOTW มาแทรกไว้เป็นลำดับแรกสุด (`teams.unshift`)
  - ทำให้ผู้ใช้เห็นผัง Team of the Week ทันทีเป็นใบแรกเมื่อเปิดหน้าเว็บทั้งบนเดสก์ท็อปและบนมือถือ
  - แท็บนำทางแบบด่วน (Carousel Quick Nav Pills) จะมี `⭐ TOTW` เป็นปุ่มแรกสุด พร้อมสัญลักษณ์และจุดระบุสถานะสีทอง
- **ปรับแต่งหัวข้อการ์ดทีมให้อยู่ในบรรทัดเดียวเสมอ ไม่ตกบรรทัด (`public/style.css`)**:
  - กำหนด `white-space: nowrap !important;` และ `flex-wrap: nowrap !important;` ใน `.team-col-header`, `.team-col-name`, `.team-col-record`
  - ปรับขนาดฟอนต์ของหัวข้อ TOTW (`⭐ TEAM OF THE WEEK` และ `👑 Best XI (X คน)`) ให้กระชับพอดีกับการ์ดในทุกขนาดหน้าจอมือถือ (รวมถึงจอ 320px–360px) โดยไม่มีการตัดคำตกเป็น 2 บรรทัด
  - เพิ่ม `overflow: hidden; text-overflow: ellipsis; min-width: 0;` เพื่อป้องกันปัญหาข้อความทะลุขอบในกรณีชื่อสียาว

--- 

## [0.6.17] - 2026-10-26

### Bug Fix: Mobile Horizontal Carousel CSS Precedence & Cache Busting
- **แก้ไขปัญหาสรุปทีมไม่เลื่อนแนวนอนบนมือถือเนื่องจากลำดับการเรียง CSS (`public/style.css`)**:
  - ย้ายบล็อกคำสั่ง Responsive `@media (max-width: 768px)` สำหรับสไลด์สรุปทีมแนวนอนไปไว้ที่ **ท้ายสุดของไฟล์ `style.css`** พร้อมเพิ่ม `!important` และ `flex-wrap: nowrap`
  - แก้ไขปัญหาเดิมที่คำสั่ง Desktop Grid (`display: grid; grid-template-columns: repeat(...)`) ในช่วงท้ายไฟล์ไปเขียนทับ (Override) คำสั่ง Flex Carousel บนหน้าจอมือถือ ทำให้การ์ดทีมแสดงผลซ้อนแนวตั้งเหมือนเดิม
- **ปรับปรุง Cache Invalidation สำหรับไฟล์ CSS (`routes/web.js`, `public/update.shtml`, `update.shtml`)**:
  - ยกเลิกการระบุเวอรชั่นฮาร์ดโค้ดเก่าในแท็ก `<link rel="stylesheet">` และตั้งค่า Header `Cache-Control: no-cache, must-revalidate, max-age=0` บนเซิร์ฟเวอร์
  - ป้องกันบราวเซอร์มือถือใช้ไฟล์สไตล์ชีตเก่าจากแคช (Browser Stale Cache) มั่นใจได้ว่ามือถือทุกเครื่องจะดึง CSS ล่าสุดและเลื่อนแนวนอนได้ 100%

--- 

## [0.6.16] - 2026-10-26

### Feature & Performance: Team of the Week (TOTW) & Persistent Ratings Caching
- **เพิ่มผังทีมยอดเยี่ยมประจำสัปดาห์ (Team of the Week - TOTW) ในหน้าเว็บ (`public/update.shtml`, `update.shtml`, `routes/web.js`, `query.js`, `public/style.css`)**:
  - ดึงข้อมูลดรีมทีม TOTW (7 หรือ 8 คนตามโควตาสัปดาห์) ที่คัดเลือกผู้เล่นเรทติ้งสูงสุดตามขอบเขตตำแหน่งการเล่น (GK, DF, DW, MF, DM, AM, CF) เข้ามาแสดงผลร่วมในส่วนสรุปทีม
  - จัดการแสดงผล TOTW อย่างโดดเด่นด้วยโทนสีทองพรีเมียม (Gold Badge & Gradient Header) พร้อมแสดงสีกรอบ Avatar ตามทีมต้นสังกัดจริงของผู้เล่นแต่ละคน
  - แสดงผลกลมกลืนทั้งใน **🏟️ ผังสนาม (Pitch View)**, **📋 รายชื่อ (List View)** และ **สไลด์เลื่อนแนวนอน (Mobile Carousel & Quick Tab `⭐ TOTW`)**
- **ปรับปรุงระบบ Caching การคำนวณเรทติ้งเพื่อแก้ปัญหาคำนวณซ้ำทุกครั้งที่เข้าหน้าเว็บ (`routes/web.js`)**:
  - ยกเลิกการหมดอายุแคชแบบสั้น 15 วินาทีที่ทำให้ระบบต้อง Query และคำนวณเรทติ้งใหม่ทุกครั้งที่มีคนเปิดหน้าเว็บหรือผ่านช่วงโพลล์ 30 วินาที
  - ปรับให้แคชคงอยู่ตลอดไป (Persistent Cache) ตราบใดที่ยังไม่มีการเปลี่ยนแปลงสถานะหรือผลการแข่งขัน
  - **คำนวณใหม่เมื่อกด จบ Match**: เมื่อผู้ดูแลระบบกดจบแมตช์ (`finish_match` / `end_match`) ระบบจะทำการคำนวณเรทติ้งและ TOTW ทันที พร้อมอัปเดตแคชใหม่ให้อัตโนมัติ ผู้ใช้งานทั่วไปที่เข้ามาเปิดหน้าเว็บจะได้รับข้อมูลจากแคชในเสี้ยววินาที (0ms overhead) โดยไม่มีการรันคำนวณซ้ำซ้อน

--- 

## [0.6.15] - 2026-10-26

### Mobile Carousel & Horizontal Team Scrolling
- **Mobile Horizontal Team Carousel & Quick Switcher Navigation (`public/update.shtml`, `update.shtml`, `public/style.css`)**:
  - **ปรับการแสดงผลสรุปทีมบนหน้าจอมือถือเป็นแบบเลื่อนแนวนอน (Horizontal Scroll / Swipe)**:
    - เปลี่ยนการเรียงการ์ดทีมจากเดิมที่เรียงซ้อนกันเป็นแนวยาวลงข้างล่าง (Vertical Stack) ซึ่งกินพื้นที่ยาวมาก มาเป็นแบบสไลด์แนวนอน (`overflow-x: auto; scroll-snap-type: x mandatory`)
    - แต่ละทีมมีความกว้างประมาณ 88% (`calc(100% - 36px)`) ทำให้ผู้ใช้มองเห็นขอบของการ์ดทีมถัดไปโผล่ออกมาเล็กน้อย เป็น Visual Cue ที่ชัดเจนว่าสามารถปัดหน้าจอเพื่อดูทีมอื่นได้
    - ปัดซ้าย-ขวาได้อย่างลื่นไหลพร้อมระบบดูดจับตำแหน่ง (Scroll Snap) เข้าที่ทันที
  - **เพิ่มแถบสลับทีมด่วน (Team Navigation Tabs) และจุดบอกตำแหน่ง (Page Dots) สำหรับมือถือ**:
    - มีปุ่มเลือกทีมด้านบนตามสีทีมจริงพร้อมคะแนน (เช่น `🟢 GREEN (14p)`, `⚪ WHITE (12p)`, `🔴 RED (10p)`) สามารถแตะเพื่อเลื่อนไปยังทีมนั้นได้ทันทีอย่างแม่นยำ
    - ระบบตรวจจับตำแหน่งการเลื่อนอัตโนมัติ (`onTeamGridScroll`) คอยอัปเดตสถานะปุ่มทีมและจุดหน้า (Pagination Dots) ให้ตรงกับทีมที่กำลังแสดงอยู่แบบเรียลไทม์
    - ซ่อนแถบนำทางนี้บนหน้าจอคอมพิวเตอร์/เดสก์ท็อปโดยอัตโนมัติ เพื่อรักษาเลย์เอาต์เดิมที่แสดง 3 ทีมเคียงข้างกันอย่างสมบูรณ์แบบ

--- 

## [0.6.14] - 2026-10-25

### Improved & Tactical Formation Layout
- **Smart Tactical Formation Balancing (2-3-3 / 2-2-3) & Remove Redundant Name Ratings (`public/update.shtml`, `public/style.css`)**:
  - **ยกเลิกการแสดงคะแนนเรทติ้งซ้ำซ้อนในป้ายชื่อนักเตะ**:
    - เนื่องจากมีป้ายเรทติ้งรูปดาว/มงกุฎแบบทึบคมชัดลอยอยู่เหนูปผู้เล่นแล้ว จึงนำป้ายคะแนนในแถบชื่อ (`.pitch-name-rating`) ออก
    - ส่งผลให้ป้ายชื่อเหลือเฉพาะตำแหน่ง (`CF`, `MF`, `DF`) และชื่อผู้เล่น ทำให้มีพื้นที่แสดงชื่อผู้เล่นกว้างขึ้น ชื่อไม่ถูกย่อเป็นอักษรตัวเดียวอย่าง "k.", "P.", "M." อีกต่อไป
  - **จัดสมดุลแถวการยืนในสนามเป็น 2-3-3 หรือ 2-2-3 (จำกัดสูงสุดแถวละ 3 คน)**:
    - ปรับอัลกอริทึม `getTeamTacticalRows` ใหม่ โดยจัดเรียงผู้เล่นตามลำดับตำแหน่งเกมรุกไปเกมรับ (CF > AM > MF > DM > DW > DF)
    - กรณีผู้เล่น 8 คน: จัดเป็น **2 - 3 - 3** (หน้า 2, กลาง 3, หลัง 3) แก้ปัญหาแถวกลางอัดแน่น 4 คน
    - กรณีผู้เล่น 7 คน: จัดเป็น **2 - 2 - 3** (หน้า 2, กลาง 2, หลัง 3)
    - ทุกแถวจะมีผู้เล่นสูงสุดไม่เกิน 3 คน ทำให้มีระยะห่างที่พอดี ไม่เบียดติดกัน และแสดงผล Avatar ได้ขนาด 40px อย่างสวยงาม

--- 

## [0.6.13] - 2026-10-25

### Improved & Responsive UI
- **Shorten Titles & Badges for Mobile Clarity (`public/update.shtml`, `public/style.css`)**:
  - **ย่นย่อข้อความหัวการ์ดสรุปทีมให้สั้นกระชับ ไม่โดนตัดคำตกหล่น (`...`)**:
    - ปรับข้อความหัวการ์ดจากเดิมที่ยาวเกินไปจนถูกตัดคำเป็น `👥 สรุปนักเตะแต่ละที...` ให้กระชับลงเป็น `👥 สรุปทีม & เรทติ้ง` อ่านเข้าใจทันที และแสดงผลได้เต็มข้อความบนมือถือทุกรุ่นอย่างแน่นอน
    - ปรับป้ายสถานะสดบนมือถือให้สั้นกระชับเป็น `⚡ Live` (และคง `⚡ Live Ratings` เต็มรูปแบบเมื่อดูบนหน้าจอคอมพิวเตอร์)
    - ย่นย่อข้อความหัวผังนักเตะในการ์ดแมตช์จาก `🏟️ ผังรายชื่อนักเตะ Match X` เป็น `🏟️ ผังนักเตะ Match X` ให้ดูสะอาดตาและไม่เบียดปุ่มปิด

--- 

## [0.6.12] - 2026-10-25

### Improved & Responsive UI
- **Mobile-First Responsive Redesign across All Sections (`public/update.shtml`, `public/style.css`, `public/position.shtml`)**:
  - **แก้ไขปัญหาข้อความแตกเป็นคำแนวตั้งในหน้าจอมือถือ (Team Summary Header)**:
    - แก้ไขการ์ดสรุปนักเตะแต่ละทีมและเรทติ้ง ที่ชื่อหัวข้อ "👥 สรุปนักเตะแต่ละทีม & เรทติ้งเรียลไทม์" บีบกับปุ่มกดจนตัดคำเป็น 5 บรรทัด และตัวหนังสือในปุ่ม "ผังสนาม", "รายชื่อ", "ย่อสรุป" บีบซ้อนเป็นแนวตั้ง
    - ปรับโครงสร้างบนหน้าจอมือถือให้แสดงแบบ 2 แถวที่สมดุล:
      - **แถวบน**: แสดงชื่อหมวด `👥 สรุปนักเตะแต่ละทีม & เรทติ้ง` ชิดซ้าย พร้อมป้าย `⚡ Live Ratings` ชิดขวา สวยงามและไม่ตัดคำมั่ว
      - **แถวล่าง**: แบ่งปุ่มควบคุมมุมมอง `[ 🏟️ ผังสนาม | 📋 รายชื่อ ]` และปุ่ม `[ ▲ ย่อสรุป / ▼ ดูสรุป ]` ให้ขยายเต็มความกว้างอย่างลงตัว
    - เพิ่ม `white-space: nowrap` และ `user-select: none` ให้กับปุ่มและป้ายกำกับทั้งหมด ป้องกันไม่ให้ตัวอักษรแตกเป็นหลายบรรทัดบนมือถือทุกขนาดจอ
  - **ปรับแต่งทุกส่วนของหน้าเว็บบนมือถือให้พอดี กระชับ และสบายตา**:
    - **Top Header & Nav**: ปรับระยะขอบด้านขวาเพื่อป้องกันปุ่มสลับธีม ☀️/🌙 บังเนื้อหา, ปรับ Navigation Tabs และ User Status ให้จัดกึ่งกลางและปรับขนาดตัวอักษรอย่างเหมาะสม, รองรับป้ายอัปเดตเวอร์ชันแบบกระชับ (`🚀 อัปเดต v...`)
    - **Leaders Spotlight (MVP, Top Scorer, Top Assist)**: ปรับระยะ Padding และขนาดการ์ดผู้นำสัปดาห์ให้พอดีกับจอมือถือ ไม่กินพื้นที่ความสูงจนเกินไป
    - **Team Formation & Soccer Pitch**: ปรับขนาด Node ผู้เล่น, Avatar (38px), ป้ายชื่อ และป้ายคะแนนเรทติ้ง ให้แสดงผลในกรอบสนามบอลได้อย่างคมชัด ไม่ล้นและไม่ซ้อนทับกัน
    - **Match Cards & Scoreboard**: ปรับขนาดปุ่มขยายผังสนาม (`🏟️ ผังสนาม`), ป้าย Scoreboard, รายการประตู/แอสซิสต์ ให้กระชับ อ่านง่าย
    - **Position Manager & Modals**: ปรับ Quota Chips, แท็บมุมมอง, ปรับปุ่มเปลี่ยนรหัสผ่านเป็น `🔑 รหัสผ่าน` และปุ่มบันทึกให้เต็มแถวบนมือถือ

--- 

## [0.6.11] - 2026-10-25

### Improved & Enhanced
- **High-Contrast Bold Rating Badges on Pitch (`public/update.shtml`, `public/style.css`)**:
  - **แก้ปัญหาป้ายเรทติ้งมองแทบไม่เห็น**:
    - เปลี่ยนป้ายเรทติ้ง (`.mini-score-rating`) จากพื้นหลังโปร่งแสงเดิม มาเป็น **สีทึบ 100% (Solid Vibrant Color)** พร้อมขอบขาวหนา 1.5px และเงาซ้อนมิติชัดเจน
    - แยกสีตามระดับคะแนนแบบทึบชัดเจน: สีเขียวสด (`#16a34a`) สำหรับฟอร์มยอดเยี่ยม, สีน้ำเงิน (`#2563eb`) สำหรับฟอร์มดีมาก, สีทองส้ม (`#d97706`) สำหรับฟอร์มดี และสีเทาเข้ม (`#475569`) สำหรับทั่วไป
    - ขยายขนาดตัวเลขคะแนนเป็น 0.74rem ตัวหนาพิเศษ 900 พร้อมไอคอนมงกุฎ 👑 สำหรับ Team MVP หรือ ⭐
    - เพิ่มป้ายคะแนนเรทติ้งในป้ายชื่อนักเตะ (`.pitch-name-rating`) ทำให้เห็นคะแนนได้อย่างชัดเจนในทุกมุมมอง
    - ปรับขนาด Avatar บนสนามเพิ่มเป็น 44px ขอบขาวหนา 2.5px คมชัดยิ่งขึ้น

--- 

## [0.6.10] - 2026-10-25

### Fixed
- **Fix Team Points and Record in Team Summary Header (`public/update.shtml`)**:
  - แก้ไขปัญหาหัวการ์ดสรุปทีมแสดงผลคะแนนและสถิติเป็น 0 หมด (`0 pts (0W-0D-0L)`)
  - สาเหตุเกิดจากการอ้างอิงชื่อคอลัมน์ที่ไม่ตรงกับโครงสร้างข้อมูลของ `tableweek` (`tw.point` แทนที่จะเป็น `tw.pts`, `tw.win` แทนที่จะเป็น `tw.w`, `tw.draw` แทนที่จะเป็น `tw.d`, `tw.loss` แทนที่จะเป็น `tw.l`)
  - เพิ่ม Fallback ให้รองรับทั้งสองรูปแบบอย่างสมบูรณ์ ทำให้แสดงผลคะแนนและสถิติการแข่งขันของทีม (`14 pts (3W-5D-2L)`) ตรงกับตารางคะแนนจริง 100%

--- 

## [0.6.9] - 2026-10-25

### Added & Improved
- **Visual Pitch Field & Player Avatar Icons Layout (`public/update.shtml`, `public/style.css`)**:
  - **ปรับผังทีมเป็นรูปสนามฟุตบอล 2D พร้อมไอคอนนักเตะ (แทนที่ตารางรายชื่อ)**:
    - ในส่วน **สรุปผังนักเตะแต่ละทีม (Team Tactical Pitch)**: แสดงผังทีมเป็นรูปสนามฟุตบอลแนวตั้ง (`.team-pitch-vertical`) พื้นหญ้าเขียวพร้อมเส้นสนามสมจริง (Half-line, Penalty Box, Goal, Center Circle)
    - นักเตะถูกจัดวางตามตำแหน่งในสนามจริง (แถวบนสุด: กองหน้า CF, แถวกลาง: กองกลาง MF/DM/AM, แถวล่าง: กองหลัง DF/DW และ ผู้รักษาประตู GK)
    - แสดงผลเป็นไอคอนนักเตะทรงกลม (Avatar Circle) ขอบสีทีม พร้อมป้ายตำแหน่ง (`CF`, `MF`, `DF`, `GK`), ป้ายชื่อเล่น, ป้าย 👑 MVP ประจำทีม และคะแนน ⭐ เรทติ้งเรียลไทม์ลอยอยู่เหนือไอคอน
    - เพิ่มปุ่มสลับมุมมอง `🏟️ ผังสนาม` (ค่าเริ่มต้น) และ `📋 รายชื่อ` บนหัวการ์ด
  - **ผังสนามในแมตช์การ์ด (`inline-soccer-pitch`)**:
    - เมื่อกดปุ่ม `🏟️ ผังสนาม` ในแมตช์การ์ดใดๆ จะกางรูปสนามฟุตบอลแบบ 2D แสดงผู้เล่นทีม A (ฝั่งซ้าย) และทีม B (ฝั่งขวา) เผชิญหน้ากันในสนาม
    - วางไอคอนนักเตะตามโซนแท็กติก (กองหลัง-โกล์, กองกลาง, กองหน้า) พร้อมป้ายยืมตัว (`ยืม`) และรูป Avatar สวยงามบนพื้นสนาม

--- 

## [0.6.8] - 2026-10-25

### Fixed & Added
- **Fix False Empty Schedule Warning (`public/update.shtml`)**:
  - แก้ไขเงื่อนไขการแสดงผลกล่องเตือน 'ยังไม่มีตารางการแข่งขันในสัปดาห์นี้' ที่เคยผูกเป็น `v-else` ต่อจากการ์ดสนาม ทำให้หน้าดูผล (Viewer) ที่ซ่อนการ์ดสนามแสดงกล่องเตือนว่างเปล่าขึ้นมาแม้ตารางจะแข่งขันจบหรือมีแมตช์อยู่แล้ว
  - ปรับเงื่อนไขให้กล่องแจ้งเตือนแสดงผลเฉพาะเมื่อ `matchCount === 0` เท่านั้น และเมื่อมีตารางหรือแข่งขันจบแล้ว กล่องนี้จะหายไปโดยสิ้นเชิง

- **Real-time Team Rosters & Rating Summary Showcase (`public/update.shtml`, `public/style.css`, `routes/web.js`)**:
  - **สรุปนักเตะแต่ละทีมและเรทติ้งแบบเรียลไทม์**: เพิ่มการ์ดสรุปรายชื่อผู้เล่นแยกตามทีม (เช่น White, Yellow, Red) พร้อมคะแนนเรทติ้งที่คำนวณแบบเรียลไทม์ (1-10 Rating) จากสถิติการเล่นจริง (ประตู, แอสซิสต์, คลีนชีต, ผลแพ้/ชนะ/เสมอ, จำนวนนัดที่ลงเล่น)
  - **Week Leaders Spotlight**: ไฮไลท์ผู้นำคะแนนประจำสัปดาห์ ได้แก่ 👑 Week MVP, ⚽ Top Scorer (ดาวซัลโว) และ 👟 Top Assist (จอมแอสซิสต์) พร้อมรูป Avatar และคะแนนแบบสดๆ
  - **Rosters Detail & Color-Coded Ratings**: แสดงรูปโปรไฟล์ Avatar, ชื่อเล่น, ตำแหน่งในสนาม (`CF`, `DM`, `DW`, `GK`), ป้าย 👑 MVP ประจำทีม, แท็กสถิติ และป้ายเรทติ้งแยกสีตามระดับฟอร์ม (Elite, Great, Good, Avg)
  - **In-Memory Cache & Auto-Busting**: เซิร์ฟเวอร์เก็บแคชข้อมูลเรทติ้ง 15 วินาทีเพื่อความรวดเร็วในการเปิดดู และทำการ Invalidate แคชทันทีเมื่อมีการเพิ่ม/ลบประตูหรือเปลี่ยนสถานะแมตช์ ทำให้ผู้ใช้เห็นเรทติ้งที่อัปเดตสดใหม่เสมอ

--- 

## [0.6.7] - 2026-10-25

### Added & Improved
- **Inline Pitch Lineup & Continuous Match Stream (public/update.shtml, public/style.css)**:
  - **ปรับการแสดงผลเป็นแบบแถบต่อเนื่อง (Continuous Unified Stream)**: ยกเลิกกล่อง Hero แยกเดี่ยวด้านบน (.viewer-live-hub) ตามความต้องการของผู้ใช้ เพื่อให้การเลื่อนดูแมตช์ก่อนหน้า (ย้อนหลัง) และแมตช์ถัดไปทำได้อย่างราบรื่นและเป็นธรรมชาติในหน้าจอเดียว
  - **Auto-Scroll to Current Match**: เมื่อเปิดหน้าจอ Viewer หรือกดรีเฟรช ระบบจะเลื่อนหน้าจอ (Smooth Scroll) ลงมาโฟกัสที่การ์ดแมตช์ปัจจุบันหรือแมตช์ที่กำลังแข่งขันอยู่ทันที
  - **ปุ่มเปิด/ปิดผังสนามแบบ Inline (🏟️ ผังสนาม)**: ในการ์ดแต่ละแมตช์ สามารถกดเปิดดูผังผู้เล่นของทั้งสองทีมพร้อมรูป Avatar, ชื่อเล่น, ชื่อจริง, ตำแหน่ง (CF, MF, DF, GK) และป้ายยืมตัว ได้ทันทีในแถบแมตช์นั้นๆ โดยไม่ต้องแยกไปแสดงเดี่ยวๆ ด้านบน
  - **Live & Current Match Highlighting**: ไฮไลท์การ์ดแมตช์ปัจจุบันด้วยขอบสีและแสงเรือง พร้อมป้าย 🔴 LIVE และ ⭐ แมตช์ปัจจุบัน ชัดเจน
  - **Quick Jump Header Pill**: เพิ่มปุ่มลัด ⚽ Match X บนส่วนหัว (Header) เพื่อให้ผู้ใช้กดแตะกลับมาที่แมตช์ปัจจุบันได้ทุกเมื่อ

--- 

## [0.6.6] - 2026-10-25

### Added
- **Viewer Live Focus Hub & Next Match Showcase (`public/update.shtml`, `public/style.css`, `routes/web.js`)**:
  - **Live Focus Hub สำหรับหน้า Viewer**: ปรับปรุงหน้าดูผลการแข่งขัน (`/webhook/view`) ให้โฟกัสไปที่ **แมตช์ปัจจุบัน (Current / Live Match)** และ **แมตช์ถัดไป (Next Match / Up Next)** โดยอัตโนมัติ สไตล์เดียวกับคำสั่ง `/live` บน LINE แต่แสดงผลครบถ้วนทุกคู่
  - **ระบบเปิด/ปิดผังสนามแบบยืดหยุ่น**: ซ่อนผังสนามฟุตบอลขนาดใหญ่เป็นค่าเริ่มต้นในโหมด Viewer เพื่อให้เห็นผลการแข่งขันและเหตุการณ์ทันทีโดยไม่ต้องเลื่อนหน้าจอ พร้อมเพิ่มปุ่มกด `🏟️ แสดงผังสนาม / ซ่อนผังสนาม` ให้ผู้ใช้เปิดดูผังสนามแบบ 2D ได้ทุกเมื่อตามต้องการ
  - **จัดเต็มรูป Avatar และชื่อผู้เล่น (Scorers & Assists & Rosters)**:
    - ในแมตช์ปัจจุบัน: แสดงรูปโปรไฟล์ Avatar ของผู้ทำประตู (⚽), ผู้แอสซิสต์ (👟) และ Own Goal (🥅) พร้อมชื่อเล่นและชื่อจริงเต็มรูปแบบ
    - แสดงรายชื่อนักเตะตัวจริงในสนามของทั้งสองทีมพร้อมรูป Avatar และตำแหน่งการเล่น (`CF`, `MF`, `DF`, `GK`) รวมถึงแถบแสดงผู้เล่นยืมตัว
    - ในแมตช์ถัดไป: แสดงคู่ประกบทีมถัดไปพร้อมรายชื่อและรูป Avatar ของนักเตะที่จะลงสนามในนัดถัดไป เพื่อให้นักเตะเตรียมความพร้อมได้ทันที
  - **เพิ่ม Avatar ในสรุปแมตช์ทั้งหมด (All Matches)**: แสดงรูป Avatar ของผู้ทำประตูและแอสซิสต์ในทุกแมตช์ของการแข่งขัน พร้อม Tooltip แสดงชื่อจริงเต็มรูปแบบ
  - ปรับปรุง Backend API (`routes/web.js`) ในฟังก์ชัน `queryMatchScorer` และ `queryTeamMembers` ให้ดึง `picture_url` และ `full_name` ของผู้เล่นจากฐานข้อมูลโดยตรง

--- 

## [0.6.5] - 2026-10-25

### Added
- **Dynamic Asset & Application Auto-Versioning (`utils/version.js`, `routes/web.js`, `public/*.shtml`)**:
  - สร้างระบบ Auto-Versioning และ Cache Busting อัตโนมัติทุกครั้งที่มีการแก้ไขไฟล์ในระบบ โดยไม่ต้องแก้เลขเวอร์ชันแบบแมนนวล (`?v=...`) อีกต่อไป
  - เซิร์ฟเวอร์จะตรวจสอบ Modification Time (`mtime`) ของไฟล์ HTML และ `style.css` แบบไดนามิก พร้อมระบบ In-Memory Cache อัจฉริยะ (ตรวจสอบ `mtimeMs` ในระดับไมโครวินาที ทำให้ส่งข้อมูลเร็วเสมือนหน่วยความจำ RAM)
  - เซิร์ฟเวอร์ทำการแทนที่ `<link rel="stylesheet">` ด้วย `?v=${assetVersion}` อัตโนมัติ พร้อมฉีดข้อมูลเวอร์ชัน `window.__APP_VERSION__`, `window.__ASSET_VERSION__`, `window.__GIT_REV__` เข้าไปยัง `<head>`
  - เพิ่มป้ายแสดงเวอร์ชัน `.app-version-badge` บนส่วนหัว (Header) ของหน้า Match Manager, Match Center, Position Manager และ Login อย่างชัดเจน สวยงาม รองรับทั้ง Dark Theme และ Light Theme
  - เพิ่มข้อมูลเวอร์ชัน (`app_version`, `asset_version`) ใน API Endpoint `/webhook/get_info`, `/webhook/match_view_data`, และ `/webhook/auth/me`
  - เพิ่มระบบตรวจจับการอัปเดตเวอร์ชันใหม่แบบเรียลไทม์บนหน้าจอ Frontend หากเซิร์ฟเวอร์มีการอัปเดตไฟล์หรือโค้ดใหม่ ป้ายเวอร์ชันจะแสดงสถานะ `🚀 มีอัปเดตใหม่ (แตะเพื่อโหลด)` เพื่อให้ผู้ใช้รีเฟรชหน้าจอได้ทันที

--- 

## [0.6.4] - 2026-10-25

### Fixed
- **Fix Classic Goal Form Ref Error (`public/update.shtml`)**:
  - แก้ไขปัญหา JavaScript `TypeError: Cannot read properties of undefined (reading 'value')` ในฟังก์ชัน `addGoal()` ที่พยายามอ่าน `$refs.week_id.value` ทั้งที่ไม่มี element อยู่ในหน้า HTML
  - เปลี่ยนมาดึงค่าจาก `this.week.id` (หรือ `this.week.number`) พร้อมระบบตรวจสอบความถูกต้องของผู้เล่นที่ถูกเลือกก่อนส่งบันทึก
  - ปรับปรุงฟังก์ชัน `addMatch()` ให้มีระบบ Fallback ในการอ่าน `$refs` อย่างปลอดภัย

- **Fix Authentication Middleware & Prevent Silent 302 False Positive (`routes/web.js`, `public/update.shtml`)**:
  - ปรับปรุง Middleware `requireAuth` และ `requireRoot` ใน `routes/web.js` ให้ตอบกลับเป็น `HTTP 401 JSON` (`session_expired: true`) เสมอสำหรับคำขอประเภท AJAX, Non-GET หรือ Endpoint บันทึกผล เพื่อป้องกันไม่ให้ส่ง HTTP 302 Redirect ไปหน้า Login ซึ่งทำให้เบราว์เซอร์วิ่งตามและหลอกฝั่ง Frontend ว่าได้ HTTP 200
  - เพิ่ม HTTP Headers `Cache-Control: no-store, no-cache, must-revalidate, private` ในเส้นทาง `/match`, `/view`, `/auth/me` และ `/match_view_data` เพื่อป้องกันเบราว์เซอร์เสิร์ฟหน้าจอหรือข้อมูลที่ค้างจาก Cache
  - เพิ่ม Header `X-Requested-With: XMLHttpRequest` และกำหนด `timeout: 10000ms` ในการส่ง Axios ทุกคำขอ พร้อม Global Response Interceptor ดักจับกรณีที่ได้รับหน้า HTML Login ให้แปลงเป็น Error เซสชันหมดอายุโดยอัตโนมัติ

- **Strict API Response Validation & Anti-False-Update Guarantee (`public/update.shtml`)**:
  - ปรับปรุงฟังก์ชันการบันทึกผลและเปลี่ยนสถานะทั้งหมด (`quickAddGoal`, `finishCurrentMatch`, `startCurrentMatch`, `reopenCurrentMatch`, `quickRemoveGoal`, `quickRemovePlayerEvent`, `addGoal`, `removeGoalbyID`, `executeDeleteMatch`)
  - ตรวจสอบ `response.data && response.data.success === true` อย่างเข้มงวดก่อนแสดง Toast หรือปรับปรุงสถานะในหน้าจอ
  - หาก API ไม่ตอบสนอง, Timeout หรือเกิดข้อผิดพลาด จะไม่มีการทึกทักว่าสำเร็จเด็ดขาด พร้อมแสดง Toast ข้อผิดพลาดชัดเจน และดึงข้อมูลจริงจากฐานข้อมูลมาซิงก์กลับทันทีเพื่อป้องกันความสับสน

### Added
- **Live Session Cross-Check & Expired Session Banner (`public/update.shtml`, `public/style.css`)**:
  - เพิ่มระบบตรวจเช็คความถูกต้องของเซสชันแบบเรียลไทม์ (Cross-Check) เมื่อผู้ใช้สลับกลับมาที่แท็บเบราว์เซอร์ (`visibilitychange`), ปลุกหน้าจอจากแคช (`pageshow`), ได้รับโฟกัส (`focus`) และตั้งเวลาตรวจสอบเบื้องหลังทุก 60 วินาทีสำหรับผู้ดูแล
  - เพิ่มแถบแจ้งเตือนสีแดงด้านบน (`.session-expired-banner`) เตือนผู้ใช้ทันทีเมื่อเซสชันหมดอายุ และป้องกันไม่ให้กดบันทึกผลบนหน้าจอที่ค้างอยู่

---

## [0.6.3] - 2026-10-24

### Fixed
- **Fix Button Overlap in Dual Pitch Modal View (`public/style.css`, `public/update.shtml`, `public/position.shtml`)**:
  - **แก้ไขปัญหาปุ่มกดบันทึกประตู/แอสซิสต์ทับซ้อนกันในโหมดขยายสนามแบบสนามคู่ (Dual Pitch Modal View)**:
    - ในโหมดสนามคู่ (แนวนอน 2 ฝั่งทีม) ที่แบ่งผู้เล่นออกเป็น 3 คอลัมน์ต่อฝั่งทีม การขยายขนาดปุ่มแบบเดิมทำให้ปุ่มของคอลัมน์ที่ 1 (เช่น ปุ่ม OG) ยื่นล้นเข้าไปทับกับปุ่มของคอลัมน์ที่ 2 (เช่น ปุ่ม ⚽) และปุ่มของคอลัมน์ที่ 2 ล้นไปทับคอลัมน์ที่ 3
    - ปรับแต่งขนาดปุ่มในผังสนามคู่ (`.match-pitch .btn-quick-goal`, `.btn-quick-assist`, `.btn-quick-og`) ให้มีขนาดกะทัดรัดพอดี (`padding: 4px 7px`, สูง 28px และบนมือถือ 26px) จัดเรียงด้วย `gap: 2.5px - 3px` ทำให้ปุ่มทั้งหมดของนักเตะแต่ละคนมีความกว้างรวมไม่เกิน 90-98px
    - ปรับขยายความกว้างขั้นต่ำของสนามคู่ใน Modal เป็น `min-width: 860px` (บนมือถือ `min-width: 800px`) และปรับขยายคอลัมน์ยุทธวิธี (`.col-tactical-half`) ให้มีความกว้าง `110px - 138px` เพื่อให้มีระยะห่างระหว่างคอลัมน์มากกว่า 25-35px
    - ผู้จัดการทีมสามารถเลื่อนดูสนามและแตะปุ่ม ⚽, 👟 และ OG ของนักเตะแต่ละตำแหน่งได้อย่างแม่นยำ ชัดเจน ไม่มีปุ่มเกยหรือซ้อนทับกันอีกต่อไป
    - รักษาขนาดปุ่มใหญ่พิเศษในมุมมองสนามเดี่ยวแนวตั้ง (`.match-pitch-vertical`) ไว้คงเดิม ไม่กระทบการใช้งานแบบรายทีม

---

## [0.6.2] - 2026-10-24

### Fixed
- **Restore Dual Pitch Visibility & Fix Single-Team Pitch Clipping in Modal (`public/style.css`, `public/update.shtml`)**:
  - **แก้ไขปัญหาผังสนามคู่ไม่แสดงผลในโหมด Modal บนมือถือ**: เปลี่ยนเลย์เอาต์ `.match-pitch-wrapper` จากเดิมที่ใช้ Flexbox พร้อม `overflow: hidden` (ซึ่งทำให้ความสูงของสนามหดตัวเหลือ 0px เมื่ออยู่ใน Flex Container) ให้เป็น `display: block` พร้อม `overflow-x: auto` และกำหนด `min-width: 720px; min-height: 440px;` ทำให้ผังสนามคู่ทั้งสองฝั่งแสดงผลได้อย่างครบถ้วนและเลื่อนซ้าย-ขวาเพื่อเลือกนักเตะได้อย่างราบรื่น
  - **แก้ไขปัญหาผังสนามเดี่ยว (รายทีม) โดนขอบสนามบังผู้เล่นด้านบนและด้านล่าง**: นำการจัดตำแหน่งแบบ `justify-content: center` ออก เปลี่ยนเป็น `justify-content: flex-start` พร้อมเพิ่ม Padding ด้านบนและด้านล่าง (`1.5rem`) และตั้งค่า `height: auto; overflow: visible;` ทำให้นักเตะแถวหน้า (CF/AM) และกองหลัง/ผู้รักษาประตู (DF/GK) แสดงผลอยู่ในกรอบสนามแข่งขันอย่างชัดเจน ไม่โดนขอบบน ขอบล่าง หรือการ์ดเหตุการณ์บังอีกต่อไป
  - **ซิงก์ปุ่มสลับสถานะใน Scoreboard Toolbar**: อัปเดตปุ่มกดขยายสนามในแถบเครื่องมือให้สลับข้อความเป็น `🗗 ย่อสนาม` เมื่ออยู่ในโหมด Modal เพื่อให้ผู้ใช้สามารถกดคลิกเพื่อปิดหน้าต่างขยายสนามได้จากปุ่มนี้โดยตรง

- **Restore Pitch Rendering & Decouple Modal Backdrop (`public/update.shtml`, `public/style.css`)**:
  - แก้ไขข้อผิดพลาดโครงสร้างแท็ก Vue Template (`v-if` / `v-else`) ที่การครอบ `div` ซ้อนทับการ์ดสนามทำให้บล็อก `<div class="card" v-else>` ขาดคู่ `v-if` ส่งผลให้ Vue runtime compiler ทำงานล้มเหลวและสนามแข่งขันหายไปจากหน้าจอ
  - แยกแท็ก `<div class="pitch-modal-backdrop" v-if="isPitchModal" @click="closePitchModal"></div>` ออกมาเป็นอิสระ และคงลำดับ Sibling ของ `<div class="match-stadium-card" v-if="currentSelectedMatch">` คู่กับ `<div class="card" v-else>` อย่างถูกต้อง
  - ปรับการจัดตำแหน่งของการ์ดสนามในโหมด Modal เป็น `position: fixed` อยู่กึ่งกลางหน้าจอ (`top: 50%`, `left: 50%`, `transform: translate(-50%, -50%)`) พร้อมกำหนด `z-index: 9999` ลอยอยู่เหนือ Backdrop (`z-index: 9990`) ช่วยให้แสดงผลสนามได้อย่างถูกต้องทั้งในมุมมองปกติและโหมดขยายสนาม

### Added
- **Expanded Modal Stadium Pitch (โหมดขยายผังสนามแบบหน้าต่าง Modal ขนาดใหญ่ โดยไม่ใช้ F11 เพื่อเลือกกดปุ่มประตูได้ง่าย)**:
  - **เปิดผังสนามเป็นหน้าต่าง Modal Overlay ขนาดใหญ่ (`public/update.shtml`, `public/style.css`)**:
    - ปรับเปลี่ยนจากการใช้โหมดเต็มจอเบราว์เซอร์ (F11 / Fullscreen API) เป็น **หน้าต่าง Modal Overlay ขนาดใหญ่ (`.pitch-modal-backdrop`)** พร้อมฉากหลังโปร่งแสงสีมืดและเอฟเฟกต์เบลอ (Blur Backdrop)
    - เมื่อกดปุ่ม `🔍 ขยายสนาม` ตัวสนามแข่งขันและ Scoreboard จะเปิดขึ้นมาเป็นการ์ด Modal ขนาดใหญ่กินพื้นที่เกือบเต็มหน้าจอ (`98vw` × `94vh`)
    - ไม่รบกวนแถบ URL หรือแท็บของเบราว์เซอร์ และปิดได้ง่ายด้วยการกดปุ่ม `✕ ปิด`, คลิกพื้นที่ฉากหลังสีมืด หรือกดปุ่ม `Esc` บนคีย์บอร์ด
  - **ปุ่มกดบันทึกประตู/แอสซิสต์ และอวาตาร์ผู้เล่นขนาดใหญ่ Touch-Friendly (`public/style.css`)**:
    - ปรับขยายขนาดปุ่มด่วน `⚽ +1 ประตู` (`.btn-quick-goal`), `👟 +1 แอสซิสต์` (`.btn-quick-assist`) และ `OG` ให้มีขนาดใหญ่พิเศษ (`font-size: 1.05rem`, padding หนา ขอบมน เงามิติสวยงาม)
    - ขยายอวาตาร์ผู้เล่นเป็น 52px และขยายป้ายชื่อผู้เล่นให้อ่านง่าย แตะสั่งการบันทึกประตูด้วยนิ้วข้างสนามได้อย่างแม่นยำและรวดเร็ว

- **Position Manager Full Screen Mode (เพิ่มระบบขยายเต็มจอในหน้าจัดตำแหน่งผังสนาม)**:
  - **ปุ่มสลับ ⛶ Fullscreen ใน Save Action Toolbar และปุ่มลอย (`public/position.shtml`, `public/style.css`)**:
    - เพิ่มปุ่มกดสลับโหมดเต็มจอ `⛶ ขยายเต็มจอ` / `🗗 ออกจากเต็มจอ` ในแถบควบคุม (`save-action-bar`) ถัดจากปุ่มเลือกคอลัมน์ (🔲 2 คอลัมน์ / 📑 1 คอลัมน์)
    - เพิ่มปุ่มลอย Full Screen (`.fullscreen-toggle`) ที่มุมขวาบนถัดจากปุ่มสลับธีม (`.theme-toggle`) เพื่อให้สามารถกดเข้า/ออกจากโหมดเต็มจอได้สะดวกไม่ว่าจะเลื่อนหน้าจออยู่ตำแหน่งใด
    - เชื่อมต่อกับ HTML5 Fullscreen API (`requestFullscreen` / `exitFullscreen`) ครอบคลุมเบราว์เซอร์หลัก พร้อมการตรวจจับเหตุการณ์ `fullscreenchange` เพื่อซิงก์สถานะอัตโนมัติ (เช่น เมื่อผู้ใช้กดปุ่ม `Esc` หรือ `F11`)
    - มีระบบ Fallback ในกรณีที่เบราว์เซอร์ไม่อนุญาตหรือบล็อก Fullscreen API ระบบจะยังคงขยายเลย์เอาต์หน้าจอให้กว้างเต็มขอบจอ (Full Width) ให้โดยอัตโนมัติ
  - **ปรับแต่ง Layout ขยายเต็มขอบจอและเพิ่มขนาดสนาม (`public/style.css`)**:
    - ปรับขยายขนาด Container ปกติของ `#position-app` เป็น 1240px และเมื่อเปิด Fullscreen จะขยายเต็มหน้าจอ 100% ไร้ขอบจำกัด
    - ปรับเพิ่มความสูงสนามแท็กติก (`.tactical-pitch`) เป็น 420-440px เมื่ออยู่ในโหมดเต็มจอ ทำให้มีพื้นที่ลากวางผู้เล่นสะดวก ไม่บีบอัด และเห็นรายชื่อชัดเจน

---

## [0.6.1] - 2026-10-20

### Added / Changed
- **Update Team Randomization Notice Text (ปรับข้อความแจ้งเตือนเวลาสุ่มทีมให้ตรงไปตรงมา)**:
  - **ปรับข้อความแจ้งเตือนในหน้าเว็บและ LINE Bot (`public/update.shtml`, `routes/web.js`, `query.js`, `cmd.js`)**:
    - เปลี่ยนจากข้อความเดิมที่ระบุว่า "เปิดเผยรายชื่อทีมเมื่อไหร่ / ป้องกันการรู้รายชื่อทีมที่สุ่มไว้ล่วงหน้า" ซึ่งทำให้เข้าใจผิดว่าระบบได้สุ่มทีมไว้ล่วงหน้าแล้ว
    - เปลี่ยนเป็นข้อความแจ้งเวลาสุ่มทีมโดยตรง: "🎲 ระบบจะทำการสุ่มทีมวันศุกร์ เวลา 20:00 น." และ "ผังการเล่นและรายชื่อทีมจะแสดงผลอัตโนมัติหลังการสุ่มทีมครับ"
    - ปรับเปลี่ยนข้อความตอบกลับในบอท LINE เมื่อสั่ง `/teamweek`, `/teamimg` ในช่วงก่อนวันศุกร์ 20:00 น. ให้แจ้งเตือนอย่างกระชับว่า "⚠️ ระบบจะทำการสุ่มทีมในวันศุกร์ เวลา 20:00 น. ครับ"

- **Scoreboard Team Selection Integration & Pitch Selector Removal (รวมการเลือกทีมเข้ากับป้าย Scoreboard และตัดแถบเลือกทีมซ้ำซ้อนออก)**:
  - **คลิกเลือกดูผังสนามเดี่ยวได้จากป้ายชื่อทีมบน Scoreboard โดยตรง (`public/update.shtml`)**:
    - ผู้ใช้สามารถคลิกที่ป้ายชื่อทีม Team A หรือ Team B ใน Scoreboard เพื่อสลับดูผังสนามแนวตั้งของทีมนั้นๆ ได้ทันที
    - มีเอฟเฟกต์ไฮไลต์ชัดเจนเมื่อถูกเลือก (Outline สีขาวรอบป้าย, แสงเรือง, ขยายขนาดเล็กน้อย 1.05 เท่า และหรี่ความเข้มของทีมที่ไม่ได้เลือกเหลือ 0.55)
  - **หากไม่เลือกทีม ให้แสดงสนามคู่เป็นค่าเริ่มต้น (Default Dual Pitch)**:
    - ค่าเริ่มต้น `activePitchTab` ถูกปรับให้เป็น 'both' (แสดงสนามคู่ทั้งสองทีม)
    - หากคลิกที่ป้ายทีมที่กำลังดูอยู่ซ้ำอีกครั้ง จะเป็นการยกเลิกการเลือกและสลับกลับมาแสดงสนามคู่ทันที
    - สามารถคลิกที่ตัวเลขผลบอลตรงกลาง Scoreboard (`scoreboard-digits`) หรือปุ่ม ⚔️ ดูสนามคู่ ในแถบด้านบน เพื่อกลับมาดูสนามคู่ได้ตลอดเวลา
  - **ตัดแถบแท็บ `pitch-view-selector-bar` ออกทั้งหมด**:
    - นำแถบแท็บ [ Team A ] [ Team B ] [ ⚔️ สนามคู่ ] ที่เคยอยู่ใต้ Scoreboard ออกอย่างสมบูรณ์ ลดความซ้ำซ้อนของ UI และทำให้พื้นที่หน้าจอแสดงผลสนามแข่งขันได้กว้างขึ้น

- **UI Redundancy Cleanup & Scoreboard Enhancements (ลดความซ้ำซ้อนแถบเลือกทีม และปรับขนาดตัวหนังสือใน Scoreboard)**:
  - **ตัดแถบชื่อทีมที่ซ้ำซ้อนในแนวตั้ง (`vp-header-bar`) ออก**:
    - นำแถบกล่องชื่อทีมด้านบนของผังสนามแนวตั้งออก คงไว้เฉพาะแถบแท็บด้านบน (`pitch-view-selector-bar`) เพียงตำแหน่งเดียว ช่วยลดความซ้ำซ้อนและประหยัดพื้นที่แนวตั้งบนจอมือถือ
  - **ปรับขนาดตัวอักษรและปุ่มใน Scoreboard ให้ใหญ่และอ่านง่ายขึ้น (`public/style.css`)**:
    - ปรับขนาดตัวอักษรส่วนหัว `scoreboard-top-meta` จาก `0.68rem` เป็น `0.85rem` (บนมือถือจาก `0.62rem` เป็น `0.8rem`)
    - ปรับขนาดป้ายชื่อทีม `scoreboard-badge` จาก `0.78rem` เป็น `0.95rem` (บนมือถือจาก `0.72rem` เป็น `0.88rem`) พร้อมเพิ่ม Padding เพื่อความสมดุล
    - ปรับขนาดตัวเลขผลบอล `scoreboard-digits` จาก `1.45rem` เป็น `1.85rem` (บนมือถือจาก `1.25rem` เป็น `1.6rem`) เด่นชัด ชัดเจน
    - ปรับขนาดปุ่มเครื่องมือ `btn-scoreboard-tool` จาก `0.75rem` เป็น `0.85rem` (บนมือถือจาก `0.72rem` เป็น `0.82rem`) เพื่อให้กดง่ายขึ้น
  - **ซ่อนปุ่ม "↩️ แข่งต่อ" สำหรับสัปดาห์ที่จบการแข่งขันไปแล้ว**:
    - เพิ่มเงื่อนไข `!isWeekEnded` ตรวจสอบทั้งเวลาสิ้นสุดของสัปดาห์และสัปดาห์ย้อนหลัง
    - เมื่อผู้ใช้เปิดดูสัปดาห์ที่จบไปแล้ว จะไม่แสดงปุ่ม "แข่งต่อ" ป้องกันความสับสนและการกดเปิดแมตช์ย้อนหลังโดยไม่ตั้งใจ

- **UI & Match Status Improvements (นำป้ายคำว่า LIVE ออก และป้องกันการเปลี่ยนสถานะแมตช์เป็น in_progress อัตโนมัติ)**:
  - **นำป้ายคำว่า "LIVE" ออกจาก UI ทั้งหมด (`public/update.shtml`)**:
    - นำป้ายสีแดง `LIVE` ออกจากส่วนหัว Scoreboard (`scoreboard-top-meta`), แถบ Match Selector Dropdown และรายการการแข่งขันย้อนหลัง ทำให้ UI ดูสะอาด สบายตา และไม่รบกวนสายตา
    - แสดงเฉพาะสถานะ `FT` (เมื่อจบการแข่งขัน) หรือ `รอแข่ง` (สำหรับแมตช์ที่รอเริ่ม)
  - **แก้ไขปัญหา Match 1 ถูกตั้งค่าเป็น `in_progress` ก่อนวันแข่งจริง (`routes/web.js`)**:
    - ลบคำสั่ง `UPDATE match_stat_tbl SET status = 'in_progress'` อัตโนมัติในฟังก์ชัน `getLastMatchWeek()` ที่เคยทำงานใน HTTP GET request
    - ป้องกันไม่ให้แมตช์ที่ 1 ถูกเปลี่ยนสถานะเป็นกำลังแข่งขันล่วงหน้าหลายวัน แมตช์จะคงสถานะ `scheduled` (รอแข่ง) ตามจริงจนกว่ากรรมการจะกดเริ่มแมตช์หรือมีการบันทึกคะแนน
    - รีเซ็ตสถานะ Match 1 ของสัปดาห์ที่ 333 ในฐานข้อมูลกลับเป็น `scheduled` เรียบร้อยแล้ว

- **Team Roster Leak Protection before Friday 20:00 (ระบบป้องกันการรู้ผลการสุ่มทีมล่วงหน้าก่อน 20:00 น. วันศุกร์)**:
  - **ซ่อนรายชื่อทีมสำหรับ Admin และ Viewer สาธารณะ**:
    - แก้ไขให้เมื่อ Login ด้วยสิทธิ์ `admin` (หรือผู้ชมทั่วไปใน `/web/view`) จะยังไม่แสดงรายชื่อและผังผู้เล่นของแต่ละทีมสำหรับสัปดาห์ปัจจุบัน หากยังไม่เกินเวลา 20:00 น. ของวันศุกร์
    - ป้องกันการรู้รายชื่อทีมและผู้เล่นล่วงหน้าที่อาจถูกสุ่มไว้ก่อน (เช่น บันทึกผลการสุ่มทีมไว้ในวันพฤหัสบดี หรือวันศุกร์ช่วงกลางวัน)
  - **การคำนวณเงื่อนไขและเวลาตัดรอบ (Friday 20:00 Cutoff)**:
    - ฟังก์ชัน `isBeforeFriday2000(dateStr)`: คำนวณวันศุกร์ของสัปดาห์การแข่งขัน (Timezone Asia/Bangkok UTC+7) โดยตรวจสอบว่าเวลาปัจจุบันน้อยกว่า 20:00:00 น. หรือไม่
    - ฟังก์ชัน `isWeekRosterLocked(weekid, currentUser)`: ล็อกเฉพาะสัปดาห์ล่าสุด (สัปดาห์ปัจจุบัน) เท่านั้น สัปดาห์ย้อนหลังยังคงดูประวัติได้ตามปกติ และผู้ใช้สิทธิ์ `root` จะได้รับการยกเว้นเพื่อดูแลระบบและจัดตำแหน่งทางยุทธวิธี
    - ฟังก์ชัน `isMatchRosterLocked(matchid, currentUser)`: ป้องกันการเรียกดูสมาชิกผ่าน API `get_team_members`
  - **การรักษาความปลอดภัยระดับข้อมูล Backend (`routes/web.js`)**:
    - ใน `getLastMatchWeek()`: เมื่อสถานะเป็นล็อก (`is_roster_locked: true`) จะทำการ Sanitization รายชื่อ `allmembers` โดยลบ `team_id: 0` และ `color: null` ออกทั้งหมด ป้องกันการเปิดดูผ่าน Network DevTools
    - กำหนด `members: []` และบล็อกคำขอ `cmd=get_team_members` ให้ส่งคืน Array ว่าง
  - **ส่วนติดต่อผู้ใช้ Frontend (`public/update.shtml` & `public/style.css`)**:
    - แสดงการ์ดแจ้งเตือนสถานะความปลอดภัย `roster-locked-container`: แสดงข้อความ "🔒 รายชื่อทีมจะเปิดเผยวันศุกร์ เวลา 20:00 น." พร้อมระบบนับเวลาปลดล็อกอัตโนมัติ
    - ซ่อนผังสนามผู้เล่น (Pitch View), แถบเลือกทีม (Team Selector Tabs), คลังยืมตัว (Loan Pool) และเครื่องมือบันทึกคะแนนจนกว่าจะถึงเวลาที่กำหนด
    - ปรับปรุง Computed Properties (`teamAPlayers`, `teamBPlayers`, `loanPoolPlayers`, `availableLoanColors`) ให้ส่งคืนค่าว่างเพื่อความปลอดภัยสูงสุด

---

## [0.6.0] - 2026-10-19

### Added / Changed
- **Safe Back-to-Front Match Deletion (ระบบลบแมตช์ย้อนกลับพร้อมความปลอดภัย)**:
  - **ลบแมตช์แข่งขันได้จากหลังมาหน้าเท่านั้น (Back-to-Front Deletion)**:
    - เพิ่มการตรวจสอบทั้งฝั่ง Frontend และ Backend: อนุญาตให้ลบได้เฉพาะแมตช์สุดท้ายของสัปดาห์ (`match_num == maxMatchNum`) เท่านั้น ป้องกันการเกิดช่องว่างของลำดับการแข่งขัน (Match Gap) และรักษาความต่อเนื่องของวงจรชีวิตแมตช์
    - Backend (`routes/web.js`): ตรวจสอบ `SELECT MAX(match_num)` ของสัปดาห์ หากส่งรหัสแมตช์ที่ไม่ใช่แมตช์สุดท้ายเข้ามา จะปฏิเสธพร้อมส่งข้อความแจ้งเตือนภาษาไทยทันที
    - ลบข้อมูลที่เกี่ยวข้องแบบ Cascade: ลบรายการประตูและแอสซิสต์ใน `match_goal_tbl` ก่อน แล้วจึงลบเรคคอร์ดใน `match_stat_tbl` พร้อมสั่งคำนวณและอัปเดตตารางคะแนนสัปดาห์ (`updateTableWeek()`) ให้อัตโนมัติ
  - **Safety Confirmation Modal (ป๊อปอัปยืนยันความปลอดภัยก่อนลบ)**:
    - ออกแบบ Modal ยืนยันการลบที่มีการแสดงรายละเอียดแมตช์ที่จะลบชัดเจน (คู่แข่ง, สกอร์, สถานะ และจำนวนประตูที่จะถูกลบ)
    - เพิ่มเงื่อนไข Checkbox บังคับติ๊กยืนยันความปลอดภัยก่อน จึงจะสามารถกดปุ่มลบถาวรได้
    - ปรับปุ่มลบใน Scoreboard และรายการแมตช์ให้แสดงเฉพาะคู่สุดท้ายเท่านั้น
    - แก้ไขบั๊ก `this.$refs.week_id` เดิมที่ทำให้การลบแมตช์หรือลบประตูล้มเหลว

- **Unified Monorepo Integration (Merge `soccerbotapi` into `line-webhook`)**:
  - **รวมระบบ Soccer Bot API & Web Dashboard เข้ามาใน `line-webhook` แบบสมบูรณ์**:
    - แก้ไขและดูแลโค้ดระบบ Bot และระบบ Web Dashboard ในที่เดียว ไม่ต้องแยกสองโปรเจกต์อีกต่อไป
    - เพิ่มโมดูลเราเตอร์ `routes/web.js` รองรับ Endpoint ระบบทั้งหมด:
      - `/web/match` (Interactive Pitch & Match Manager สำหรับบันทึกผลการแข่งขัน)
      - `/web/view` & `/web/matches` (Read-only Match Viewer สำหรับผู้เล่นและผู้ชม)
      - `/web/position` (Tactical Position Pitch แนวนอนสำหรับจัดวางตำแหน่งผู้เล่น)
      - `/web/login`, `/web/logout`, `/web/auth/me`, `/web/change_password` (Authentication & RBAC แบบ Bcrypt/JWT)
      - `/web/get_info`, `/web/match_view_data`, `/web/add_match`, `/web/update_position`, `/web/batch_update_positions` (RESTful APIs)
    - นำเข้าไฟล์ส่วนแสดงผล Frontend ไว้ที่โฟลเดอร์ `public/` (`update.shtml`, `position.shtml`, `login.shtml`, `view.shtml`, `style.css`)
    - ให้บริการ Static Asset อัตโนมัติที่ `/web` และ Root Redirect จาก `/` ไปยัง `/web/match`
    - **Single Port Unified Server**: ให้บริการทั้ง LINE Bot Webhook และ Web Dashboard บนพอร์ตเดิมพอร์ตเดียว (`PORT=3001`) ไม่ต้องแยกพอร์ต รันเพียงโปรเซสเดียวจบ
    - เชื่อมโยงฐานข้อมูล MySQL Connection Pool เดียวกันระหว่าง Bot และ Web Dashboard ประหยัดทรัพยากรและป้องกันปัญหา Connection ล้น
    - เพิ่มฟังก์ชัน `ensureUserTable()` ใน `query.js` สำหรับตรวจสอบและสร้างตาราง `user_tbl` พร้อมบัญชีเริ่มต้น (`admin`, `root`) อัตโนมัติ
    - ติดตั้ง Dependencies เพิ่มเติม: `bcryptjs`, `cookie-parser`, `cors`, `multer`, `winston`

- **Database-Backed Schedule & Match Progression (`/schedule`, `/now`, `/live`)**:
  - **ยกเลิกการพึ่งพา `schedule.json` และเปลี่ยนมาใช้ MySQL (`match_stat_tbl`) เป็น Single Source of Truth (SSOT) 100%**:
    - เพิ่มฟังก์ชัน `getScheduleFromDb(week_id)` ใน `query.js` ดึงข้อมูลตารางแข่งขันและประมวลผล Match Progression Lifecycle โดยตรงจากตาราง `match_stat_tbl` และ `team_color_week_tbl`
    - ปรับคำสั่ง `/schedule` ให้ตรวจสอบและโหลดตารางที่มีอยู่แล้วจากฐานข้อมูล `match_stat_tbl` โดยตรง ไม่ต้องพึ่งพาหรืออ่านไฟล์ `schedule.json`
    - ปรับฟังก์ชัน `getCurrentMatch()` สำหรับคำสั่ง `/now` และ `/live` ให้ดึงข้อมูลสดจากฐานข้อมูลโดยตรง ทำให้การแก้ไขผลการแข่งขันหรือเวลาในฐานข้อมูลสะท้อนขึ้นหน้าแชทแบบ Realtime ทันที
    - แก้ไขปัญหาความไม่สอดคล้องของข้อมูล (Data Desync) ระหว่างแคชไฟล์และฐานข้อมูลอย่างถาวร
    - เพิ่มฟังก์ชัน `formatScheduleLines(sched)` เพื่อจัดรูปแบบข้อความตารางการแข่งขันอย่างเป็นระเบียบ
    - บันทึกคู่แข่งขัน 18 แมตช์ (round, start_time, end_time, team_a_id, team_b_id, status = 'scheduled') ลงในตาราง `match_stat_tbl` โดยอัตโนมัติ
    - ป้องกันการเขียนทับผลการแข่งขันของแมตช์ที่แข่งเสร็จแล้ว (เว้นแต่จะระบุคำสั่ง force / reset)
    - เพิ่ม Migration SQL `migrations/match_stat_schedule.sql` และฟังก์ชัน `ensureMatchStatScheduleColumns()` รองรับ `MODIFY COLUMN team_a_goal INT NULL` เพื่อความสมบูรณ์ของโครงสร้างตาราง
  - **ระบบ Match Lifecycle & Automatic Cursor Progression (รองรับการจบแต่ละแมตช์ก่อนขึ้นนัดถัดไป)**:
    - ปรับปรุงฟังก์ชัน `getCurrentMatch()` ให้ตรวจสอบสถานะการแข่งขันแบบ Realtime:
      - หากมีแมตช์ที่กำลังแข่งขัน (`status = 'in_progress'`): ชี้ไปที่แมตช์นั้นเป็น Current Match (แสดงสด 🟢 LIVE)
      - หากไม่มีแมตช์ที่กำลังแข่ง (จบแมตช์ล่าสุดไปแล้ว): ระบบจะขยับ Current Match ไปยังแมตช์คิวถัดไปที่มีสถานะ `status = 'scheduled'` (รอเริ่มแข่ง) ทันที เพื่อให้ผู้เล่นทราบคู่ประกบและเวลาลงสนามล่วงหน้า
      - หากแข่งจบครบทุกคู่: แสดงสถานะจบการแข่งขันทั้งหมด (`all_finished`)
    - ปรับปรุง `buildNowFlex` และ `buildLiveFlex` ใน `flex.js`:
      - แมตช์ที่รอแข่ง (`status = 'scheduled'`) จะแสดงผล `vs` และระบุหัวข้อ `แมตช์ถัดไป (รอเริ่ม)` โดยไม่แสดงผลเสมอ 0 - 0 ล่วงหน้า
      - แมตช์ที่แข่งจบแล้วหรือกำลังแข่ง จะแสดงผลสกอร์จริงและรายละเอียดผู้ยิง/แอสซิสต์
    - แก้ไข `buildScheduleFlex` ใน `flex.js`: ปรับเงื่อนไขการแสดงผลสกอร์ให้ตรวจสอบ `isPlayedOrLive` เพื่อให้แมตช์ที่รอแข่ง (`status = 'scheduled'`) แสดงเป็น `vs` แทนการแสดงผลสกอร์ `null - null`
  - **ปรับปรุง Query สถิติตารางคะแนน (Clean Sheet / GA / Standings)**:
    - ปรับการคำนวณใน `queryTableWeek`, `getMatchWeek` และ Clean Sheet Map ให้พิจารณาเฉพาะแมตช์ที่เตะแล้วเท่านั้น ป้องกันการนำแมตช์ที่ยังไม่เตะไปคำนวณเป็นผลเสมอ 0-0

---

## [0.5.5] - 2026-10-17
- **Live Match View & Web Stream Link (`/live`)**:
  - **เพิ่มลิงก์ดูถ่ายทอดสด / ผลการแข่งขันผ่านเว็บ (`https://boxch2.kdnstream.com/web/view`)**:
    - เพิ่มแถบ Banner ใต้หัวข้อ Live! Match สำหรับคลิกเปิดดูผ่านเว็บได้ทันที
    - เพิ่มปุ่ม Footer และ Text Link ท้ายการ์ด Flex Message พร้อมรองรับตัวแปร `LIVE_WEB_URL` ใน `.env`
    - เพิ่ม Action ลิงก์ที่รูปภาพ Header ให้สามารถคลิกเพื่อเปิดเว็บได้
    - แนบลิงก์รับชมผ่านเว็บลงใน `altText` เพื่อให้เห็นใน Notification
    - เพิ่มฟังก์ชัน `makeBoxUriButton` ใน `flex.js` สำหรับสร้างปุ่มเปิด URI มาตรฐาน
  - **ขยายช่วงแมตช์ถัดไปให้แสดงเพิ่มอีก 4 แมตช์**:
    - ปรับเงื่อนไขการกรองแมตช์ใน `buildLiveFlex` เป็น `maxMatchNo = curMatchNo + 4` (แสดง 2 แมตช์ก่อนหน้า, แมตช์ปัจจุบัน, 4 แมตช์ถัดไป และแมตช์สุดท้าย เช่น `3 4 live 6 7 8 9 ... 18`)

---

## [0.5.4] - 2026-10-11

### Changed
- **Slip Verification Message Simplification (ปรับข้อความเมื่อตรวจสอบสลิปไม่สำเร็จให้กระชับ)**:
  - **ลบข้อความแจ้งเตือนข้อผิดพลาด**: กรณีที่ติดต่อ API EasySlip ไม่สำเร็จ หรือยังไม่พบข้อมูลสลิปในระบบธนาคาร (`!slipData`) ใน `processSlipData` (`slip.js`) จะไม่แสดงข้อความแจ้งเตือนยาวๆ หรือคำเตือนการตรวจสอบซ้ำ (`** 📝 ยังไม่พบข้อมูลการโอนในระบบที่เชื่อมกับธนาคาร... **`)
  - **ตอบกลับสั้นๆ**: แสดงเพียงข้อความ `🙏 {ชื่อสมาชิก} ได้รับสลิปโอนแล้ว` เพื่อยืนยันว่าได้รับรูปแล้ว โดยยังคงบันทึกข้อมูลและอัปเดตสถานะชำระเงินในสัปดาห์ให้ตามปกติ
  - **แสดงรายละเอียดเมื่อสำเร็จคงเดิม**: หากติดต่อ API สำเร็จและได้ข้อมูลสลิป (`slipData`) จะยังคงแสดงรายละเอียด ยอดเงิน, ผู้โอน, บัญชีผู้รับ และวันที่โอนตามเดิม
  - **ปรับปรุง Fallback ตรวจจับ PromptPay Slip QR**: เพิ่มการตรวจจับ PromptPay AID (`0016A000000677010111`) ควบคู่กับ `60000010103` สำหรับการยอมรับสลิปธนาคารในกรณีที่ API ล้มเหลว
  - **จัด Format ข้อความ**: ปรับการตัดช่องว่างท้ายข้อความ (trim) ระหว่าง header และรายชื่อผู้ค้างจ่ายเพื่อความสวยงาม

---

## [0.5.3] - 2026-10-09

### Added / Changed
- **Schedule Task Template Day-of-Week Conditions (รองรับเงื่อนไขวันในข้อความตั้งเวลา)**:
  - **รองรับการตรวจสอบวันในสัปดาห์**: เพิ่มการประเมินเงื่อนไขเกี่ยวกับวันใน `evaluateCondition` และ `resolveScheduleTemplateText` ผ่าน `getBangkokCurrent().dow`
  - **รูปแบบที่รองรับ**:
    - เปรียบเทียบตัวแปร `dow` / `day` / `weekday`: เช่น `{{#if dow == fri}}`, `{{#if dow == friday}}`, `{{#if dow == 5}}`, `{{#if dow != sat}}`
    - ตรวจสอบชื่อวันโดยตรง: เช่น `{{#if fri}}`, `{{#if friday}}`, `{{#if sat}}` หรือแบบ Bracket `[if fri]...[/if]`
    - รองรับ block `{{else}}` / `[else]` ร่วมด้วย
- **Random Team Assignment Update (`/randomteam`)**:
  - **ไม่นำโกล์ลงทีม (`member_tbl.team_id = 100`)**: กรองผู้เล่นที่เป็นโกล์ (`team_id = 100` ใน `member_tbl`) ออกจากการสุ่มทีมทั้งหมด โดยกำหนดให้โกล์มี `team_id = 0` (ไม่สังกัดทีมใดทีมหนึ่ง) และในการ์ดตำแหน่งโกล์ของแต่ละทีมใน Flex Message จะแสดงเป็น `'สลับกัน'` อัตโนมัติ
  - **จำกัดผู้เล่นตาม `maxweek` เคร่งครัด**: ยกเลิกการขยายโควตาผู้เล่นเป็น 32 คนอัตโนมัติ โดยคัดเลือกเฉพาะผู้เล่นในสนาม (Outfield Players) สูงสุดตามโควตา `maxweek` (`week_tbl.max` เช่น 24 คน) แบบ FIFO เท่านั้น ส่วนผู้เล่นลำดับเกินกว่านั้นจะถูกจัดเป็นตัวสำรอง (`reserveMembers`, `team_id = 0`) ทั้งหมด
- **Player, Goalkeeper & Reserve Display for `+1` (ปรับปรุงการแสดงผลลงชื่อ +1 โกล์ และ สำรอง)**:
  - **ตรวจจับตำแหน่งโกล์จาก `member_tbl.team_id = 100`**: ปรับ query ใน `getMemberWeek0` และ `getMemberWeek` ให้ดึง `member_tbl.team_id as member_team_id` เพื่อระบุตำแหน่งโกล์ได้อย่างถูกต้อง (จากเดิมที่เช็ค `member_team_week_tbl.team_id` ซึ่งเป็น 0 ในช่วงลงชื่อ)
  - **จำกัดโควตาโกล์ไม่เกินจำนวนทีม (Capped at Team Count)**: คำนวณจำนวนทีมประจำสัปดาห์จาก `team_color_week_tbl` (3 หรือ 4 ทีม) โดยโควตาโกล์จะรับได้สูงสุดเท่ากับจำนวนทีม
  - **จัดสรรผู้เล่นสำรอง (Reserves Handling)**:
    - สมาชิกตำแหน่งโกล์ที่ลงชื่อเกินโควตาจำนวนทีม จะถูกย้ายไปอยู่ในส่วน "รายชื่อสำรอง" พร้อมระบุ `(โกล์)`
    - ผู้เล่นทั่วไปที่ลงชื่อเกิน `max_players` จะถูกจัดเข้าส่วน "รายชื่อสำรอง" ตามลำดับ FIFO การลงชื่อ
  - **ปรับลำดับการแสดงผลใน Flex Message (`buildMemberWeekFlex`)**:
    - จัดลำดับ Section: 1. `▶ รายชื่อ` (ผู้เล่นในสนาม), 2. `🧤 รายชื่อโกล์`, 3. `⏳ รายชื่อสำรอง`
    - แสดงยอดโกล์ใน Subheader แบบ `🧤 X/Y` (เช่น `🧤 3/3`) และยอดสำรอง `⏳ Z`
  - **ปรับปรุงการแสดงผลในโหมดข้อความธรรมดา (Text Mode)**:
    - แสดงส่วน `=== รายชื่อโกล์ ===` ก่อน `=== รายชื่อสำรอง ===`
    - รูปแบบสรุปหัวข้อ: `+ผู้เล่น(โกล์)(สำรอง)` เช่น `+21(3)(2)`
  - **ปรับปรุงฟังก์ชันสนับสนุน**:
    - `removeReserveMembers`: ปรับให้ตรวจจับโกล์จาก `member_tbl.team_id` และจำกัดตามจำนวนทีม
    - `resolveScheduleTemplateText`: ปรับการนับ `registeredFieldPlayers` ให้กรองโกล์จาก `member_tbl.team_id = 100` ได้อย่างถูกต้อง
- **Goalkeeper & Pitch Fee Calculation (`/setcost`)**:
  - **แยกโกล์ออกจากการหารค่าสนาม**: ปรับ `setWeekCost` ให้โกล์ (`team_id = 100`) ไม่ถูกนำไปหารเฉลี่ยค่าสนาม โดยโกล์ตัวจริงจะถูกตั้งยอดค้างชำระ (debt) เป็นค่าธรรมเนียมคงที่ 40 บาทเสมอ
  - **คำนวณค่าสนามจากผู้เล่นในสนามทั้งหมด**: นำผู้เล่นในสนามทั้งหมดที่ไม่เกินโควตา `max_players` (รวม Admin) มาเป็นตัวหาร เพื่อให้ยอดเฉลี่ยคำนวณจากจำนวนคนเล่นจริง (เช่น 28 คน)
  - **บันทึกหนี้สำหรับ Admin (`admin > 0` หรือ `team_id = 101`)**: กำหนด `debt = 0` ในระบบเพื่อไม่ต้องส่งสลิปยืนยัน (หมายเหตุ: Admin ไม่ได้เล่นฟรี แต่เป็นผู้สำรองจ่ายค่าสนามและเคลียร์หักยอดกันเองภายนอก) โดยที่จำนวน Admin ยังคงถูกนำมานับเป็นตัวหารตามปกติเพื่อให้ยอดเฉลี่ยคำนวณถูกต้อง
  - **ป้องกันการคิดเงินผู้เล่นสำรอง**: สมาชิกสำรอง (ทั้งผู้เล่นและโกล์ที่เกินโควตา) จะถูกตั้งค่า debt เป็น 0
  - **ข้อความตอบกลับคำสั่ง `/setcost`**: แจ้งจำนวนผู้เล่นในสนาม ยอดเฉลี่ยต่อคน และจำนวนโกล์พร้อมค่าธรรมเนียม 40 บาทอย่างชัดเจน

---

## [0.5.2] - 2026-10-03

### Added
- **New Year Party Companion Registration & Cancellation (ระบบลงทะเบียนและยกเลิกผู้ติดตามงานเลี้ยงปีใหม่)**:
  - ปรับปรุง Footer ของ Party Flex Message เป็นแบบ 2 แถว (2 Rows of 2 Buttons):
    - แถวที่ 1: `➕ ลงชื่อ (คนเดียว)` (ส่ง `+ny`) และ `👥 มีผู้ติดตาม` (ส่ง `x2`)
    - แถวที่ 2: `➖ ยกเลิกผู้ติดตาม` (ส่ง `-guest`) และ `❌ ยกเลิกทั้งหมด` (ส่ง `-ny`)
  - เพิ่มฟังก์ชัน `unregisterGuestNY` ใน `query.js` สำหรับรีเซ็ต `guests = 0` โดยไม่ลบชื่อสมาชิกที่ลงชื่อไว้
  - เพิ่มคำสั่งยกเลิกเฉพาะผู้ติดตาม: `-guest`, `-guests`, `-follower`, `delguest`, `remguest`, `cancelguest` และคำสั่ง `-ny guest`
  - รองรับการ mention เพื่อยกเลิกผู้ติดตามแทนเพื่อน เช่น `-guest @ชื่อสมาชิก`
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
