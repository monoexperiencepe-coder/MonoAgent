export function FAQPanel({ faqs, onAdd, onChange, onRemove }) {
  return (
    <section className="panel">
      <h2 className="panel__title">Preguntas frecuentes</h2>
      <p className="panel__hint">
        Referencia enviada al agente con cada mensaje (no persiste en servidor).
      </p>
      <button type="button" className="btn btn--secondary" onClick={onAdd}>
        + Agregar par
      </button>
      <ul className="faq-list">
        {faqs.map((item, index) => (
          <li key={item.id} className="faq-item">
            <input
              className="faq-item__input"
              type="text"
              placeholder="Pregunta"
              value={item.question}
              onChange={(e) => onChange(index, "question", e.target.value)}
            />
            <input
              className="faq-item__input"
              type="text"
              placeholder="Respuesta"
              value={item.answer}
              onChange={(e) => onChange(index, "answer", e.target.value)}
            />
            <button
              type="button"
              className="btn btn--danger btn--small"
              onClick={() => onRemove(index)}
            >
              Eliminar
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
