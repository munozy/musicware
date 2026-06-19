"""
Spike 1 — Python audio latency baseline (musicware feasibility spike).

PURPOSE
    Answer the dominant feasibility risk from BC-001 before committing to a build:
    can a Python back-end sustain glitch-free, low-latency audio on macOS?

    This is a THROWAWAY measurement harness, not production code. Read it, run it,
    interpret the numbers, then throw it away (or graduate deliberately via a PRD+ADR).

THE SIGNAL PATH (what you are measuring)
    glitch mode:     Python callback -> CoreAudio output buffer -> speakers
                     We generate a continuous sine in the callback and count how often
                     the OS reports an "output underflow" (the callback didn't return a
                     buffer in time -> an audible click). Underruns are the symptom of
                     Python's GIL/GC stalling the real-time audio thread.

    roundtrip mode:  Python callback emits a 1-sample impulse on OUTPUT, then watches
                     INPUT for it to come back. round-trip latency =
                     (input sample index where it was detected - output sample index
                      where it was emitted) / sample_rate.
                     This REQUIRES a loopback path: route output -> input either with a
                     physical cable (headphone-out -> mic-in) or a virtual loopback
                     device (e.g. BlackHole). Without loopback, use `report` mode, which
                     just prints the latency CoreAudio reports for the stream (no cable).

PASS CRITERIA (from BC-001)
    - glitch:    stable playback at blocksize 512 (~11 ms at 44.1 kHz) for 60 s with
                 ZERO underruns. Also try 256 (~5.8 ms) to find where it breaks.
    - roundtrip: record the measured round-trip latency; the MVP target is < 20 ms.

USAGE
    python latency_probe.py devices                 # list audio devices + indices
    python latency_probe.py glitch                  # 60 s at blocksize 512 (default)
    python latency_probe.py glitch --blocksize 256 --duration 60
    python latency_probe.py report                  # CoreAudio-reported latency, no cable
    python latency_probe.py roundtrip               # needs a loopback path (see above)
    python latency_probe.py roundtrip --device 2    # pick a specific duplex device

Dependencies: see requirements.txt (sounddevice, numpy).
"""

import argparse
import sys
import threading

import numpy as np
import sounddevice as sd

SAMPLE_RATE = 44100
DEFAULT_BLOCKSIZE = 512


def list_devices() -> None:
    """Print the device table so you can pick an index for --device."""
    print(sd.query_devices())
    print("\nDefault (input, output) device indices:", sd.default.device)


def glitch_test(blocksize: int, duration: float, samplerate: int, device) -> None:
    """Play a continuous sine for `duration` seconds; count output underflows.

    An underflow means the Python callback failed to return its buffer before the
    audio hardware needed it -> an audible click. Zero underflows over 60 s at a
    given blocksize is the bar for "the GIL is not in our way at this buffer size".
    """
    underruns = {"count": 0}
    frames_done = {"n": 0}
    freq = 440.0

    def callback(outdata, frames, time_info, status):
        if status and status.output_underflow:
            underruns["count"] += 1
            print("  underflow!", file=sys.stderr)
        # Continuous phase across callbacks: index samples by absolute frame number.
        n = frames_done["n"]
        t = (n + np.arange(frames)) / samplerate
        outdata[:, 0] = (0.2 * np.sin(2 * np.pi * freq * t)).astype(np.float32)
        frames_done["n"] += frames

    print(f"glitch test: blocksize={blocksize} (~{1000*blocksize/samplerate:.1f} ms), "
          f"duration={duration:.0f}s, samplerate={samplerate}")
    with sd.OutputStream(samplerate=samplerate, blocksize=blocksize, channels=1,
                         dtype="float32", callback=callback, device=device) as stream:
        print(f"  CoreAudio-reported output latency: {stream.latency*1000:.2f} ms")
        sd.sleep(int(duration * 1000))

    print(f"RESULT: {underruns['count']} underflow(s) over {duration:.0f}s "
          f"at blocksize {blocksize}.")
    print("PASS" if underruns["count"] == 0 else "FAIL", "(criterion: 0 underflows)")


def report_latency(blocksize: int, samplerate: int, device) -> None:
    """Open a duplex stream briefly and print CoreAudio's reported latency. No cable needed."""
    with sd.Stream(samplerate=samplerate, blocksize=blocksize, channels=1,
                   dtype="float32", device=device) as stream:
        in_lat, out_lat = stream.latency
        print(f"reported input latency : {in_lat*1000:.2f} ms")
        print(f"reported output latency: {out_lat*1000:.2f} ms")
        print(f"reported sum (rough RTT floor): {(in_lat+out_lat)*1000:.2f} ms")
    print("NOTE: this is the device's own estimate, not a measured round trip. "
          "Use `roundtrip` with a loopback path for the real number.")


