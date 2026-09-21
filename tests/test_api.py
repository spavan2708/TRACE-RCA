"""Read-only smoke checks against the running local app and saved artifacts."""
import json
import os
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from src.inference import predict

BASE_URL = os.environ.get("TRACE_RCA_TEST_URL", "http://127.0.0.1:8000").rstrip("/")
SAMPLE = {
    "cpu_usage": 40, "memory_usage": 55, "network_latency": 50,
    "request_rate": 100, "error_rate": 90, "response_time": 400,
    "db_connections": 30, "disk_usage": 55, "service_restarts": 8,
    "queue_length": 20,
}


def request(path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = Request(BASE_URL + path, data=data, headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=30) as response:
            return response.status, response.read(), response.headers
    except HTTPError as error:
        with error:
            return error.code, error.read(), error.headers


class ApplicationSmokeTests(unittest.TestCase):
    def test_routes_and_static_assets(self):
        for path, fragment in [
            ("/", b"Root cause intelligence"), ("/docs", b"swagger"),
            ("/static/styles.css", b"prefers-reduced-motion"),
            ("/static/app.js", b"/predict"),
            ("/static/telemetry.js", b"SIGNAL_RULES"),
            ("/static/assets/icons.js", b"Lucide"),
            ("/static/assets/mark.svg", b"<svg"),
            ("/api/evaluation-report", b"Test Accuracy"),
        ]:
            with self.subTest(path=path):
                status, body, _ = request(path)
                self.assertEqual(status, 200)
                self.assertIn(fragment, body)

    def test_prediction_matches_original_inference(self):
        status, body, _ = request("/predict", SAMPLE)
        self.assertEqual(status, 200)
        actual = json.loads(body)
        self.assertEqual(actual, predict(SAMPLE))
        self.assertEqual(len(actual["probabilities"]), 5)
        self.assertAlmostEqual(sum(actual["probabilities"].values()), 1, places=5)

    def test_invalid_inputs(self):
        for payload in [{}, {**SAMPLE, "cpu_usage": ""}, {**SAMPLE, "cpu_usage": "NaN"}, {**SAMPLE, "cpu_usage": "Infinity"}, {**SAMPLE, "cpu_usage": None}]:
            with self.subTest(payload=payload):
                self.assertEqual(request("/predict", payload)[0], 422)

    def test_loaded_model_metadata(self):
        status, body, _ = request("/api/model")
        self.assertEqual(status, 200)
        metadata = json.loads(body)
        self.assertEqual(metadata["status"], "ready")
        self.assertEqual(len(metadata["features"]), 10)
        self.assertEqual(len(metadata["classes"]), 5)
        self.assertEqual(metadata["layers"], [10, 128, 64, 32, 5])
        self.assertEqual(metadata["parameters"], 11909)


if __name__ == "__main__":
    unittest.main()
