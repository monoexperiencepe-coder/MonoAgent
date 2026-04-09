import { Route, Routes } from "react-router-dom";
import { AppNav } from "./components/AppNav.jsx";
import { AppStateProvider } from "./context/AppStateContext.jsx";
import ChatPage from "./pages/ChatPage.jsx";
import FAQsPage from "./pages/FAQsPage.jsx";
import InstructionsPage from "./pages/InstructionsPage.jsx";
import "./App.css";

export default function App() {
  return (
    <AppStateProvider>
      <div className="app-shell">
        <AppNav />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<ChatPage />} />
            <Route path="/instrucciones" element={<InstructionsPage />} />
            <Route path="/faqs" element={<FAQsPage />} />
          </Routes>
        </main>
      </div>
    </AppStateProvider>
  );
}
