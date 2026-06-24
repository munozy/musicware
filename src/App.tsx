import "./App.css";
import Keyboard from "./Keyboard";
import PresetSelector from "./PresetSelector";
import Recorder from "./Recorder";
import VolumeControl from "./VolumeControl";

function App() {
  return (
    <main className="container">
      <h1>musicware — keyboard</h1>
      <p className="hint">
        Play with the mouse or your computer keyboard — hold several keys for chords
        (16-voice polyphony). 61 keys, five octaves (C1–C6). Pick a timbre below.
      </p>
      <PresetSelector />
      <VolumeControl />
      <Recorder />
      <Keyboard />
    </main>
  );
}

export default App;
