/* Vendor delivery dates are server aggregates, independent of bill pagination. */
var GrVendorCalendar = (() => {
  'use strict';
  const weekdays=['จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์'];
  const shortDays=['จ.','อ.','พ.','พฤ.','ศ.','ส.','อา.'];
  const iso=d=>d.toISOString().slice(0,10);
  function parse(value) {
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('วันที่ไม่ถูกต้อง');
    const d=new Date(value+'T00:00:00Z');
    if(!Number.isFinite(d.getTime())||iso(d)!==value)throw Error('วันที่ไม่ถูกต้อง');
    return d;
  }
  const index=d=>(d.getUTCDay()+6)%7;
  function frequency(count,total) {
    if(!total)return {level:0,label:'ไม่มีวันในช่วงนี้'};
    if(!count)return {level:0,label:'ไม่พบการส่ง'};
    const level=Math.min(4,Math.ceil(count/total*4));
    return {level,label:['','น้อยมาก','น้อย','กลาง','มาก'][level]};
  }
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function range(days,now=new Date()) {
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
    const end=parse(`${p.year}-${p.month}-${p.day}`);end.setUTCDate(end.getUTCDate()-1);
    const start=new Date(end);start.setUTCDate(start.getUTCDate()-Number(days)+1);
    return {dateFrom:iso(start),dateTo:iso(end)};
  }
  function summarize(rows,from,to) {
    const start=parse(from),end=parse(to),denominators=Array(7).fill(0),counts=Array(7).fill(0),dates=new Map(),billsByDay=new Map();
    if(start>end||end-start>=366*86400000)throw Error('เลือกช่วงข้อมูลไม่เกิน 366 วัน');
    if(!Array.isArray(rows))throw Error('ข้อมูลวันส่งยังไม่พร้อม กรุณาโหลดใหม่หลังอัปเดตระบบ');
    for(const r of rows){
      parse(r.date);if(r.date<from||r.date>to||!Number.isSafeInteger(r.billCount)||r.billCount<1||dates.has(r.date))throw Error('ข้อมูลวันส่งไม่ครบถ้วน กรุณาโหลดใหม่');
      if(r.bills!==undefined){
        if(!Array.isArray(r.bills)||r.bills.length!==r.billCount||new Set(r.bills.map(b=>b.grId)).size!==r.billCount||r.bills.some(b=>!validId(b.grId)||!validId(b.sourceId)))throw Error('ข้อมูลอ้างอิงบิลไม่ครบถ้วน กรุณาโหลดใหม่');
        billsByDay.set(r.date,r.bills);
      }
      dates.set(r.date,r.billCount);
    }
    for(let d=new Date(start);d<=end;d.setUTCDate(d.getUTCDate()+1))denominators[index(d)]++;
    dates.forEach((_,date)=>counts[index(parse(date))]++);
    const maximum=Math.max(...counts);
    return {dates,billsByDay,counts,denominators,totalDays:dates.size,peak:maximum?weekdays.filter((_,i)=>counts[i]===maximum):[],zero:weekdays.filter((_,i)=>denominators[i]>0&&!counts[i])};
  }
  const validId=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const captureSession=()=>typeof window==='undefined'?null:{owner:window.appSession,token:window.appSession?.token};
  const sameSession=s=>s===null||typeof window!=='undefined'&&window.appSession===s.owner&&window.appSession?.token===s.token;
  let active=null,request=0,billRequest=0,root;
  const el=id=>document.getElementById(id);
  const label=value=>new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(parse(value));
  function close(){++request;++billRequest;active=null;if(root){root.hidden=true;root.replaceChildren();}el('gr-vendor-workspace')?.classList.remove('vc-workspace-open');}
  function invalidate(){close();}
  function shell() {
    root=el('gr-vendor-calendar');if(!root)return false;
    root.hidden=false;
    el('gr-vendor-workspace')?.classList.add('vc-workspace-open');
    root.innerHTML=`<button type="button" data-vc="close">กลับไปรายชื่อ Vendor</button><h3 id="vc-title"></h3><p class="gr-card-hint">อ้างอิงชื่อ Vendor ที่บันทึกใน PO · ตามตัวกรอง Dashboard · หลายบิลวันเดียว นับ 1 วัน · วิเคราะห์ถึงเมื่อวาน</p><div class="vc-controls"><label>ช่วงข้อมูล<select id="vc-range"><option value="90">90 วันย้อนหลัง</option><option value="30">30 วันย้อนหลัง</option><option value="180">180 วันย้อนหลัง</option><option value="dashboard">ตามช่วง Dashboard</option><option value="custom">กำหนดเอง</option></select></label><label id="vc-from-label" hidden>จากวันที่<input id="vc-from" type="date"></label><label id="vc-to-label" hidden>ถึงวันที่<input id="vc-to" type="date"></label></div><p id="vc-period" class="gr-card-hint"></p><div id="vc-status" role="status" aria-live="polite"></div><div id="vc-content"></div>`;
    el('vc-title').textContent=active.vendor;el('vc-range').value=active.mode;
    el('vc-from').value=active.query.dateFrom;el('vc-to').value=active.query.dateTo;
    root.onclick=event=>{
      const target=event.target.closest('[data-vc]');if(!target||!active)return;
      const action=target.dataset.vc;
      if(action==='close'){
        const trigger=active.trigger,vendor=active.vendor;close();
        const visible=Array.from(document.querySelectorAll('.gr-vendor-calendar-action')).find(button=>button.dataset.vendorCalendar===vendor);
        (visible||trigger)?.focus();return;
      }
      if(action==='retry'){load();return;}
      if(action==='month'){active.month.setUTCMonth(active.month.getUTCMonth()+Number(target.dataset.delta));render();return;}
      if(action==='date'){++billRequest;active.selected=target.dataset.date;render();el('vc-content').querySelector(`[data-date="${active.selected}"]`)?.focus();return;}
      if(action==='detail'){openBill(Number(target.dataset.billIndex),target);return;}
      if(action==='bills'){
        const {offset,limit,...filters}=active.query;
        const query={...filters,exactDate:active.selected};
        Object.assign(grDashboardState,query,{selectedDay:active.selected});
        el('dashboard-date-preset').value='custom';el('dashboard-custom-date-box').classList.remove('hidden');
        el('dashboard-date-from').value=query.dateFrom;el('dashboard-date-to').value=query.dateTo;
        GrDashboard.tab('bills');GrDashboard.load(true);
      }
    };
    root.onchange=event=>{if(['vc-range','vc-from','vc-to'].includes(event.target.id))changeRange();};
    return true;
  }
  function open(vendor,trigger) {
    if(!vendor||!grDashboardState.analytics)return;
    const inherited=grDashboardState.analytics.filters;
    const explicit=grDashboardState.preset!=='today',yesterday=range(1).dateTo;
    const dates=explicit?{dateFrom:inherited.dateFrom,dateTo:inherited.dateTo>yesterday?yesterday:inherited.dateTo}:range(90);
    active={vendor,trigger,mode:explicit?'dashboard':'90',query:{...GrDashboard.filters(),...dates,preset:'custom',exactDate:null,vendor,offset:0,limit:1},summary:null,selected:null};
    if(shell()){
      document.querySelectorAll('.gr-vendor-rail-choice').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.vendorCalendar===vendor)));
      load();el('vc-range').focus();
    }
  }
  function changeRange() {
    ++request;++billRequest;active.summary=null;el('vc-content').innerHTML='';
    const mode=el('vc-range').value;active.mode=mode;
    el('vc-from-label').hidden=el('vc-to-label').hidden=mode!=='custom';
    let dates;
    if(mode==='custom')dates={dateFrom:el('vc-from').value,dateTo:el('vc-to').value};
    else if(mode==='dashboard'){const f=grDashboardState.analytics?.filters,yesterday=range(1).dateTo;dates={dateFrom:f?.dateFrom,dateTo:f?.dateTo>yesterday?yesterday:f?.dateTo};}
    else dates=range(Number(mode));
    Object.assign(active.query,dates);el('vc-from').value=dates.dateFrom||'';el('vc-to').value=dates.dateTo||'';
    load();
  }
  async function load() {
    ++billRequest;const token=++request,current=active,session=captureSession();if(!current)return;
    current.summary=null;el('vc-content').innerHTML='';root.setAttribute('aria-busy','true');
    el('vc-period').textContent='';
    try {
      summarize([],current.query.dateFrom,current.query.dateTo);
      const yesterday=range(1).dateTo;
      if(current.query.dateTo>yesterday)throw Error('เลือกวันสิ้นสุดไม่เกินเมื่อวาน เพื่อเปรียบเทียบวันที่ครบแล้ว');
      el('vc-period').textContent=`${label(current.query.dateFrom)} – ${label(current.query.dateTo)}`;
      el('vc-status').textContent='กำลังโหลดประวัติวันส่ง…';
      const res=await apiCall('getGrDashboardAnalytics',{...current.query});
      if(token!==request||active!==current)return;
      if(!sameSession(session)){close();return;}
      if(!res?.success)throw Error(res?.message||'โหลดประวัติวันส่งไม่สำเร็จ');
      if(res.vendorDeliveryCalendarVersion!==1||!Array.isArray(res.vendorBreakdown)||res.filters?.dateFrom!==current.query.dateFrom||res.filters?.dateTo!==current.query.dateTo)throw Error('ข้อมูลวันส่งยังไม่พร้อม กรุณาโหลดใหม่หลังอัปเดตระบบ');
      const vendor=res.vendorBreakdown.find(r=>r.key===current.vendor);
      if(!vendor&&res.total!==0)throw Error('ข้อมูล Vendor ไม่ครบถ้วน กรุณาโหลดใหม่');
      current.summary=summarize(vendor?vendor.deliveryDays:[],current.query.dateFrom,current.query.dateTo);
      current.selected=[...current.summary.dates.keys()].sort().at(-1)||current.query.dateTo;
      current.month=parse(current.selected.slice(0,7)+'-01');el('vc-status').textContent='';render();
    }catch(error){if(token===request&&active===current){if(!sameSession(session)){close();return;}el('vc-content').innerHTML='';el('vc-status').innerHTML=`<p>${esc(error.message)}</p><button type="button" data-vc="retry">โหลดใหม่</button>`;}}
    finally{if(token===request&&active===current)root.setAttribute('aria-busy','false');}
  }
  async function openBill(index,trigger) {
    const current=active,day=current?.selected,row=current?.summary?.billsByDay.get(day)?.[index];
    if(!Number.isSafeInteger(index)||index<0||!row)return;
    const token=++billRequest,session=captureSession();
    const status=()=>el('vc-bill-status'),valid=()=>active===current&&current.selected===day&&token===billRequest&&sameSession(session);
    trigger.disabled=true;status().textContent='กำลังเปิดรายละเอียด GR…';
    try{
      // Eligibility belongs to the whole report period: a logical bill may have
      // another SKU/warehouse on another arrival date. Its exact source ID still
      // selects only the clicked bill; preserve that population for detail lookup.
      const res=await apiCall('getGrDashboardAnalytics',{...current.query,exactDate:null,search:row.sourceId,offset:0,limit:20});
      if(!valid())return;
      if(!res?.success||res.schemaVersion!==2)throw Error(res?.message||'เปิดรายละเอียด GR ไม่สำเร็จ กรุณาลองอีกครั้ง');
      const bill=(res.bills||[]).find(b=>String(b.grId)===row.grId&&Array.isArray(b.grIds)&&b.grIds.includes(row.sourceId));
      if(!bill)throw Error('ไม่พบบิล GR ที่อ้างอิง อาจมีการดึงกลับหรือแก้ไข กรุณาโหลดประวัติใหม่');
      if(typeof openGrBillDetailModal!=='function')throw Error('หน้ารายละเอียด GR ยังไม่พร้อม กรุณารีเฟรช');
      status().textContent='';openGrBillDetailModal(bill.grId,bill,el('vc-bill-link-'+index)||trigger);
    }catch(error){if(valid())status().textContent=error.message||'เปิดรายละเอียด GR ไม่สำเร็จ';}
    finally{trigger.disabled=false;if(active===current&&!sameSession(session))close();}
  }
  function render() {
    if(!active?.summary)return;
    const s=active.summary,from=active.query.dateFrom,to=active.query.dateTo,month=iso(active.month).slice(0,7);
    const count=s.dates.get(active.selected)||0;
    const dayBills=s.billsByDay.get(active.selected);
    const billLinks=Array.isArray(dayBills)?`<div class="vc-day-bills"><h5>เลขบิลที่รับจริง</h5>${dayBills.map((b,i)=>`<button type="button" id="vc-bill-link-${i}" class="vc-bill-link" data-vc="detail" data-bill-index="${i}">${esc(b.grNumber||'ดูใบ GR')}</button>`).join('')}</div>`:'';
    let calendar=shortDays.map(d=>`<span class="vc-dow">${d}</span>`).join('')+'<span aria-hidden="true"></span>'.repeat(index(active.month));
    const length=new Date(Date.UTC(active.month.getUTCFullYear(),active.month.getUTCMonth()+1,0)).getUTCDate();
    for(let n=1;n<=length;n++){
      const date=month+'-'+String(n).padStart(2,'0'),hit=s.dates.has(date),disabled=date<from||date>to;
      const weekday=index(parse(date)),tone=frequency(s.counts[weekday],s.denominators[weekday]);
      calendar+=`<button type="button" class="vc-date ${hit?'vc-hit vc-frequency-'+tone.level:''}" data-vc="date" data-date="${date}" aria-pressed="${date===active.selected}" aria-label="${esc(label(date))} ${disabled?'นอกช่วงข้อมูล':hit?'มีส่ง · ความถี่'+tone.label:'ไม่พบการส่ง'}" ${disabled?'disabled':''}>${n}<small>${hit?'มีส่ง':'·'}</small></button>`;
    }
    el('vc-content').innerHTML=`<div class="vc-summary" role="status"><strong>${s.peak.length?'มาส่งบ่อยที่สุด: '+s.peak.join(' / '):'ยังไม่มีประวัติรับสินค้าในช่วงที่เลือก'}</strong><p>พบการส่ง ${s.totalDays} วัน</p><p class="gr-card-hint">ไม่พบการส่งในช่วงนี้: ${s.zero.join(' / ')||'ไม่มี'}</p></div><h4>ความถี่ตามวันในสัปดาห์</h4><div class="vc-week">${s.counts.map((n,i)=>`<div class="vc-weekday vc-frequency-${frequency(n,s.denominators[i]).level}" aria-label="${weekdays[i]} · ความถี่${frequency(n,s.denominators[i]).label} · ${n} จาก ${s.denominators[i]} วัน"><span>${shortDays[i]}</span><strong>${n}</strong><span>/ ${s.denominators[i]} วัน</span><div class="vc-track"><div style="width:${s.denominators[i]?100*n/s.denominators[i]:0}%"></div></div><small>${s.denominators[i]?Math.round(100*n/s.denominators[i])+'%':'ไม่มีวันในช่วงนี้'}</small></div>`).join('')}</div><div class="vc-frequency-legend" aria-label="ระดับสีความถี่การส่ง">${['น้อยมาก','น้อย','กลาง','มาก'].map((text,i)=>`<span><i class="vc-frequency-${i+1}" aria-hidden="true"></i>${text} <small>${['>0–25%','>25–50%','>50–75%','>75–100%'][i]}</small></span>`).join('')}</div><p class="gr-card-hint">จำนวนวันที่มาส่ง / จำนวนวันนั้นในช่วงที่เลือก · สีเทา = ไม่พบการส่ง</p><div class="vc-layout"><section aria-label="ปฏิทินวันที่รับสินค้า"><div class="vc-monthbar"><button type="button" data-vc="month" data-delta="-1" ${month<=from.slice(0,7)?'disabled':''}>เดือนก่อน</button><h4>${new Intl.DateTimeFormat('th-TH',{month:'long',year:'numeric',timeZone:'UTC'}).format(active.month)}</h4><button type="button" data-vc="month" data-delta="1" ${month>=to.slice(0,7)?'disabled':''}>เดือนถัดไป</button></div><div class="vc-calendar">${calendar}</div><p class="gr-card-hint">วันที่มีส่งใช้สีตามความถี่ของวันในสัปดาห์ · สีจาง = นอกช่วงข้อมูล</p></section><section class="vc-detail" aria-live="polite"><h4>${label(active.selected)}</h4><p>${count?'มาส่ง 1 วัน · '+count+' บิล':'ไม่พบการส่งในวันที่เลือก'}</p>${count?`<button type="button" data-vc="bills">ดูบิลรับสินค้า ${count} บิล</button>`:''}${billLinks}<p id="vc-bill-status" role="status" aria-live="polite"></p></section></div><p class="gr-card-hint vc-note">ประวัติในช่วงที่เลือก ไม่ใช่ตารางนัดหรือการรับประกันวันส่งครั้งถัดไป</p>`;
  }
  return {open,close,invalidate,summarize,range,parse,openBill,frequency};
})();
if(typeof module==='object'&&module.exports)module.exports=GrVendorCalendar;
