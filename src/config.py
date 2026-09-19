from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
RAW_DATA_DIR = DATA_DIR / "raw"
PROCESSED_DATA_DIR = DATA_DIR / "processed"
RESULTS_DIR = PROJECT_ROOT / "results"
SAVED_MODELS_DIR = PROJECT_ROOT / "saved_models"

DATASET_PATH = RAW_DATA_DIR / "telemetry_dataset.csv"
MODEL_PATH = SAVED_MODELS_DIR / "trace_rca_mlp.pt"
PREPROCESSOR_PATH = SAVED_MODELS_DIR / "preprocessing.pkl"

RANDOM_STATE = 42
NUM_CLASSES = 5
FEATURE_COLUMNS = [
    "cpu_usage",
    "memory_usage",
    "network_latency",
    "request_rate",
    "error_rate",
    "response_time",
    "db_connections",
    "disk_usage",
    "service_restarts",
    "queue_length",
]

TARGET_COLUMN = "root_cause"
