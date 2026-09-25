
(function(){
  const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const cfg=window.IMPORTB2B_CONFIG;const client=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const token=new URLSearchParams(location.search).get('token')||location.pathname.split('/club/')[1]||'';
  const labels={vapers:'Club Vapers',jerseys:'Club Jerseys',perfumes:'Club Perfumes',importb2b:'Club IMPORTB2B'};
  async function load(){
    if(!token){showError('El enlace no contiene un token válido.');return}
    const {data,error}=await client.rpc('importb2b_public_club_card',{p_token:token});
    if(error||!data){showError('No encontramos una tarjeta activa asociada a este enlace.');return}
    render(data);
  }
  function render(d){
    const clubs=d.clubs||[],total=clubs.reduce((a,x)=>a+Number(x.points||0),0);
    $('#loading').classList.add('hidden');$('#card').classList.remove('hidden');
    $('#card').innerHTML=`<section class="hero"><span class="eyebrow">TU ESPACIO EN IMPORTB2B</span><h1>${esc(d.client.full_name)}</h1><p class="muted">Un solo código. Todos tus clubes y progresos por separado.</p><div class="hero-grid"><div><small>Código</small><b>${esc(d.client.member_code)}</b></div><div><small>Clubes activos</small><b>${clubs.length}</b></div><div><small>Puntos totales</small><b>${total}</b></div></div></section><div class="section-label">TUS MEMBRESÍAS</div><section class="club-list">${clubs.map(clubHtml).join('')||'<div class="hero">Todavía no hay clubes activos.</div>'}</section><div class="section-label">HISTORIAL RECIENTE</div><section class="hero"><div class="history-list">${(d.history||[]).map(h=>`<div class="history"><span><b>${esc(labels[h.club_type]||h.club_type)}</b><small>${esc(h.sale_code||h.observation||'Compra + historia verificadas')}</small></span><span><b>+1 punto</b><small>${new Date(h.created_at).toLocaleDateString('es-AR')}</small></span></div>`).join('')||'<span class="muted">Todavía no hay movimientos.</span>'}</div></section>`;
  }
  function clubHtml(c){const next=c.next_reward;const target=next?Number(next.milestone):Number(c.points||0)||1;const pct=next?Math.min(100,Math.round(Number(c.points||0)/target*100)):100;return`<details class="club-card" open><summary><span class="club-title"><small>${esc(c.club_name||labels[c.club_type]||c.club_type)}</small><b>${Number(c.points||0)} puntos</b></span><strong>${next?`Próxima meta: ${next.milestone}`:'Completo'}</strong></summary><div class="club-body"><div class="progress"><i style="width:${pct}%"></i></div><p class="next">${next?`Te faltan <b>${Number(next.remaining||0)}</b> puntos para <b>${esc(next.reward_name)}</b>.`:'Alcanzaste todas las recompensas configuradas.'}</p><div class="reward-list">${(c.rewards||[]).map(r=>`<div class="reward ${esc(r.status)}"><span><b>${r.milestone} pts · ${esc(r.reward_name)}</b><small>${esc(r.description||'')}</small></span><span class="pill ${r.status==='delivered'?'green':r.status==='unlocked'?'yellow':''}">${r.status==='delivered'?'Entregado':r.status==='unlocked'?'Desbloqueado':'Bloqueado'}</span></div>`).join('')}</div></div></details>`}
  function showError(msg){$('#loading').classList.add('hidden');$('#error').classList.remove('hidden');$('#errorMessage').textContent=msg}
  load();
})();
