export function MessageBubble({ role, text }) {
  return (
    <div className={`msg msg--${role}`}>
      <div className="msg__bubble">{text}</div>
    </div>
  );
}
