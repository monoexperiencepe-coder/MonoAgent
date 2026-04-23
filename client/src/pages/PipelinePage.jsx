import { useCallback, useEffect, useState } from "react";
import { fetchActiveSessions, pauseSession, resumeSession } from "../services/api.js";

const COLUMNS = [
  { stage: "exploration", label: "Exploración", icon: "🔍", color: "#3b82f6" },
  { stage: "interest",    label: "Interés",     icon: "💡", color: "#f97316" },
  { stage: "intention",   label: "Pedido",      icon: "🛒", color: "#8b5cf6" },
  { stage: "closing",     label: "Cierre",      icon: "✅", color: "#22c55e" },
];

function customerName(cd) {
  if (!cd || typeof cd !== "object") return null;
  const n = cd.name ?? cd.nombre ?? cd.Name;
  return n && String(n).trim() ? String(n).trim() : null;
}
function phoneDisplay(id) {
  return id?.replace("whatsapp:+", "+") ?? id ?? "—";
}
function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff) || diff < 0) return "";
  const m = Math.floor(diff / 60000);
  if (m < 1)   return "justo ahora";
  if (m < 60)  return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}
function initials(sess) {
  const n = customerName(sess.customerData) ?? phoneDisplay(sess.id);
  return n.charAt(0).toUpperCase();
}

