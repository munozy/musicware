import { useCallback, useEffect, useRef, useState } from "react";
import { newId, nextName, type Recording, type VoiceEffect } from "./recordings";
import { newBlobKey, putBlob } from "./voiceStore";
import { loadVoiceBuffer, playVoice, type VoiceHandle } from "./voiceAudio";

/**
 * Voice capture (ADR-0009) — getUserMedia + MediaRecorder → Blob → IndexedDB, then a
 * `kind:"voice"` Recording is appended to the SHARED library (via onSave) so the take shows
 * up in the Compositions list and the Song shelf. Effects are applied at preview time
 * (voiceAudio); the dry blob is what we store. Separate from useRecorder (keyboard) — both
 * feed the one recordings list.
 */
export function useVoiceRecorder({
  recordings,
  onSave,
}: {
  recordings: Recording[];
  onSave: (rec: Recording) => void;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const t0Ref = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewRef = useRef<VoiceHandle | null>(null);

  // Always-current refs so the MediaRecorder.onstop closure (bound once per take) names and
  // saves against the latest library without re-binding.
  const recordingsRef = useRef(recordings);
  recordingsRef.current = recordings;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    if (isRecording) return;
    setError(null);
    // Diagnose exactly what the webview is missing — the fix differs per cause.
    const diag = {
      secureContext: typeof window !== "undefined" ? window.isSecureContext : false,
      mediaDevices: !!navigator.mediaDevices,
      getUserMedia: !!navigator.mediaDevices?.getUserMedia,
      mediaRecorder: typeof MediaRecorder !== "undefined",
    };
    if (!diag.mediaDevices || !diag.getUserMedia || !diag.mediaRecorder) {
      const missing = [
        !diag.secureContext && "not a secure context",
        !diag.mediaDevices && "no navigator.mediaDevices",
        diag.mediaDevices && !diag.getUserMedia && "no getUserMedia",
        !diag.mediaRecorder && "no MediaRecorder",
      ]
        .filter(Boolean)
        .join(", ");
      console.error("voice: microphone API unavailable —", diag);
      setError(`Microphone API unavailable in this webview (${missing}).`);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const durationMs = Math.max(0, performance.now() - t0Ref.current);
        stopTracks();
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (blob.size === 0) return; // nothing captured — drop it
        const blobKey = newBlobKey();
        void putBlob(blobKey, blob).then(() => {
          onSaveRef.current({
            id: newId(),
            name: nextName(recordingsRef.current, "Voice"),
            createdAt: Date.now(),
            durationMs,
            kind: "voice",
            events: [],
            audio: { blobKey, mimeType: blob.type, effect: "none" },
          });
        });
      };
      recorderRef.current = mr;
      t0Ref.current = performance.now();
      mr.start();
      setIsRecording(true);
      setElapsedMs(0);
      tickRef.current = setInterval(() => setElapsedMs(performance.now() - t0Ref.current), 200);
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        setError("Microphone access was blocked. Allow it in System Settings → Privacy → Microphone, then retry.");
      } else if (name === "NotFoundError") {
        setError("No microphone found.");
      } else {
        setError("Couldn't start the microphone.");
      }
      stopTracks();
    }
  }, [isRecording, stopTracks]);

  const stopRecording = useCallback(() => {
    if (!isRecording) return;
    setIsRecording(false);
    setElapsedMs(0);
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    const mr = recorderRef.current;
    if (mr && mr.state !== "inactive") mr.stop(); // → onstop finalises + saves
    recorderRef.current = null;
  }, [isRecording]);

  const stopPreview = useCallback(() => {
    previewRef.current?.stop();
    previewRef.current = null;
    setPreviewingId(null);
  }, []);

  /** Preview a voice take (toggles off if it's the one playing). Hears `effect` (defaults to the take's). */
  const preview = useCallback(
    async (rec: Recording, effect?: VoiceEffect) => {
      if (!rec.audio) return;
      if (previewRef.current && previewingId === rec.id && effect === undefined) {
        stopPreview();
        return;
      }
      stopPreview();
      const buf = await loadVoiceBuffer(rec.audio.blobKey);
      if (!buf) {
        setError("Couldn't load that take's audio.");
        return;
      }
      const handle = playVoice(buf, effect ?? rec.audio.effect, () => {
        previewRef.current = null;
        setPreviewingId(null);
      });
      previewRef.current = handle;
      setPreviewingId(rec.id);
    },
    [previewingId, stopPreview],
  );

  // Release the mic + any preview on unmount (mode switch / HMR) — no stranded stream or voice.
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      const mr = recorderRef.current;
      if (mr && mr.state !== "inactive") mr.stop();
      stopTracks();
      previewRef.current?.stop();
    };
  }, [stopTracks]);

  return { isRecording, elapsedMs, error, previewingId, startRecording, stopRecording, preview, stopPreview };
}
