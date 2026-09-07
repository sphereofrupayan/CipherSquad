import os
import threading
from faster_whisper import WhisperModel

class WhisperService:
    def __init__(self, model_name="small", model_dir="models/whisper-small"):
        self.model_name = model_name
        self.model_dir = model_dir
        self.model = None
        self.is_downloading = False
        self.is_ready = False
        self.device = "cpu"
        self.compute_type = "int8"
        self.error = None
        self.lock = threading.Lock()

    def initialize(self):
        with self.lock:
            if self.is_ready or self.is_downloading:
                return
            self.is_downloading = True

        thread = threading.Thread(target=self._load_model_background, daemon=True)
        thread.start()

    def _load_model_background(self):
        try:
            # Check for CUDA availability
            try:
                import ctranslate2
                if ctranslate2.get_cuda_device_count() > 0:
                    self.device = "cuda"
                    self.compute_type = "float16"
            except Exception:
                pass

            print(f"[Whisper] model: {self.model_name}")
            print(f"[Whisper] device: {self.device}")
            print(f"[Whisper] loading...")

            os.makedirs(self.model_dir, exist_ok=True)
            self.model = WhisperModel(
                self.model_name,
                device=self.device,
                compute_type=self.compute_type,
                download_root=self.model_dir
            )
            self.is_ready = True
            print("[Whisper] ready")
        except Exception as e:
            print(f"[Whisper] Error loading model: {e}")
            self.error = str(e)
        finally:
            self.is_downloading = False

    def get_status(self):
        return {
            "available": self.is_ready,
            "model": self.model_name,
            "device": self.device,
            "loaded": self.is_ready,
            "downloading": self.is_downloading,
            "error": self.error
        }

    def transcribe(self, audio_path):
        if not self.is_ready:
            raise Exception("whisper_model_loading")

        # We use Vad filtering
        segments, info = self.model.transcribe(
            audio_path,
            vad_filter=True,
            beam_size=5,
            condition_on_previous_text=False
        )

        text = " ".join([segment.text for segment in segments])
        return {
            "text": text.strip(),
            "language": info.language,
            "duration": info.duration
        }

whisper_service = WhisperService()
