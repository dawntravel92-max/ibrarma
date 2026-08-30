import express from 'express';
import cors from 'cors';
import { DateTime } from 'luxon';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const CACHE_SECONDS = Number(process.env.CACHE_SECONDS || 20);
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const LEAGUES = { laliga:'esp.1', epl:'eng.1', ucl:'uefa.champions' };
const ALLOWED = new Set(Object.values(LEAGUES));
const cache = new Map();

app.use(cors());
app.use(express.json({limit:'256kb'}));
app.use(express.static(path.join(__dirname,'..','public')));

async function getJSON(url, ttl=CACHE_SECONDS){
  const hit=cache.get(url);
  if(hit && Date.now()-hit.at<ttl*1000) return hit.data;
  const r=await fetch(url,{headers:{'User-Agent':'MadridLive/1.0'}});
  if(!r.ok) throw new Error(`Upstream ${r.status}`);
  const data=await r.json();
  cache.set(url,{at:Date.now(),data});
  return data;
}

function competitionOf(e){
  const c=e?.competitions?.[0]?.league;
  return c?.slug || c?.abbreviation || '';
}
function logo(team){return team?.logo || team?.logos?.[0]?.href || ''}
function team(t){return {id:String(t?.id||''),name:t?.displayName||t?.team?.displayName||t?.name||'',short:t?.abbreviation||t?.team?.abbreviation||'',logo:logo(t?.team||t)}}
function normalizeEvent(e, league){
  const c=e?.competitions?.[0]||{};
  const comps=(c.competitors||[]).map(x=>({...team(x),homeAway:x.homeAway,score:x.score??x.curatedRank?.current??null, winner:!!x.winner}));
  const home=comps.find(x=>x.homeAway==='home')||comps[0]||{};
  const away=comps.find(x=>x.homeAway==='away')||comps[1]||{};
  const status=e?.status||{};
  return {id:String(e.id),league,leagueName:c?.league?.name||league,start:e.date,name:e.name,shortName:e.shortName,home,away,status:{type:status.type?.name||'',detail:status.type?.shortDetail||status.type?.detail||'',clock:status.displayClock||'',period:status.period||0},venue:c.venue?.fullName||c.venue?.address?.city||'',broadcasts:(c.broadcasts||[]).flatMap(b=>b.names||[]),odds:c.odds?.[0]||null};
}

app.get('/api/health',(req,res)=>res.json({ok:true,service:'madrid-live',time:new Date().toISOString()}));

app.get('/api/scoreboard',async(req,res)=>{
  try{
    const dates=req.query.dates || DateTime.now().toFormat('yyyyLLdd');
    const out=[];
    for(const [key,league] of Object.entries(LEAGUES)){
      const d=await getJSON(`${ESPN}/${league}/scoreboard?dates=${encodeURIComponent(dates)}`);
      out.push(...(d.events||[]).map(e=>normalizeEvent(e,key)));
    }
    out.sort((a,b)=>(a.start||'').localeCompare(b.start||''));
    res.json({updated:new Date().toISOString(),events:out});
  }catch(e){res.status(502).json({error:'تعذر جلب المباريات الآن',detail:e.message})}
});

app.get('/api/real-madrid/schedule',async(req,res)=>{
  try{
    const d=await getJSON(`${ESPN}/esp.1/teams/86/schedule`);
    const events=(d.events||[]).map(e=>{
      const c=e.competitions?.[0]||{};
      const league=c.league?.slug || c.league?.abbreviation || '';
      return normalizeEvent(e,league);
    }).filter(e=>ALLOWED.has(e.league)||/champions|laliga|premier/i.test(e.leagueName||''));
    res.json({events,updated:new Date().toISOString()});
  }catch(e){res.status(502).json({error:'تعذر جلب جدول ريال مدريد',detail:e.message})}
});

