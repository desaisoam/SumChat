
## Engagement Metric Recap

- Raw engagement: `E = β / (α + θ)`
  - θ (theta): 4–7 Hz
  - α (alpha): 7–11 Hz
  - β (beta): 11–20 Hz
- Normalization per participant: `Enorm = (E − Emin) / (Emax − Emin)`
- The UI tracks a 15-second sliding average of `Enorm` (1 Hz updates) and freezes that value while the learner is typing their next prompt.

## Repository Layout

- `streaming.py` – OpenBCI cue-display and logging loop 
- `engagement_streaming.py` – BrainFlow engagement prototype with console output (unchanged)
- `bridge/eeg_ws_bridge.py` – WebSocket bridge that reuses BrainFlow to compute engagement and broadcast it to any number of UI clients

## Quick Start

### 1. EEG → WebSocket Bridge (Python)

Requirements:
- Python 3.9+
- `pip install brainflow websockets numpy`
- Plug in the OpenBCI Cyton/Daisy and note the serial port

Run:

```bash
python bridge/eeg_ws_bridge.py \
  --serial /dev/cu.usbserial-DP05I34K \
  --ws ws://0.0.0.0:8765 \
  --apply-default-cyton-config
```

Flags:
- `--cmd CMD` (repeatable) sends custom `config_board` commands after the session is prepared (default list matches `streaming.py`)
- `--apply-default-cyton-config` sends the 16 commands from `streaming.py`

The bridge broadcasts JSON engagement packets at ~1 Hz:

```json
{
  "type": "engagement",
  "ts": 1710000000000,
  "fs": 250,
  "E": 0.42,
  "Enorm": 0.68,
  "alpha": 1.2e-6,
  "theta": 9.3e-7,
  "beta": 3.1e-6,
  "Emin": 0.11,
  "Emax": 0.62,
  "mode": "normal"
}
```

Clients can send control messages:
- `{ "type": "subscribe" }`
- `{ "type": "set_mode", "mode": "normal" | "relax" | "mental" }`
- `{ "type": "reset_norm" }`

### 2. Web App (Next.js + Assistant UI)

Requirements:
- Node 18+

Setup:

```bash
cd web
npm install
cp .env.local.example .env.local
```

Edit `.env.local`:

```
OPENAI_API_KEY=sk-...
NEXT_PUBLIC_EEG_WS_URL=ws://localhost:8765
```

Development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 3. Workflow

1. Start the Python bridge.
2. Open the web UI, click **Connect** in the Brain Widget.
3. Run a 2-minute **Relax** phase and a 2-minute **Mental** phase (mode dropdown) to expose min/max engagement to the system (Emin/Emax update automatically).
4. Toggle **Mood Mode** to let the chat inject hidden engagement values into the LLM prompt. Toggle **Debug Mode** to expose EEG metrics in the sidebar.
5. Start chatting: the UI freezes the latest 15-second average engagement when you begin typing, injects it into `/api/chat`, and unfreezes after the assistant responds.

## Implementation Notes

### EEG bridge highlights

- Uses BrainFlow for Cyton/Daisy
- Pull cadence: 200 ms
- Window length: 1 s (Hann window → rFFT → integrate PSD in θ/α/β bands)
- Maintains `Emin`/`Emax` dynamically; normalization persists only in memory (reset via message)
- Broadcasts to any number of clients using the `websockets` library

### Web UI components

- **BrainWidget** – connection, calibration mode toggle, mood/debug toggles, freeze/unfreeze controls, and summaries of latest `Enorm`, `Emin`, `Emax`
- **EEGDebugPanel** – raw metrics (timestamp, fs, bandpowers)
- **Thread** – Assistant UI chat with a custom `send` wrapper that attaches the frozen 15s average when Mood Mode is enabled
- **useEEG hook** – subscribes to the websocket, exposes `latest`, `connect`, `disconnect`, `setMode`, `resetNorm`
- **useEngagementWindow hook** – 15-element queue for 15-second averaging; supports freeze/unfreeze

### LLM proxy (`/api/chat`)

- Uses OpenAI’s SDK (default model `gpt-4o-mini`)
- Appends a hidden line: `Normalized engagement score (0-1): <value>` when Mood Mode is on
- Returns a single message

## Next steps (optional)

- Persist calibration bounds and chat logs to IndexedDB
- Stream assistant responses using Assistant UI’s data-stream runtime
- Add visualization (graphs) for engagement history
- Implement structured data exports (EEG + chat transcript)
- Build study scripts (topic seeds, quizzes, analysis notebooks)

## Voice Mode (OpenAI Realtime)

Minimal voice interface backed by OpenAI’s Realtime API.

What’s included:
- API route to mint ephemeral Realtime tokens: `web/app/api/realtime/session/route.ts`
- Client WebRTC hook to connect, send events, and play assistant audio: `web/lib/voice/useRealtimeVoice.ts`
- Simple UI to control the session: `web/components/VoiceControls.tsx`
- Page wiring under the left sidebar below the Brain Widget: `web/app/page.tsx`

Environment variables (optional):
- `OPENAI_REALTIME_MODEL` (default: `gpt-4o-realtime-preview`)
- `OPENAI_REALTIME_VOICE` (default: `verse`)

How it works:
- The client requests an ephemeral key from `/api/realtime/session` (server uses your `OPENAI_API_KEY`).
- A WebRTC `RTCPeerConnection` is created; the mic track is added, and a data channel carries events.
- When you click “Ask (voice)”, the client freezes the current 15s engagement average and sends a `response.create` event whose `instructions` are `systemPrompt + "Normalized engagement score (0-1): <value>"`.
- The Realtime model returns both audio (played automatically) and text (displayed under the Voice panel and mirrored into the main chat thread). Your microphone input is transcribed locally via the Web Speech API and shown alongside the assistant reply.

Notes:
- Browsers may require a user gesture before autoplay; click Connect first.
- Voice and text chat are currently separate surfaces; merging transcripts into the main Thread can be added later.
- Engagement freeze/unfreeze mirrors the text flow: freeze on speak, unfreeze after response.
