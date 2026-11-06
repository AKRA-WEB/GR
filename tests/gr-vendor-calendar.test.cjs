const test=require('node:test'),assert=require('node:assert/strict');
const calendar=require('../js/gr-vendor-calendar.js');
test('frequency colors use four fixed percentage bands; zero and absent weekdays stay separate',()=>{
 for(const [count,total,level,label] of [[0,13,0,'ไม่พบการส่ง'],[1,4,1,'น้อยมาก'],[2,4,2,'น้อย'],[3,4,3,'กลาง'],[4,4,4,'มาก'],[0,0,0,'ไม่มีวันในช่วงนี้'],[8,13,3,'กลาง'],[1,13,1,'น้อยมาก']])assert.deepEqual(calendar.frequency(count,total),{level,label});
});
test('distinct dates, all weekday denominators, ties and zero days',()=>{
 const result=calendar.summarize([{date:'2026-10-05',billCount:8},{date:'2026-10-06',billCount:2},{date:'2026-10-13',billCount:1}],'2026-10-01','2026-10-31');
 assert.equal(result.totalDays,3);assert.deepEqual(result.counts,[1,2,0,0,0,0,0]);assert.deepEqual(result.denominators,[4,4,4,5,5,5,4]);assert.deepEqual(result.peak,['อังคาร']);
 assert.deepEqual(calendar.summarize([{date:'2026-10-05',billCount:1},{date:'2026-10-06',billCount:1}],'2026-10-01','2026-10-31').peak,['จันทร์','อังคาร']);
 assert.deepEqual(calendar.summarize([],'2026-10-01','2026-10-31').peak,[]);
});
test('date-only leap-year validation, unavailable/invalid aggregates fail closed',()=>{
 assert.equal(calendar.parse('2024-02-29').getUTCDate(),29);
 for(const value of ['2026-02-29','2026-10-01T23:00:00Z',''])assert.throws(()=>calendar.parse(value));
 for(const rows of [undefined,[{date:'2026-09-30',billCount:1}],[{date:'2026-10-01',billCount:0}],[{date:'2026-10-01',billCount:1},{date:'2026-10-01',billCount:2}]])assert.throws(()=>calendar.summarize(rows,'2026-10-01','2026-10-31'));
 assert.throws(()=>calendar.summarize([],'2024-01-01','2026-10-31'));
});
test('completed 90 Bangkok dates exclude the current date even near UTC midnight',()=>{
 assert.deepEqual(calendar.range(90,new Date('2026-11-05T18:00:00Z')),{dateFrom:'2026-08-08',dateTo:'2026-11-05'});
 assert.deepEqual(calendar.range(30,new Date('2026-11-05T16:59:00Z')),{dateFrom:'2026-10-06',dateTo:'2026-11-04'});
});
