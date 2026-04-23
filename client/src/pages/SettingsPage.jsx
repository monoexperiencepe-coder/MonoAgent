import { useEffect, useState } from "react";
import { fetchConfig, saveConfig } from "../services/api.js";

const TABS = [
  { id: "negocio",       label: "Negocio",       icon: "🏪" },
  { id: "horario",       label: "Horario",        icon: "🕐" },
  { id: "promos",        label: "Promos",         icon: "🎁" },
  { id: "catalogo",      label: "Catálogo",       icon: "📦" },
  { id: "instrucciones", label: "Instrucciones",  icon: "🤖" },
  { id: "meta",          label: "Meta API",       icon: "🔑" },
];

const C = {
  page:    { display:"flex", height:"100vh", background:"#0d0d1a", color:"#e2e8f0", fontFamily:"Inter,system-ui,sans-serif", overflow:"hidden" },
  sidebar: { width:180, flexShrink:0, borderRight:"1px solid #1e1e2e", background:"#0f0f1e", display:"flex", flexDirection:"column", padding:"24px 0 16px" },
  sideTitle: { margin:"0 0 20px", padding:"0 18px", fontSize:"0.75rem", fontWeight:700, color:"#475569", textTransform:"uppercase", letterSpacing:"0.08em" },
  tab:        { display:"flex", alignItems:"center", gap:10, padding:"10px 18px", background:"none", border:"none", cursor:"pointer", color:"#64748b", fontSize:"0.88rem", fontWeight:500, width:"100%", textAlign:"left", borderLeft:"3px solid transparent" },
  tabActive:  { color:"#a78bfa", background:"rgba(139,92,246,0.1)", borderLeft:"3px solid #8b5cf6" },
  content:    { flex:1, overflowY:"auto", padding:"32px 36px" },
  heading:    { margin:"0 0 24px", fontSize:"1.25rem", fontWeight:700, color:"#f1f5f9" },
  card:       { background:"#13131f", border:"1px solid #1e1e2e", borderRadius:12, padding:"24px", marginBottom:20 },
  label:      { display:"block", marginBottom:6, fontSize:"0.8rem", fontWeight:600, color:"#64748b", textTransform:"uppercase", letterSpacing:"0.06em" },
  input:      { width:"100%", padding:"10px 14px", background:"#0d0d1a", border:"1px solid #2a2a3a", borderRadius:8, color:"#e2e8f0", fontSize:"0.9rem", outline:"none", boxSizing:"border-box" },
  textarea:   { width:"100%", padding:"12px 14px", background:"#0d0d1a", border:"1px solid #2a2a3a", borderRadius:8, color:"#e2e8f0", fontSize:"0.88rem", outline:"none", resize:"vertical", fontFamily:"inherit", boxSizing:"border-box", lineHeight:1.6 },
  btn:        { marginTop:16, padding:"10px 22px", background:"linear-gradient(135deg,#8b5cf6,#7c3aed)", border:"none", borderRadius:8, color:"#fff", fontWeight:700, fontSize:"0.9rem", cursor:"pointer" },
  btnDisabled:{ opacity:0.5, cursor:"not-allowed" },
  success:    { marginTop:10, fontSize:"0.82rem", color:"#4ade80" },
  error:      { marginTop:10, fontSize:"0.82rem", color:"#f87171" },
  hint:       { marginTop:6, fontSize:"0.78rem", color:"#475569" },
};

