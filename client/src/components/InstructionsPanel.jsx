export function InstructionsPanel({
  draft,
  onDraftChange,
  onSave,
  saveFeedback,
}) {
  return (
    <section className="panel">
      <h2 className="panel__title">Instrucciones del agente</h2>
      <p className="panel__hint">
        System prompt enviado al backend en cada mensaje del chat.
      </p>
      <textarea
        className="panel__textarea"
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        placeholder='Ej: "Eres un agente de ventas de seguros. Tu objetivo es..."'
        rows={10}
      />
      <button type="button" className="btn btn--primary" onClick={onSave}>
        Guardar instrucciones
      </button>
      {saveFeedback ? (
        <p className="panel__feedback">{saveFeedback}</p>
      ) : null}
    </section>
  );
}
