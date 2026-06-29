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
import VoiceView from "./VoiceView";
import { useRecorder } from "./useRecorder";
import { useVoiceRecorder } from "./useVoiceRecorder";
import { useVisualizerStyle } from "./useVisualizerStyle";
import { isVoice } from "./recordings";

function App() {
  const rec = useRecorder();
  const voice = useVoiceRecorder({ recordings: rec.recordings, onSave: rec.addRecording });
  const [vizStyle, setVizStyle] = useVisualizerStyle();
  const recordBtnRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<AppMode>("play");
  // Keep mode in a ref so the once-bound R-key listener can read it without re-binding.
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Space toggles record/stop (ignored while typing in a field). Keep the latest
  // toggle in a ref so the listener binds once.
  const toggle = rec.isRecording ? rec.stopRecording : rec.startRecording;
  const toggleRef = useRef(toggle);
  useEffect(() => {
    toggleRef.current = toggle;
  }, [toggle]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.code !== "Space") return; // layout-independent spacebar
      if (modeRef.current !== "play") return; // the keyboard recorder — only in Play
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      // preventDefault stops page scroll AND a focused button's native Space-activation,
      // so Space means "record" consistently rather than double-firing.
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
          <svg className="brand-logo" viewBox="0 0 32 32" role="img" aria-label="musicware logo">
            <defs>
              <linearGradient id="brandLogoGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#6ad7ff" />
                <stop offset="1" stopColor="#b07cff" />
              </linearGradient>
            </defs>
            <rect x="2" y="2" width="28" height="28" rx="9" fill="url(#brandLogoGrad)" />
            {/* equalizer bars — reads as music; dark on the bright gradient */}
            <g fill="#0c0e13">
              <rect x="8.5" y="13" width="3" height="6" rx="1.5" />
              <rect x="14.5" y="9" width="3" height="14" rx="1.5" />
              <rect x="20.5" y="11.5" width="3" height="9" rx="1.5" />
            </g>
          </svg>
          <span className="brand-text">
            <span className="brand-name">musicware</span>
            <span className="brand-by">
              by <span className="brand-moon">MoonOzY</span>
            </span>
          </span>
        </div>
        <ModeToggle
          mode={mode}
          onChange={setMode}
          isRecording={rec.isRecording}
        />
        {/* Volume stays pinned to the right corner in every mode. The keyboard recorder now
            lives in the Play stage (below), not the top bar. */}
        <div className="topbar-right">
          <VolumeControl />
        </div>
      </header>

      {mode === "play" && (
        <>
          <div className="body">
            <Library
              recordings={rec.recordings.filter((r) => !isVoice(r))}
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
              <Transport
                recordBtnRef={recordBtnRef}
                isRecording={rec.isRecording}
                elapsedMs={rec.elapsedMs}
                savedCount={rec.recordings.length}
                onStart={rec.startRecording}
                onStop={rec.stopRecording}
              />
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
      )}

      {mode === "voice" && (
        <main className="voice-main">
          <VoiceView
            voiceTakes={rec.recordings.filter(isVoice)}
            isRecording={voice.isRecording}
            elapsedMs={voice.elapsedMs}
            error={voice.error}
            previewingId={voice.previewingId}
            onStart={voice.startRecording}
            onStop={voice.stopRecording}
            onPreview={voice.preview}
            onStopPreview={voice.stopPreview}
            onSetEffect={rec.setVoiceEffect}
            onRename={rec.rename}
            onDelete={rec.remove}
          />
        </main>
      )}

      {mode === "song" && (
        <main className="song-main">
          <SongView recordings={rec.recordings} onGoToPlay={() => setMode("play")} />
        </main>
      )}
    </div>
  );
}

export default App;
