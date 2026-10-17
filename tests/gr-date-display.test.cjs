// Actual display helper/dashboard date consumer; storage/API parsers are not replaced.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
test('GR date consumers render BE while date-only/legacy/timestamp boundaries stay explicit',()=>{
  const window={},context=vm.createContext({window,Intl,Date});
  vm.runInContext(fs.readFileSync(path.join(root,'js/bm-date-display.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'js/gr-dashboard-v2.js'),'utf8'),context);
  for(const value of ['2026-10-12','12/10/2026','12/10/2569'])assert.equal(context.GrDashboard.date(value),'12 ต.ค. 2569');
  assert.equal(context.GrDashboard.date('2569-10-12'),'12 ต.ค. 3112');
  assert.equal(context.GrDashboard.date('2026-02-29'),'2026-02-29');
  assert.equal(context.GrDashboard.date('G2C'),'G2C');
  assert.equal(context.GrDashboard.date(''),'—');
  assert.equal(window.BMDateDisplay.dateTime('2026-10-12T23:00:00Z'),'13 ต.ค. 2569 - 06:00:00');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const code=html.match(/    function Utilities_formatDateFrontEnd\(dateStr\) \{[^\n]+/)[0];
  vm.runInContext(code,context);
  assert.equal(context.Utilities_formatDateFrontEnd('2026-10-12'),'12/10/2026','existing GR mutation ATA serialization remains CE');
});