function useSave() {
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState(null); // { ok, text }
  const save = async (patch) => {
    setSaving(true); setMsg(null);
    try {
      await saveConfig(patch);
      setMsg({ ok: true, text: "Guardado ✓" });
    } catch (e) {
      setMsg({ ok: false, text: e?.message ?? "Error al guardar" });
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };
  return { save, saving, msg };
}

/* ── Pestaña Negocio ── */
const EMPTY_FIELD = () => ({ label: "", value: "" });

function TabNegocio({ config }) {
  const b = config?.business ?? {};
  const [name,       setName]       = useState(b.name        ?? "");
  const [industry,   setIndustry]   = useState(b.industry    ?? "");
  const [desc,       setDesc]       = useState(b.description ?? "");
  const [phone1,     setPhone1]     = useState(b.phone1      ?? "");
  const [phone2,     setPhone2]     = useState(b.phone2      ?? "");
  const [whatsapp,   setWhatsapp]   = useState(b.whatsapp    ?? "");
  const [email,      setEmail]      = useState(b.email       ?? "");
  const [website,    setWebsite]    = useState(b.website     ?? "");
  const [instagram,  setInstagram]  = useState(b.instagram   ?? "");
  const [address,    setAddress]    = useState(b.address     ?? "");
  const [hours,      setHours]      = useState(b.hours       ?? "");
  const [customFields, setCustomFields] = useState(
    Array.isArray(b.customFields) && b.customFields.length ? b.customFields : []
  );
  const { save, saving, msg } = useSave();

  useEffect(() => {
    const b2 = config?.business ?? {};
    setName(b2.name        ?? "");
    setIndustry(b2.industry    ?? "");
    setDesc(b2.description ?? "");
    setPhone1(b2.phone1      ?? "");
    setPhone2(b2.phone2      ?? "");
    setWhatsapp(b2.whatsapp    ?? "");
    setEmail(b2.email       ?? "");
    setWebsite(b2.website     ?? "");
    setInstagram(b2.instagram   ?? "");
    setAddress(b2.address     ?? "");
    setHours(b2.hours       ?? "");
    setCustomFields(Array.isArray(b2.customFields) && b2.customFields.length ? b2.customFields : []);
  }, [config]);

  const addCustomField  = () => setCustomFields(prev => [...prev, EMPTY_FIELD()]);
  const removeCustomField = (i) => setCustomFields(prev => prev.filter((_, idx) => idx !== i));
  const updateCustomField = (i, key, val) =>
    setCustomFields(prev => prev.map((f, idx) => idx === i ? { ...f, [key]: val } : f));

  const handleSave = () => save({
    business: {
      name, industry, description: desc,
      phone1, phone2, whatsapp, email,
      website, instagram, address, hours,
      customFields: customFields.filter(f => f.label.trim() || f.value.trim()),
    },
  });

  const field = (label, value, setter, placeholder = "") => (
    <div style={{ marginBottom: 14 }}>
      <label style={C.label}>{label}</label>
      <input style={C.input} value={value} onChange={e => setter(e.target.value)} placeholder={placeholder} />
    </div>
  );

  return (
    <div>
      <h2 style={C.heading}>Datos del negocio</h2>

      {/* Información principal */}
      <div style={C.card}>
        <p style={{ ...C.label, fontSize:"0.7rem", marginBottom:16 }}>Información principal</p>
        {field("Nombre del negocio", name, setName, "Ej: Mono Experience")}
        {field("Rubro / Industria",  industry, setIndustry, "Ej: Ropa, Restaurante, Servicios")}
        <div style={{ marginBottom: 14 }}>
          <label style={C.label}>Descripción breve</label>
          <textarea style={{ ...C.textarea, minHeight: 80 }} value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="Describe brevemente tu negocio, productos o servicios…" />
        </div>
      </div>

      {/* Contacto */}
      <div style={C.card}>
        <p style={{ ...C.label, fontSize:"0.7rem", marginBottom:16 }}>Contacto</p>
        {field("Teléfono principal",    phone1,    setPhone1,    "+51 999 000 000")}
        {field("Teléfono secundario",   phone2,    setPhone2,    "+51 999 000 001")}
        {field("WhatsApp de contacto",  whatsapp,  setWhatsapp,  "+51 999 000 000")}
        {field("Email",                 email,     setEmail,     "hola@negocio.com")}
      </div>

      {/* Presencia online */}
      <div style={C.card}>
        <p style={{ ...C.label, fontSize:"0.7rem", marginBottom:16 }}>Presencia online y ubicación</p>
        {field("Sitio web",          website,   setWebsite,   "https://negocio.com")}
        {field("Instagram",          instagram, setInstagram, "@negocio")}
        {field("Dirección",          address,   setAddress,   "Av. Principal 123, Lima")}
        {field("Horario de atención",hours,     setHours,     "Lun-Vie 9am-6pm, Sáb 10am-2pm")}
      </div>

      {/* Campos personalizados */}
      <div style={C.card}>
        <p style={{ ...C.label, fontSize:"0.7rem", marginBottom:12 }}>Campos personalizados</p>
        <p style={{ ...C.hint, marginBottom:16 }}>Agrega cualquier dato extra que quieras que el bot conozca sobre tu negocio.</p>
        {customFields.map((cf, i) => (
          <div key={i} style={{ display:"flex", gap:8, marginBottom:8, alignItems:"center" }}>
            <input style={{ ...C.input, flex:"0 0 38%", marginBottom:0 }}
              value={cf.label} placeholder="Etiqueta (ej: Yape)"
              onChange={e => updateCustomField(i, "label", e.target.value)} />
            <input style={{ ...C.input, flex:1, marginBottom:0 }}
              value={cf.value} placeholder="Valor (ej: 999 000 000)"
              onChange={e => updateCustomField(i, "value", e.target.value)} />
            <button onClick={() => removeCustomField(i)}
              style={{ background:"none", border:"1px solid #3a2a2a", borderRadius:6, color:"#f87171", cursor:"pointer", padding:"8px 10px", flexShrink:0, fontSize:"0.9rem" }}>
              ✕
            </button>
          </div>
        ))}
        <button onClick={addCustomField}
          style={{ marginTop:8, background:"none", border:"1px dashed #2a2a4a", borderRadius:8, color:"#8b5cf6", cursor:"pointer", padding:"8px 14px", fontSize:"0.83rem", fontWeight:600, width:"100%" }}>
          ＋ Agregar campo personalizado
        </button>
      </div>

      <button style={{ ...C.btn, ...(saving ? C.btnDisabled : {}) }} disabled={saving} onClick={handleSave}>
        {saving ? "Guardando…" : "Guardar todo"}
      </button>
      {msg && <p style={msg.ok ? C.success : C.error}>{msg.text}</p>}
    </div>
  );
}

/* ── Pestaña Horario ── */
const DAYS_DEFAULT = [
  { day: "Lunes",     active: true,  start: "09:00", end: "18:00" },
  { day: "Martes",    active: true,  start: "09:00", end: "18:00" },
  { day: "Miércoles", active: true,  start: "09:00", end: "18:00" },
  { day: "Jueves",    active: true,  start: "09:00", end: "18:00" },
  { day: "Viernes",   active: true,  start: "09:00", end: "18:00" },
  { day: "Sábado",    active: false, start: "09:00", end: "13:00" },
  { day: "Domingo",   active: false, start: "09:00", end: "13:00" },
];

function mergeDays(saved) {
  if (!Array.isArray(saved) || !saved.length) return DAYS_DEFAULT.map(d => ({ ...d }));
  return DAYS_DEFAULT.map(def => {
    const found = saved.find(s => s.day === def.day);
    return found ? { ...def, ...found } : { ...def };
  });
}

function TabHorario({ config }) {
  const s = config?.schedule ?? {};
  const [days, setDays]         = useState(() => mergeDays(s.days));
  const [timezone, setTimezone] = useState(s.timezone    ?? "America/Lima");
  const [away, setAway]         = useState(s.awayMessage ?? "");
  const { save, saving, msg }   = useSave();

  useEffect(() => {
    const s2 = config?.schedule ?? {};
    setDays(mergeDays(s2.days));
    setTimezone(s2.timezone    ?? "America/Lima");
    setAway(s2.awayMessage ?? "");
  }, [config]);

  const toggleDay = (i) =>
    setDays(prev => prev.map((d, idx) => idx === i ? { ...d, active: !d.active } : d));
  const updateDay = (i, key, val) =>
    setDays(prev => prev.map((d, idx) => idx === i ? { ...d, [key]: val } : d));

  const timeInput = {
    padding: "7px 10px", background: "#0d0d1a", border: "1px solid #2a2a3a",
    borderRadius: 6, color: "#e2e8f0", fontSize: "0.85rem", outline: "none",
    colorScheme: "dark",
  };
  const toggleStyle = (active) => ({
    width: 38, height: 20, borderRadius: 10, cursor: "pointer", border: "none",
    background: active ? "#8b5cf6" : "#2a2a3a", position: "relative",
    flexShrink: 0, transition: "background 0.2s",
  });
  const knobStyle = (active) => ({
    position: "absolute", top: 2, left: active ? 20 : 2, width: 16, height: 16,
    borderRadius: "50%", background: "#fff", transition: "left 0.2s",
  });

  return (
    <div>
      <h2 style={C.heading}>Horario de atención</h2>

      {/* Tabla de días */}
      <div style={C.card}>
        <p style={{ ...C.label, fontSize:"0.7rem", marginBottom:16 }}>Días y horas</p>
        {days.map((d, i) => (
          <div key={d.day} style={{ display:"flex", alignItems:"center", gap:16, padding:"10px 0",
            borderBottom: i < days.length - 1 ? "1px solid #1a1a2a" : "none" }}>
            {/* Nombre del día */}
            <span style={{ width:90, fontSize:"0.88rem", color:"#cbd5e1", flexShrink:0 }}>{d.day}</span>
            {/* Toggle */}
            <button onClick={() => toggleDay(i)} style={toggleStyle(d.active)} title={d.active ? "Activo" : "Cerrado"}>
              <span style={knobStyle(d.active)} />
            </button>
            {/* Horas o "Cerrado" */}
            {d.active ? (
              <div style={{ display:"flex", alignItems:"center", gap:8, flex:1 }}>
                <input type="time" value={d.start} onChange={e => updateDay(i, "start", e.target.value)} style={timeInput} />
                <span style={{ color:"#475569", fontSize:"0.8rem" }}>–</span>
                <input type="time" value={d.end}   onChange={e => updateDay(i, "end",   e.target.value)} style={timeInput} />
              </div>
            ) : (
              <span style={{ color:"#475569", fontSize:"0.82rem", fontStyle:"italic" }}>Cerrado</span>
            )}
          </div>
        ))}
      </div>

      {/* Mensaje de ausencia */}
      <div style={C.card}>
        <p style={{ ...C.label, fontSize:"0.7rem", marginBottom:6 }}>Mensaje fuera de horario</p>
        <p style={{ ...C.hint, marginBottom:14 }}>
          El bot enviará este mensaje cuando el cliente escriba fuera del horario configurado.
        </p>
        <textarea style={{ ...C.textarea, minHeight:100 }} value={away} onChange={e => setAway(e.target.value)}
          placeholder="Hola! Estamos fuera de horario. Te respondemos en cuanto volvamos 🙏" />
        <div style={{ marginTop:16 }}>
          <label style={C.label}>Zona horaria</label>
          <input style={C.input} value={timezone} onChange={e => setTimezone(e.target.value)}
            placeholder="America/Lima" />
          <p style={C.hint}>Ejemplos: America/Lima · America/Bogota · America/Mexico_City · Europe/Madrid</p>
        </div>
      </div>

      <button style={{ ...C.btn, ...(saving ? C.btnDisabled : {}) }} disabled={saving}
        onClick={() => save({ schedule: { days, timezone, awayMessage: away } })}>
        {saving ? "Guardando…" : "Guardar"}
      </button>
      {msg && <p style={msg.ok ? C.success : C.error}>{msg.text}</p>}
    </div>
  );
}

/* ── Pestaña Promos ── */
function TabPromos({ config }) {
  const [promos, setPromos] = useState(config?.promos ?? "");
  const { save, saving, msg } = useSave();

  useEffect(() => { setPromos(config?.promos ?? ""); }, [config]);

  return (
    <div>
      <h2 style={C.heading}>Promociones vigentes</h2>
      <div style={C.card}>
        <label style={C.label}>Texto libre de promos (el bot lo usará como referencia)</label>
        <textarea style={{ ...C.textarea, minHeight:200 }} value={promos} onChange={e => setPromos(e.target.value)}
          placeholder={"Ej:\n3 polos S/ 150 con delivery gratis\n2 polos S/ 110\nPromo cumpleaños: -10% en todos los pedidos"} />
        <button style={{ ...C.btn, ...(saving ? C.btnDisabled : {}) }} disabled={saving}
          onClick={() => save({ promos })}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
        {msg && <p style={msg.ok ? C.success : C.error}>{msg.text}</p>}
      </div>
    </div>
  );
}

/* ── Pestaña Catálogo ── */
const EMPTY_VARIANT = () => ({ name: "", options: "" });
const EMPTY_PRODUCT = () => ({
  id: Date.now().toString(),
  name: "", category: "", description: "",
  price: "", currency: "S/",
  imageUrl: "", imageUrl2: "", imageUrl3: "",
  variants: [],
});

function ProductForm({ initial, onSave, onCancel }) {
  const [p, setP] = useState(() => initial ?? EMPTY_PRODUCT());
  const set = (key, val) => setP(prev => ({ ...prev, [key]: val }));

  const addVariant    = () => setP(prev => ({ ...prev, variants: [...(prev.variants ?? []), EMPTY_VARIANT()] }));
  const removeVariant = (i) => setP(prev => ({ ...prev, variants: prev.variants.filter((_, idx) => idx !== i) }));
  const updateVariant = (i, key, val) =>
    setP(prev => ({ ...prev, variants: prev.variants.map((v, idx) => idx === i ? { ...v, [key]: val } : v) }));

  const inp = (key, placeholder, type = "text", extra = {}) => (
    <input style={C.input} type={type} value={p[key] ?? ""} placeholder={placeholder}
      onChange={e => set(key, e.target.value)} {...extra} />
  );

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24 }}>
        <h2 style={{ ...C.heading, margin:0 }}>{initial ? "Editar producto" : "Nuevo producto"}</h2>
        <button onClick={onCancel}
          style={{ background:"none", border:"1px solid #2a2a3a", borderRadius:8, color:"#64748b", padding:"7px 14px", cursor:"pointer", fontSize:"0.85rem" }}>
          Cancelar
        </button>
      </div>

      {/* Info básica */}
      <div style={C.card}>
        <p style={{ ...C.label, fontSize:"0.7rem", marginBottom:16 }}>Información básica</p>
        <div style={{ marginBottom:14 }}>
          <label style={C.label}>Nombre del producto *</label>
          {inp("name", "Ej: Polo Oversize Premium")}
        </div>
        <div style={{ marginBottom:14 }}>
          <label style={C.label}>Categoría</label>
          {inp("category", "Ej: Polos, Accesorios, Bebidas")}
        </div>
        <div style={{ marginBottom:0 }}>
          <label style={C.label}>Descripción</label>
          <textarea style={{ ...C.textarea, minHeight:80 }} value={p.description ?? ""}
            onChange={e => set("description", e.target.value)}
            placeholder="Descripción breve del producto…" />
        </div>
      </div>

      {/* Precio */}
      <div style={C.card}>
        <p style={{ ...C.label, fontSize:"0.7rem", marginBottom:16 }}>Precio</p>
        <div style={{ display:"flex", gap:10 }}>
          <div style={{ flex:"0 0 90px" }}>
            <label style={C.label}>Moneda</label>
            {inp("currency", "S/")}
          </div>
          <div style={{ flex:1 }}>
            <label style={C.label}>Precio unitario</label>
            {inp("price", "65", "number")}
          </div>
        </div>
      </div>

      {/* Imágenes */}
      <div style={C.card}>
        <p style={{ ...C.label, fontSize:"0.7rem", marginBottom:16 }}>Imágenes (URL directa)</p>
        {["imageUrl","imageUrl2","imageUrl3"].map((key, i) => (
          <div key={key} style={{ marginBottom: i < 2 ? 16 : 0 }}>
            <label style={C.label}>Imagen {i + 1}{i === 0 ? " *" : " (opcional)"}</label>
            {inp(key, "https://...")}
            {p[key] && (
              <img src={p[key]} alt="" style={{ marginTop:8, height:120, borderRadius:8, objectFit:"cover", border:"1px solid #2a2a3a", display:"block" }}
                onError={e => { e.target.style.display = "none"; }} />
            )}
          </div>
        ))}
      </div>

      {/* Variantes */}
      <div style={C.card}>
        <p style={{ ...C.label, fontSize:"0.7rem", marginBottom:6 }}>Variantes del producto</p>
        <p style={{ ...C.hint, marginBottom:16 }}>Ej: Talla → S, M, L, XL · Color → Rojo, Azul, Negro</p>
        {(p.variants ?? []).map((v, i) => (
          <div key={i} style={{ display:"flex", gap:8, marginBottom:8, alignItems:"flex-start" }}>
            <div style={{ flex:"0 0 160px" }}>
              {i === 0 && <label style={{ ...C.label, marginBottom:4 }}>Nombre</label>}
              <input style={C.input} value={v.name} placeholder="Ej: Talla"
                onChange={e => updateVariant(i, "name", e.target.value)} />
            </div>
            <div style={{ flex:1 }}>
              {i === 0 && <label style={{ ...C.label, marginBottom:4 }}>Opciones (separadas por coma)</label>}
              <input style={C.input} value={v.options} placeholder="Ej: S, M, L, XL"
                onChange={e => updateVariant(i, "options", e.target.value)} />
            </div>
            <button onClick={() => removeVariant(i)}
              style={{ background:"none", border:"1px solid #3a2a2a", borderRadius:6, color:"#f87171",
                cursor:"pointer", padding:"8px 10px", flexShrink:0, fontSize:"0.9rem",
                marginTop: i === 0 ? 22 : 0 }}>
              ✕
            </button>
          </div>
        ))}
        <button onClick={addVariant}
          style={{ marginTop:8, background:"none", border:"1px dashed #2a2a4a", borderRadius:8,
            color:"#8b5cf6", cursor:"pointer", padding:"8px 14px", fontSize:"0.83rem", fontWeight:600, width:"100%" }}>
          ＋ Agregar variante
        </button>
      </div>

      <button
        disabled={!p.name?.trim()}
        onClick={() => onSave(p)}
        style={{ ...C.btn, ...(!p.name?.trim() ? C.btnDisabled : {}), width:"100%" }}>
        Guardar producto
      </button>
    </div>
  );
}

