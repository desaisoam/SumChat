import time, pygame, numpy as np
from time import monotonic_ns
import os
from datetime import datetime
from brainflow.board_shim import BoardShim, BrainFlowInputParams, BoardIds
import struct

# ==== config ====
FS = 125
NS_PER_SAMPLE = 8_000_000  # 1e9 / 125 exactly
EEG_PERIOD = 0.200         # seconds (pull cadence)
UI_PERIOD  = 0.020         # seconds (50 Hz UI tick)
MAX_RUN_MIN = 10

REST_S   = 2
ACTIVE_S = 20
CLASSES  = ["LEFT HAND", "RIGHT HAND", "TONGUE", "FEET"]
CLASS_TO_ID = {"LEFT HAND":0, "RIGHT HAND":1, "TONGUE":2, "FEET":3}
REST_ID  = 4

def brainflow_init(serial_port, user_cmds):
    print("#" * 50)
    print("INITIALIZING EEG via BrainFlow...")
    brainflow_params = BrainFlowInputParams()
    brainflow_params.serial_port = serial_port
    board_id = BoardIds.CYTON_DAISY_BOARD.value
    board = BoardShim(board_id, brainflow_params)
    board.prepare_session()
    if isinstance(user_cmds, str):
        user_cmds = [user_cmds]
    for cmd in user_cmds:
        print(f"Applying board command: {cmd}")
        board.config_board(cmd)
        time.sleep(0.05)
    board.start_stream()
    return board, board_id

_EEG_CH = None

def brainflow_get_new(board, board_id):
    """Pull and return the newest block from BrainFlow ring buffer."""
    global _EEG_CH
    if _EEG_CH is None:
        _EEG_CH = BoardShim.get_eeg_channels(board_id)
    data = board.get_board_data()
    if data.size == 0:
        print("UR DATA IS FUCKED ")
    eeg   = data[_EEG_CH, :].T.astype(np.float32)
    return eeg

def pygame_init():
    pygame.init()
    screen_size = (800, 600)
    screen = pygame.display.set_mode(screen_size, 0)
    font_big = pygame.font.SysFont(None, 96)
    font_small = pygame.font.SysFont(None, 32)
    start_mono = time.monotonic()
    return screen, font_big, font_small, start_mono

def pygame_tick(screen, font_big, font_small, ui, now_s):
    """Advance UI, draw, and report whether state changed."""
    # Event pump so window can close
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            return False, None, False
        if event.type == pygame.KEYDOWN and event.key in (pygame.K_ESCAPE, pygame.K_q):
            return False, None, False

    changed = False
    # REST<->ACTIVE scheduler
    if now_s >= ui["next_switch"]:
        if ui["phase"] == "REST":
            cue = np.random.choice(CLASSES)
            ui["cue"] = cue
            ui["cue_id"] = CLASS_TO_ID[cue]
            ui["phase"] = "ACTIVE"
            ui["trial"] += 1
            ui["next_switch"] = now_s + ACTIVE_S
        else:
            ui["cue"] = "STILL"
            ui["cue_id"] = REST_ID
            ui["phase"] = "REST"
            ui["next_switch"] = now_s + REST_S
        changed = True

    # draw HUD
    screen.fill((30,30,30))
    # run countdown (requested behavior)
    run_remaining = max(0.0, ui["end"] - now_s)
    timer_txt = f"{int(run_remaining//60):02d}:{int(run_remaining%60):02d}"
    screen.blit(font_small.render(timer_txt, True, (200,200,200)), (10,10))

    center = screen.get_rect().center
    msg = ui["cue"] if ui["phase"] == "ACTIVE" else "STILL"
    surf = font_big.render(msg, True, (255,255,255))
    screen.blit(surf, surf.get_rect(center=center))

    dur  = ACTIVE_S if ui["phase"] == "ACTIVE" else REST_S
    prog = max(0.0, min(1.0, (now_s - (ui["next_switch"] - dur)) / dur))
    pygame.draw.rect(screen, (200,200,200),
                     (40, screen.get_height()-30, int((screen.get_width()-80)*(1.0 - prog)), 8))
    pygame.display.flip()

    return changed, int(ui["cue_id"]), True

def run_openloop(serial_port="/dev/ttyUSB0", user_cmds=None):
    board, bid = brainflow_init(serial_port, user_cmds)
    screen, font_big, font_small, _ = pygame_init()

    ui = {
        "phase": "REST",
        "cue": "STILL",
        "cue_id": REST_ID,
        "next_switch": time.monotonic() + REST_S,
        "trial": 0,
        "run_start_ns": monotonic_ns()
    }

    # files
    timestamp = datetime.now().strftime("%m-%d_%H-%M-%S")
    base_dir = os.path.join(os.path.dirname(__file__), "Data")
    session_dir = os.path.join(base_dir, timestamp)
    os.makedirs(session_dir, exist_ok=True)
    print(f"Saving data to: {session_dir}")
    feeg = open(os.path.join(session_dir, "eeg.bin"), "ab", buffering=1024*1024)
    fts  = open(os.path.join(session_dir, "eeg_ts.bin"), "ab", buffering=1024*1024)
    # task record: int64 mono_ns, int64 sample_idx, int32 class_id
    ft   = open(os.path.join(session_dir, "task.bin"),  "ab", buffering=1024)
    TASK_REC = struct.Struct("<qqi")

    next_eeg = time.monotonic()
    next_ui  = time.monotonic()
    end_at_s = time.monotonic() + 60 * MAX_RUN_MIN
    ui["end"] = end_at_s

    # single time source origin and global sample index
    t0_ns = None
    global_idx = 0

    while True:
        now = time.monotonic()
        if now >= end_at_s:
            break

        # EEG pull (~200 ms)
        if now >= next_eeg:
            X = brainflow_get_new(board, bid)
            n = int(X.shape[0])
            if n > 0:
                if t0_ns is None:
                    t0_ns = monotonic_ns()  # set origin when we commit the first sample
                feeg.write(X.tobytes())
                # synthesize per-sample monotonic timestamps
                idxs  = global_idx + np.arange(n, dtype=np.int64)
                ts_ns = (t0_ns + idxs * NS_PER_SAMPLE).astype(np.int64)
                fts.write(ts_ns.tobytes())
                global_idx += n
            next_eeg += EEG_PERIOD
            if now - next_eeg > EEG_PERIOD:
                next_eeg = now

        # UI tick (50 Hz) + log state changes with sample index
        if now >= next_ui:
            changed, cid, alive = pygame_tick(screen, font_big, font_small, ui, now)
            if not alive:
                break
            if changed:
                # mark boundary at "next sample to be acquired"
                try:
                    buf_count = board.get_board_data_count()
                except Exception:
                    buf_count = 0
                sample_idx = global_idx + int(buf_count)
                ft.write(TASK_REC.pack(monotonic_ns(), int(sample_idx), int(cid)))
            next_ui += UI_PERIOD
            if now - next_ui > UI_PERIOD:
                next_ui = now

        time.sleep(0.002)

    feeg.close(); fts.close(); ft.close()
    board.stop_stream(); board.release_session()
    pygame.quit()

if __name__ == "__main__":
    cmds = [
        "x1040010X","x2040010X","x3040010X","x4040010X",
        "x5040010X","x6040010X","x7040010X","x8040010X",
        "xQ040010X","xW040010X","xE040010X","xR040010X",
        "xT040010X","xY040010X","xU040010X","xI040010X"
    ]
    run_openloop(serial_port="/dev/cu.usbserial-DP05I34K", user_cmds=cmds)
