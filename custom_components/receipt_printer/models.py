"""Runtime models for the Receipt Printer integration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .api import ReceiptPrinterApi


@dataclass(slots=True)
class ReceiptPrinterRuntimeData:
    """Data shared by Receipt Printer platforms."""

    api: ReceiptPrinterApi
    printers: list[dict[str, Any]]
    jobs: list[dict[str, Any]]
