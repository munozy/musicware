import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleTone() {
    setError(null);
    try {
      if (playing) {
        await invoke("stop_tone");
        setPlaying(false);
      } else {
        await invoke("start_tone");
        setPlaying(true);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <main className="container">
      <h1>musicware — tone test</h1>
      <button onClick={toggleTone}>
        {playing ? "■ Stop tone" : "▶ Play tone"}
      </button>
      {error && <p style={{ color: "red" }}>{error}</p>}
    </main>
  );
}

export default App;
