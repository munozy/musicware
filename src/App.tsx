import "./App.css";
import Keyboard from "./Keyboard";

function App() {
  return (
    <main className="container">
      <h1>musicware — keyboard</h1>
      <p className="hint">
        Click a key to play a note. Monophonic for now — 25 keys, two octaves (C3–C5).
      </p>
      <Keyboard />
    </main>
  );
}

export default App;
