/* Dashboard v2: one server-filtered population for cards, charts and bill pages. */
var GrDashboard = (() => {
  'use strict';
  const issues = { SHORT_DELIVERY:'ของไม่ครบ', BACKORDER:'ค้างส่ง', DAMAGED:'พบสินค้าเสียหาย', BILL_CORRECTION:'แก้บิล', RETURNED:'ตีกลับ', NO_PO:'ไม่มี PO' };
  const chartSpecs = [ ['warehouse','ลงคลังไหน อะไร เท่าไหร่','ลัง','warehouseBreakdown'], ['vendor','Vendor ที่มีบิลส่งของมากที่สุด','บิล','vendorBreakdown'], ['sku','SKU ที่มีปริมาณรับเข้าสูงสุด','ลัง','skuBreakdown'], ['receiver','พนักงานที่รับผิดชอบการรับของ','GR','receiverBreakdown'] ];
  const colors=['#ea580c','#2563eb','#059669','#9333ea','#ca8a04','#64748b'];
  const warehouseColors={W1:'#fef3c7',W2:'#f97316',W3:'#facc15',W4:'#22c55e',W5:'#6b7280',C1:'#bae6fd',C2:'#1d4ed8'};
  let generation=0, lastPayload='', mutationId=null, suppressClickUntil=0;
  const el=id=>document.getElementById(id);
  const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>Number(value||0).toLocaleString('th-TH',{maximumFractionDigits:2});
  function date(value) { return String(value||'').replace(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/,'$3/$2/$1') || '—'; }
  function issueText(codes) { return !Array.isArray(codes) ? 'ยังไม่ได้ระบุ' : codes.length ? codes.map(c=>issues[c]||c).join(' · ') : 'ปกติ / ไม่พบปัญหา'; }
  function filters() { const s=grDashboardState;return {schemaVersion:2,preset:s.preset,dateFrom:s.dateFrom,dateTo:s.dateTo,exactDate:s.exactDate,warehouse:s.warehouse||'',receiver:s.receiver||'',issue:s.issue||'',liftOnly:!!s.liftOnly,search:s.search||'',vendor:s.vendor||'',sku:s.sku||''}; }
  function tab(name) {
    currentVendorLeadtimeTab=name;
    ['overview','benchmarks','product','bills'].forEach(key=>{
      const button=el({overview:'tab-btn-dashboard-overview',benchmarks:'tab-btn-vendor-benchmarks',product:'tab-btn-product-drilldown',bills:'tab-btn-approved-bills'}[key]);
      const panel=el('vendor-leadtime-tab-'+key);
      if(button){button.classList.toggle('gr-tab-active',key===name);button.classList.toggle('bg-white',key===name);button.setAttribute('aria-pressed',String(key===name));}
      panel?.classList.toggle('hidden',key!==name);
    });
    el('gr-report-filters')?.classList.toggle('hidden',name==='product');
    if(name==='product') prepareProductHistoryDashboard();
    else if(!grDashboardState.loaded&&!grDashboardState.loading) load();
    else if(name==='benchmarks') renderVendors(grDashboardState.analytics);
  }
  function preset(value) {
    grDashboardState.preset=value;grDashboardState.exactDate=null;grDashboardState.selectedDay=null;
    el('dashboard-custom-date-box').classList.toggle('hidden',value!=='custom');
    if(value==='custom') {
      const f=grDashboardState.analytics?.filters;
      el('dashboard-date-from').value=grDashboardState.dateFrom||f?.dateFrom||'';
      el('dashboard-date-to').value=grDashboardState.dateTo||f?.dateTo||'';
    } else load(true);
  }
  function custom() {
    const from=el('dashboard-date-from').value,to=el('dashboard-date-to').value;
    if(!from||!to||from>to) { el('gr-report-status').textContent='กรุณาเลือกช่วงวันที่ให้ครบ โดยวันเริ่มไม่เกินวันสิ้นสุด';return; }
    grDashboardState.dateFrom=from;grDashboardState.dateTo=to;grDashboardState.exactDate=null;load(true);
  }
  function filter() {
    const s=grDashboardState;
    s.search=el('dashboard-bill-search').value.trim();s.warehouse=el('dashboard-bill-wh').value;
    s.receiver=el('dashboard-bill-receiver').value;s.issue=el('dashboard-bill-issue').value;
    s.liftOnly=el('dashboard-lift-only').checked;
    clearTimeout(grDashboardSearchTimer);grDashboardSearchTimer=setTimeout(()=>load(true),250);
  }
  function reset() {
    Object.assign(grDashboardState,{search:'',warehouse:'',receiver:'',issue:'',liftOnly:false,vendor:'',sku:'',exactDate:null,selectedDay:null});
    ['dashboard-bill-search','dashboard-bill-wh','dashboard-bill-receiver','dashboard-bill-issue'].forEach(id=>el(id).value='');
    el('dashboard-lift-only').checked=false;load(true);
  }
  function chips() {
    const s=grDashboardState,labels=[s.vendor&&'Vendor: '+s.vendor,s.sku&&'SKU: '+s.sku,s.exactDate&&'วันที่: '+date(s.exactDate),s.liftOnly&&'ใช้ลิฟท์',s.issue&&('หมายเหตุ: '+(issues[s.issue]||{any:'พบปัญหา',normal:'ปกติ',unknown:'ยังไม่ได้ระบุ'}[s.issue]))].filter(Boolean);
    el('gr-filter-chips').textContent=labels.join(' · ');
  }
  async function load(force=false,append=false) {
    const s=grDashboardState;
    if(append&&(s.loading||!s.hasMore))return;
    const request=++generation, query=filters();
    const offset=append?s.offset:0;
    s.loading=true;s.loadingMore=append;
    if(!append){s.loaded=false;s.offset=0;s.hasMore=false;el('gr-report-content').setAttribute('aria-busy','true');el('gr-report-content').classList.add('gr-is-loading');renderGrDashboardBillsLoading();}
    updateGrDashboardLoadMoreState(true);el('gr-report-status').textContent='กำลังโหลดข้อมูล…';chips();
    try {
      const res=await apiCall('getGrDashboardAnalytics',{...query,offset,limit:s.limit});
      if(request!==generation)return;
      if(!res?.success)throw new Error(res?.message||'โหลดข้อมูลไม่สำเร็จ');
      if(res.schemaVersion!==2)throw new Error('Dashboard รุ่นใหม่ยังไม่พร้อม กรุณารีเฟรชหลังอัปเดตระบบ');
      const bills=mergeGrDashboardBills(append?s.analytics?.bills:[],res.bills);
      s.analytics={...res,bills};s.offset=offset+res.bills.length;s.total=res.total;s.hasMore=s.offset<res.total;s.loaded=true;
      el('dashboard-active-period-label').textContent=`ช่วงวันที่ ${date(res.filters.dateFrom)} – ${date(res.filters.dateTo)}`;
      renderSummary(res.summary);renderCharts(res);renderGrDailyChart(res.dailyStats);renderGrDashboardBillsTable(bills);renderVendors(res);
      const receiver=el('dashboard-bill-receiver');receiver.innerHTML='<option value="">พนักงานทั้งหมด</option>'+res.receivers.map(n=>`<option value="${html(n)}">${html(n)}</option>`).join('');receiver.value=s.receiver||'';
      if(s.receiver&&!receiver.value){receiver.add(new Option(s.receiver,s.receiver));receiver.value=s.receiver;}
      el('gr-report-status').textContent='';
      el('gr-bill-scope-summary').textContent=`${number(res.total)} บิล · รอบลิฟท์ที่ยืนยันได้ ${number(res.summary.liftRounds)} รอบ (รอบร่วมหลายบิลนับครั้งเดียว)`+(s.warehouse||s.sku?' · ยอดลังตามคลัง/SKU ที่เลือก รายละเอียดแสดงทั้งบิล':'');
    } catch(error) {
      if(request!==generation)return;
      el('gr-report-status').textContent=error.message;
      if(!append){el('gr-bill-scope-summary').textContent='';el('gr-coverage').textContent='';}
      if(!append){s.analytics=null;el('gr-kpi-row').innerHTML='<p>ยังไม่มีผลลัพธ์สำหรับตัวกรองนี้</p>';el('gr-chart-row').innerHTML='';el('vl-vendor-list').innerHTML='';el('dashboard-daily-chart').innerHTML='';el('dashboard-bills-tbody').innerHTML='<tr><td colspan="9">โหลดไม่สำเร็จ กด “โหลดใหม่” เพื่อลองอีกครั้ง</td></tr>';}
    } finally {
      if(request===generation){s.loading=false;s.loadingMore=false;el('gr-report-content').classList.remove('gr-is-loading');el('gr-report-content').setAttribute('aria-busy','false');updateGrDashboardLoadMoreState(false);}
    }
  }
  function renderSummary(s) {
    const cards=[['approved','จำนวนบิลที่อนุมัติรับลงสินค้า',number(s.approvedBills),'บิล','ดูบิลที่อนุมัติ'],['issues','จำนวนบิล / GR ที่พบปัญหา',number(s.problemBills),'บิล','ดูบิลที่พบปัญหา'],['lift','จำนวนรอบที่ใช้ลิฟท์',number(s.liftRounds),'รอบ','ดูบิลที่ใช้ลิฟท์'],['lead','Leadtime เฉลี่ย',s.overallAvgLeadDays==null?'—':number(s.overallAvgLeadDays),'วัน',`จาก ${number(s.leadtimeSamples)} บิล`]];
    el('gr-kpi-row').innerHTML=cards.map(([key,title,value,unit,hint])=>`<button type="button" class="gr-stat-card gr-slide" data-card="${key}"><span>${title}</span><strong>${value} <small>${unit}</small></strong><span class="gr-card-hint">${hint} →</span></button>`).join('');
    el('gr-coverage').textContent=[s.unreviewedBills&&`${number(s.unreviewedBills)} บิลยังไม่มีหมายเหตุปัญหา`,s.unknownLiftBills&&`${number(s.unknownLiftBills)} บิลยังยืนยันรอบลิฟท์ไม่ได้`,s.otherUnitItems&&`${number(s.otherUnitItems)} รายการหน่วยอื่น ไม่รวมในยอดลัง`,s.unknownAllocationItems&&`${number(s.unknownAllocationItems)} รายการไม่ทราบการกระจายคลัง`,s.legacyBills&&`${number(s.legacyBills)} บิลเก่านับตาม GR ต้นทาง`].filter(Boolean).join(' · ');
  }
  function drillCard(key) {
    if(key==='lead'){tab('benchmarks');return;}
    Object.assign(grDashboardState,{issue:key==='issues'?'any':'',liftOnly:key==='lift'});
    el('dashboard-bill-issue').value=grDashboardState.issue;el('dashboard-lift-only').checked=grDashboardState.liftOnly;
    tab('bills');load(true);
  }
  function renderCharts(res) {
    el('gr-chart-row').innerHTML=chartSpecs.map(([key,title,unit,field])=>{
      const rows=res[field]||[],total=rows.reduce((s,r)=>s+Number(r.value),0),shown=rows.slice(0,5);
      if(rows.length>5)shown.push({key:null,label:'อื่น ๆ',value:rows.slice(5).reduce((s,r)=>s+Number(r.value),0)});
      const color=(r,i)=>key==='warehouse'?(warehouseColors[r.key]||'#64748b'):colors[i];
      let at=0;const stops=shown.map((r,i)=>{const start=at;at+=total?r.value/total*100:0;return `${color(r,i)} ${start}% ${at}%`;});
      const gradient=stops.length?`conic-gradient(${stops.join(',')})`:'#e2e8f0';
      return `<article class="gr-donut-card gr-slide"><h3>${title}</h3><p class="gr-card-hint">${unit==='ลัง'?'เฉพาะปริมาณรับจริงหน่วยลัง':'นับหนึ่งครั้งต่อ GR'}</p><div class="gr-donut" style="background:${gradient}" role="img" aria-label="${html(title)} รวม ${number(total)} ${unit}"><div><strong>${number(total)}</strong><span>${unit}</span></div></div><ul class="gr-chart-legend">${shown.map((r,i)=>`<li><span style="background:${color(r,i)}" aria-hidden="true"></span>${r.key!==null?`<button type="button" data-chart="${key}" data-key="${html(r.key)}">${html(r.label)}</button>`:'<span>อื่น ๆ</span>'}<b>${number(r.value)} <small>${total?(r.value/total*100).toFixed(1):0}%</small></b></li>`).join('')||'<li>ไม่มีข้อมูลในช่วงนี้</li>'}</ul><details class="gr-chart-data"><summary>ดูข้อมูลทั้งหมด (${rows.length})</summary><table><thead><tr><th>รายการ</th><th>${unit}</th></tr></thead><tbody>${rows.map(r=>`<tr><td><button type="button" data-chart="${key}" data-key="${html(r.key)}">${html(r.label)}</button></td><td>${number(r.value)}</td></tr>`).join('')}</tbody></table></details></article>`;
    }).join('');
  }
  function drillChart(key,value) {
    grDashboardState[key]=value;
    const input={warehouse:'dashboard-bill-wh',receiver:'dashboard-bill-receiver'}[key];if(input)el(input).value=value;
    tab('bills');load(true);
  }
  function day(value) {grDashboardState.exactDate=value;grDashboardState.selectedDay=value;tab('bills');load(true);}
  function resetDay(){grDashboardState.exactDate=null;grDashboardState.selectedDay=null;load(true);}
  function renderVendors(res) {
    if(!res)return;
    const query=el('vl-search-input').value.trim().toLowerCase();
    let rows=(res.vendorBreakdown||[]).filter(r=>r.label.toLowerCase().includes(query));
    const confidence=el('vl-confidence-filter').value;
    rows=rows.filter(r=>!confidence||(confidence==='high'?r.samples>=8:confidence==='medium'?r.samples>=3&&r.samples<8:r.samples<3));
    const sort=el('vl-sort-by').value;
    rows.sort((a,b)=>sort==='name_asc'?a.label.localeCompare(b.label,'th'):sort==='lead_asc'?(a.avgLeadtime??Infinity)-(b.avgLeadtime??Infinity):sort==='lead_desc'?(b.avgLeadtime??-1)-(a.avgLeadtime??-1):sort==='ontime_desc'?(b.onTimeRate??-1)-(a.onTimeRate??-1):b.value-a.value);
    const metric=v=>v==null?'—':number(v);
    el('vl-vendor-list').innerHTML=rows.map(r=>`<article class="gr-vendor-card"><h3>${html(r.label)}</h3><p>${number(r.value)} บิล · ${number(r.totalItems)} รายการ</p><p>Leadtime <strong>${metric(r.avgLeadtime)} วัน</strong></p><p class="gr-card-hint">คำนวณจาก ${number(r.samples)} บิลในช่วงที่เลือก · ${r.samples>=8?'ข้อมูลระดับสูง':r.samples>=3?'ข้อมูลระดับปานกลาง':'ข้อมูลเบื้องต้น'}</p><p>มัธยฐาน ${metric(r.medianLeadDays)} · P75 ${metric(r.p75LeadDays)} วัน</p><p>ส่งไวสุด–ช้าสุด ${metric(r.minLeadDays)}–${metric(r.maxLeadDays)} วัน</p><p>${r.onTimeRate==null?'ยังไม่มีวันนัด':`ตรงเวลา ${metric(r.onTimeRate)}% จาก ${number(r.onTimeSamples)} บิลที่มีวันนัด`}</p><p>รับล่าสุด ${date(r.latestAtaDate)}</p><button type="button" data-chart="vendor" data-key="${html(r.key)}">ดูบิลรับสินค้า →</button></article>`).join('')||'<p>ไม่พบ Vendor ตามตัวกรองนี้</p>';
  }
  function review(first,readonly=false) {
    const container=el('gr-issue-review');if(!container)return;
    const permitted=canApproveGR(),codes=first?.issueCodes??(permitted&&!readonly?[]:null);
    container.innerHTML=`<h3>หมายเหตุบิลก่อนยืนยันรับเข้า</h3><p class="gr-card-hint">เลือกหลายปัญหาได้ · จำนวนรับต้องเป็นจำนวนที่รับเข้าจริง</p>${permitted?`<details><summary id="gr-issue-selection">${html(issueText(codes))}</summary><div class="gr-issue-options"><label><input type="checkbox" id="gr-issue-normal" ${Array.isArray(codes)&&!codes.length?'checked':''} ${readonly?'disabled':''}> ปกติ / ไม่พบปัญหา</label>${Object.entries(issues).map(([code,label])=>`<label><input type="checkbox" name="gr-issue-code" value="${code}" ${codes?.includes(code)?'checked':''} ${readonly?'disabled':''}> ${label}</label>`).join('')}</div></details><label for="gr-issue-note">รายละเอียดเพิ่มเติม</label><textarea id="gr-issue-note" rows="2" maxlength="1000" ${readonly?'disabled':''}>${html(first?.issueNote||'')}</textarea>`:`<p>${html(issueText(codes))}</p><p class="gr-card-hint">Admin หรือหัวหน้างานเป็นผู้ยืนยันหมายเหตุบิล</p>`}`;
    container.onchange=e=>{
      if(e.target.id==='gr-issue-normal'&&e.target.checked)container.querySelectorAll('[name="gr-issue-code"]').forEach(x=>x.checked=false);
      if(e.target.name==='gr-issue-code'&&e.target.checked)el('gr-issue-normal').checked=false;
      const selected=Array.from(container.querySelectorAll('[name="gr-issue-code"]:checked'),x=>x.value);
      if(!selected.length)el('gr-issue-normal').checked=true;
      el('gr-issue-selection').textContent=selected.length?issueText(selected):el('gr-issue-normal').checked?'ปกติ / ไม่พบปัญหา':'ยังไม่ได้ระบุ';
    };
    lastPayload='';mutationId=null;
  }
  function writeMetadata(payload) {
    if(appData?.grSchemaVersion!==2)throw new Error('ระบบรับสินค้าอยู่ระหว่างอัปเดต กรุณารีเฟรชข้อมูลก่อนบันทึก');
    const checked=Array.from(document.querySelectorAll('[name="gr-issue-code"]:checked'),x=>x.value);
    if(canApproveGR())payload.issueReview={confirmed:true,codes:checked,note:el('gr-issue-note')?.value.trim()||''};
    if(payload.targetStatus==='GR Completed'&&!payload.issueReview)throw new Error('กรุณาเลือก “ปกติ / ไม่พบปัญหา” หรือหมายเหตุปัญหาก่อนยืนยัน');
    if(el('lift-fee-container')){
      const raw=el('lift-fee-rounds').value.trim(),payment=document.querySelector('[name="lift-fee"]:checked')?.value;
      if(raw===''&&payload.targetStatus==='Draft GR')payload.lift=null;
      else {
        if(!/^\d{1,4}$/.test(raw)||Number(raw)>0&&!payment)throw new Error('กรุณาระบุรอบลิฟท์เป็นจำนวนเต็ม (0 หากไม่ใช้) และวิธีชำระเมื่อใช้ลิฟท์');
        payload.lift={rounds:Number(raw),payment:Number(raw)>0?payment:null};
      }
    } else payload.lift={rounds:0,payment:null};
    const serialized=JSON.stringify(payload);if(serialized!==lastPayload||!mutationId){lastPayload=serialized;mutationId=crypto.randomUUID();}
    payload.requestId=mutationId;return payload;
  }
  function move(rowId,delta) {
    const row=el(rowId),slides=Array.from(row.children);if(!slides.length)return;
    const current=slides.reduce((best,node,i)=>Math.abs(node.offsetLeft-row.scrollLeft)<Math.abs(slides[best].offsetLeft-row.scrollLeft)?i:best,0);
    const next=(current+delta+slides.length)%slides.length;
    row.scrollTo({left:slides[next].offsetLeft,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    el(rowId+'-position').textContent=`${next+1} / ${slides.length}`;
  }
  function init() {
    el('vendor-leadtime-view').addEventListener('click',event=>{
      if(Date.now()<suppressClickUntil){event.preventDefault();return;}
      const card=event.target.closest('[data-card]');if(card){drillCard(card.dataset.card);return;}
      const chart=event.target.closest('[data-chart]');if(chart)drillChart(chart.dataset.chart,chart.dataset.key);
    });
    ['gr-kpi-row','gr-chart-row'].forEach(id=>{
      const row=el(id);let start=0,edge=0;
      row.addEventListener('scroll',()=>{
        const slides=Array.from(row.children);if(!slides.length)return;
        const index=slides.reduce((best,n,i)=>Math.abs(n.offsetLeft-row.scrollLeft)<Math.abs(slides[best].offsetLeft-row.scrollLeft)?i:best,0);
        el(id+'-position').textContent=`${index+1} / ${slides.length}`;
      },{passive:true});
      row.addEventListener('touchstart',e=>{start=e.touches[0].clientX;edge=row.scrollLeft;},{passive:true});
      row.addEventListener('touchend',e=>{const delta=e.changedTouches[0].clientX-start;if(Math.abs(delta)<45)return;
        suppressClickUntil=Date.now()+400;
        if(delta>0&&edge<4)move(id,-1);else if(delta<0&&edge>=row.scrollWidth-row.clientWidth-4)move(id,1);
      },{passive:true});
    });
  }
  if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',init);
  return {issues,date,issueText,filters,tab,preset,custom,filter,reset,load,day,resetDay,renderSummary,renderCharts,renderVendors,review,writeMetadata,move};
})();
if(typeof module==='object'&&module.exports)module.exports=GrDashboard;
