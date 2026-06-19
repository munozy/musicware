# Spike 1 — results

> Fill this in after running `latency_probe.py`. This is the evidence the go/no-go rests on.

## Environment
- Mac model / chip:
- macOS version:
- Python version:
- Loopback used for roundtrip (none / BlackHole / cable):

## Glitch test (criterion: 0 underflows over 60 s)
| blocksize | ~ms @44.1k | underflows / 60s | reported out latency (ms) | pass? |
|---|---|---|---|---|
| 512 | 11.6 | | | |
| 256 | 5.8 | | | |
| 128 | 2.9 | | | |

## Latency
- `report` reported (in / out / sum), ms:
- `roundtrip` measured RTT (median of N runs), ms:

## Observations
-

## Verdict (gate)
- [ ] Glitch-free at 512 AND latency low-tens-of-ms → proceed to Spike 2 (IPC)
- [ ] Underflows at 512 OR latency ≫ 20 ms → record C/Rust engine fallback for ADR-001
