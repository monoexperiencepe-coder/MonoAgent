import { useCallback, useEffect, useRef, useState } from "react";
import { fetchActiveSessions, pauseSession, resumeSession } from "../services/api.js";

const STAGE_LABELS = { exploration:"Exploración", interest:"Interés", intention:"Pedido", closing:"Cierre" };
const STAGE_COLORS = { exploration:"#6c757d", interest:"#0d6efd", intention:"#fd7e14", closing:"#198754" };

function stageLabel(s){return STAGE_LABELS[s]??s??"—"}
function stageColor(s){return STAGE_COLORS[s]??"#6c757d"}
function formatTime(iso){if(!iso)return"";const d=new Date(iso);if(isNaN(d))return"";const now=new Date();const diffH=(now-d)/3600000;if(diffH<24)return d.toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit"});return d.toLocaleDateString("es-PE",{day:"2-digit",month:"2-digit"})}
function customerName(cd){if(!cd||typeof cd!=="object")return null;const n=cd.name??cd.nombre??cd.Name;return n&&String(n).trim()?String(n).trim():null}
function phoneDisplay(id){return id?.replace("whatsapp:+","+")??id??"—"}
function extractText(msg){if(!msg)return"";if(typeof msg.content==="string")return msg.content;if(Array.isArray(msg.content))return msg.content.map(b=>b?.text??"").join(" ").trim();return""}
function lastMessage(messages){if(!Array.isArray(messages)||!messages.length)return null;return messages[messages.length-1]}

export default function InboxPage(){
  const[sessions,setSessions]=useState([]);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState(null);
  const[selected,setSelected]=useState(null);
  const[busyId,setBusyId]=useState(null);
  const[stageFilter,setStageFilter]=useState("all");
  const chatEndRef=useRef(null);

  const load=useCallback(async()=>{
    setError(null);
    try{const{sessions:list}=await fetchActiveSessions();setSessions(list);setSelected(prev=>prev?list.find(s=>s.id===prev.id)??prev:null)}
    catch(e){setError(e?.message??"Error al cargar")}
    finally{setLoading(false)}
  },[]);

  useEffect(()=>{load()},[load]);
  useEffect(()=>{const t=setInterval(load,15000);return()=>clearInterval(t)},[load]);
  useEffect(()=>{chatEndRef.current?.scrollIntoView({behavior:"smooth"})},[selected?.id,selected?.messages?.length]);

  const togglePause=async(session,pause)=>{
    setBusyId(session.id);
    try{if(pause)await pauseSession(session.id);else await resumeSession(session.id);await load()}
    catch(e){setError(e?.message??"Error")}
    finally{setBusyId(null)}
  };

  const detail=selected?sessions.find(s=>s.id===selected.id)??selected:null;
  const filteredSessions=stageFilter==="all"?sessions:sessions.filter(s=>s.stage===stageFilter);
  const stages=["all","exploration","interest","intention","closing"];

  return(
    <div style={{display:"flex",height:"100vh",background:"#0d0d1a",color:"#e2e8f0",fontFamily:"Inter,system-ui,sans-serif",overflow:"hidden"}}>

      {/* Panel izquierdo: lista */}
      <div style={{width:300,minWidth:260,borderRight:"1px solid #1e1e2e",display:"flex",flexDirection:"column",background:"#0f0f1e",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"20px 16px 12px",borderBottom:"1px solid #1e1e2e"}}>
          <h2 style={{margin:0,fontSize:"1.1rem",fontWeight:700,color:"#f1f5f9"}}>Buzón</h2>
          <button onClick={load} style={{background:"none",border:"none",color:"#64748b",cursor:"pointer",fontSize:"1.2rem"}}>↺</button>
        </div>
        <div style={{display:"flex",gap:4,padding:"10px 12px",flexWrap:"wrap",borderBottom:"1px solid #1e1e2e"}}>
          {stages.map(st=>(
            <button key={st} onClick={()=>setStageFilter(st)} style={{background:stageFilter===st?"rgba(139,92,246,0.2)":"none",border:stageFilter===st?"1px solid #8b5cf6":"1px solid #2a2a3a",color:stageFilter===st?"#a78bfa":"#64748b",fontSize:"0.68rem",padding:"4px 8px",borderRadius:20,cursor:"pointer"}}>
              {st==="all"?"Todos":stageLabel(st)}
            </button>
          ))}
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"8px 0"}}>
          {loading&&!sessions.length?<p style={{color:"#334155",fontSize:"0.8rem",padding:16}}>Cargando…</p>
          :!filteredSessions.length?<p style={{color:"#334155",fontSize:"0.8rem",padding:16}}>Sin conversaciones.</p>
          :filteredSessions.map(sess=>{
            const name=customerName(sess.customerData);
            const last=lastMessage(sess.messages);
            const lastText=last?extractText(last):null;
            const isActive=detail?.id===sess.id;
            return(
              <button key={sess.id} onClick={()=>setSelected(sess)} style={{display:"flex",alignItems:"flex-start",gap:10,width:"100%",padding:"12px 14px",background:isActive?"rgba(139,92,246,0.12)":"none",border:"none",borderBottom:"1px solid #1a1a2a",borderLeft:isActive?"3px solid #8b5cf6":"3px solid transparent",cursor:"pointer",textAlign:"left",color:"#e2e8f0"}}>
                <div style={{width:38,height:38,borderRadius:"50%",background:"linear-gradient(135deg,#8b5cf6,#ec4899)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:"0.9rem",flexShrink:0,color:"#fff"}}>
                  {(name??phoneDisplay(sess.id)).charAt(0).toUpperCase()}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:4}}>
                    <span style={{fontWeight:600,fontSize:"0.85rem",color:"#f1f5f9",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{name??phoneDisplay(sess.id)}</span>
                    <span style={{fontSize:"0.7rem",color:"#475569",flexShrink:0}}>{formatTime(sess.updatedAt)}</span>
                  </div>
                  {lastText&&<p style={{margin:"3px 0 5px",fontSize:"0.75rem",color:"#64748b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{last.role==="assistant"?"🤖 ":"👤 "}{lastText.slice(0,60)}{lastText.length>60?"…":""}</p>}
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <span style={{fontSize:"0.65rem",padding:"2px 7px",borderRadius:20,fontWeight:600,background:stageColor(sess.stage)+"33",color:stageColor(sess.stage),border:`1px solid ${stageColor(sess.stage)}55`}}>{stageLabel(sess.stage)}</span>
                    {sess.botPaused&&<span style={{fontSize:"0.65rem",padding:"2px 7px",borderRadius:20,background:"rgba(248,113,113,0.15)",color:"#f87171",border:"1px solid rgba(248,113,113,0.3)",fontWeight:600}}>Pausado</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Panel central: chat */}
      <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0,background:"#0d0d1a"}}>
        {!detail?(
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,color:"#334155"}}>
            <span style={{fontSize:"3rem"}}>💬</span>
            <p style={{fontSize:"0.9rem"}}>Selecciona una conversación</p>
          </div>
        ):(
          <>
            <div style={{display:"flex",alignItems:"center",gap:12,padding:"14px 20px",borderBottom:"1px solid #1e1e2e",background:"#0f0f1e",flexShrink:0}}>
              <div style={{width:40,height:40,borderRadius:"50%",background:"linear-gradient(135deg,#8b5cf6,#ec4899)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#fff",flexShrink:0}}>
                {(customerName(detail.customerData)??phoneDisplay(detail.id)).charAt(0).toUpperCase()}
              </div>
              <div>
                <p style={{margin:0,fontWeight:700,fontSize:"0.95rem",color:"#f1f5f9"}}>{customerName(detail.customerData)??phoneDisplay(detail.id)}</p>
                <p style={{margin:0,fontSize:"0.75rem",color:"#64748b"}}>{phoneDisplay(detail.id)} · {stageLabel(detail.stage)}</p>
              </div>
              <div style={{marginLeft:"auto"}}>
                {detail.botPaused?(
                  <button disabled={busyId===detail.id} onClick={()=>togglePause(detail,false)} style={{background:"rgba(74,222,128,0.1)",border:"1px solid rgba(74,222,128,0.3)",color:"#4ade80",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:"0.8rem",fontWeight:600}}>
                    {busyId===detail.id?"…":"▶ Reanudar bot"}
                  </button>
                ):(
                  <button disabled={busyId===detail.id} onClick={()=>togglePause(detail,true)} style={{background:"rgba(251,191,36,0.1)",border:"1px solid rgba(251,191,36,0.3)",color:"#fbbf24",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:"0.8rem",fontWeight:600}}>
                    {busyId===detail.id?"…":"⏸ Pausar bot"}
                  </button>
                )}
              </div>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"20px 16px",display:"flex",flexDirection:"column",gap:8}}>
              {!Array.isArray(detail.messages)||!detail.messages.length?(
                <p style={{color:"#334155",textAlign:"center",marginTop:32,fontSize:"0.8rem"}}>Sin historial de mensajes.</p>
              ):detail.messages.map((msg,i)=>{
                const text=extractText(msg);
                if(!text)return null;
                const isBot=msg.role==="assistant";
                return(
                  <div key={i} style={{display:"flex",alignItems:"flex-end",gap:8,justifyContent:isBot?"flex-start":"flex-end"}}>
                    {isBot&&<span style={{fontSize:"1.1rem",flexShrink:0,marginBottom:2}}>🤖</span>}
                    <div style={{maxWidth:"70%",padding:"10px 14px",borderRadius:16,fontSize:"0.85rem",lineHeight:1.5,whiteSpace:"pre-wrap",wordBreak:"break-word",...(isBot?{background:"#1e1e2e",borderBottomLeftRadius:4,color:"#e2e8f0"}:{background:"linear-gradient(135deg,#8b5cf6,#ec4899)",borderBottomRightRadius:4,color:"#fff"})}}>
                      {text}
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef}/>
            </div>
          </>
        )}
      </div>

      {/* Panel derecho: datos */}
      <div style={{width:260,minWidth:240,borderLeft:"1px solid #1e1e2e",background:"#0f0f1e",overflowY:"auto",padding:"16px 14px",display:"flex",flexDirection:"column",gap:12,flexShrink:0}}>
        {!detail?<p style={{color:"#334155",fontSize:"0.8rem"}}>—</p>:(
          <>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,padding:"20px 0 16px",borderBottom:"1px solid #1e1e2e"}}>
              <div style={{width:60,height:60,borderRadius:"50%",background:"linear-gradient(135deg,#8b5cf6,#ec4899)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:"1.5rem",color:"#fff"}}>
                {(customerName(detail.customerData)??"?").charAt(0).toUpperCase()}
              </div>
              <p style={{margin:0,fontWeight:700,fontSize:"0.95rem",color:"#f1f5f9",textAlign:"center"}}>{customerName(detail.customerData)??"Cliente"}</p>
              <p style={{margin:0,fontSize:"0.75rem",color:"#64748b"}}>{phoneDisplay(detail.id)}</p>
              <span style={{fontSize:"0.65rem",padding:"2px 8px",borderRadius:20,fontWeight:600,background:stageColor(detail.stage)+"33",color:stageColor(detail.stage),border:`1px solid ${stageColor(detail.stage)}55`}}>{stageLabel(detail.stage)}</span>
            </div>

            {detail.customerData&&Object.keys(detail.customerData).length>0&&(
              <div style={{background:"#13131f",borderRadius:10,padding:"12px 14px",border:"1px solid #1e1e2e"}}>
                <p style={{margin:"0 0 10px",fontSize:"0.7rem",fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.08em"}}>Datos del cliente</p>
                {Object.entries(detail.customerData).map(([k,v])=>(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:6}}>
                    <span style={{fontSize:"0.75rem",color:"#64748b",flexShrink:0}}>{k}</span>
                    <span style={{fontSize:"0.75rem",color:"#cbd5e1",textAlign:"right",wordBreak:"break-word"}}>{String(v)}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{background:"#13131f",borderRadius:10,padding:"12px 14px",border:"1px solid #1e1e2e"}}>
              <p style={{margin:"0 0 10px",fontSize:"0.7rem",fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.08em"}}>Pedido</p>
              {Array.isArray(detail.items)&&detail.items.length?(
                <>
                  {detail.items.map(row=>(
                    <div key={row.size} style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:6}}>
                      <span style={{fontSize:"0.75rem",color:"#64748b"}}>Talla {row.size}</span>
                      <span style={{fontSize:"0.75rem",color:"#cbd5e1"}}>{row.qty} ud.</span>
                    </div>
                  ))}
                  <div style={{display:"flex",justifyContent:"space-between",gap:8,marginTop:8,borderTop:"1px solid #2a2a3a",paddingTop:8}}>
                    <span style={{fontSize:"0.75rem",color:"#64748b"}}>Total unidades</span>
                    <span style={{fontSize:"0.75rem",color:"#cbd5e1",fontWeight:700}}>{detail.totalQty??0}</span>
                  </div>
                  {detail.totalSoles!=null&&(
                    <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                      <span style={{fontSize:"0.75rem",color:"#64748b"}}>Total ref.</span>
                      <span style={{fontSize:"0.75rem",fontWeight:700,color:"#4ade80"}}>S/ {detail.totalSoles}</span>
                    </div>
                  )}
                </>
              ):<p style={{margin:0,color:"#334155",fontSize:"0.75rem"}}>Sin ítems todavía.</p>}
            </div>

            <div style={{background:"#13131f",borderRadius:10,padding:"12px 14px",border:"1px solid #1e1e2e"}}>
              <p style={{margin:"0 0 10px",fontSize:"0.7rem",fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.08em"}}>Estado</p>
              <div style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:6}}>
                <span style={{fontSize:"0.75rem",color:"#64748b"}}>Última actividad</span>
                <span style={{fontSize:"0.75rem",color:"#cbd5e1"}}>{formatTime(detail.updatedAt)}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                <span style={{fontSize:"0.75rem",color:"#64748b"}}>Bot</span>
                <span style={{fontSize:"0.75rem",fontWeight:600,color:detail.botPaused?"#f87171":"#4ade80"}}>{detail.botPaused?"⏸ Pausado":"▶ Activo"}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {error&&<div style={{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",background:"#ef4444",color:"#fff",padding:"10px 20px",borderRadius:8,fontSize:"0.85rem",zIndex:999}}>{error}</div>}
    </div>
  );
}
