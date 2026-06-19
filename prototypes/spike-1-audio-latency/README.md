# Spike 1 — Python audio latency baseline

> Throwaway feasibility spike for [BC-001](../../docs/product/business-cases/BC-001-musicware-learning-daw.md).
> Brief: [POC-001](../../docs/product/design/POC-001-spike-1-audio-latency.md). **Not production code.**

## The question
Can a **Python** back-end sustain glitch-free, low-latency audio on macOS? This is the
single biggest unknown that decides whether the whole musicware stack is viable.

## Setup (one time)
```sh
cd prototypes/spike-1-audio-latency
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```
On first run macOS will ask for **microphone permission** (for the input-using modes).
Grant it — if you skip it, `report`/`roundtrip` will read silence.

## Run it
```sh
python latency_probe.py devices        # see your audio devices + indices

# 1) Glitch test — the core pass/fail. 60 s of audio, count dropouts.
python latency_probe.py glitch                       # blocksize 512 (~11 ms)
python latency_probe.py glitch --blocksize 256       # ~5.8 ms — find where it breaks

# 2) Latency number
python latency_probe.py report                       # quick estimate, no cable
python latency_probe.py roundtrip                    # real measurement, needs loopback
```

## What "pass" means (from BC-001)
| Mode | Pass criterion |
|---|---|
| `glitch` | **0 underflows** over 60 s at blocksize **512** on your Mac. Then see how low you can push the blocksize before underflows appear. |
| `roundtrip` | Record the measured round-trip latency. MVP target is **< 20 ms**. |

## Measuring real round-trip latency (loopback)
`roundtrip` emits an impulse on the output and waits to hear it on the input, so you need
to route output → input. Two options:
- **Virtual (easiest):** install [BlackHole](https://existential.audio/blackhole/), set it as
  both the input and output device (or use a Multi-Output/Aggregate device), then
  `python latency_probe.py roundtrip --device <blackhole-index>`.
- **Physical:** a cable from headphone-out to mic/line-in. Keep the level low.

Run it a few times and take the **median** — the first run is often noisy.

## What to record (feeds the go/no-go)
Save your results to `results.md` here:
- Mac model + chip (e.g. M2 Air), macOS version.
- Smallest blocksize with **0 underflows** over 60 s.
- Reported and (if you set up loopback) measured round-trip latency.
- Anything surprising (thermal throttling, underflows only under load, etc.).

## How to read the outcome
- **Glitch-free at 512, latency in the low tens of ms** → stack is plausible; proceed to Spike 2 (IPC).
- **Underflows at 512, or latency far above 20 ms** → Python-in-the-audio-path is the bottleneck.
  Don't abandon yet: the realistic fallback is to keep Python for orchestration/UI-glue and move the
  real-time callback to a C/Rust/C++ engine (or a library that releases the GIL). Note that for ADR-001.
