"""
Generates a sample LeanPayload, encodes it as protobuf, and POSTs it to /api/v1/cases/ingest.
Run from apps/api/: python scripts/send_test_payload.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main():
    pass


if __name__ == "__main__":
    main()
