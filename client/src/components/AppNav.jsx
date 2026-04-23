import { NavLink } from "react-router-dom";

const links = [
  { to: "/", label: "Buzón", icon: "📥", end: true },
  { to: "/chat", label: "Chat AI", icon: "💬", end: false },
  { to: "/configuracion", label: "Configuración", icon: "⚙️", end: false },
];

export function AppNav() {
  return (
    <nav style={{width:64,minHeight:"100vh",background:"#080812",borderRight:"1px solid #1a1a2a",display:"flex",flexDirection:"column",alignItems:"center",padding:"12px 0",gap:4,flexShrink:0}}>
      <div style={{width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,#8b5cf6,#ec4899)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:"1.1rem",color:"#fff",marginBottom:16}}>M</div>
      <div style={{display:"flex",flexDirection:"column",gap:4,flex:1,width:"100%",alignItems:"center"}}>
        {links.map(({to,label,icon,end})=>(
          <NavLink key={to} to={to} end={end} title={label}
            style={({isActive})=>({position:"relative",display:"flex",alignItems:"center",justifyContent:"center",width:44,height:44,borderRadius:12,textDecoration:"none",color:isActive?"#a78bfa":"#475569",background:isActive?"rgba(139,92,246,0.2)":"none"})}>
            <span style={{fontSize:"1.2rem"}}>{icon}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
