import "./App.css";
import { useEffect, useRef, useState } from "react";
import Keyboard from "./Keyboard";
import PresetSelector from "./PresetSelector";
import VolumeControl from "./VolumeControl";
import Visualizer from "./Visualizer";
import VizStyleSelector from "./VizStyleSelector";
import ChordDisplay from "./ChordDisplay";
import Transport from "./Transport";
import Library from "./Library";
import ModeToggle, { type AppMode } from "./ModeToggle";
import SongView from "./SongView";
import { useRecorder } from "./useRecorder";
import { useVisualizerStyle } from "./useVisualizerStyle";

function App() {
  const rec = useRecorder();
  const [vizStyle, setVizStyle] = useVisualizerStyle();
  const recordBtnRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<AppMode>("play");

  // R toggles record/stop (ignored while typing in a field). Keep the latest
  // toggle in a ref so the listener binds once.
  const toggle = rec.isRecording ? rec.stopRecording : rec.startRecording;
  const toggleRef = useRef(toggle);
  useEffect(() => {
    toggleRef.current = toggle;
  }, [toggle]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "r") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      toggleRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" aria-hidden="true" />
          musicware
        </div>
        <ModeToggle
          mode={mode}
          onChange={setMode}
          isRecording={rec.isRecording}
        />
        <Transport
          recordBtnRef={recordBtnRef}
          isRecording={rec.isRecording}
          elapsedMs={rec.elapsedMs}
          savedCount={rec.recordings.length}
          onStart={rec.startRecording}
          onStop={rec.stopRecording}
        />
        <VolumeControl />
      </header>

      {mode === "play" ? (
        <>
          <div className="body">
            <Library
              recordings={rec.recordings}
              playingId={rec.playingId}
              playProgress={rec.playProgress}
              pendingDelete={rec.pendingDelete}
              onPlay={rec.play}
              onStopPlay={rec.stopPlayback}
              onRename={rec.rename}
              onDelete={rec.remove}
              onUndo={rec.undoDelete}
              recordBtnRef={recordBtnRef}
            />

            <main className="stage">
              <div className="viz-panel">
                <Visualizer style={vizStyle} />
                <VizStyleSelector value={vizStyle} onChange={setVizStyle} />
              </div>
              <ChordDisplay />
              <div className="stage-controls">
                <PresetSelector />
              </div>
            </main>
          </div>

          <footer className="dock">
            <Keyboard />
          </footer>
        </>
      ) : (
        <main className="song-main">
          <SongView
            recordings={rec.recordings}
            onGoToPlay={() => setMode("play")}
          />
        </main>
      )}
    </div>
  );
}

export default App;
