import "./App.css";
import Keyboard from "./Keyboard";
import PresetSelector from "./PresetSelector";

function App() {
  return (
    <main className="container">
      <h1>musicware — keyboard</h1>
      <p className="hint">
        Play with the mouse or your computer keyboard — hold several keys for chords
        (16-voice polyphony). 25 keys, two octaves (C3–C5). Pick a timbre below.
      </p>
      <PresetSelector />
      <Keyboard />
    </main>
  );
}

export default App;
