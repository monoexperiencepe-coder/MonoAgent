import { ChatWindow } from "../components/ChatWindow.jsx";
import { useAppState } from "../context/AppStateContext.jsx";

export default function ChatPage() {
  const {
    messages,
    chatInput,
    setChatInput,
    handleSend,
    isTyping,
  } = useAppState();

  return (
    <div className="page page--chat">
      <ChatWindow
        hideHeader
        messages={messages}
        input={chatInput}
        onInputChange={setChatInput}
        onSend={handleSend}
        isTyping={isTyping}
        disabled={isTyping}
      />
    </div>
  );
}
