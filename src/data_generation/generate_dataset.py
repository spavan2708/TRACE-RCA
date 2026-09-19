from pathlib import Path
import numpy as np
import pandas as pd

from src.config import DATASET_PATH, RAW_DATA_DIR, RANDOM_STATE

ROOT_CAUSES = [
    "CPU Saturation",
    "Memory Leak",
    "Database Connection Exhaustion",
    "Network Latency",
    "Service Crash",
]


def clip(value, low, high):
    return np.clip(value, low, high)


def generate_sample(root_cause, rng):
    # Start with realistic background telemetry.
    sample = {
        "cpu_usage": rng.normal(45, 12),
        "memory_usage": rng.normal(50, 12),
        "network_latency": rng.normal(45, 15),
        "request_rate": rng.normal(250, 70),
        "error_rate": rng.normal(2, 1.2),
        "response_time": rng.normal(180, 55),
        "db_connections": rng.normal(45, 12),
        "disk_usage": rng.normal(55, 12),
        "service_restarts": rng.poisson(0.2),
        "queue_length": rng.normal(25, 10),
        "root_cause": root_cause,
    }

    # Inject a fault signature while retaining noise and overlap.
    if root_cause == "CPU Saturation":
        sample["cpu_usage"] += rng.normal(48, 8)
        sample["response_time"] += rng.normal(180, 45)
        sample["queue_length"] += rng.normal(35, 12)
        sample["error_rate"] += rng.normal(3, 1.5)

    elif root_cause == "Memory Leak":
        sample["memory_usage"] += rng.normal(43, 8)
        sample["response_time"] += rng.normal(75, 25)
        sample["service_restarts"] += rng.poisson(1.0)
        sample["disk_usage"] += rng.normal(8, 5)

    elif root_cause == "Database Connection Exhaustion":
        sample["db_connections"] += rng.normal(125, 18)
        sample["response_time"] += rng.normal(150, 40)
        sample["error_rate"] += rng.normal(8, 3)
        sample["queue_length"] += rng.normal(25, 10)

    elif root_cause == "Network Latency":
        sample["network_latency"] += rng.normal(280, 55)
        sample["response_time"] += rng.normal(220, 55)
        sample["error_rate"] += rng.normal(4, 2)

    elif root_cause == "Service Crash":
        sample["service_restarts"] += rng.poisson(4.0) + 2
        sample["error_rate"] += rng.normal(18, 5)
        sample["response_time"] += rng.normal(120, 50)
        sample["request_rate"] -= rng.normal(80, 25)

    # Keep values in valid operational ranges.
    sample["cpu_usage"] = float(clip(sample["cpu_usage"], 0, 100))
    sample["memory_usage"] = float(clip(sample["memory_usage"], 0, 100))
    sample["network_latency"] = float(clip(sample["network_latency"], 1, 1000))
    sample["request_rate"] = float(clip(sample["request_rate"], 0, 2000))
    sample["error_rate"] = float(clip(sample["error_rate"], 0, 100))
    sample["response_time"] = float(clip(sample["response_time"], 1, 5000))
    sample["db_connections"] = float(clip(sample["db_connections"], 0, 300))
    sample["disk_usage"] = float(clip(sample["disk_usage"], 0, 100))
    sample["service_restarts"] = int(clip(sample["service_restarts"], 0, 50))
    sample["queue_length"] = float(clip(sample["queue_length"], 0, 1000))

    return sample


def main(samples_per_class=1200):
    RAW_DATA_DIR.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(RANDOM_STATE)

    rows = []
    for root_cause in ROOT_CAUSES:
        for _ in range(samples_per_class):
            rows.append(generate_sample(root_cause, rng))

    dataset = pd.DataFrame(rows)
    dataset = dataset.sample(frac=1, random_state=RANDOM_STATE).reset_index(drop=True)
    dataset.to_csv(DATASET_PATH, index=False)

    print(f"Dataset created: {DATASET_PATH}")
    print(f"Shape: {dataset.shape}")
    print("\nClass distribution:")
    print(dataset["root_cause"].value_counts())


if __name__ == "__main__":
    main()
