import { Route, Routes } from "react-router-dom";
import { AppNav } from "./components/AppNav.jsx";
import { AppStateProvider } from "./context/AppStateContext.jsx";
import InboxPage from "./pages/InboxPage.jsx";
import ChatPage from "./pages/ChatPage.jsx";
import FAQsPage from "./pages/FAQsPage.jsx";
import InstructionsPage from "./pages/InstructionsPage.jsx";
import "./App.css";

export default function App() {
  return (
    <AppStateProvider>
      <div style={{ display:"flex", height:"100vh", overflow:"hidden", background:"#0d0d1a" }}>
        <AppNav />
        <div style={{ flex:1, minWidth:0, overflow:"hidden" }}>
          <Routes>
            <Route path="/" element={<InboxPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/instrucciones" element={<InstructionsPage />} />
            <Route path="/faqs" element={<FAQsPage />} />
          </Routes>
        </div>
      </div>
    </AppStateProvider>
  );
}