function TabCatalogo({ config, onConfigChange }) {
  const [products, setProducts] = useState(() =>
    Array.isArray(config?.catalog) ? config.catalog : []
  );
  const [showForm, setShowForm]       = useState(false);
  const [editingProduct, setEditing]  = useState(null);
  const [saving, setSaving]           = useState(false);
  const [msg, setMsg]                 = useState(null);

  useEffect(() => {
    setProducts(Array.isArray(config?.catalog) ? config.catalog : []);
  }, [config]);

  const persist = async (updated) => {
    setSaving(true); setMsg(null);
    try {
      await saveConfig({ catalog: updated });
      setMsg({ ok: true, text: "Guardado ✓" });
      if (onConfigChange) onConfigChange({ ...config, catalog: updated });
      setTimeout(() => setMsg(null), 3000);
    } catch (e) {
      setMsg({ ok: false, text: e?.message ?? "Error al guardar" });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (product) => {
    const updated = editingProduct
      ? products.map(p => p.id === product.id ? product : p)
      : [...products, { ...product, id: product.id || Date.now().toString() }];
    setProducts(updated);
    await persist(updated);
    setShowForm(false);
    setEditing(null);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("¿Eliminar este producto?")) return;
    const updated = products.filter(p => p.id !== id);
    setProducts(updated);
    await persist(updated);
  };

  const handleEdit = (product) => {
    setEditing(product);
    setShowForm(true);
  };

  if (showForm) {
    return (
      <ProductForm
        initial={editingProduct}
        onSave={handleSave}
        onCancel={() => { setShowForm(false); setEditing(null); }}
      />
    );
  }

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24 }}>
        <h2 style={{ ...C.heading, margin:0 }}>Catálogo de productos</h2>
        <button onClick={() => { setEditing(null); setShowForm(true); }}
          style={{ ...C.btn, marginTop:0 }}>
          ＋ Nuevo producto
        </button>
      </div>

      {msg && <p style={{ ...(msg.ok ? C.success : C.error), marginBottom:12 }}>{msg.text}</p>}

      {!products.length ? (
        <div style={{ ...C.card, textAlign:"center", padding:"48px 24px" }}>
          <span style={{ fontSize:"3rem" }}>📦</span>
          <p style={{ marginTop:16, color:"#475569", fontSize:"0.95rem" }}>
            No hay productos aún. Agrega tu primer producto.
          </p>
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16 }}>
          {products.map(prod => (
            <div key={prod.id} style={{ background:"#13131f", border:"1px solid #1e1e2e", borderRadius:12, overflow:"hidden", display:"flex", flexDirection:"column" }}>
              {prod.imageUrl && (
                <img src={prod.imageUrl} alt={prod.name}
                  style={{ width:"100%", height:160, objectFit:"cover", display:"block" }}
                  onError={e => { e.target.style.display = "none"; }} />
              )}
              <div style={{ padding:"14px 16px", flex:1, display:"flex", flexDirection:"column", gap:6 }}>
                <p style={{ margin:0, fontWeight:700, fontSize:"0.95rem", color:"#f1f5f9" }}>{prod.name}</p>
                {prod.category && <p style={{ margin:0, fontSize:"0.75rem", color:"#64748b" }}>{prod.category}</p>}
                {prod.price && (
                  <p style={{ margin:0, fontWeight:700, color:"#4ade80", fontSize:"0.9rem" }}>
                    {prod.currency ?? "S/"} {prod.price}
                  </p>
                )}
                {Array.isArray(prod.variants) && prod.variants.length > 0 && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginTop:4 }}>
                    {prod.variants.map((v, i) => v.name && (
                      <span key={i} style={{ fontSize:"0.65rem", padding:"2px 7px", borderRadius:20,
                        background:"rgba(139,92,246,0.15)", color:"#a78bfa", border:"1px solid rgba(139,92,246,0.3)" }}>
                        {v.name}: {v.options}
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ display:"flex", gap:8, marginTop:"auto", paddingTop:10 }}>
                  <button onClick={() => handleEdit(prod)}
                    style={{ flex:1, padding:"7px 0", background:"rgba(139,92,246,0.1)", border:"1px solid rgba(139,92,246,0.3)",
                      borderRadius:7, color:"#a78bfa", cursor:"pointer", fontSize:"0.8rem", fontWeight:600 }}>
                    Editar
                  </button>
                  <button onClick={() => handleDelete(prod.id)} disabled={saving}
                    style={{ flex:1, padding:"7px 0", background:"rgba(248,113,113,0.08)", border:"1px solid rgba(248,113,113,0.25)",
                      borderRadius:7, color:"#f87171", cursor:"pointer", fontSize:"0.8rem", fontWeight:600 }}>
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Pestaña Instrucciones ── */
function TabInstrucciones({ config }) {
  const [prompt, setPrompt] = useState(config?.systemPrompt ?? config?.instructions ?? "");
  const { save, saving, msg } = useSave();

  useEffect(() => { setPrompt(config?.systemPrompt ?? config?.instructions ?? ""); }, [config]);

  return (
    <div>
      <h2 style={C.heading}>Instrucciones del bot</h2>
      <div style={C.card}>
        <label style={C.label}>System prompt</label>
        <p style={C.hint}>Este texto define la personalidad y reglas del asistente de ventas.</p>
        <textarea style={{ ...C.textarea, minHeight:320, marginTop:12 }} value={prompt} onChange={e => setPrompt(e.target.value)}
          placeholder="Eres un asistente de ventas de Mono Experience. Tu objetivo es..." />
        <button style={{ ...C.btn, ...(saving ? C.btnDisabled : {}) }} disabled={saving}
          onClick={() => save({ systemPrompt: prompt })}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
        {msg && <p style={msg.ok ? C.success : C.error}>{msg.text}</p>}
      </div>
    </div>
  );
}

/* ── Pestaña Meta API ── */
function TabMeta({ config }) {
  const existing = config?.whatsappToken ?? config?.metaToken ?? "";
  const masked   = existing.length > 20
    ? existing.slice(0, 20) + "•".repeat(Math.min(existing.length - 20, 24))
    : existing;
  const [token, setToken] = useState("");
  const { save, saving, msg } = useSave();

  return (
    <div>
      <h2 style={C.heading}>Meta API / WhatsApp</h2>
      <div style={C.card}>
        {existing && (
          <div style={{ marginBottom:20, padding:"10px 14px", background:"#0d0d1a", borderRadius:8, border:"1px solid #2a2a3a" }}>
            <p style={{ margin:0, fontSize:"0.75rem", color:"#475569", marginBottom:4 }}>Token actual</p>
            <code style={{ fontSize:"0.8rem", color:"#a78bfa", wordBreak:"break-all" }}>{masked}</code>
          </div>
        )}
        <label style={C.label}>Nuevo Access Token</label>
        <input style={C.input} type="password" value={token} onChange={e => setToken(e.target.value)}
          placeholder="Pega aquí el token de Meta WhatsApp Cloud API" />
        <p style={C.hint}>Ve a developers.facebook.com → tu app → WhatsApp → API Setup → Access Token temporal o permanente.</p>
        <button style={{ ...C.btn, ...(saving || !token.trim() ? C.btnDisabled : {}) }}
          disabled={saving || !token.trim()} onClick={() => save({ whatsappToken: token })}>
          {saving ? "Guardando…" : "Guardar token"}
        </button>
        {msg && <p style={msg.ok ? C.success : C.error}>{msg.text}</p>}
      </div>
    </div>
  );
}

/* ── Componente principal ── */
export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("negocio");
  const [config, setConfig]       = useState(null);
  const [loadErr, setLoadErr]     = useState(null);

  useEffect(() => {
    fetchConfig()
      .then(setConfig)
      .catch(e => setLoadErr(e?.message ?? "Error al cargar configuración"));
  }, []);

  const renderTab = () => {
    if (!config) return <p style={{ color:"#475569", fontSize:"0.9rem" }}>{loadErr ?? "Cargando…"}</p>;
    switch (activeTab) {
      case "negocio":       return <TabNegocio        config={config} />;
      case "horario":       return <TabHorario         config={config} />;
      case "promos":        return <TabPromos          config={config} />;
      case "catalogo":      return <TabCatalogo config={config} onConfigChange={setConfig} />;
      case "instrucciones": return <TabInstrucciones   config={config} />;
      case "meta":          return <TabMeta            config={config} />;
      default:              return null;
    }
  };

  return (
    <div style={C.page}>
      {/* Sidebar de pestañas */}
      <div style={C.sidebar}>
        <p style={C.sideTitle}>Configuración</p>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ ...C.tab, ...(activeTab === t.id ? C.tabActive : {}) }}>
            <span style={{ fontSize:"1rem" }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenido */}
      <div style={C.content}>
        {renderTab()}
      </div>
    </div>
  );
}
