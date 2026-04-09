import { InstructionsPanel } from "../components/InstructionsPanel.jsx";
import { useAppState } from "../context/AppStateContext.jsx";

export default function InstructionsPage() {
  const {
    instructionsDraft,
    setInstructionsDraft,
    handleSaveInstructions,
    saveFeedback,
  } = useAppState();

  return (
    <div className="page page--settings">
      <div className="page__content">
        <InstructionsPanel
          draft={instructionsDraft}
          onDraftChange={setInstructionsDraft}
          onSave={handleSaveInstructions}
          saveFeedback={saveFeedback}
        />
      </div>
    </div>
  );
}
