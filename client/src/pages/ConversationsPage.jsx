import { useCallback, useEffect, useState } from "react";
import { fetchActiveSessions, pauseSession, resumeSession } from "../services/api.js";

const STAGE_LABELS = {
  exploration: "Exploración",
  interest: "Interés",
  intention: "Pedido",
  closing: "Cierre",
};

function stageLabel(stage) {
  return STAGE_LABELS[stage] ?? stage ?? "—";
}

function formatWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" });
}

function customerName(data) {
  if (!data || typeof data !== "object") return null;
  const n = data.name;
  if (n != null && String(n).trim() !== "") return String(n).trim();
  return null;
}

export default function ConversationsPage() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { sessions: list } = await fetchActiveSessions();
      setSessions(list);
      setSelected((prev) => (prev ? list.find((s) => s.id === prev.id) ?? null : null));
    } catch (e) {
      setError(e?.message ?? "No se pudieron cargar las conversaciones");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const runPauseToggle = async (session, nextPaused) => {
    setBusyId(session.id);
    setError(null);
    try {
      if (nextPaused) await pauseSession(session.id);
      else await resumeSession(session.id);
      await loadSessions();
    } catch (e) {
      setError(e?.message ?? "Error al actualizar el estado del bot");
    } finally {
      setBusyId(null);
    }
  };

  const detail = selected ? sessions.find((s) => s.id === selected.id) ?? selected : null;

  return (
    <div className="page page--settings">
      <div className="page__content page__content--wide">
        <header className="conv__header">
          <h1 className="conv__title">Conversaciones</h1>
          <p className="conv__subtitle">WhatsApp activo en las últimas 24 horas (máx. 50)</p>
        </header>

        {error ? (
          <div className="panel conv__error" role="alert">
            {error}
          </div>
        ) : null}

        {loading && !sessions.length ? (
          <p className="conv__muted">Cargando…</p>
        ) : !sessions.length && !loading ? (
          <p className="conv__muted">No hay conversaciones en ese periodo.</p>
        ) : null}

        {detail ? (
          <div className="panel conv__detail">
            <button type="button" className="btn btn--secondary btn--small conv__back" onClick={() => setSelected(null)}>
              ← Volver al listado
            </button>

            <h2 className="conv__detail-phone">{detail.id}</h2>
            {customerName(detail.customerData) ? (
              <p className="conv__detail-name">{customerName(detail.customerData)}</p>
            ) : null}
            <p className="conv__muted conv__detail-meta">
              Última actividad: {formatWhen(detail.updatedAt)} · {stageLabel(detail.stage)}
              {detail.botPaused ? " · Bot pausado" : ""}
            </p>

            {detail.product ? (
              <p className="conv__detail-product">
                <span className="conv__label">Producto</span> {detail.product}
              </p>
            ) : null}

            <section className="conv__block">
              <h3 className="conv__block-title">Ítems</h3>
              {Array.isArray(detail.items) && detail.items.length ? (
                <ul className="conv__items">
                  {detail.items.map((row) => (
                    <li key={row.size}>
                      Talla {row.size}: {row.qty}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="conv__muted">Sin líneas de pedido todavía.</p>
              )}
              <p className="conv__total">
                Total unidades: <strong>{detail.totalQty ?? 0}</strong>
                {detail.totalSoles != null ? (
                  <>
                    {" "}
                    · Total referencia: <strong>S/ {detail.totalSoles}</strong>
                  </>
                ) : null}
              </p>
            </section>

            <section className="conv__block">
              <h3 className="conv__block-title">Datos del cliente</h3>
              {detail.customerData && Object.keys(detail.customerData).length ? (
                <dl className="conv__dl">
                  {Object.entries(detail.customerData).map(([k, v]) => (
                    <div key={k} className="conv__dl-row">
                      <dt>{k}</dt>
                      <dd>{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="conv__muted">Sin datos registrados.</p>
              )}
            </section>

            <div className="conv__hero-action">
              {detail.botPaused ? (
                <button
                  type="button"
                  className="btn btn--primary conv__hero-btn"
                  disabled={busyId === detail.id}
                  onClick={() => runPauseToggle(detail, false)}
                >
                  {busyId === detail.id ? "Aplicando…" : "Reanudar bot"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--danger conv__hero-btn"
                  disabled={busyId === detail.id}
                  onClick={() => runPauseToggle(detail, true)}
                >
                  {busyId === detail.id ? "Aplicando…" : "Pausar bot"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <ul className="conv__list">
            {sessions.map((s) => (
              <li key={s.id} className="conv__row">
                <button type="button" className="conv__card-main" onClick={() => setSelected(s)}>
                  <span className="conv__card-id">{s.id}</span>
                  {customerName(s.customerData) ? (
                    <span className="conv__card-name">{customerName(s.customerData)}</span>
                  ) : null}
                  <span className="conv__muted conv__card-when">{formatWhen(s.updatedAt)}</span>
                  <span className="conv__stage">{stageLabel(s.stage)}</span>
                </button>
                <div className="conv__card-actions">
                  {s.botPaused ? (
                    <button
                      type="button"
                      className="btn btn--primary btn--small"
                      disabled={busyId === s.id}
                      onClick={() => runPauseToggle(s, false)}
                    >
                      {busyId === s.id ? "…" : "Reanudar bot"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--secondary btn--small"
                      disabled={busyId === s.id}
                      onClick={() => runPauseToggle(s, true)}
                    >
                      {busyId === s.id ? "…" : "Pausar bot"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {!detail && sessions.length ? (
          <p className="conv__hint conv__muted">Toca una fila para ver el resumen del pedido.</p>
        ) : null}
      </div>
    </div>
  );
}