app.get('/api/match/:id',async(req,res)=>{
  try{
    const league=req.query.league;
    if(!ALLOWED.has(league)) return res.status(400).json({error:'league غير صالح'});
    const d=await getJSON(`${ESPN}/${league}/summary?event=${encodeURIComponent(req.params.id)}`,8);
    const c=d.header?.competitions?.[0]||d.header?.competitions?.[0]||{};
    const competitors=(c.competitors||[]).map(x=>({...team(x),homeAway:x.homeAway,score:x.score}));
    const plays=(d.plays||d.keyEvents||[]).map(p=>({id:p.id||`${p.clock?.value}-${p.text}`,text:p.text||p.shortText||'',type:p.type?.text||p.type?.name||'',clock:p.clock?.displayValue||p.clock?.value||'',team:p.team?.displayName||'',athlete:p.athletes?.[0]?.displayName||p.athlete?.displayName||'',assist:p.athletes?.[1]?.displayName||p.assist?.displayName||'',scoreValue:p.scoreValue||null}));
    const stats=[];
    for(const g of d.boxscore?.teams||[]){
      const vals={}; for(const s of g.statistics||[]) vals[s.name]=s.displayValue??s.value;
      stats.push({team:team(g.team),statistics:vals});
    }
    const roster=(d.rosters||d.lineups||[]).map(r=>({team:team(r.team),formation:r.formation||'',players:(r.roster||r.athletes||r.players||[]).map(a=>({id:a.athlete?.id||a.id||'',name:a.athlete?.displayName||a.displayName||a.name||'',starter:!!(a.starter||a.lineupType==='starter'),sub:!!a.substitute||a.lineupType==='substitute',position:a.athlete?.position?.abbreviation||a.position?.abbreviation||a.position?.name||''}))}));
    res.json({header:{id:req.params.id,start:c.date||d.header?.season?.slug||'',name:d.header?.competitions?.[0]?.type?.text||'',status:c.status||d.header?.competitions?.[0]?.status||{}},competitors,plays,stats,broadcasts:(c.broadcasts||[]).flatMap(b=>b.names||[]),leaders:d.leaders||[],commentary:d.commentary||[],roster});
  }catch(e){res.status(502).json({error:'تعذر جلب تفاصيل المباراة',detail:e.message})}
});

app.get('/api/real-madrid/injuries',async(req,res)=>{
  try{const d=await getJSON(`${ESPN}/esp.1/teams/86/injuries`,120);res.json({items:(d.injuries||[]).map(x=>({player:x.athlete?.displayName||x.athlete?.fullName||'',status:x.status||'',detail:x.details||x.description||'',date:x.date||''})),updated:new Date().toISOString()})}
  catch(e){res.status(502).json({error:'تعذر جلب الغيابات',detail:e.message})}
});

app.get('/api/calendar/real-madrid.ics',async(req,res)=>{
  try{
    const d=await getJSON(`${ESPN}/esp.1/teams/86/schedule`,300);
    const events=(d.events||[]).filter(e=>{const l=e.competitions?.[0]?.league?.slug||'';return ALLOWED.has(l)||/champions|laliga/i.test(l)});
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Madrid Live//Iraq//AR','CALSCALE:GREGORIAN','X-WR-CALNAME:ريال مدريد - الموسم'];
    for(const e of events){
      const c=e.competitions?.[0]||{}; const home=c.competitors?.find(x=>x.homeAway==='home')?.team?.displayName||''; const away=c.competitors?.find(x=>x.homeAway==='away')?.team?.displayName||''; const dt=DateTime.fromISO(e.date,{zone:'utc'}); const end=dt.plus({hours:2});
      const fmt=x=>x.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
      const esc=s=>String(s||'').replace(/([,;\\])/g,'\\$1').replace(/\n/g,'\\n');
      lines.push('BEGIN:VEVENT',`UID:rm-${e.id}@madrid-live`,`DTSTAMP:${fmt(DateTime.utc())}`,`DTSTART:${fmt(dt)}`,`DTEND:${fmt(end)}`,`SUMMARY:${esc(home)} - ${esc(away)}`,`DESCRIPTION:${esc('Madrid Live | ريال مدريد')}`,`LOCATION:${esc(c.venue?.fullName||'')}`,'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    res.set('Content-Type','text/calendar; charset=utf-8');res.set('Content-Disposition','attachment; filename="real-madrid-season.ics"');res.send(lines.join('\r\n'));
  }catch(e){res.status(502).json({error:'تعذر إنشاء التقويم',detail:e.message})}
});

app.use((req,res)=>res.sendFile(path.join(__dirname,'..','public','index.html')));
export default app;