def roundtrip(blocksize: int, samplerate: int, device, threshold: float, timeout: float) -> None:
    """Measure real round-trip latency via a loopback path (impulse out -> detect on in)."""
    state = {
        "frame": 0,
        "emit_at": int(0.5 * samplerate),  # emit the impulse 0.5 s in (let streams settle)
        "emitted_frame": None,
        "detected_frame": None,
    }
    done = threading.Event()

    def callback(indata, outdata, frames, time_info, status):
        if status:
            print(f"  status: {status}", file=sys.stderr)
        outdata.fill(0.0)
        start = state["frame"]
        # Emit a single full-scale impulse exactly once, at emit_at.
        if state["emitted_frame"] is None and start + frames > state["emit_at"]:
            idx = state["emit_at"] - start
            if 0 <= idx < frames:
                outdata[idx, 0] = 0.9
                state["emitted_frame"] = state["emit_at"]
        # After emitting, scan input for the impulse coming back.
        if state["emitted_frame"] is not None and state["detected_frame"] is None:
            above = np.where(np.abs(indata[:, 0]) > threshold)[0]
            if above.size > 0:
                state["detected_frame"] = start + int(above[0])
                done.set()
        state["frame"] += frames

    print("roundtrip test: emitting an impulse and listening for it on input.")
    print("  REQUIRES a loopback path (physical cable out->in, or a virtual device like BlackHole).")
    with sd.Stream(samplerate=samplerate, blocksize=blocksize, channels=1,
                   dtype="float32", callback=callback, device=device):
        got_it = done.wait(timeout=timeout)

    if not got_it or state["detected_frame"] is None:
        print("RESULT: impulse not detected. No loopback path, or threshold too high. "
              "Check routing and try again, or use `report` mode.")
        return
    frames_latency = state["detected_frame"] - state["emitted_frame"]
    ms = 1000.0 * frames_latency / samplerate
    print(f"RESULT: round-trip latency = {frames_latency} samples = {ms:.2f} ms "
          f"(at blocksize {blocksize}, samplerate {samplerate}).")
    print("MVP target is < 20 ms. (Run a few times; take the median — the first run can be noisy.)")


def main() -> int:
    parser = argparse.ArgumentParser(description="musicware Spike 1 — audio latency probe")
    sub = parser.add_subparsers(dest="mode", required=True)

    sub.add_parser("devices", help="list audio devices")

    g = sub.add_parser("glitch", help="underflow/glitch test")
    g.add_argument("--blocksize", type=int, default=DEFAULT_BLOCKSIZE)
    g.add_argument("--duration", type=float, default=60.0)
    g.add_argument("--samplerate", type=int, default=SAMPLE_RATE)
    g.add_argument("--device", default=None, help="output device index (see `devices`)")

    r = sub.add_parser("report", help="CoreAudio-reported latency (no cable)")
    r.add_argument("--blocksize", type=int, default=DEFAULT_BLOCKSIZE)
    r.add_argument("--samplerate", type=int, default=SAMPLE_RATE)
    r.add_argument("--device", default=None, help="duplex device index")

    rt = sub.add_parser("roundtrip", help="measured round-trip latency (needs loopback)")
    rt.add_argument("--blocksize", type=int, default=DEFAULT_BLOCKSIZE)
    rt.add_argument("--samplerate", type=int, default=SAMPLE_RATE)
    rt.add_argument("--device", default=None, help="duplex device index")
    rt.add_argument("--threshold", type=float, default=0.1, help="input detection threshold")
    rt.add_argument("--timeout", type=float, default=5.0, help="seconds to wait for the impulse")

    args = parser.parse_args()
    # sounddevice accepts int or str device ids; coerce a numeric string to int.
    device = getattr(args, "device", None)
    if isinstance(device, str) and device.isdigit():
        device = int(device)

    if args.mode == "devices":
        list_devices()
    elif args.mode == "glitch":
        glitch_test(args.blocksize, args.duration, args.samplerate, device)
    elif args.mode == "report":
        report_latency(args.blocksize, args.samplerate, device)
    elif args.mode == "roundtrip":
        roundtrip(args.blocksize, args.samplerate, device, args.threshold, args.timeout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
