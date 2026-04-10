import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { sendChat } from "../services/api.js";

const AppStateContext = createContext(null);

const LS_INSTRUCTIONS = "agent_system_prompt";
const LS_CHAT_SESSION = "agent_chat_session_id";

function newFaqItem() {
  return { id: crypto.randomUUID(), question: "", answer: "" };
}

export function AppStateProvider({ children }) {
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  const [instructionsDraft, setInstructionsDraft] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [saveFeedback, setSaveFeedback] = useState("");

  const [faqs, setFaqs] = useState([]);
  const [chatSessionId, setChatSessionId] = useState(() => {
    try {
      return localStorage.getItem(LS_CHAT_SESSION) ?? "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    const saved = localStorage.getItem(LS_INSTRUCTIONS);
    if (saved != null) {
      setInstructionsDraft(saved);
      setSystemPrompt(saved);
    }
  }, []);

  const handleSaveInstructions = useCallback(() => {
    setSystemPrompt(instructionsDraft);
    localStorage.setItem(LS_INSTRUCTIONS, instructionsDraft);
    setSaveFeedback("Guardado (se envía con cada mensaje)");
  }, [instructionsDraft]);

  useEffect(() => {
    if (!saveFeedback) return undefined;
    const t = setTimeout(() => setSaveFeedback(""), 2500);
    return () => clearTimeout(t);
  }, [saveFeedback]);

  const handleAddFaq = useCallback(() => {
    setFaqs((prev) => [...prev, newFaqItem()]);
  }, []);

  const handleChangeFaq = useCallback((index, field, value) => {
    setFaqs((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }, []);

  const handleRemoveFaq = useCallback((index) => {
    setFaqs((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSend = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || isTyping) return;

    setChatInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setIsTyping(true);

    const payloadFaqs = faqs
      .filter((f) => f.question.trim() && f.answer.trim())
      .map(({ question, answer }) => ({
        question: question.trim(),
        answer: answer.trim(),
      }));

    try {
      const { reply, sessionId: nextSessionId } = await sendChat({
        message: text,
        sessionId: chatSessionId.trim() ? chatSessionId : undefined,
        systemPrompt,
        faqs: payloadFaqs,
      });
      if (nextSessionId) {
        setChatSessionId(nextSessionId);
        try {
          localStorage.setItem(LS_CHAT_SESSION, nextSessionId);
        } catch {
          /* ignore */
        }
      }
      setMessages((prev) => [...prev, { role: "assistant", text: reply || "" }]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Error: ${e instanceof Error ? e.message : String(e)}`,
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  }, [chatInput, chatSessionId, faqs, isTyping, systemPrompt]);

  const value = useMemo(
    () => ({
      messages,
      chatInput,
      setChatInput,
      isTyping,
      instructionsDraft,
      setInstructionsDraft,
      handleSaveInstructions,
      saveFeedback,
      faqs,
      handleAddFaq,
      handleChangeFaq,
      handleRemoveFaq,
      handleSend,
    }),
    [
      messages,
      chatInput,
      isTyping,
      instructionsDraft,
      handleSaveInstructions,
      saveFeedback,
      faqs,
      handleAddFaq,
      handleChangeFaq,
      handleRemoveFaq,
      handleSend,
    ]
  );

  return (
    <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) {
    throw new Error("useAppState debe usarse dentro de AppStateProvider");
  }
  return ctx;
}
