import { NavLink } from "react-router-dom";

const links = [
  { to: "/", label: "Chat", icon: "💬", end: true },
  { to: "/instrucciones", label: "Instrucciones", icon: "⚙️", end: false },
  { to: "/faqs", label: "FAQs", icon: "❓", end: false },
];

function linkClass(isActive) {
  return `nav__link${isActive ? " nav__link--active" : ""}`;
}

export function AppNav() {
  return (
    <>
      <nav className="nav nav--top" aria-label="Navegación principal">
        <div className="nav__inner">
          {links.map(({ to, label, icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => linkClass(isActive)}
            >
              <span className="nav__icon" aria-hidden>
                {icon}
              </span>
              <span className="nav__text">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      <nav className="nav nav--bottom" aria-label="Navegación principal">
        {links.map(({ to, label, icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => linkClass(isActive)}
          >
            <span className="nav__icon" aria-hidden>
              {icon}
            </span>
            <span className="nav__label">{label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}
