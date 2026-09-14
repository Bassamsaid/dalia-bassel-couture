'use strict';
/* Demo data for Daliessa Academy. Run: npm run seed  (safe to re-run: clears demo tables first) */

const { db, ready, hashPassword } = require('./db');

(async () => {
await ready;

const clear = ['payments', 'reminders', 'enrollments', 'groups', 'rounds', 'videos', 'homeworks',
  'submissions', 'quiz_questions', 'quiz_attempts', 'quizzes', 'notes', 'dalia_posts',
  'dresses', 'dress_fittings', 'dress_images', 'attendance', 'salaries', 'leaves'];
for (const t of clear) await db.exec(`DELETE FROM ${t}`);
await db.exec(`DELETE FROM users WHERE role!='admin'`);

// Round + 4 groups (Fri/Sat, 11-3 & 5-9)
const r = await db.prepare(`INSERT INTO rounds (number,name,description,start_date) VALUES (1,'راوند أغسطس','كورس الباترون الأساسي','2026-08-15')`).run();
const roundId = r.lastInsertRowid;
const groupRows = [
  ['مجموعة 1', 'friday', '11-3'], ['مجموعة 2', 'friday', '5-9'],
  ['مجموعة 3', 'saturday', '11-3'], ['مجموعة 4', 'saturday', '5-9'],
];
const groupIds = [];
for (const g of groupRows) groupIds.push((await db.prepare('INSERT INTO groups (round_id,name,day,time_slot,capacity) VALUES (?,?,?,?,6)').run(roundId, ...g)).lastInsertRowid);

// Trainees with fees + deposits
const trainees = [
  ['ملك أحمد', 'malak@d.com', 5000, 2000, groupIds[0]],
  ['نور محمد', 'nour@d.com', 5000, 5000, groupIds[0]],
  ['حبيبة علي', 'habiba@d.com', 5000, 1500, groupIds[1]],
  ['سلمى خالد', 'salma@d.com', 5000, 3000, groupIds[2]],
  ['ريم سامي', 'reem@d.com', 5000, 0, groupIds[3]],
];
const tIds = [];
for (const [name, email, fee, dep, gid] of trainees) {
  const uid = (await db.prepare(`INSERT INTO users (name,email,password_hash,role,round_id,group_id) VALUES (?,?,?,'trainee',?,?)`)
    .run(name, email, hashPassword('123456'), roundId, gid)).lastInsertRowid;
  await db.prepare('INSERT INTO enrollments (user_id,round_id,total_fee) VALUES (?,?,?)').run(uid, roundId, fee);
  if (dep > 0) await db.prepare(`INSERT INTO payments (user_id,amount,kind,note) VALUES (?,?,'deposit','مقدم')`).run(uid, dep);
  tIds.push(uid);
}
// A payment reminder
await db.prepare(`INSERT INTO reminders (user_id,due_date,amount,note) VALUES (?,?,?,?)`).run(tIds[0], '2026-09-01', 3000, 'باقي الكورس');
await db.prepare(`INSERT INTO reminders (user_id,due_date,amount,note) VALUES (?,?,?,?)`).run(tIds[3], '2026-09-05', 2000, 'قسط تاني');

// Content
await db.prepare(`INSERT INTO videos (round_id,title,description,url) VALUES (?,?,?,?)`).run(roundId, 'مقدمة الباترون', 'أساسيات رسم الباترون', 'https://youtu.be/dQw4w9WgXcQ');
await db.prepare(`INSERT INTO videos (round_id,title,description,url) VALUES (?,?,?,?)`).run(roundId, 'أخذ المقاسات', 'طريقة أخذ المقاسات الصحيحة', 'https://youtu.be/dQw4w9WgXcQ');
await db.prepare(`INSERT INTO homeworks (round_id,title,measurements,instructions,due_date) VALUES (?,?,?,?,?)`)
  .run(roundId, 'باترون جسم أساسي', 'الصدر 90 / الوسط 72 / الأرداف 96 / الطول 160', 'ارسمي الباترون الأساسي وصوريه', '2026-08-22');
await db.prepare(`INSERT INTO notes (scope,round_id,title,body) VALUES ('round',?,?,?)`).run(roundId, 'أدوات الحصة الأولى', 'محتاجين: ورق باترون، مسطرة، قلم، متر قياش.');
await db.prepare(`INSERT INTO notes (scope,title,body) VALUES ('all',?,?)`).run('أهلاً بكم', 'مرحباً بكل متدربات أكاديمية داليسا 🌸');

// Quiz
const q = await db.prepare(`INSERT INTO quizzes (round_id,title,ref_code,duration_min) VALUES (?,?,?,?)`).run(roundId, 'كويز المقاسات', 'Q-BASIC1', 10);
const qid = q.lastInsertRowid;
const questions = [
  ['وحدة قياس المتر في الخياطة؟', ['سنتيمتر', 'كيلومتر', 'لتر'], 0],
  ['أي مقاس أوسع عادةً؟', ['الوسط', 'الأرداف', 'الرقبة'], 1],
  ['الباترون الأساسي يبدأ من؟', ['الأكمام', 'الجسم', 'الياقة'], 1],
];
for (const [text, opts, ci] of questions) await db.prepare('INSERT INTO quiz_questions (quiz_id,text,options,correct_index) VALUES (?,?,?,?)').run(qid, text, JSON.stringify(opts), ci);

// Dalia post with a table
await db.prepare(`INSERT INTO dalia_posts (title,body,table_data) VALUES (?,?,?)`)
  .run('أسعار الكورسات', 'كورسات أكاديمية داليسا وأسعارها', JSON.stringify({ cols: ['الكورس', 'المدة', 'السعر'], rows: [['الباترون الأساسي', 'شهر', '5000'], ['التفصيل المتقدم', 'شهرين', '8000'], ['الفساتين', 'حسب الطلب', 'يحدد']] }));

// Customer + dress
const custId = (await db.prepare(`INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'customer')`).run('ليلى (زبونة)', 'laila@d.com', hashPassword('123456'))).lastInsertRowid;
const dId = (await db.prepare(`INSERT INTO dresses (customer_name,customer_user_id,phone,delivery_date,status,note) VALUES (?,?,?,?,?,?)`)
  .run('ليلى أحمد', custId, '01000000000', '2026-09-20', 'in_progress', 'فستان زفاف دانتيل')).lastInsertRowid;
await db.prepare('INSERT INTO dress_fittings (dress_id,fitting_date,note) VALUES (?,?,?)').run(dId, '2026-08-25', 'الفيتنج الأول');
await db.prepare('INSERT INTO dress_fittings (dress_id,fitting_date,note) VALUES (?,?,?)').run(dId, '2026-09-10', 'الفيتنج النهائي');

// Staff
const st = (await db.prepare(`INSERT INTO users (name,email,password_hash,role,job_title,base_salary,hire_date) VALUES (?,?,?,'staff',?,?,?)`)
  .run('منى (مساعدة)', 'mona@d.com', hashPassword('123456'), 'مساعدة تدريب', 6000, '2026-01-01')).lastInsertRowid;
await db.prepare(`INSERT INTO salaries (user_id,month,base,bonus,deduction,paid) VALUES (?,?,?,?,?,1)`).run(st, '2026-07', 6000, 500, 0);
await db.prepare(`INSERT INTO leaves (user_id,from_date,to_date,type,reason,status) VALUES (?,?,?,'annual',?,'pending')`).run(st, '2026-08-20', '2026-08-21', 'ظروف عائلية');

console.log('Demo data seeded ✓');
console.log('Logins (password 123456): malak@d.com (متدربة) · laila@d.com (زبونة) · mona@d.com (موظفة)');
console.log('Admin: admin@daliessa.com / daliessa123');

})();
