import "./App.css";
import Keyboard from "./Keyboard";

function App() {
  return (
    <main className="container">
      <h1>musicware — keyboard</h1>
      <p className="hint">
        Click a key to play a note. STORY-K1: monophonic, one octave (C4–B4).
      </p>
      <Keyboard />
    </main>
  );
}

export default App;
