import joblib
import pandas as pd
import torch

from src.config import FEATURE_COLUMNS, MODEL_PATH, PREPROCESSOR_PATH
from src.models.mlp import TraceRCAMLP


def load_model():
    checkpoint = torch.load(
        MODEL_PATH,
        map_location="cpu"
    )

    model = TraceRCAMLP(
        input_size=checkpoint["input_size"],
        num_classes=checkpoint["num_classes"]
    )

    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    preprocessing = joblib.load(PREPROCESSOR_PATH)

    return model, preprocessing, checkpoint["class_names"]


def predict(telemetry):
    missing = [
        feature
        for feature in FEATURE_COLUMNS
        if feature not in telemetry
    ]

    if missing:
        raise ValueError(f"Missing telemetry features: {missing}")

    model, preprocessing, class_names = load_model()

    # Preserve feature names while preparing the input.
    values = pd.DataFrame(
        [[telemetry[feature] for feature in FEATURE_COLUMNS]],
        columns=FEATURE_COLUMNS
    )

    # Apply the same scaler used during training.
    scaled_values = preprocessing["scaler"].transform(values)

    tensor = torch.tensor(
        scaled_values,
        dtype=torch.float32
    )

    with torch.no_grad():
        outputs = model(tensor)
        probabilities = torch.softmax(outputs, dim=1)[0]
        predicted_index = int(torch.argmax(probabilities).item())

    return {
        "root_cause": class_names[predicted_index],
        "confidence": float(
            probabilities[predicted_index].item()
        ),
        "probabilities": {
            name: float(probability.item())
            for name, probability in zip(
                class_names,
                probabilities
            )
        }
    }


if __name__ == "__main__":
    example = {
    "cpu_usage": 40,
    "memory_usage": 55,
    "network_latency": 50,
    "request_rate": 100,
    "error_rate": 90,
    "response_time": 400,
    "db_connections": 30,
    "disk_usage": 55,
    "service_restarts": 8,
    "queue_length": 20
}

    prediction = predict(example)

    print("\nTRACE-RCA Prediction")
    print("-" * 30)
    print(f"Root Cause: {prediction['root_cause']}")
    print(f"Confidence: {prediction['confidence']:.4f}")

    print("\nClass Probabilities:")
    for root_cause, probability in prediction["probabilities"].items():
        print(f"{root_cause}: {probability:.6f}")