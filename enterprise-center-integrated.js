/* ================================================================
   PT. MADANI GLOBAL MANAGMENT — ENTERPRISE CENTER (INTEGRATED BUILD)
   Menggantikan file lama "enterprise-center-integrated.js".
   ------------------------------------------------------------------
   TUJUAN PERBAIKAN (sesuai permintaan):
   1) Semua transaksi Enterprise Center memakai objek DB yang SAMA
      dengan modul ERP utama (tidak ada penyimpanan/DB kedua).
      Setiap simpan memanggil saveDB() bawaan -> tetap ke MySQL yang sama
      dan otomatis tercatat di audit/Riwayat Transaksi.
   2) Menu "Hak Akses" dan "Pengajuan/Ijin & Cuti" DIHAPUS dari
      Enterprise Center karena sudah ada di modul utama
      (Owner -> Hak Akses & Menu, dan menu Pengajuan & Izin).
   3) Tab "Absensi" di Enterprise Center menjadi PENGATUR WAKTU
      untuk Absen Masuk/Pulang modul utama:
        - Owner mengatur Jam Masuk Standar, Jam Pulang Standar & toleransi.
        - Saat admin melakukan Absen Foto di modul utama, sistem
          membandingkan jam foto dengan jam standar tersebut.
        - Jika lewat toleransi -> keterangan otomatis "Terlambat"
          (atau "Pulang Cepat" untuk Absen Pulang).
        - Owner dapat mengubah/override keterangan tersebut jika ada
          kendala teknis (baterai HP habis, sinyal, GPS gagal, dll),
          lengkap dengan catatan alasan & jejak siapa yang mengubah.
   4) Payroll/Penggajian & modul lain (assets, projects, audits,
      letters, dll) memakai koleksi DB.* yang sama, dan otomatis ikut
      tercatat di log aktivitas/riwayat yang sudah ada di modul utama.
   ================================================================ */
