import { FAQPanel } from "../components/FAQPanel.jsx";
import { useAppState } from "../context/AppStateContext.jsx";

export default function FAQsPage() {
  const { faqs, handleAddFaq, handleChangeFaq, handleRemoveFaq } = useAppState();

  return (
    <div className="page page--settings">
      <div className="page__content">
        <FAQPanel
          faqs={faqs}
          onAdd={handleAddFaq}
          onChange={handleChangeFaq}
          onRemove={handleRemoveFaq}
        />
      </div>
    </div>
  );
}
