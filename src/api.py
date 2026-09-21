from pathlib import Path

import logging
import math

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict
from torch import nn

from src.config import FEATURE_COLUMNS, RESULTS_DIR
from src.inference import load_model, predict


app = FastAPI(title="TRACE-RCA API")

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
logger = logging.getLogger(__name__)


class Telemetry(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    cpu_usage: float
    memory_usage: float
    network_latency: float
    request_rate: float
    error_rate: float
    response_time: float
    db_connections: float
    disk_usage: float
    service_restarts: float
    queue_length: float


@app.get("/")
def home():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.post("/predict")
def make_prediction(telemetry: Telemetry):
    try:
        result = predict(telemetry.model_dump())
        if not all(math.isfinite(value) for value in result["probabilities"].values()):
            raise HTTPException(422, "Values exceed the classifier's numerical range.")
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Model inference failed")
        raise HTTPException(503, "The model is unavailable. Check the server and saved artifacts.") from exc


@app.get("/api/model")
def model_info():
    """Report loaded artifact metadata; never infer readiness from file existence."""
    try:
        model, _, class_names = load_model()
    except Exception as exc:
        logger.exception("Model readiness check failed")
        raise HTTPException(503, "The saved model or preprocessing artifacts could not be loaded.") from exc

    layers = [layer for layer in model.network if isinstance(layer, nn.Linear)]
    metrics = {}
    report_path = RESULTS_DIR / "classification_report.txt"
    try:
        for line in report_path.read_text(encoding="utf-8").splitlines():
            name, separator, value = line.partition(":")
            if separator and name in {"Test Accuracy", "Macro Precision", "Macro Recall", "Macro F1-score"}:
                parsed = float(value.strip())
                if math.isfinite(parsed) and 0 <= parsed <= 1:
                    metrics[name] = parsed
    except (OSError, ValueError):
        metrics = {}

    return {
        "status": "ready",
        "name": "Baseline MLP",
        "framework": "PyTorch",
        "features": FEATURE_COLUMNS,
        "classes": class_names,
        "layers": [layers[0].in_features] + [layer.out_features for layer in layers],
        "parameters": sum(parameter.numel() for parameter in model.parameters()),
        "evaluation": metrics,
        "evaluation_scope": "Recorded synthetic test set; not production accuracy.",
    }


@app.get("/api/evaluation-report", response_class=FileResponse)
def evaluation_report():
    path = RESULTS_DIR / "classification_report.txt"
    if not path.is_file():
        raise HTTPException(404, "No evaluation report is available.")
    return FileResponse(path, media_type="text/plain")