/* ── Drawer panel derecho ── */
function Drawer({ sess, onClose, onTogglePause, busyId }) {
  if (!sess) return null;
  const name = customerName(sess.customerData);
  const cd   = sess.customerData ?? {};
  const col  = COLUMNS.find(c => c.stage === sess.stage) ?? COLUMNS[0];

  const row = (label, val) => (
    <div style={{ display:"flex", justifyContent:"space-between", gap:8, marginBottom:6 }}>
      <span style={{ fontSize:"0.75rem", color:"#64748b", flexShrink:0 }}>{label}</span>
      <span style={{ fontSize:"0.75rem", color:"#cbd5e1", textAlign:"right", wordBreak:"break-word" }}>{val}</span>
    </div>
  );

  return (
    <>
      {/* Overlay */}
      <div onClick={onClose}
        style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:100 }} />
      {/* Panel */}
      <div style={{ position:"fixed", top:0, right:0, width:300, height:"100vh", background:"#0f0f1e",
        borderLeft:"1px solid #1e1e2e", zIndex:101, overflowY:"auto", padding:"20px 18px", display:"flex",
        flexDirection:"column", gap:14 }}>
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontWeight:700, color:"#f1f5f9", fontSize:"0.95rem" }}>Detalle</span>
          <button onClick={onClose}
            style={{ background:"none", border:"none", color:"#64748b", cursor:"pointer", fontSize:"1.3rem", lineHeight:1 }}>
            ✕
          </button>
        </div>

        {/* Avatar + info */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8,
          padding:"16px 0 14px", borderBottom:"1px solid #1e1e2e" }}>
          <div style={{ width:56, height:56, borderRadius:"50%",
            background:"linear-gradient(135deg,#8b5cf6,#ec4899)",
            display:"flex", alignItems:"center", justifyContent:"center",
            fontWeight:700, fontSize:"1.4rem", color:"#fff" }}>
            {initials(sess)}
          </div>
          <p style={{ margin:0, fontWeight:700, fontSize:"0.95rem", color:"#f1f5f9", textAlign:"center" }}>
            {name ?? "Cliente"}
          </p>
          <p style={{ margin:0, fontSize:"0.75rem", color:"#64748b" }}>{phoneDisplay(sess.id)}</p>
          <span style={{ fontSize:"0.65rem", padding:"2px 8px", borderRadius:20, fontWeight:600,
            background: col.color + "33", color: col.color, border:`1px solid ${col.color}55` }}>
            {col.icon} {col.label}
          </span>
        </div>

        {/* Datos del cliente */}
        {Object.keys(cd).length > 0 && (
          <div style={{ background:"#13131f", borderRadius:10, padding:"12px 14px", border:"1px solid #1e1e2e" }}>
            <p style={{ margin:"0 0 10px", fontSize:"0.7rem", fontWeight:700, color:"#475569",
              textTransform:"uppercase", letterSpacing:"0.08em" }}>Datos del cliente</p>
            {Object.entries(cd).map(([k, v]) => row(k, String(v)))}
          </div>
        )}

        {/* Pedido */}
        <div style={{ background:"#13131f", borderRadius:10, padding:"12px 14px", border:"1px solid #1e1e2e" }}>
          <p style={{ margin:"0 0 10px", fontSize:"0.7rem", fontWeight:700, color:"#475569",
            textTransform:"uppercase", letterSpacing:"0.08em" }}>Pedido</p>
          {Array.isArray(sess.items) && sess.items.length ? (
            <>
              {sess.items.map((item, i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                  <span style={{ fontSize:"0.75rem", color:"#64748b" }}>Talla {item.size}</span>
                  <span style={{ fontSize:"0.75rem", color:"#cbd5e1" }}>{item.qty} ud.</span>
                </div>
              ))}
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:8,
                borderTop:"1px solid #2a2a3a", paddingTop:8 }}>
                <span style={{ fontSize:"0.75rem", color:"#64748b" }}>Total unidades</span>
                <span style={{ fontSize:"0.75rem", color:"#cbd5e1", fontWeight:700 }}>{sess.totalQty ?? 0}</span>
              </div>
              {sess.totalSoles != null && (
                <div style={{ display:"flex", justifyContent:"space-between" }}>
                  <span style={{ fontSize:"0.75rem", color:"#64748b" }}>Total ref.</span>
                  <span style={{ fontSize:"0.75rem", fontWeight:700, color:"#4ade80" }}>S/ {sess.totalSoles}</span>
                </div>
              )}
            </>
          ) : <p style={{ margin:0, color:"#475569", fontSize:"0.75rem" }}>Sin ítems todavía.</p>}
        </div>

        {/* Estado */}
        <div style={{ background:"#13131f", borderRadius:10, padding:"12px 14px", border:"1px solid #1e1e2e" }}>
          <p style={{ margin:"0 0 10px", fontSize:"0.7rem", fontWeight:700, color:"#475569",
            textTransform:"uppercase", letterSpacing:"0.08em" }}>Estado</p>
          {row("Última actividad", timeAgo(sess.updatedAt))}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:"0.75rem", color:"#64748b" }}>Bot</span>
            <span style={{ fontSize:"0.75rem", fontWeight:600, color: sess.botPaused ? "#f87171" : "#4ade80" }}>
              {sess.botPaused ? "⏸ Pausado" : "▶ Activo"}
            </span>
          </div>
        </div>

        {/* Botón pausar/reanudar */}
        {sess.botPaused ? (
          <button disabled={busyId === sess.id} onClick={() => onTogglePause(sess, false)}
            style={{ padding:"10px", background:"rgba(74,222,128,0.1)", border:"1px solid rgba(74,222,128,0.3)",
              borderRadius:8, color:"#4ade80", cursor:"pointer", fontWeight:700, fontSize:"0.85rem",
              opacity: busyId === sess.id ? 0.5 : 1 }}>
            {busyId === sess.id ? "…" : "▶ Reanudar bot"}
          </button>
        ) : (
          <button disabled={busyId === sess.id} onClick={() => onTogglePause(sess, true)}
            style={{ padding:"10px", background:"rgba(251,191,36,0.1)", border:"1px solid rgba(251,191,36,0.3)",
              borderRadius:8, color:"#fbbf24", cursor:"pointer", fontWeight:700, fontSize:"0.85rem",
              opacity: busyId === sess.id ? 0.5 : 1 }}>
            {busyId === sess.id ? "…" : "⏸ Pausar bot"}
          </button>
        )}
      </div>
    </>
  );
}