(function(){
  'use strict';

  /* -------------------------------------------------------------
     0) Util kecil
  ------------------------------------------------------------- */
  function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function hhmmToMinutes(s){ if(!s) return null; const m=String(s).match(/^(\d{1,2}):(\d{2})$/); if(!m) return null; return Number(m[1])*60+Number(m[2]); }
  function minutesToHHMM(min){ min=((min%1440)+1440)%1440; const h=String(Math.floor(min/60)).padStart(2,'0'), m=String(min%60).padStart(2,'0'); return h+':'+m; }

  /* -------------------------------------------------------------
     1) DB SETTINGS: jam kerja standar (dipakai bersama modul utama)
     Tidak ada storage terpisah — semuanya disimpan pada DB.settings
     yang sama dengan modul ERP utama, lalu ikut ke saveDB()/MySQL.
  ------------------------------------------------------------- */
  function ensureAttendancePolicy(){
    if(typeof DB==='undefined' || !DB) return;
    DB.settings = DB.settings || {};
    if(!DB.settings.attendancePolicy){
      DB.settings.attendancePolicy = {
        jamMasukStandar: '08:00',
        jamPulangStandar: '17:00',
        toleransiMenit: 15
      };
    }
    // Riwayat override keterangan absen oleh Owner (transparan/auditable)
    if(!Array.isArray(DB.absenOverrides)) DB.absenOverrides = [];
    // Payroll & modul HR memakai koleksi bawaan defaultDB(); pastikan tetap ada.
    ['employees','attendance','overtime','leaveRequests','payroll','payslips','projects','assets','audits','letters']
      .forEach(k=>{ if(!Array.isArray(DB[k])) DB[k]=[]; });
  }

  /* -------------------------------------------------------------
     2) PENYESUAIAN ABSEN MODUL UTAMA
     Meng-override doAbsen() bawaan supaya setiap absen foto
     otomatis dibandingkan dengan jam standar di atas.
  ------------------------------------------------------------- */
  const originalDoAbsen = window.doAbsen;
  window.doAbsen = async function(jenis){
    ensureAttendancePolicy();
    if(typeof absenHariIni==='function' && absenHariIni(session.user,jenis)){
      toast('Anda sudah Absen '+jenis+' hari ini','err'); return;
    }
    const u = DB.users[session.user] || {};
    const ev = await captureEvidence('Absen '+jenis+' — '+(session.name||APP_USER));
    if(!ev.photo){ toast('Foto absen dibatalkan','err'); return; }

    const pol = DB.settings.attendancePolicy;
    const jamTs = new Date(ev.timestamp);
    const actualMin = jamTs.getHours()*60 + jamTs.getMinutes();
    let keterangan = 'Tepat Waktu';
    if(jenis === 'Masuk'){
      const batas = hhmmToMinutes(pol.jamMasukStandar) + Number(pol.toleransiMenit||0);
      if(batas!=null && actualMin > batas) keterangan = 'Terlambat';
    } else if(jenis === 'Pulang'){
      const batas = hhmmToMinutes(pol.jamPulangStandar) - Number(pol.toleransiMenit||0);
      if(batas!=null && actualMin < batas) keterangan = 'Pulang Cepat';
    }

    DB.absensi.push({
      id: uid('ABS'), user: session.user, name: session.name,
      jabatan: u.jabatan || u.position || 'Admin',
      jenis, tanggal: todayStr(),
      jamStandar: jenis==='Masuk'?pol.jamMasukStandar:pol.jamPulangStandar,
      toleransiMenit: pol.toleransiMenit,
      keterangan,               // Tepat Waktu / Terlambat / Pulang Cepat
      keteranganAsli: keterangan, // disimpan agar override Owner tetap tercatat riwayatnya
      diubahOwner: false,
      ...ev
    });
    await saveDB();
    toast('Absensi Foto '+jenis+' tersimpan — '+keterangan, keterangan==='Tepat Waktu'?'ok':'err');
    render();
  };

  /* Owner: ubah/override keterangan absen jika ada kendala teknis. */
  window.editAbsenKeterangan = function(absenId){
    if(!session || session.role!=='master'){ toast('Hanya Owner yang dapat mengubah keterangan absen','err'); return; }
    const a = DB.absensi.find(x=>x.id===absenId); if(!a) return;
    openModal(`<h3>Ubah Keterangan Absen</h3>
      <div class="desc" style="color:var(--ink-soft);font-size:12px;margin-bottom:14px">${esc(a.name)} — ${esc(a.jenis)} — ${fmtDate(a.tanggal)} (${new Date(a.timestamp).toLocaleTimeString('id-ID')})<br>Keterangan sistem: <b>${esc(a.keteranganAsli||a.keterangan)}</b></div>
      <div class="form-grid">
        <div class="form-field"><label>Keterangan Baru</label>
          <select id="fAbsKet">
            <option ${a.keterangan==='Tepat Waktu'?'selected':''}>Tepat Waktu</option>
            <option ${a.keterangan==='Terlambat'?'selected':''}>Terlambat</option>
            <option ${a.keterangan==='Pulang Cepat'?'selected':''}>Pulang Cepat</option>
            <option ${a.keterangan==='Dimaafkan (Kendala Teknis)'?'selected':''}>Dimaafkan (Kendala Teknis)</option>
          </select>
        </div>
        <div class="form-field" style="grid-column:1/-1"><label>Alasan Perubahan (wajib)</label><input id="fAbsAlasan" placeholder="cth: GPS gagal, HP mati, sinyal lokasi lambat"></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
        <button class="btn" onclick="closeModal()">Batal</button>
        <button class="btn btn-em" onclick="simpanOverrideAbsen('${absenId}')">Simpan Perubahan</button>
      </div>`);
  };
  window.simpanOverrideAbsen = async function(absenId){
    const a = DB.absensi.find(x=>x.id===absenId); if(!a) return;
    const alasan = val('fAbsAlasan');
    if(!alasan){ toast('Alasan perubahan wajib diisi','err'); return; }
    const baru = val('fAbsKet');
    DB.absenOverrides.push({id:uid('OVR'), absensiId:absenId, dari:a.keterangan, ke:baru, alasan, oleh:session.user, olehNama:session.name, pada:new Date().toISOString()});
    a.keterangan = baru; a.diubahOwner = true; a.diubahOlehOwner = session.user; a.alasanOverride = alasan;
    await saveDB(); closeModal(); toast('Keterangan absen diperbarui oleh Owner','ok'); render();
  };

  /* Tampilan tabel absen modul utama: tambahkan kolom Keterangan + tombol edit Owner. */
  window.renderAbsen = function(){
    ensureAttendancePolicy();
    const pol = DB.settings.attendancePolicy;
    const t = todayStr();
    const listStatus = (typeof activeUsers==='function'?activeUsers():[]).map(u=>{
      const r=DB.users[u];
      const masuk=DB.absensi.find(a=>a.user===u&&a.jenis==='Masuk'&&String(a.timestamp||'').slice(0,10)===t);
      const pulang=DB.absensi.find(a=>a.user===u&&a.jenis==='Pulang'&&String(a.timestamp||'').slice(0,10)===t);
      const ketBadge = x => !x ? '<span class="tag tag-red">Belum</span>' : `<span class="tag ${x.keterangan==='Tepat Waktu'?'tag-green':x.keterangan.startsWith('Dimaafkan')?'tag-gold':'tag-red'}">${esc(x.keterangan)}</span>`;
      return `<tr><td><b>${esc(r.name)}</b><div class="desc">${esc(r.jabatan||'Admin')}</div></td>
        <td>${masuk?new Date(masuk.timestamp).toLocaleTimeString('id-ID'):'-'} ${ketBadge(masuk)}</td>
        <td>${pulang?new Date(pulang.timestamp).toLocaleTimeString('id-ID'):'-'} ${ketBadge(pulang)}</td></tr>`;
    }).join('');

    const rows = DB.absensi.slice().sort((a,b)=>b.timestamp.localeCompare(a.timestamp)).map(a=>`
      <tr><td>${new Date(a.timestamp).toLocaleString('id-ID')}</td>
      <td><b>${esc(a.name||a.user)}</b><div class="desc">${esc(a.jabatan||'-')}</div></td>
      <td><span class="tag ${a.jenis==='Masuk'?'tag-green':'tag-gold'}">${esc(a.jenis)}</span></td>
      <td><span class="tag ${a.keterangan==='Tepat Waktu'?'tag-green':a.keterangan&&a.keterangan.startsWith('Dimaafkan')?'tag-gold':'tag-red'}">${esc(a.keterangan||'-')}</span>${a.diubahOwner?'<div class="desc">Diubah Owner: '+esc(a.alasanOverride||'')+'</div>':''}</td>
      <td>${a.geo?`${a.geo.lat.toFixed(6)}, ${a.geo.lng.toFixed(6)}`:'Lokasi tidak tersedia'}</td>
      <td>${a.photo?`<img class="feature-photo" src="${a.photo}">`:'-'}</td>
      <td>${session.role==='master'?`<button class="btn btn-sm" onclick="editAbsenKeterangan('${a.id}')">Ubah</button>`:'-'}</td></tr>`).join('') || `<tr><td colspan="7"><div class="empty-state">Belum ada absensi.</div></td></tr>`;

    const sudahMasuk = typeof absenHariIni==='function' && absenHariIni(session.user,'Masuk');
    const sudahPulang = typeof absenHariIni==='function' && absenHariIni(session.user,'Pulang');

    const ownerPolicyCard = session.role==='master' ? `
      <div class="card"><div class="card-head"><div><h3>Pengaturan Jam Absen (Owner)</h3><div class="desc">Jam ini menjadi acuan status Terlambat/Pulang Cepat untuk seluruh Admin, dipakai bersama oleh Enterprise Center dan modul utama.</div></div></div>
      <div class="form-grid">
        <div class="form-field"><label>Jam Masuk Standar</label><input id="polJamMasuk" type="time" value="${pol.jamMasukStandar}"></div>
        <div class="form-field"><label>Jam Pulang Standar</label><input id="polJamPulang" type="time" value="${pol.jamPulangStandar}"></div>
        <div class="form-field"><label>Toleransi (menit)</label><input id="polToleransi" type="number" min="0" value="${pol.toleransiMenit}"></div>
      </div>
      <div style="margin-top:12px"><button class="btn btn-em" onclick="saveAttendancePolicy()">Simpan Pengaturan Jam</button></div></div>` : '';

    return `${ownerPolicyCard}
    <div class="card"><div class="card-head"><div><h3>Status Absen Hari Ini — Semua Admin</h3><div class="desc">Jam standar: Masuk ${esc(pol.jamMasukStandar)} · Pulang ${esc(pol.jamPulangStandar)} (toleransi ${esc(String(pol.toleransiMenit))} menit)</div></div></div>
    <table><thead><tr><th>Admin</th><th>Absen Masuk</th><th>Absen Pulang</th></tr></thead><tbody>${listStatus}</tbody></table></div>
    <div class="card"><div class="card-head"><div><h3>Absen Foto Live</h3><div class="desc">Foto diambil dari kamera saat tombol absen ditekan, disertai nama akun, jabatan, tanggal, waktu dan GPS realtime. Status Terlambat/Pulang Cepat dihitung otomatis dari jam standar di atas.</div></div>
    <div style="display:flex;gap:8px">${session.role==='admin'?`<button class="btn btn-em" ${sudahMasuk?'disabled':''} onclick="doAbsen('Masuk')">📷 Absen Foto Masuk</button><button class="btn" ${sudahPulang?'disabled':''} onclick="doAbsen('Pulang')">📷 Absen Foto Pulang</button>`:''}</div></div>
    <table><thead><tr><th>Waktu</th><th>Akun</th><th>Jenis</th><th>Keterangan</th><th>Lokasi</th><th>Foto</th><th>Aksi Owner</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  };
  window.saveAttendancePolicy = async function(){
    if(session.role!=='master'){ toast('Hanya Owner yang dapat mengubah jam standar','err'); return; }
    ensureAttendancePolicy();
    DB.settings.attendancePolicy = {
      jamMasukStandar: val('polJamMasuk') || '08:00',
      jamPulangStandar: val('polJamPulang') || '17:00',
      toleransiMenit: Number(val('polToleransi'))||0
    };
    await saveDB(); toast('Jam absen standar tersimpan','ok'); render();
  };

  /* -------------------------------------------------------------
     3) PAYROLL / PENGGAJIAN — terintegrasi ke DB yang sama
     (menggunakan DB.employees, DB.payroll, DB.absensi — bukan
     penyimpanan terpisah). Semua simpan lewat saveDB() bawaan.
  ------------------------------------------------------------- */
  function bulanIni(){ return todayStr().slice(0,7); }
  function rekapAbsensi(user, bulan){
    const rows = DB.absensi.filter(a=>a.user===user && String(a.tanggal||'').slice(0,7)===bulan);
    const masuk = rows.filter(a=>a.jenis==='Masuk');
    const terlambat = masuk.filter(a=>a.keterangan==='Terlambat').length;
    const pulangCepat = rows.filter(a=>a.jenis==='Pulang' && a.keterangan==='Pulang Cepat').length;
    return { hadir: masuk.length, terlambat, pulangCepat };
  }
  window.renderPayroll = function(){
    ensureAttendancePolicy();
    const bulan = window._payrollBulan || bulanIni();
    const admins = (typeof activeUsers==='function'?activeUsers():Object.keys(DB.users).filter(u=>DB.users[u].role==='admin'));

    const rows = admins.map(u=>{
      const r = DB.users[u];
      const rek = rekapAbsensi(u, bulan);
      const existing = DB.payroll.find(p=>p.user===u && p.bulan===bulan) || {};
      return `<tr>
        <td><b>${esc(r.name)}</b><div class="desc">${esc(r.jabatan||'Admin')}</div></td>
        <td class="num">${rek.hadir}</td>
        <td class="num">${rek.terlambat}</td>
        <td><input id="gp_${u}" type="number" style="width:120px" value="${existing.gajiPokok||0}"></td>
        <td><input id="pt_${u}" type="number" style="width:110px" value="${existing.potongan!=null?existing.potongan:(rek.terlambat*25000)}"></td>
        <td><input id="tj_${u}" type="number" style="width:110px" value="${existing.tunjangan||0}"></td>
        <td class="num" id="total_${u}">${fmtIDR((existing.gajiPokok||0)-(existing.potongan!=null?existing.potongan:(rek.terlambat*25000))+(existing.tunjangan||0))}</td>
      </tr>`;
    }).join('');

    const riwayat = DB.payroll.filter(p=>p.bulan===bulan).slice().reverse().map(p=>`<tr><td>${esc(p.userNama||p.user)}</td><td>${esc(p.bulan)}</td><td class="num">${fmtIDR(p.gajiPokok)}</td><td class="num">${fmtIDR(p.potongan)}</td><td class="num">${fmtIDR(p.tunjangan)}</td><td class="num" style="font-weight:800">${fmtIDR(p.total)}</td><td>${statusTag(p.status||'posted')}</td></tr>`).join('') || `<tr><td colspan="7"><div class="empty-state">Belum ada slip gaji periode ini.</div></td></tr>`;

    return `<div class="card" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
      <div class="form-field" style="margin:0"><label>Periode Payroll</label><input type="month" value="${bulan}" onchange="window._payrollBulan=this.value;render()"></div>
    </div>
    <div class="card"><div class="card-head"><div><h3>Hitung Payroll — ${esc(bulan)}</h3><div class="desc">Rekap kehadiran &amp; keterlambatan diambil otomatis dari Absen Foto Live modul utama. Potongan default Rp25.000/keterlambatan (dapat diubah manual).</div></div>
    <button class="btn btn-em" onclick="simpanPayroll('${bulan}')">💾 Proses &amp; Simpan Payroll</button></div>
    <table><thead><tr><th>Admin</th><th>Hadir</th><th>Terlambat</th><th>Gaji Pokok</th><th>Potongan</th><th>Tunjangan</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="card"><div class="card-head"><div><h3>Slip Gaji Tersimpan</h3><div class="desc">Tercatat sebagai transaksi resmi dan otomatis masuk ke Riwayat Transaksi/Audit modul utama.</div></div></div>
    <table><thead><tr><th>Admin</th><th>Periode</th><th>Gaji Pokok</th><th>Potongan</th><th>Tunjangan</th><th>Total</th><th>Status</th></tr></thead><tbody>${riwayat}</tbody></table></div>`;
  };
  window.simpanPayroll = async function(bulan){
    if(session.role!=='master'){ toast('Hanya Owner yang dapat memproses payroll','err'); return; }
    const admins = (typeof activeUsers==='function'?activeUsers():Object.keys(DB.users).filter(u=>DB.users[u].role==='admin'));
    admins.forEach(u=>{
      const gp = Number(val('gp_'+u))||0, pt = Number(val('pt_'+u))||0, tj = Number(val('tj_'+u))||0;
      const total = gp - pt + tj;
      let rec = DB.payroll.find(p=>p.user===u && p.bulan===bulan);
      if(!rec){ rec = {id:uid('PAY'), user:u, bulan}; DB.payroll.push(rec); }
      Object.assign(rec, {userNama:DB.users[u].name, gajiPokok:gp, potongan:pt, tunjangan:tj, total, status:'posted', diprosesOleh:session.user, tanggal:todayStr()});
      // Kas & Bank + Jurnal otomatis mengikuti alur akuntansi modul utama (Beban Operasional).
      if(typeof postJurnal==='function'){
        postJurnal(todayStr(), 'Payroll '+bulan+' - '+DB.users[u].name, [
          {akun:'5200', debit: total, kredit: 0}, {akun:'1100', debit: 0, kredit: total}
        ], 'payroll', rec.id, 'posted');
      }
    });
    await saveDB(); toast('Payroll periode '+bulan+' tersimpan &amp; terintegrasi ke jurnal','ok'); render();
  };

  /* Tambahkan menu Payroll ke navigasi utama (satu-satunya tempat; tidak diduplikasi di Enterprise Center). */
  function addPayrollNav(){
    if(typeof NAV==='undefined') return;
    if(NAV.some(g=>g.items.some(i=>i.id==='payroll'))) return;
    NAV.push({group:'SDM & Payroll', items:[{id:'payroll', ic:'💵', label:'Payroll & Penggajian', masterOnly:true}]});
    if(typeof TITLES!=='undefined') TITLES.payroll = ['Payroll & Penggajian','Dihitung otomatis dari data Absen Foto Live modul utama'];
  }
  const oldRenderRoute = window.render;
  window.render = function(){
    ensureAttendancePolicy(); addPayrollNav();
    if(currentPage==='payroll'){
      document.getElementById('content').innerHTML = renderPageShell(renderPayroll());
      return;
    }
    return oldRenderRoute();
  };

  /* -------------------------------------------------------------
     4) ENTERPRISE CENTER (mgm*) — dibangun ulang, ramping.
     - TIDAK ADA tab "Hak Akses" (sudah ada di Owner -> Hak Akses & Menu).
     - TIDAK ADA tab "Pengajuan/Cuti & Izin" (sudah ada di menu utama).
     - Semua data dibaca langsung dari DB yang sama (tanpa storage kedua).
  ------------------------------------------------------------- */
  const MGM_TABS = [
    { id:'dashboard', label:'Dashboard' },
    { id:'absensi',   label:'Absensi & Jam Kerja' },
    { id:'payroll',   label:'Payroll' },
    { id:'keuangan',  label:'Ringkasan Keuangan' },
    { id:'projek',    label:'Projek & Aset' },
    { id:'audit',     label:'Log Aktivitas' }
    /* Sengaja TIDAK memuat: 'Hak Akses' dan 'Pengajuan/Cuti & Izin'
       karena sudah tersedia di navigasi modul utama — mencegah menu ganda. */
  ];

  function mgmEnsure(){ ensureAttendancePolicy(); addPayrollNav(); }

  function mgmTabHtml(id){
    ensureAttendancePolicy();
    if(id==='dashboard'){
      const kasTotal=['1100','1101','1102'].map(k=>saldoAkun(k)).reduce((a,b)=>a+b,0);
      return `<div class="mgm-grid">
        <div class="mgm-card"><h3>Kas &amp; Bank</h3><div class="mgm-stat">${fmtIDR(kasTotal)}</div><div class="mgm-muted">Sinkron langsung dengan modul utama</div></div>
        <div class="mgm-card"><h3>Transaksi Tercatat</h3><div class="mgm-stat">${DB.penjualan.length+DB.pembelian.length}</div><div class="mgm-muted">Penjualan + Pembelian</div></div>
        <div class="mgm-card"><h3>Absensi Hari Ini</h3><div class="mgm-stat">${DB.absensi.filter(a=>a.tanggal===todayStr()).length}</div><div class="mgm-muted">Catatan hari ini</div></div>
        <div class="mgm-card"><h3>Payroll Bulan Ini</h3><div class="mgm-stat">${fmtIDR(DB.payroll.filter(p=>p.bulan===bulanIni()).reduce((s,p)=>s+(p.total||0),0))}</div><div class="mgm-muted">${bulanIni()}</div></div>
      </div>`;
    }
    if(id==='absensi') return `<div class="mgm-muted" style="margin-bottom:10px">Panel ini memakai data &amp; pengaturan jam yang sama dengan menu "Absen Foto Live" di modul utama.</div>${renderAbsen()}`;
    if(id==='payroll') return renderPayroll();
    if(id==='keuangan') return `<div class="mgm-grid">${['1100','1101','1102'].map(k=>`<div class="mgm-card"><h3>${DB.coa.find(a=>a.kode===k)?.nama||k}</h3><div class="mgm-stat">${fmtIDR(saldoAkun(k))}</div></div>`).join('')}</div>${typeof renderLabaRugi==='function'?renderLabaRugi():''}`;
    if(id==='projek') return (typeof renderProjects3D==='function'?renderProjects3D():'') + (typeof renderAssets==='function'?renderAssets():'');
    if(id==='audit'){
      const rows=(DB.auditLog||[]).slice().reverse().slice(0,60).map(a=>`<tr><td>${new Date(a.timestamp).toLocaleString('id-ID')}</td><td>${esc(a.action)}</td><td>${esc(a.collection)}</td><td>${esc(a.nama||a.username)}</td></tr>`).join('')||'<tr><td colspan="4">Belum ada aktivitas.</td></tr>';
      return `<table class="mgm-table"><thead><tr><th>Waktu</th><th>Aksi</th><th>Modul</th><th>Oleh</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    return '<div class="mgm-muted">Modul tidak ditemukan.</div>';
  }

  window.mgmOpen = function(tabId){
    mgmEnsure();
    const overlay = document.getElementById('mgmOverlay');
    if(!overlay) return;
    overlay.style.display='block';
    const tabsWrap = document.getElementById('mgmTabs');
    tabsWrap.innerHTML = MGM_TABS.map(t=>`<button class="mgm-tab ${t.id===tabId?'active':''}" onclick="mgmOpen('${t.id}')">${esc(t.label)}</button>`).join('');
    document.getElementById('mgmBody').innerHTML = mgmTabHtml(tabId);
  };
  window.mgmClose = function(){ const o=document.getElementById('mgmOverlay'); if(o) o.style.display='none'; };

  function mount(){
    mgmEnsure();
    if(document.getElementById('mgmOverlay')) return;
    const o=document.createElement('div'); o.id='mgmOverlay'; o.className='mgm-overlay';
    o.innerHTML='<div class="mgm-modal"><div class="mgm-head"><div><h2>PT. MADANI GLOBAL MANAGMENT · Enterprise Center</h2><small>Data sama persis dengan modul ERP utama — tidak ada database kedua</small></div><button class="mgm-close" onclick="mgmClose()">✕ Tutup</button></div><div id="mgmTabs" class="mgm-tabs"></div><div id="mgmBody" class="mgm-body"></div></div>';
    document.body.appendChild(o);
    if(!document.querySelector('.mgm-fab')){
      const f=document.createElement('button'); f.className='mgm-fab no-print';
      f.innerHTML='<span class="mgm-fab-icon">⚡</span><span class="mgm-fab-text">Enterprise Center</span>';
      f.onclick=()=>mgmOpen('dashboard');
      document.body.appendChild(f);
    }
  }
  window.addEventListener('load', ()=>setTimeout(mount,700));
})();
