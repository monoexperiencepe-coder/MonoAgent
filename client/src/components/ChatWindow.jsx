import { useRef, useEffect } from "react";
import { MessageBubble } from "./MessageBubble.jsx";

export function ChatWindow({
  hideHeader = false,
  messages,
  input,
  onInputChange,
  onSend,
  isTyping,
  disabled,
}) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  function handleSubmit(e) {
    e.preventDefault();
    onSend();
  }

  return (
    <section className={`chat${hideHeader ? " chat--full" : ""}`}>
      {!hideHeader ? (
        <header className="chat__header">
          <h1 className="chat__title">Chat</h1>
        </header>
      ) : null}
      <div className="chat__messages">
        {messages.map((m, i) => (
          <MessageBubble key={i} role={m.role} text={m.text} />
        ))}
        {isTyping ? (
          <div className="msg msg--assistant">
            <div className="msg__bubble msg__bubble--typing">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-label">escribiendo…</span>
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>
      <form className="chat__form" onSubmit={handleSubmit}>
        <input
          className="chat__input"
          type="text"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Escribe un mensaje…"
          disabled={disabled}
          autoComplete="off"
        />
        <button
          type="submit"
          className="btn btn--send"
          disabled={disabled || !input.trim()}
        >
          Enviar
        </button>
      </form>
    </section>
  );
}