/* ── Tarjeta de cliente ── */
function KanbanCard({ sess, color, onClick }) {
  const name = customerName(sess.customerData);
  const hasItems = Array.isArray(sess.items) && sess.items.length > 0;

  return (
    <div onClick={onClick} style={{
      background: "#13131f", borderRadius: 10, padding: "12px 14px",
      borderLeft: `3px solid ${color}`, cursor: "pointer",
      border: `1px solid #1e1e2e`, borderLeftColor: color, borderLeftWidth: 3,
      marginBottom: 10, transition: "background 0.15s",
    }}
      onMouseEnter={e => e.currentTarget.style.background = "#1a1a2e"}
      onMouseLeave={e => e.currentTarget.style.background = "#13131f"}>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <div style={{ width:34, height:34, borderRadius:"50%", flexShrink:0, color:"#fff",
          background:"linear-gradient(135deg,#8b5cf6,#ec4899)",
          display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:"0.85rem" }}>
          {initials(sess)}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <p style={{ margin:0, fontWeight:600, fontSize:"0.85rem", color:"#f1f5f9",
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {name ?? phoneDisplay(sess.id)}
          </p>
          {hasItems && (
            <p style={{ margin:"3px 0 0", fontSize:"0.72rem", color:"#4ade80" }}>
              {sess.totalQty ?? 0} unidades
              {sess.totalSoles != null ? ` · S/ ${sess.totalSoles}` : ""}
            </p>
          )}
        </div>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:8 }}>
        <span style={{ fontSize:"0.68rem", color:"#475569" }}>{timeAgo(sess.updatedAt)}</span>
        {sess.botPaused && (
          <span style={{ fontSize:"0.65rem", padding:"2px 6px", borderRadius:20, fontWeight:600,
            background:"rgba(248,113,113,0.15)", color:"#f87171", border:"1px solid rgba(248,113,113,0.3)" }}>
            ⏸ Pausado
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Columna Kanban ── */
function KanbanColumn({ col, sessions, onCardClick }) {
  return (
    <div style={{ minWidth: 240, width: 260, flexShrink: 0, display:"flex", flexDirection:"column",
      background:"#0f0f1e", borderRadius:12, border:"1px solid #1e1e2e", overflow:"hidden" }}>
      {/* Header */}
      <div style={{ padding:"14px 16px", borderBottom:"1px solid #1e1e2e", flexShrink:0,
        background: col.color + "18" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontWeight:700, fontSize:"0.88rem", color: col.color }}>
            {col.icon} {col.label}
          </span>
          <span style={{ fontSize:"0.75rem", fontWeight:700, padding:"2px 8px", borderRadius:20,
            background: col.color + "33", color: col.color }}>
            {sessions.length}
          </span>
        </div>
      </div>
      {/* Cards */}
      <div style={{ flex:1, overflowY:"auto", padding:"10px 10px 10px" }}>
        {sessions.length === 0 ? (
          <p style={{ color:"#334155", fontSize:"0.78rem", textAlign:"center", marginTop:20 }}>
            Sin clientes en esta etapa
          </p>
        ) : sessions.map(sess => (
          <KanbanCard key={sess.id} sess={sess} color={col.color} onClick={() => onCardClick(sess)} />
        ))}
      </div>
    </div>
  );
}

/* ── Página principal ── */
export default function PipelinePage() {
  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [selected, setSelected] = useState(null);
  const [busyId,   setBusyId]   = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { sessions: list } = await fetchActiveSessions();
      setSessions(list);
      setSelected(prev => prev ? list.find(s => s.id === prev.id) ?? prev : null);
    } catch (e) {
      setError(e?.message ?? "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const handleTogglePause = async (sess, pause) => {
    setBusyId(sess.id);
    try {
      if (pause) await pauseSession(sess.id);
      else await resumeSession(sess.id);
      await load();
    } catch (e) {
      setError(e?.message ?? "Error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh",
      background:"#0d0d1a", color:"#e2e8f0", fontFamily:"Inter,system-ui,sans-serif", overflow:"hidden" }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"18px 28px 14px", borderBottom:"1px solid #1e1e2e", flexShrink:0 }}>
        <div>
          <h1 style={{ margin:0, fontSize:"1.2rem", fontWeight:700, color:"#f1f5f9" }}>
            📊 Pipeline de ventas
          </h1>
          {!loading && (
            <p style={{ margin:"4px 0 0", fontSize:"0.75rem", color:"#475569" }}>
              {sessions.length} conversación{sessions.length !== 1 ? "es" : ""} activa{sessions.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <button onClick={load}
          style={{ background:"none", border:"1px solid #2a2a3a", borderRadius:8,
            color:"#64748b", cursor:"pointer", fontSize:"1.1rem", padding:"7px 12px" }}
          title="Actualizar">
          ↺
        </button>
      </div>

      {/* Board */}
      <div style={{ flex:1, overflowX:"auto", overflowY:"hidden", padding:"20px 24px" }}>
        {loading ? (
          <p style={{ color:"#475569", fontSize:"0.9rem" }}>Cargando…</p>
        ) : error ? (
          <p style={{ color:"#f87171", fontSize:"0.85rem" }}>{error}</p>
        ) : (
          <div style={{ display:"flex", gap:16, height:"100%", alignItems:"flex-start" }}>
            {COLUMNS.map(col => (
              <KanbanColumn
                key={col.stage}
                col={col}
                sessions={sessions.filter(s => s.stage === col.stage)}
                onCardClick={setSelected}
              />
            ))}
          </div>
        )}
      </div>

      {/* Drawer */}
      <Drawer
        sess={selected}
        onClose={() => setSelected(null)}
        onTogglePause={handleTogglePause}
        busyId={busyId}
      />
    </div>
  );
}
